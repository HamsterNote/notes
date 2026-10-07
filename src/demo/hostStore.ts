/**
 * 7.4 demo 宿主存储：localStorage 上的 HNN 持久化 + Web Locks 内的真实 CAS revision 比较。
 * 绝不无条件返回 saved——只有 baseRevision 与已存 revision 一致（或双方均为空）
 * 才写出并分配新 revision；已存内容损坏视为无法验证基线，同样判冲突，绝不静默
 * 覆盖无法读取的数据。库内 abort 只保护库内状态，这里的 CAS 是宿主侧真实防线。
 *
 * 并发防线：所有读-比较-写（含 overwriteExternal）都在「每个持久化 key 一把排他锁」
 * 内完成。默认使用浏览器 Web Locks（跨标签页/跨实例互斥）；构造时若运行环境不提供
 * Web Locks（非安全上下文、旧浏览器、SSR/测试宿主），保存与外部写入必须 fail closed：
 * 抛出显式错误且绝不落盘，绝不降级为「read-check-write」这种非原子伪 CAS。
 */

export interface StoredNoteSnapshot {
  readonly revision: string
  readonly document: unknown
}

export type CasSaveResult =
  | Readonly<{ kind: "saved"; revision: string }>
  | Readonly<{ kind: "conflict" }>

/**
 * 最小排他锁接口：同一 key 的任务严格串行执行，任务可同步或异步。
 * 生产默认为 Web Locks；测试可注入进程内实现（见 createInMemoryExclusiveLock），
 * 从而让两个 store 实例共享同一把真实锁、确定性地复现「恰好一个 saved、一个 conflict」。
 */
export interface ExclusiveLock {
  run<T>(key: string, task: () => T | Promise<T>): Promise<T>
}

/**
 * Web Locks 不可用时的显式失败（fail closed）。宿主保存/外部写入会以该错误拒绝，
 * 绝不写入任何字节；调用方应将其呈现为「无法安全保存」，而不是 saved 或 conflict。
 */
export class HnnStoreLockUnavailableError extends Error {
  constructor(
    message = "当前环境不提供 Web Locks（需 HTTPS 或 localhost，且浏览器支持），无法保证写入原子性，已拒绝写入"
  ) {
    super(message)
    this.name = "HnnStoreLockUnavailableError"
  }
}

export interface DemoNoteStore {
  /** 读取已存快照；从未保存或内容损坏（无法展示）时返回 null。load 只读，不需要锁。 */
  load(documentId: string): StoredNoteSnapshot | null
  /**
   * 真实 CAS 写出（异步：必须先在每 key 排他锁内 read+compare+write）：
   * - 锁不可用 → 以 HnnStoreLockUnavailableError 拒绝，绝不写入（fail closed）；
   * - 已存损坏 → conflict（无法验证基线，绝不覆盖）；
   * - 从未保存但 baseRevision 非空 → conflict（基线对应的版本已不存在）；
   * - 已存 revision 与 baseRevision 不一致 → conflict（另一客户端已写过）。
   */
  saveWithCas(documentId: string, document: unknown, baseRevision: string | undefined): Promise<CasSaveResult>
  /**
   * 模拟另一客户端直接写入（不经编辑器）；同样在每 key 排他锁内完成，避免绕开并发互斥；
   * 文档从未保存过或已损坏时返回 null（无副作用）。锁不可用时以显式错误拒绝。
   */
  overwriteExternal(
    documentId: string,
    mutate: (document: unknown) => unknown
  ): Promise<StoredNoteSnapshot | null>
}

type RawRead =
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "corrupt" }>
  | Readonly<{ status: "ok"; value: StoredNoteSnapshot }>

const DEFAULT_KEY_PREFIX = "hamster-note-demo:hnn:v1:"

/**
 * 规范 revision：`r` + 非负十进制整数且无前导零（r0、r1、r9007199254740993…）。
 * 用于严格解析与损坏判定，取代会接受 r01/r1junk 的宽松 `/^r(\d+)$/` + parseInt。
 */
const CANONICAL_REVISION = /^r(0|[1-9][0-9]*)$/

/**
 * 基于浏览器 Web Locks 的每 key 排他锁。锁名直接复用持久化 key（由调用方传入），
 * 保证「同一 documentId 写入」跨 store 实例/跨标签页互斥。
 * 不支持 Web Locks 时抛 HnnStoreLockUnavailableError（fail closed），绝不静默降级。
 */
export function createWebLocksExclusiveLock(): ExclusiveLock {
  return {
    async run<T>(key: string, task: () => T | Promise<T>): Promise<T> {
      const locks: LockManager | undefined =
        typeof navigator === "undefined" ? undefined : navigator.locks
      if (locks === undefined) throw new HnnStoreLockUnavailableError()
      // Web Locks 在锁授予后才执行回调；回调的 rejection 会原样向上传播。
      return locks.request(key, { mode: "exclusive" }, () => task())
    }
  }
}

/**
 * 进程内排他锁：仅用于测试注入，让同 realm 的多个 store 实例共享同一把真实串行锁。
 * 它不能提供跨标签页/跨进程互斥，生产环境绝不使用（也不作为 Web Locks 缺失时的回退）。
 */
export function createInMemoryExclusiveLock(): ExclusiveLock {
  const tails = new Map<string, Promise<unknown>>()
  return {
    run<T>(key: string, task: () => T | Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve()
      const result = previous.then(() => task())
      // 无论成败都让后续同 key 任务继续排队；吞掉拒绝只为防止链上 unhandled rejection，
      // 真正的失败仍通过返回的 result 传播给本次调用方。
      tails.set(
        key,
        result.then(
          () => undefined,
          () => undefined
        )
      )
      return result
    }
  }
}

/** storage 可注入以便测试隔离；默认 localStorage（jsdom 与真实浏览器均可用）。 */
export function createLocalStorageNoteStore(
  storage: Storage = localStorage,
  keyPrefix: string = DEFAULT_KEY_PREFIX,
  lock: ExclusiveLock = createWebLocksExclusiveLock()
): DemoNoteStore {
  const keyOf = (documentId: string): string => `${keyPrefix}${encodeURIComponent(documentId)}`

  const readRaw = (documentId: string): RawRead => {
    const raw = storage.getItem(keyOf(documentId))
    if (raw === null) return { status: "absent" }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== "object" || parsed === null) return { status: "corrupt" }
      const record = parsed as Record<string, unknown>
      const revision = record["revision"]
      // revision 必须是规范形式 rN（非负十进制、无前导零）。非规范（r01/r1junk/r-1…）
      // 一律视为无法验证基线的损坏数据：load null、保存 conflict、overwrite null，
      // 绝不借 parseInt 的宽松解析写出，也绝不被覆盖。
      if (typeof revision !== "string" || !CANONICAL_REVISION.test(revision)) return { status: "corrupt" }
      if (!("document" in record)) return { status: "corrupt" }
      return { status: "ok", value: { revision, document: record["document"] } }
    } catch {
      return { status: "corrupt" }
    }
  }

  const write = (documentId: string, value: StoredNoteSnapshot): void => {
    storage.setItem(keyOf(documentId), JSON.stringify(value))
  }

  /** revision 采用 r1、r2… 单调递增，便于演示中肉眼核对 CAS 基线。 */
  const nextRevision = (current: string | undefined): string => {
    if (current === undefined) return "r1"
    const match = CANONICAL_REVISION.exec(current)
    const digits = match?.[1]
    // readRaw 已保证规范；此处防御性硬失败，绝不回退到 parseInt 的宽松解析。
    if (digits === undefined) throw new Error(`非规范 revision，无法递增：${current}`)
    // BigInt 递增：超过 Number.MAX_SAFE_INTEGER 也严格 +1 不丢精度。
    return `r${(BigInt(digits) + 1n).toString()}`
  }

  /** 在与 documentId 对应的持久化 key 锁内执行读-比较-写；不可用锁时拒绝且不写。 */
  const withKeyLock = <T>(documentId: string, task: () => T | Promise<T>): Promise<T> =>
    lock.run(keyOf(documentId), task)

  return {
    load(documentId) {
      const raw = readRaw(documentId)
      return raw.status === "ok" ? raw.value : null
    },
    saveWithCas(documentId, document, baseRevision) {
      return withKeyLock(documentId, (): CasSaveResult => {
        const raw = readRaw(documentId)
        if (raw.status === "corrupt") return { kind: "conflict" }
        const current = raw.status === "ok" ? raw.value : null
        if (current === null && baseRevision !== undefined) return { kind: "conflict" }
        if (current !== null && current.revision !== baseRevision) return { kind: "conflict" }
        const revision = nextRevision(current?.revision)
        write(documentId, { revision, document })
        return { kind: "saved", revision }
      })
    },
    overwriteExternal(documentId, mutate) {
      return withKeyLock(documentId, (): StoredNoteSnapshot | null => {
        const raw = readRaw(documentId)
        if (raw.status !== "ok") return null
        const next: StoredNoteSnapshot = {
          revision: nextRevision(raw.value.revision),
          document: mutate(structuredClone(raw.value.document))
        }
        write(documentId, next)
        return next
      })
    }
  }
}
