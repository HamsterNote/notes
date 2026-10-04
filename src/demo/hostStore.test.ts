/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest"
import { createLocalStorageNoteStore } from "./hostStore"

/** hostStore 只关心 opaque document + revision，不校验 HNN 结构。 */
const doc = (marker: string): unknown => ({ schemaVersion: 1, data: { type: "doc", marker } })

describe("demo hostStore — localStorage 真实 CAS", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("首次保存（无 baseRevision）写出 r1 并可读回", () => {
    const store = createLocalStorageNoteStore()
    const result = store.saveWithCas("doc-a", doc("v1"), undefined)
    expect(result).toEqual({ kind: "saved", revision: "r1" })
    expect(store.load("doc-a")).toEqual({ revision: "r1", document: doc("v1") })
  })

  it("baseRevision 匹配已存 revision 时保存成功并递增 revision", () => {
    const store = createLocalStorageNoteStore()
    store.saveWithCas("doc-a", doc("v1"), undefined)
    const result = store.saveWithCas("doc-a", doc("v2"), "r1")
    expect(result).toEqual({ kind: "saved", revision: "r2" })
    expect(store.load("doc-a")).toEqual({ revision: "r2", document: doc("v2") })
  })

  it("baseRevision 过期时判冲突且绝不覆盖已存内容（真实 CAS，非无条件 saved）", () => {
    const store = createLocalStorageNoteStore()
    store.saveWithCas("doc-a", doc("v1"), undefined)
    store.saveWithCas("doc-a", doc("v2"), "r1")
    const result = store.saveWithCas("doc-a", doc("stale"), "r1")
    expect(result).toEqual({ kind: "conflict" })
    // 存储保持 r2/v2，陈旧写入被完整拒绝。
    expect(store.load("doc-a")).toEqual({ revision: "r2", document: doc("v2") })
  })

  it("从未保存过却携带 baseRevision 时判冲突（基线版本已不存在）", () => {
    const store = createLocalStorageNoteStore()
    expect(store.saveWithCas("doc-a", doc("v1"), "r9")).toEqual({ kind: "conflict" })
    expect(store.load("doc-a")).toBeNull()
  })

  it("已存内容损坏：load 返回 null、保存判冲突、原始字节不被覆盖", () => {
    const store = createLocalStorageNoteStore()
    store.saveWithCas("doc-a", doc("v1"), undefined)
    const key = [...Array.from({ length: localStorage.length }).keys()]
      .map((index) => localStorage.key(index))
      .find((name) => name?.includes("doc-a"))
    expect(key).toBeDefined()
    localStorage.setItem(key as string, "{broken json")

    expect(store.load("doc-a")).toBeNull()
    expect(store.saveWithCas("doc-a", doc("v2"), "r1")).toEqual({ kind: "conflict" })
    // 无法验证基线时绝不静默写丢：原始（损坏的）字节原样保留，等待人工处理。
    expect(localStorage.getItem(key as string)).toBe("{broken json")
  })

  it("overwriteExternal 模拟另一客户端写入：revision 递增，随后旧基线保存判冲突", () => {
    const store = createLocalStorageNoteStore()
    store.saveWithCas("doc-a", doc("v1"), undefined)

    const external = store.overwriteExternal("doc-a", (current) => {
      expect(current).toEqual(doc("v1"))
      return doc("external")
    })
    expect(external).toEqual({ revision: "r2", document: doc("external") })
    expect(store.load("doc-a")).toEqual({ revision: "r2", document: doc("external") })
    // 编辑器仍持有 r1 基线 → CAS 拒绝。
    expect(store.saveWithCas("doc-a", doc("v2"), "r1")).toEqual({ kind: "conflict" })
    // 采用外部版本后（基线 r2）可继续保存。
    expect(store.saveWithCas("doc-a", doc("v3"), "r2")).toEqual({ kind: "saved", revision: "r3" })
  })

  it("overwriteExternal 对从未保存或已损坏的文档返回 null（无副作用）", () => {
    const store = createLocalStorageNoteStore()
    expect(store.overwriteExternal("missing", () => doc("x"))).toBeNull()
    localStorage.setItem("hamster-note-demo:hnn:v1:broken", "not json")
    expect(store.overwriteExternal("broken", () => doc("x"))).toBeNull()
    expect(localStorage.getItem("hamster-note-demo:hnn:v1:broken")).toBe("not json")
  })

  it("不同 documentId 的存储互不影响", () => {
    const store = createLocalStorageNoteStore()
    store.saveWithCas("doc-a", doc("a1"), undefined)
    store.saveWithCas("doc-b", doc("b1"), undefined)
    expect(store.load("doc-a")?.document).toEqual(doc("a1"))
    expect(store.load("doc-b")?.document).toEqual(doc("b1"))
    expect(store.saveWithCas("doc-b", doc("b2"), "r1")).toEqual({ kind: "saved", revision: "r2" })
    // doc-a 的 revision 不受 doc-b 写出的影响。
    expect(store.load("doc-a")?.revision).toBe("r1")
  })
})
