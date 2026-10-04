/**
 * 7.4 demo 宿主存储：localStorage 上的 HNN 持久化 + 真实 CAS revision 比较。
 * 绝不无条件返回 saved——只有 baseRevision 与已存 revision 一致（或双方均为空）
 * 才写出并分配新 revision；已存内容损坏视为无法验证基线，同样判冲突，绝不静默
 * 覆盖无法读取的数据。库内 abort 只保护库内状态，这里的 CAS 是宿主侧真实防线。
 */

export interface StoredNoteSnapshot {
  readonly revision: string
  readonly document: unknown
}

export type CasSaveResult =
  | Readonly<{ kind: "saved"; revision: string }>
  | Readonly<{ kind: "conflict" }>

export interface DemoNoteStore {
  /** 读取已存快照；从未保存或内容损坏（无法展示）时返回 null。 */
  load(documentId: string): StoredNoteSnapshot | null
  /**
   * 真实 CAS 写出：
   * - 已存损坏 → conflict（无法验证基线，绝不覆盖）；
   * - 从未保存但 baseRevision 非空 → conflict（基线对应的版本已不存在）；
   * - 已存 revision 与 baseRevision 不一致 → conflict（另一客户端已写过）。
   */
  saveWithCas(documentId: string, document: unknown, baseRevision: string | undefined): CasSaveResult
  /** 模拟另一客户端直接写入（不经编辑器）；文档从未保存过或已损坏时返回 null。 */
  overwriteExternal(documentId: string, mutate: (document: unknown) => unknown): StoredNoteSnapshot | null
}

type RawRead =
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "corrupt" }>
  | Readonly<{ status: "ok"; value: StoredNoteSnapshot }>

const DEFAULT_KEY_PREFIX = "hamster-note-demo:hnn:v1:"

/** storage 可注入以便测试隔离；默认 localStorage（jsdom 与真实浏览器均可用）。 */
export function createLocalStorageNoteStore(
  storage: Storage = localStorage,
  keyPrefix: string = DEFAULT_KEY_PREFIX
): DemoNoteStore {
  const keyOf = (documentId: string): string => `${keyPrefix}${encodeURIComponent(documentId)}`

  const readRaw = (documentId: string): RawRead => {
    const raw = storage.getItem(keyOf(documentId))
    if (raw === null) return { status: "absent" }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== "object" || parsed === null) return { status: "corrupt" }
      const record = parsed as Record<string, unknown>
      if (typeof record["revision"] !== "string" || record["revision"] === "") return { status: "corrupt" }
      if (!("document" in record)) return { status: "corrupt" }
      return { status: "ok", value: { revision: record["revision"], document: record["document"] } }
    } catch {
      return { status: "corrupt" }
    }
  }

  const write = (documentId: string, value: StoredNoteSnapshot): void => {
    storage.setItem(keyOf(documentId), JSON.stringify(value))
  }

  /** revision 采用 r1、r2… 单调递增，便于演示中肉眼核对 CAS 基线。 */
  const nextRevision = (current: string | undefined): string => {
    const match = /^r(\d+)$/.exec(current ?? "")
    const base = match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10)
    return `r${base + 1}`
  }

  return {
    load(documentId) {
      const raw = readRaw(documentId)
      return raw.status === "ok" ? raw.value : null
    },
    saveWithCas(documentId, document, baseRevision) {
      const raw = readRaw(documentId)
      if (raw.status === "corrupt") return { kind: "conflict" }
      const current = raw.status === "ok" ? raw.value : null
      if (current === null && baseRevision !== undefined) return { kind: "conflict" }
      if (current !== null && current.revision !== baseRevision) return { kind: "conflict" }
      const revision = nextRevision(current?.revision)
      write(documentId, { revision, document })
      return { kind: "saved", revision }
    },
    overwriteExternal(documentId, mutate) {
      const raw = readRaw(documentId)
      if (raw.status !== "ok") return null
      const next: StoredNoteSnapshot = {
        revision: nextRevision(raw.value.revision),
        document: mutate(structuredClone(raw.value.document))
      }
      write(documentId, next)
      return next
    }
  }
}
