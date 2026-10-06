import type { Editor } from "@tiptap/core"
import { TextSelection, type Transaction } from "@tiptap/pm/state"
import { isSafeHnnUrl } from "../hnn/urlPolicy"
import type { HostReferenceInstaller } from "./hostReferences"
import type { HostCandidateKind, HostReferenceActivation, HostReferenceCandidate, HostReferenceKind } from "./types"

/**
 * 7.2 宿主引用的交互桥（headless，与 React 组件解耦）：
 * - 触发识别：仅在空 TextSelection 的当前 textblock 内识别 `@query`（mention）与
 *   `[[query`（resource）；`@` 前必须是行首或空白，避免邮箱等文本误触发。触发串
 *   规格未钉死，此处采用 DESIGN.md §14 的 `@` 与常见的 `[[` wiki 资源约定；
 * - 候选生命周期：触发/查询/range 变化调用 installer.requestCandidates（旧请求随之
 *   abort），selection 变化、失焦、Escape、compositionstart、destroy 一律 cancelCandidates；
 *   composition（IME）期间不识别、不抢键，旧候选不可点/不可接受；
 * - focus gate：仅在编辑器聚焦时识别触发；blur 后后台 doc/history/resolve 刷新不会
 *   自动重开候选，重新 focus 时按当前光标只读识别一次（不改动 selection/文档）。初始
 *   focus 尊重编辑器既有聚焦状态（editor.isFocused）；
 * - 键盘：菜单打开时在 document capture 阶段拦截 ArrowUp/ArrowDown/Enter/Escape
 *   （先于 ProseMirror 自身 keydown），环形移动高亮，Enter 以存储的触发 range 精确
 *   替换插入（单 transaction 单 undo 步由 installer 保证）；
 * - 旧 range 保护：真正插入前重新校验当前 selection 与文档文本仍等于触发串，
 *   否则放弃插入并取消，旧 range 绝不插到新光标；
 * - 点击/键盘激活：在编辑器 DOM 上做事件委托，命中 mention/resource/externalItem 的
 *   NodeView dom 时经 posAtDOM 取回节点 attrs 交给 installer.activate，不自行导航；
 *   hnmagic link mark 以 kind/href 交宿主，无回调仍阻止原生协议跳转；普通 URL 不接管；
 *   宿主提供 activate（installer.hasActivate）时才在运行时给引用 dom 补
 *   tabindex="0"/role="link"（运行时 attribute，不进 PM/HNN），Enter/Space 激活，
 *   无回调则无任何 tab stop 与链接语义（DESIGN.md §16）；
 * - 解析状态呈现：订阅 installer 的 resolve mapping，以 data-hnn-resolve-status /
 *   title DOM attribute 呈现 loading/resolved/missing/error（NodeView 均
 *   ignoreMutation:true，外部 attribute 不会破坏文档或 DOM selection，也不把
 *   label/description 写进 PM/HNN）；
 * - a11y：菜单打开期间在编辑根节点维护 aria-expanded/aria-controls/
 *   aria-activedescendant（focus 保留在编辑器，符合 combobox 模式）。
 */

/** PM textBetween 对无文本叶子节点（atom 引用）的占位符。 */
const LEAF_PLACEHOLDER = "\ufffc"
/** 候选触发词：`@` 前必须是行首或空白；查询字符排除空白/@/对象替换符。 */
const MENTION_TRIGGER = /(?:^|\s)@([^\s@\ufffc]{0,64})$/u
/** 资源触发词：`[[query`，查询字符排除方括号/换行/对象替换符。 */
const RESOURCE_TRIGGER = /\[\[([^\][\n\ufffc]{0,64})$/u

const REFERENCE_DOM_SELECTOR = '[data-hnn-node="mention"],[data-hnn-node="resource"],[data-hnn-node="externalItem"]'

let menuCounter = 0

export type HostReferenceTrigger = Readonly<{
  kind: HostCandidateKind
  query: string
  /** 触发串（含 `@`/`[[`）在文档中的精确范围，选择候选时整体替换。 */
  from: number
  to: number
}>

export type HostReferenceInteractionState = Readonly<{
  /** null 表示候选菜单关闭。 */
  trigger: HostReferenceTrigger | null
  /** 键盘高亮项下标；UI 侧按候选数量 clamp 后渲染。 */
  activeIndex: number
}>

export interface HostReferenceInteractions {
  getState(): HostReferenceInteractionState
  subscribe(listener: () => void): () => void
  /** listbox/option 的 DOM id，供 UI 渲染与 aria-activedescendant 对齐。 */
  readonly menuId: string
  optionId(index: number): string
  /**
   * 选择候选：校验存储 range 仍与当前光标/文档一致后交给 installer 精确替换；
   * 无论成败都收尾关闭菜单；插入为单 transaction 单 undo 步。
   */
  selectCandidate(candidate: HostReferenceCandidate): boolean
  setActiveIndex(index: number): void
  /** 关闭菜单并取消候选请求；不改变触发文本。 */
  cancel(): void
  destroy(): void
}

const IDLE_INTERACTION_STATE: HostReferenceInteractionState = Object.freeze({ trigger: null, activeIndex: 0 })

/** 仅在空 TextSelection 的当前 textblock 内识别触发串；其它 selection 一律不触发。 */
function detectTrigger(editor: Editor): HostReferenceTrigger | null {
  const selection = editor.state.selection
  if (!(selection instanceof TextSelection) || !selection.empty) return null
  const $from = selection.$from
  const parent = $from.parent
  if (!parent.inlineContent) return null
  const textBefore = parent.textBetween(0, $from.parentOffset, "\n", LEAF_PLACEHOLDER)

  const resourceMatch = RESOURCE_TRIGGER.exec(textBefore)
  if (resourceMatch) {
    const query = resourceMatch[1] ?? ""
    return { kind: "resource", query, from: $from.pos - query.length - 2, to: $from.pos }
  }
  const mentionMatch = MENTION_TRIGGER.exec(textBefore)
  if (mentionMatch) {
    const query = mentionMatch[1] ?? ""
    return { kind: "mention", query, from: $from.pos - query.length - 1, to: $from.pos }
  }
  return null
}

function referenceIdAttr(kind: string): string {
  // mention 按 DESIGN.md §14 携带链接 id；resource/externalItem 暴露资源 id。
  return kind === "mention" ? "data-note-link-id" : "data-resource-id"
}

function isReferenceKind(value: string): value is HostReferenceKind {
  return value === "mention" || value === "resource" || value === "externalItem"
}

export function createHostReferenceInteractions(editor: Editor, installer: HostReferenceInstaller): HostReferenceInteractions {
  const menuId = `hn-reference-menu-${(menuCounter += 1)}`
  let destroyed = false
  let composing = false
  // focus gate：尊重桥创建前编辑器已有的聚焦状态；仅聚焦时识别触发。
  let focused = editor.isFocused
  let state: HostReferenceInteractionState = IDLE_INTERACTION_STATE
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  const setState = (next: HostReferenceInteractionState): void => {
    state = next
    notify()
  }

  const optionId = (index: number): string => `${menuId}-option-${index}`

  /** 菜单开闭与高亮同步到编辑根节点的 combobox aria 属性；focus 始终在编辑器。 */
  const syncAria = (): void => {
    if (destroyed || editor.isDestroyed) return
    const dom = editor.view.dom
    const trigger = state.trigger
    if (!trigger) {
      dom.removeAttribute("aria-expanded")
      dom.removeAttribute("aria-controls")
      dom.removeAttribute("aria-activedescendant")
      return
    }
    dom.setAttribute("aria-expanded", "true")
    dom.setAttribute("aria-controls", menuId)
    const candidateState = installer.getCandidateState()
    if (candidateState.status === "ready" && candidateState.kind === trigger.kind && candidateState.items.length > 0) {
      const index = Math.min(state.activeIndex, candidateState.items.length - 1)
      dom.setAttribute("aria-activedescendant", optionId(index))
    } else {
      dom.removeAttribute("aria-activedescendant")
    }
  }

  const cancel = (): void => {
    if (destroyed) return
    const wasOpen = state.trigger !== null
    if (wasOpen) setState(IDLE_INTERACTION_STATE)
    // installer 侧幂等：abort 在途请求并回到 idle，旧结果不会覆盖。
    installer.cancelCandidates()
    syncAria()
  }

  /** 触发识别驱动候选生命周期：触发/查询/range 变化重新请求，失去触发即取消。 */
  const recompute = (): void => {
    if (destroyed || editor.isDestroyed || composing) return
    // 未聚焦的编辑器不因后台 doc/history/resolve 刷新自动开候选。
    if (!focused) return
    const trigger = detectTrigger(editor)
    const prev = state.trigger
    if (!trigger) {
      if (prev) cancel()
      return
    }
    // kind/query/range 任一变化都视为新触发：requestCandidates 会 abort 旧请求，
    // 旧 range/旧查询的迟到结果不会覆盖新状态。
    if (!prev || prev.kind !== trigger.kind || prev.query !== trigger.query || prev.from !== trigger.from || prev.to !== trigger.to) {
      installer.requestCandidates(trigger.kind, trigger.query)
      setState({ trigger, activeIndex: 0 })
    }
    syncAria()
  }

  const selectCandidate = (candidate: HostReferenceCandidate): boolean => {
    const trigger = state.trigger
    if (!trigger || destroyed || editor.isDestroyed) return false
    // 旧 range 不能插到新光标：当前 selection 必须仍是停在 range.to 的空 TextSelection，
    // 且文档中的触发文本与识别时完全一致；任一不满足即放弃插入并取消。
    const selection = editor.state.selection
    const doc = editor.state.doc
    const expected = trigger.kind === "mention" ? `@${trigger.query}` : `[[${trigger.query}`
    const valid = selection instanceof TextSelection
      && selection.empty
      && selection.from === trigger.to
      && trigger.from >= 0
      && trigger.to <= doc.content.size
      && doc.textBetween(trigger.from, trigger.to, "\n", LEAF_PLACEHOLDER) === expected
    if (!valid) {
      cancel()
      return false
    }
    const inserted = installer.selectCandidate(trigger.kind, candidate, { from: trigger.from, to: trigger.to })
    // 成功由随后的 transaction 事件驱动 recompute 关闭菜单；失败也要显式收尾，
    // 绝不留着陈旧 range 等待下一次点击。
    cancel()
    return inserted
  }

  /**
   * document capture 拦截：先于 PM 自身的 keydown；composition 期间绝不抢键。
   * 两个分支严格区分：菜单打开时 Enter/方向/Escape 只属于候选导航；菜单关闭时
   * Enter/Space 才可能属于聚焦引用 pill 的宿主激活。
   */
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (destroyed || editor.isDestroyed) return
    if (composing || event.isComposing) return
    const target = event.target
    if (!(target instanceof Node) || !editor.view.dom.contains(target)) return
    const trigger = state.trigger
    if (trigger) {
      const candidateState = installer.getCandidateState()
      const ready = candidateState.status === "ready" && candidateState.kind === trigger.kind ? candidateState.items : []
      switch (event.key) {
        case "ArrowDown":
        case "ArrowUp": {
          // 无候选时放行方向键：光标移动经 selection 变化自然取消菜单。
          if (ready.length === 0) return
          event.preventDefault()
          event.stopPropagation()
          const delta = event.key === "ArrowDown" ? 1 : -1
          const current = Math.min(state.activeIndex, ready.length - 1)
          setState({ trigger, activeIndex: (current + delta + ready.length) % ready.length })
          syncAria()
          return
        }
        case "Enter": {
          if (ready.length === 0) return
          event.preventDefault()
          event.stopPropagation()
          const candidate = ready[Math.min(state.activeIndex, ready.length - 1)]
          if (candidate) void selectCandidate(candidate)
          return
        }
        case "Escape": {
          // 仅关闭菜单，不改变触发文本。
          event.preventDefault()
          event.stopPropagation()
          cancel()
          return
        }
        default:
          return
      }
    }
    // 菜单关闭：原生链接与引用 pill 的键盘激活。引用 pill 无回调时放行，
    // hnmagic 原生锚点即使无回调也要阻止导航。
    if (event.key !== "Enter" && event.key !== " ") return
    if (!(target instanceof Element)) return
    const magic = resolveMagicLinkTarget(target)
    if (magic) {
      // hnmagic 即使没有宿主回调也不得触发浏览器协议导航。
      event.preventDefault()
      event.stopPropagation()
      if (installer.hasActivate && !event.repeat) installer.activate(magic)
      return
    }
    if (!installer.hasActivate) return
    const refDom = target.closest(REFERENCE_DOM_SELECTOR)
    if (!refDom || !editor.view.dom.contains(refDom)) return
    const reference = resolveReferenceTarget(refDom)
    if (!reference) return
    // preventDefault：Space 不滚动页面、Enter 不被 PM 当编辑键；stopPropagation：不落入 PM。
    event.preventDefault()
    event.stopPropagation()
    installer.activate(reference)
  }

  /** 命中的引用 NodeView dom → 经 posAtDOM 取回节点 attrs；dom 与文档节点互验。 */
  const resolveReferenceTarget = (dom: Element): { kind: HostReferenceKind; resourceId: string; name: string } | null => {
    const parent = dom.parentNode
    if (!parent) return null
    let pos: number
    try {
      pos = editor.view.posAtDOM(parent, Array.prototype.indexOf.call(parent.childNodes, dom))
    } catch {
      return null
    }
    const node = editor.state.doc.nodeAt(pos)
    if (!node || !isReferenceKind(node.type.name)) return null
    if (dom.getAttribute("data-hnn-node") !== node.type.name) return null
    const resourceId: unknown = node.attrs["resourceId"]
    const name: unknown = node.attrs["name"]
    if (typeof resourceId !== "string" || resourceId.trim() === "") return null
    return { kind: node.type.name, resourceId, name: typeof name === "string" ? name : "" }
  }

  /** 仅识别真正 link mark 的魔法链接，DOM 属性不能伪造宿主激活。 */
  const resolveMagicLinkTarget = (target: Element): Extract<HostReferenceActivation, { kind: "hnmagic" }> | null => {
    const anchor = target.closest("a[href]")
    if (!anchor || !editor.view.dom.contains(anchor)) return null
    const href = anchor.getAttribute("href")
    if (!href?.startsWith("hnmagic:") || !isSafeHnnUrl(href)) return null
    try {
      const pos = editor.view.posAtDOM(anchor, 0)
      const node = editor.state.doc.nodeAt(pos)
      if (!node?.marks.some((mark) => mark.type.name === "link" && mark.attrs["href"] === href)) return null
    } catch {
      return null
    }
    return { kind: "hnmagic", href }
  }

  const handleClick = (event: MouseEvent): void => {
    if (destroyed || editor.isDestroyed) return
    const target = event.target
    if (!(target instanceof Element)) return
    const magic = resolveMagicLinkTarget(target)
    if (magic) {
      event.preventDefault()
      installer.activate(magic)
      return
    }
    const refDom = target.closest(REFERENCE_DOM_SELECTOR)
    if (!refDom || !editor.view.dom.contains(refDom)) return
    const reference = resolveReferenceTarget(refDom)
    if (reference) installer.activate(reference)
  }

  /** 中键走 auxclick 而非 click；同样禁用原生协议导航，但不重复触发宿主。 */
  const handleAuxClick = (event: MouseEvent): void => {
    if (destroyed || editor.isDestroyed || !(event.target instanceof Element)) return
    if (resolveMagicLinkTarget(event.target)) event.preventDefault()
  }

  /**
   * 键盘可达语义（DESIGN.md §16：仅宿主提供 activate 时才暴露链接语义）：
   * 运行时给引用 NodeView dom 补 tabindex="0"/role="link"，NodeView 均
   * ignoreMutation:true，attribute 不参与文档序列化、不进 PM/HNN；
   * 无回调时不加任何 tab stop。destroy 时按记录精确还原，不碰他人 attribute。
   */
  const linkSemanticDoms = new Set<HTMLElement>()
  const syncLinkSemantics = (dom: HTMLElement): void => {
    if (!installer.hasActivate || linkSemanticDoms.has(dom)) return
    dom.setAttribute("tabindex", "0")
    dom.setAttribute("role", "link")
    linkSemanticDoms.add(dom)
  }

  /**
   * 解析状态只写 DOM attribute（data-hnn-resolve-status/title）：NodeView 均
   * ignoreMutation:true，attribute 不参与文档序列化，也不触碰 DOM selection；
   * label/description 绝不写进 PM/HNN。
   */
  const syncReferenceDom = (): void => {
    if (destroyed || editor.isDestroyed) return
    const entries = new Map(installer.getReferenceState().entries.map((entry) => [`${entry.kind}\0${entry.resourceId}`, entry]))
    for (const dom of editor.view.dom.querySelectorAll(REFERENCE_DOM_SELECTOR)) {
      if (!(dom instanceof HTMLElement)) continue
      syncLinkSemantics(dom)
      const kind = dom.getAttribute("data-hnn-node")
      const resourceId = kind === null ? null : dom.getAttribute(referenceIdAttr(kind))
      const entry = kind !== null && resourceId !== null && resourceId !== "" ? entries.get(`${kind}\0${resourceId}`) : undefined
      if (!entry) {
        dom.removeAttribute("data-hnn-resolve-status")
        dom.removeAttribute("title")
        continue
      }
      dom.setAttribute("data-hnn-resolve-status", entry.status)
      if (entry.status === "resolved" && entry.label !== undefined) {
        dom.setAttribute("title", entry.description === undefined ? entry.label : `${entry.label}：${entry.description}`)
      } else {
        dom.removeAttribute("title")
      }
    }
  }

  const handleTransaction = (payload: { transaction: Transaction }): void => {
    // focus/blur 由专门事件处理：避免 focused 标志更新前在该 meta transaction 上误识别。
    if (payload.transaction.getMeta("focus") || payload.transaction.getMeta("blur")) {
      syncReferenceDom()
      return
    }
    recompute()
    // 文档变化后 NodeView 可能重建，引用状态 attribute 需要重刷。
    syncReferenceDom()
  }
  const handleFocus = (): void => {
    if (destroyed || editor.isDestroyed) return
    focused = true
    // 重新聚焦时按当前光标只读识别一次合法 trigger（不改动 selection/文档）。
    recompute()
  }
  const handleBlur = (): void => {
    focused = false
    // 用户失焦取消；点击候选经 pointerdown/mousedown preventDefault 不会触发 blur，
    // 因此存储 range 不会在选中前丢失。
    cancel()
  }
  const handleCompositionStart = (): void => {
    composing = true
    // IME 期间旧候选不可点/不可接受：取消触发并 abort 在途请求，
    // 迟到的旧 promise 结果由 installer token 机制丢弃，不会覆盖 idle。
    cancel()
  }
  const handleCompositionEnd = (): void => {
    composing = false
    recompute()
  }

  // 订阅句柄先声明后赋值，destroy 在任何时刻调用都安全。
  let unsubscribeReferences: () => void = () => undefined
  let unsubscribeCandidates: () => void = () => undefined

  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    unsubscribeReferences()
    unsubscribeCandidates()
    editor.off("transaction", handleTransaction)
    editor.off("focus", handleFocus)
    editor.off("blur", handleBlur)
    editor.off("destroy", destroy)
    const viewDom = editor.view.dom
    viewDom.removeEventListener("click", handleClick)
    viewDom.removeEventListener("auxclick", handleAuxClick)
    viewDom.removeEventListener("compositionstart", handleCompositionStart)
    viewDom.removeEventListener("compositionend", handleCompositionEnd)
    viewDom.ownerDocument.removeEventListener("keydown", handleKeyDown, true)
    installer.cancelCandidates()
    // 还原 aria、解析状态 attribute 与桥添加的键盘可达语义，DOM 不留桥接痕迹。
    if (!editor.isDestroyed) {
      viewDom.removeAttribute("aria-expanded")
      viewDom.removeAttribute("aria-controls")
      viewDom.removeAttribute("aria-activedescendant")
      for (const dom of viewDom.querySelectorAll(REFERENCE_DOM_SELECTOR)) {
        if (!(dom instanceof HTMLElement)) continue
        dom.removeAttribute("data-hnn-resolve-status")
        dom.removeAttribute("title")
      }
      for (const dom of linkSemanticDoms) {
        dom.removeAttribute("tabindex")
        dom.removeAttribute("role")
      }
    }
    linkSemanticDoms.clear()
    state = IDLE_INTERACTION_STATE
    listeners.clear()
  }

  editor.on("transaction", handleTransaction)
  editor.on("focus", handleFocus)
  editor.on("blur", handleBlur)
  editor.on("destroy", destroy)
  const viewDom = editor.view.dom
  viewDom.addEventListener("click", handleClick)
  viewDom.addEventListener("auxclick", handleAuxClick)
  viewDom.addEventListener("compositionstart", handleCompositionStart)
  viewDom.addEventListener("compositionend", handleCompositionEnd)
  viewDom.ownerDocument.addEventListener("keydown", handleKeyDown, true)
  // 候选到达/状态迁移时同步 aria-activedescendant；解析状态迁移时刷新引用 attribute。
  unsubscribeReferences = installer.subscribeReferences(syncReferenceDom)
  unsubscribeCandidates = installer.subscribeCandidates(syncAria)
  // 初始同步：installer 在桥创建前已完成的 resolved/missing/loading 条目立即上 DOM，
  // 不等 transaction/未来通知；已聚焦时顺带按当前光标只读识别一次既有触发。
  syncReferenceDom()
  recompute()

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    menuId,
    optionId,
    selectCandidate,
    setActiveIndex(index) {
      if (destroyed || state.trigger === null) return
      setState({ trigger: state.trigger, activeIndex: index })
      syncAria()
    },
    cancel,
    destroy
  }
}
