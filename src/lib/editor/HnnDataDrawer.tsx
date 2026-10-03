import { Button, Drawer } from "@hamster-note/components"
import "@hamster-note/components/styles.css"
import {
  DrawingSurface,
  type DrawingTool,
  type DrawingValue
} from "@hamster-note/painting"
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement
} from "react"
import type { Editor } from "@tiptap/core"
import {
  HNN_CARD_PAYLOAD_VERSION,
  parseCardPayload,
  prepareCardPayloadCandidate,
  type HnnCard
} from "../hnn/cardPayload"
import { encodeHnn } from "../hnn/codec"
import {
  parseDrawingPayload,
  prepareDrawingPayloadCandidate
} from "../hnn/drawingPayload"
import {
  registerHnnDataEditor,
  type HnnDataEditRequest
} from "../hnn/extensions"
import { getPersistedStringBudget } from "../hnn/persistedStringBudget"

type HnnDataDrawerProps = Readonly<{
  editor: Editor
  /** 显式主题只切换 hn-* token 修饰类，与编辑壳一致；缺省 light。 */
  theme: "light" | "dark"
}>

/**
 * Drawer 的 React 临时草稿（DESIGN.md §15）：输入/绘制只改本 state，绝不产生 PM
 * 事务；取消/Escape/backdrop 直接丢弃。只有「完成」经 prepare*Candidate 归一化 +
 * NodeView commit（单事务）落盘。非法既有 payload 进入只读模式，原样保留。
 */
type DraftState =
  | { readonly kind: "card"; readonly readOnly: true; readonly raw: string; readonly reason: string }
  | { readonly kind: "card"; readonly readOnly: false; readonly cards: CardDraft[] }
  | { readonly kind: "drawing"; readonly readOnly: true; readonly raw: string; readonly reason: string }
  | { readonly kind: "drawing"; readonly readOnly: false; readonly value: DrawingValue }

/** HnnCard 的可变草稿形态：只暴露标题/内容编辑，几何与链接原样保留在草稿内。 */
type CardDraft = {
  id: string
  title: string
  content: string
  x: number
  y: number
  width: number
  height: number
  parentId?: string
  linkedCardIds?: string[]
  zIndex?: number
  locked?: boolean
  childrenLayout?: "free" | "mind-map-horizontal" | "arrange"
}

// exactOptionalPropertyTypes 下逐字段拷贝：readonly 可选字段显式转为可变草稿字段。
const toCardDraft = (card: HnnCard): CardDraft => ({
  id: card.id,
  title: card.title,
  content: card.content,
  x: card.x,
  y: card.y,
  width: card.width,
  height: card.height,
  ...(card.parentId === undefined ? {} : { parentId: card.parentId }),
  ...(card.linkedCardIds === undefined ? {} : { linkedCardIds: [...card.linkedCardIds] }),
  ...(card.zIndex === undefined ? {} : { zIndex: card.zIndex }),
  ...(card.locked === undefined ? {} : { locked: card.locked }),
  ...(card.childrenLayout === undefined ? {} : { childrenLayout: card.childrenLayout })
})

/** 生成不与现有卡片冲突的新 id（满足 cardPayload 的受限 id 模式）。 */
function nextCardId(cards: readonly CardDraft[]): string {
  const used = new Set(cards.map((card) => card.id))
  let index = cards.length + 1
  let id = `card-${index}`
  while (used.has(id)) {
    index += 1
    id = `card-${index}`
  }
  return id
}

const DRAWER_LABELS = {
  card: { title: "卡片", description: "编辑卡片标题与内容；完成后一次保存，取消不保留修改" },
  drawing: { title: "画板", description: "在画布上绘制；完成后一次保存，取消不保留修改" }
} as const

const DRAWING_TOOLS: readonly { readonly tool: DrawingTool; readonly label: string }[] = [
  { tool: "pen", label: "画笔" },
  { tool: "line", label: "直线" },
  { tool: "rect", label: "矩形" },
  { tool: "ellipse", label: "椭圆" },
  { tool: "eraser", label: "橡皮" }
]

type DrawerStyle = CSSProperties & { readonly "--hn-drawer-size": string }

/** 组件库 Drawer 用 --hn-drawer-size 控制 bottom 高度：60vh 随视口变化（DESIGN.md §15）。 */
const DRAWER_STYLE: DrawerStyle = { "--hn-drawer-size": "60vh" }

/** 内部组件：card/drawing 块的底部 Drawer 数据编辑器（Phase 6.3）。
 *
 * 会话绑定（Gate 6.3 安全约束）：宿主以 `key = mounted sessionKey` 挂载本组件，
 * editor 取自同一原子挂载态。会话切换/卸载时 React 整体 remount——portal 随卸载
 * 移除、进行中的草稿只被丢弃：绝不 commit、绝不触发旧会话保存、绝不把焦点还给
 * 可能已随旧会话断开的 anchor（close() 只在同会话内被显式关闭路径调用，且已用
 * anchor.isConnected 兜底）。卸载路径上不安排任何 commit/焦点副作用。
 */
export function HnnDataDrawer({ editor, theme }: HnnDataDrawerProps): ReactElement {
  // 关闭后保留 session 内容直到 Drawer 退场动画结束，避免面板在退出瞬间塌缩。
  const [session, setSession] = useState<{ request: HnnDataEditRequest; draft: DraftState } | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tool, setTool] = useState<DrawingTool>("pen")

  const openEditor = useCallback((request: HnnDataEditRequest) => {
    setError(null)
    setTool("pen")
    // 先聚焦触发入口：组件库 modal 钩子在打开瞬间记录 document.activeElement，
    // 关闭时还原到它（close() 里的 anchor.focus() 是同步兜底）。
    request.anchor.focus()
    if (request.kind === "card") {
      const parsed = parseCardPayload(request.data)
      setSession({
        request,
        draft: parsed.ok
          ? { kind: "card", readOnly: false, cards: parsed.value.cards.map(toCardDraft) }
          // 非法既有 payload：只读展示原始 data，绝不自动替换为空卡片。
          : { kind: "card", readOnly: true, raw: request.data, reason: parsed.error.message }
      })
    } else {
      const parsed = parseDrawingPayload(request.data)
      setSession({
        request,
        draft: parsed.ok
          ? { kind: "drawing", readOnly: false, value: parsed.value }
          : { kind: "drawing", readOnly: true, raw: request.data, reason: parsed.error.message }
      })
    }
    setOpen(true)
  }, [])

  // 未 dispatch 的 candidate 整文档必须能通过 strict codec（含 shell 预算），否则提交失败。
  const validateCandidate = useCallback((candidateDoc: Parameters<typeof encodeHnn>[0]): string | null => {
    try {
      encodeHnn(candidateDoc)
      return null
    } catch (failure) {
      return failure instanceof Error ? failure.message : String(failure)
    }
  }, [])

  useEffect(
    () => registerHnnDataEditor(editor, { open: openEditor, validateCandidate }),
    [editor, openEditor, validateCandidate]
  )

  /** 丢弃草稿关闭：零事务；焦点还原到触发入口（DESIGN.md §15）。 */
  const close = useCallback(() => {
    setOpen(false)
    setError(null)
    const request = session?.request
    if (!request) return
    request.onClosed?.()
    if (request.anchor.isConnected) request.anchor.focus()
  }, [session])

  /** 完成：prepare 归一化失败或 commit 预检失败都保持开启、草稿保留、role=alert 播报。 */
  const complete = useCallback(() => {
    if (!session || session.draft.readOnly) return
    const { request, draft } = session
    const candidate = draft.kind === "card"
      ? prepareCardPayloadCandidate({ schemaVersion: HNN_CARD_PAYLOAD_VERSION, cards: draft.cards })
      : prepareDrawingPayloadCandidate(draft.value)
    if (!candidate.result.ok) {
      setError(`${candidate.result.error.path}：${candidate.result.error.message}`)
      return
    }
    const committed = request.commit(candidate.result.value)
    if (!committed.ok) {
      setError(committed.message)
      return
    }
    close()
  }, [session, close])

  const updateCard = useCallback((id: string, patch: Partial<Pick<CardDraft, "title" | "content">>) => {
    setSession((current) => {
      if (current?.draft.kind !== "card" || current.draft.readOnly) return current
      return {
        ...current,
        draft: {
          ...current.draft,
          cards: current.draft.cards.map((card) => (card.id === id ? { ...card, ...patch } : card))
        }
      }
    })
  }, [])

  const addCard = useCallback(() => {
    setSession((current) => {
      if (current?.draft.kind !== "card" || current.draft.readOnly) return current
      const id = nextCardId(current.draft.cards)
      const offset = 24 + current.draft.cards.length * 16
      const created: CardDraft = { id, title: "新卡片", content: "", x: offset, y: offset, width: 240, height: 160 }
      return { ...current, draft: { ...current.draft, cards: [...current.draft.cards, created] } }
    })
  }, [])

  /** 删除卡片同时移除其它卡片对它的父子/链接引用，保持 payload 引用完整可提交。 */
  const removeCard = useCallback((id: string) => {
    setSession((current) => {
      if (current?.draft.kind !== "card" || current.draft.readOnly) return current
      const cards = current.draft.cards
        .filter((card) => card.id !== id)
        .map((card) => {
          const next = { ...card }
          if (next.parentId === id) delete next.parentId
          if (next.linkedCardIds !== undefined) {
            const links = next.linkedCardIds.filter((link) => link !== id)
            if (links.length > 0) next.linkedCardIds = links
            else delete next.linkedCardIds
          }
          return next
        })
      return { ...current, draft: { ...current.draft, cards } }
    })
  }, [])

  const setDrawingValue = useCallback((value: DrawingValue) => {
    setSession((current) =>
      current?.draft.kind === "drawing" && !current.draft.readOnly
        ? { ...current, draft: { ...current.draft, value } }
        : current
    )
  }, [])

  // 草稿序列化后的双重预算（原始/JSON attr 字节），只做展示；提交前 prepare 才是权威检查。
  const budget = useMemo(() => {
    const draft = session?.draft
    if (!draft || draft.readOnly) return null
    const serialized = draft.kind === "card"
      ? JSON.stringify({ schemaVersion: HNN_CARD_PAYLOAD_VERSION, cards: draft.cards })
      : JSON.stringify(draft.value)
    return getPersistedStringBudget(serialized)
  }, [session])

  const kind = session?.request.kind ?? "card"
  const labels = DRAWER_LABELS[kind]
  const draft = session?.draft

  return (
    <Drawer
      open={open}
      onClose={close}
      placement="bottom"
      title={labels.title}
      description={labels.description}
      className={`hn-editor--${theme} hn-editor-data-drawer hn-editor-data-drawer--${kind}`}
      style={DRAWER_STYLE}
    >
      {draft && (
        <div className="hn-editor-data-drawer-body">
          {/* 提交失败的可访问错误（role=alert 即 aria-live=assertive）；空时隐藏 */}
          <p className="hn-editor-data-drawer-error" role="alert" hidden={error === null}>
            {error ?? ""}
          </p>

          {draft.readOnly ? (
            <>
              <p className="hn-editor-data-drawer-note">
                已有数据无效（{draft.reason}）。为保护原始内容，仅以只读 JSON 展示；取消即可保留原数据。
              </p>
              <textarea
                className="hn-editor-data-drawer-raw"
                value={draft.raw}
                readOnly
                rows={8}
                aria-label="原始数据（只读）"
              />
            </>
          ) : draft.kind === "card" ? (
            <>
              <ul className="hn-editor-card-list">
                {draft.cards.map((card) => (
                  <li className="hn-editor-card-item" key={card.id}>
                    <div className="hn-editor-card-item-head">
                      <input
                        className="hn-editor-card-title"
                        value={card.title}
                        aria-label={`卡片 ${card.id} 标题`}
                        onChange={(event) => updateCard(card.id, { title: event.target.value })}
                      />
                      <span className="hn-editor-card-meta">{card.id}</span>
                      <Button
                        variant="ghost"
                        size="small"
                        aria-label={`删除卡片 ${card.id}`}
                        onClick={() => removeCard(card.id)}
                      >
                        删除
                      </Button>
                    </div>
                    <textarea
                      className="hn-editor-card-content"
                      value={card.content}
                      rows={3}
                      aria-label={`卡片 ${card.id} 内容`}
                      onChange={(event) => updateCard(card.id, { content: event.target.value })}
                    />
                  </li>
                ))}
              </ul>
              <Button variant="secondary" size="small" onClick={addCard}>
                添加卡片
              </Button>
            </>
          ) : (
            <>
              <div className="hn-editor-drawing-toolbar" role="toolbar" aria-label="画板工具">
                {DRAWING_TOOLS.map((item) => (
                  <button
                    key={item.tool}
                    type="button"
                    className="hn-editor-drawing-tool"
                    aria-pressed={tool === item.tool}
                    onClick={() => setTool(item.tool)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="hn-editor-drawing-canvas">
                <DrawingSurface tool={tool} value={draft.value} onChange={setDrawingValue} />
              </div>
            </>
          )}

          <footer className="hn-editor-data-drawer-footer">
            {budget && (
              <span
                className={
                  budget.error === undefined
                    ? "hn-editor-data-drawer-budget"
                    : "hn-editor-data-drawer-budget hn-editor-data-drawer-budget--over"
                }
              >
                原始 {budget.rawBytes} / 序列化 {budget.jsonBytes} / 上限 {budget.maxBytes} 字节
                {budget.error === undefined ? "" : "（已超限）"}
              </span>
            )}
            <span className="hn-editor-data-drawer-actions">
              <Button variant="secondary" onClick={close}>
                取消
              </Button>
              {!draft.readOnly && (
                <Button variant="primary" onClick={complete}>
                  完成
                </Button>
              )}
            </span>
          </footer>
        </div>
      )}
    </Drawer>
  )
}
