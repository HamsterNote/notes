/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest"
import {
  HnnStoreLockUnavailableError,
  createInMemoryExclusiveLock,
  createLocalStorageNoteStore,
  type ExclusiveLock
} from "./hostStore"

/** hostStore 只关心 opaque document + revision，不校验 HNN 结构。 */
const doc = (marker: string): unknown => ({ schemaVersion: 1, data: { type: "doc", marker } })

const PREFIX = "hamster-note-demo-test:"

/** 测试统一注入进程内真实排他锁：jsdom 无 Web Locks，默认锁会 fail closed。 */
const createStore = (lock: ExclusiveLock = createInMemoryExclusiveLock()) =>
  createLocalStorageNoteStore(localStorage, PREFIX, lock)

describe("demo hostStore — localStorage 真实 CAS", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("首次保存（无 baseRevision）写出 r1 并可读回", async () => {
    const store = createStore()
    const result = await store.saveWithCas("doc-a", doc("v1"), undefined)
    expect(result).toEqual({ kind: "saved", revision: "r1" })
    expect(store.load("doc-a")).toEqual({ revision: "r1", document: doc("v1") })
  })

  it("baseRevision 匹配已存 revision 时保存成功并递增 revision", async () => {
    const store = createStore()
    await store.saveWithCas("doc-a", doc("v1"), undefined)
    const result = await store.saveWithCas("doc-a", doc("v2"), "r1")
    expect(result).toEqual({ kind: "saved", revision: "r2" })
    expect(store.load("doc-a")).toEqual({ revision: "r2", document: doc("v2") })
  })

  it("baseRevision 过期时判冲突且绝不覆盖已存内容（真实 CAS，非无条件 saved）", async () => {
    const store = createStore()
    await store.saveWithCas("doc-a", doc("v1"), undefined)
    await store.saveWithCas("doc-a", doc("v2"), "r1")
    const result = await store.saveWithCas("doc-a", doc("stale"), "r1")
    expect(result).toEqual({ kind: "conflict" })
    // 存储保持 r2/v2，陈旧写入被完整拒绝。
    expect(store.load("doc-a")).toEqual({ revision: "r2", document: doc("v2") })
  })

  it("从未保存过却携带 baseRevision 时判冲突（基线版本已不存在）", async () => {
    const store = createStore()
    expect(await store.saveWithCas("doc-a", doc("v1"), "r9")).toEqual({ kind: "conflict" })
    expect(store.load("doc-a")).toBeNull()
  })

  it("已存内容损坏：load 返回 null、保存判冲突、原始字节不被覆盖", async () => {
    const store = createStore()
    await store.saveWithCas("doc-a", doc("v1"), undefined)
    const key = [...Array.from({ length: localStorage.length }).keys()]
      .map((index) => localStorage.key(index))
      .find((name) => name?.includes("doc-a"))
    expect(key).toBeDefined()
    localStorage.setItem(key as string, "{broken json")

    expect(store.load("doc-a")).toBeNull()
    expect(await store.saveWithCas("doc-a", doc("v2"), "r1")).toEqual({ kind: "conflict" })
    // 无法验证基线时绝不静默写丢：原始（损坏的）字节原样保留，等待人工处理。
    expect(localStorage.getItem(key as string)).toBe("{broken json")
  })

  it("overwriteExternal 模拟另一客户端写入：revision 递增，随后旧基线保存判冲突", async () => {
    const store = createStore()
    await store.saveWithCas("doc-a", doc("v1"), undefined)

    const external = await store.overwriteExternal("doc-a", (current) => {
      expect(current).toEqual(doc("v1"))
      return doc("external")
    })
    expect(external).toEqual({ revision: "r2", document: doc("external") })
    expect(store.load("doc-a")).toEqual({ revision: "r2", document: doc("external") })
    // 编辑器仍持有 r1 基线 → CAS 拒绝。
    expect(await store.saveWithCas("doc-a", doc("v2"), "r1")).toEqual({ kind: "conflict" })
    // 采用外部版本后（基线 r2）可继续保存。
    expect(await store.saveWithCas("doc-a", doc("v3"), "r2")).toEqual({ kind: "saved", revision: "r3" })
  })

  it("overwriteExternal 对从未保存或已损坏的文档返回 null（无副作用）", async () => {
    const store = createStore()
    expect(await store.overwriteExternal("missing", () => doc("x"))).toBeNull()
    localStorage.setItem(`${PREFIX}broken`, "not json")
    expect(await store.overwriteExternal("broken", () => doc("x"))).toBeNull()
    expect(localStorage.getItem(`${PREFIX}broken`)).toBe("not json")
  })

  it("不同 documentId 的存储互不影响", async () => {
    const store = createStore()
    await store.saveWithCas("doc-a", doc("a1"), undefined)
    await store.saveWithCas("doc-b", doc("b1"), undefined)
    expect(store.load("doc-a")?.document).toEqual(doc("a1"))
    expect(store.load("doc-b")?.document).toEqual(doc("b1"))
    expect(await store.saveWithCas("doc-b", doc("b2"), "r1")).toEqual({ kind: "saved", revision: "r2" })
    // doc-a 的 revision 不受 doc-b 写出的影响。
    expect(store.load("doc-a")?.revision).toBe("r1")
  })
})

describe("demo hostStore — Web Locks 原子性与 fail closed", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("跨 store 实例共享同一把排他锁：基于同一 r1 并发保存，恰好一个 saved、一个 conflict，获胜快照未被覆盖", async () => {
    // 两个实例代表同一浏览器的两个客户端，共享同一把真实排他锁（模拟 Web Locks 跨实例互斥）。
    const lock = createInMemoryExclusiveLock()
    const storeA = createStore(lock)
    const storeB = createStore(lock)
    await storeA.saveWithCas("doc-a", doc("v1"), undefined)
    expect(storeA.load("doc-a")).toEqual({ revision: "r1", document: doc("v1") })

    // 两者都基于 r1 并发提交：没有锁时二者都会读到 r1 并双双写丢其中一份。
    const [resultA, resultB] = await Promise.all([
      storeA.saveWithCas("doc-a", doc("winnerA"), "r1"),
      storeB.saveWithCas("doc-a", doc("winnerB"), "r1")
    ])
    const outcomes = [
      { result: resultA, document: doc("winnerA") },
      { result: resultB, document: doc("winnerB") }
    ]
    const saved = outcomes.filter((outcome) => outcome.result.kind === "saved")
    const conflicted = outcomes.filter((outcome) => outcome.result.kind === "conflict")
    // 恰好一个成功、一个冲突（严格串行 CAS，无丢失更新）。
    expect(saved).toHaveLength(1)
    expect(conflicted).toHaveLength(1)
    expect(saved[0]?.result).toEqual({ kind: "saved", revision: "r2" })

    // 存储中保留的是获胜者的完整快照，失败写入没有覆盖它。
    const stored = storeA.load("doc-a")
    expect(stored?.revision).toBe("r2")
    expect(stored?.document).toEqual(saved[0]?.document)
    const loser = outcomes.find((outcome) => outcome.result.kind === "conflict")
    expect(stored?.document).not.toEqual(loser?.document)
  })

  it("overwriteExternal 与 saveWithCas 共用同一把 key 锁，外部写入不会绕开并发互斥", async () => {
    const lock = createInMemoryExclusiveLock()
    const storeA = createStore(lock)
    const storeB = createStore(lock)
    await storeA.saveWithCas("doc-a", doc("v1"), undefined)

    // 外部覆盖与旧基线保存并发：锁保证顺序确定，revision 严格递增，绝无交叠写。
    const [external, save] = await Promise.all([
      storeB.overwriteExternal("doc-a", () => doc("external")),
      storeA.saveWithCas("doc-a", doc("editor"), "r1")
    ])
    // 二者互斥：外部先拿到锁 → 编辑器保存基于 r1 冲突；否则编辑器先写 r2，外部再写 r3。
    if (save.kind === "conflict") {
      expect(external).toEqual({ revision: "r2", document: doc("external") })
      expect(storeA.load("doc-a")).toEqual({ revision: "r2", document: doc("external") })
    } else {
      expect(save).toEqual({ kind: "saved", revision: "r2" })
      expect(external).toEqual({ revision: "r3", document: doc("external") })
      expect(storeA.load("doc-a")).toEqual({ revision: "r3", document: doc("external") })
    }
  })

  it("Web Locks 不可用时 fail closed：saveWithCas/overwriteExternal 显式报错且绝不写入", async () => {
    // jsdom 的 navigator 不提供 locks —— 默认锁必须拒绝，而不是降级为非原子 CAS。
    expect(typeof navigator === "undefined" ? undefined : navigator.locks).toBeUndefined()
    const store = createLocalStorageNoteStore(localStorage, PREFIX)

    await expect(store.saveWithCas("doc-a", doc("v1"), undefined)).rejects.toBeInstanceOf(
      HnnStoreLockUnavailableError
    )
    expect(store.load("doc-a")).toBeNull()
    expect(localStorage.getItem(`${PREFIX}doc-a`)).toBeNull()

    await expect(store.overwriteExternal("doc-a", () => doc("x"))).rejects.toBeInstanceOf(
      HnnStoreLockUnavailableError
    )
    expect(localStorage.getItem(`${PREFIX}doc-a`)).toBeNull()
  })

  it("注入锁抛错时保存拒绝且不落盘（显式失败优于静默覆盖）", async () => {
    const failingLock: ExclusiveLock = {
      run: () => Promise.reject(new HnnStoreLockUnavailableError("测试：锁不可用"))
    }
    const store = createStore(failingLock)
    await expect(store.saveWithCas("doc-a", doc("v1"), undefined)).rejects.toBeInstanceOf(
      HnnStoreLockUnavailableError
    )
    expect(localStorage.getItem(`${PREFIX}doc-a`)).toBeNull()
  })
})

describe("demo hostStore — revision 规范与精度", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  const rawKey = (documentId: string): string => `${PREFIX}${encodeURIComponent(documentId)}`
  const seedRaw = (documentId: string, revision: string, document: unknown): string => {
    const raw = JSON.stringify({ revision, document })
    localStorage.setItem(rawKey(documentId), raw)
    return raw
  }

  // 2^53：Number.parseInt 递增会因浮点精度原地踏步，BigInt 才能严格递增。
  const BIG = "9007199254740992"
  const BIG_NEXT = (BigInt(BIG) + 1n).toString()
  const bigBase = `r${BIG}`

  it("revision 达到/超过 MAX_SAFE_INTEGER：双 client 同锁基于同一 baseline 并发，恰好一个 saved、一个 conflict，且严格 +1 不丢精度", async () => {
    const lock = createInMemoryExclusiveLock()
    const storeA = createStore(lock)
    const storeB = createStore(lock)
    seedRaw("doc-a", bigBase, doc("base"))

    const [resA, resB] = await Promise.all([
      storeA.saveWithCas("doc-a", doc("big-A"), bigBase),
      storeB.saveWithCas("doc-a", doc("big-B"), bigBase)
    ])
    const outcomes = [
      { result: resA, document: doc("big-A") },
      { result: resB, document: doc("big-B") }
    ]
    const saved = outcomes.filter((outcome) => outcome.result.kind === "saved")
    const conflicted = outcomes.filter((outcome) => outcome.result.kind === "conflict")
    // 缺陷版本下 parseInt(base)+1 === base，两个 client 都会 saved 同一 revision。
    expect(saved).toHaveLength(1)
    expect(conflicted).toHaveLength(1)
    expect(saved[0]?.result).toEqual({ kind: "saved", revision: `r${BIG_NEXT}` })

    const stored = storeA.load("doc-a")
    expect(stored?.revision).toBe(`r${BIG_NEXT}`)
    expect(BigInt(stored!.revision.slice(1))).toBe(BigInt(bigBase.slice(1)) + 1n)
    // 存储中保留的是获胜者完整快照。
    expect(stored?.document).toEqual(saved[0]?.document)
    expect(stored?.document).not.toEqual(conflicted[0]?.document)
  })

  it("overwriteExternal 在超大 revision 下同样产生严格递增的新 revision，不覆盖为旧值", async () => {
    const store = createStore()
    seedRaw("doc-a", bigBase, doc("base"))
    const next = await store.overwriteExternal("doc-a", () => doc("external"))
    expect(next).toEqual({ revision: `r${BIG_NEXT}`, document: doc("external") })
    expect(store.load("doc-a")).toEqual({ revision: `r${BIG_NEXT}`, document: doc("external") })
  })

  it("规范 revision 的边界：r0 可递增为 r1，且大数保持十进制无指数形式", async () => {
    const store = createStore()
    seedRaw("doc-a", "r0", doc("zero"))
    expect(await store.saveWithCas("doc-a", doc("one"), "r0")).toEqual({ kind: "saved", revision: "r1" })
    seedRaw("doc-b", bigBase, doc("big"))
    expect(await store.saveWithCas("doc-b", doc("big2"), bigBase)).toEqual({
      kind: "saved",
      revision: `r${BIG_NEXT}`
    })
  })

  it.each(["r01", "r00", "r1junk", "r-1", "r", "r1.5", "1", "R1", ""])(
    "非规范 revision %j 视为 corrupt：load null、保存冲突、overwrite null、原始字节绝不被覆盖",
    async (bad) => {
      const store = createStore()
      const raw = seedRaw("doc-a", bad, doc("base"))

      expect(store.load("doc-a")).toBeNull()
      // 即使 baseRevision 与已存「伪 revision」字面相等也绝不写出（避免 parseInt 宽松解析）。
      expect(await store.saveWithCas("doc-a", doc("v2"), bad)).toEqual({ kind: "conflict" })
      expect(await store.saveWithCas("doc-a", doc("v3"), undefined)).toEqual({ kind: "conflict" })
      expect(await store.overwriteExternal("doc-a", () => doc("x"))).toBeNull()
      expect(localStorage.getItem(rawKey("doc-a"))).toBe(raw)
    }
  )
})
