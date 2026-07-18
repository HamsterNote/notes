import {
  type ChangeEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState
} from "react"

import {
  handleEditableBlockKeyDown,
  renderBlockActionMenu
} from "./NoteBlockEditingControls"
import {
  type EditContext,
  editableProps,
  richText,
  updateCode,
  updateCodeFilename,
  updateCodeLanguage
} from "./NoteContentEditing"
import { highlightCode, listSupportedLanguages } from "./syntaxHighlight"
import type { NoteCodeBlock as NoteCodeBlockData } from "./types"

// 语言下拉菜单选项：Plain Text 在最前，其后为所有已注册高亮语言
const languageOptions: readonly string[] = ["text", ...listSupportedLanguages()]

type NoteCodeBlockProps = {
  readonly block: NoteCodeBlockData
  readonly ctx: EditContext
}

const normalizeLineEndings = (value: string): string =>
  value.replaceAll("\r\n", "\n").replaceAll("\r", "\n")

export const NoteCodeBlock = ({
  block,
  ctx
}: NoteCodeBlockProps): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx
  const [editing, setEditing] = useState(false)
  const [draftCode, setDraftCode] = useState(block.code)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const highlightRef = useRef<HTMLElement | null>(null)
  const highlightedCode = highlightCode(
    editing ? draftCode : block.code,
    block.language
  )
  // PlainText（language="text"）不使用 hljs 类：语义上无语法高亮，
  // 避免任何依赖 .hljs 类的 CSS 或运行时逻辑误触发高亮样式
  const codeClassName = block.language === "text" ? "" : "hljs"

  useEffect(() => {
    if (!editing) return
    const editor = editorRef.current
    editor?.focus()
    const selection = window.getSelection()
    if (!editor || !selection) return
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [editing])

  return (
    <>
      {renderBlockActionMenu(block, ctx)}
      <section className="hn-note-code-card">
        <div className="hn-note-code-meta">
          {editable ? (
            <>
              <select
                className="hn-note-code-lang-select"
                value={block.language}
                aria-label="选择代码语言"
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  onBlocksChange?.(
                    updateCodeLanguage(blocks, block.id, event.target.value)
                  )
                }
              >
                {languageOptions.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang === "text" ? "Plain Text" : lang}
                  </option>
                ))}
              </select>
              <input
                className="hn-note-code-filename-input"
                type="text"
                value={block.filename ?? ""}
                size={Math.max(1, (block.filename ?? "").length)}
                placeholder="filename..."
                aria-label="编辑文件名"
                onChange={(event) =>
                  onBlocksChange?.(
                    updateCodeFilename(blocks, block.id, event.target.value)
                  )
                }
              />
            </>
          ) : (
            <>
              <span>
                {block.language === "text" ? "Plain Text" : block.language}
              </span>
              {block.filename ? <span>{block.filename}</span> : null}
            </>
          )}
        </div>
        {editable ? (
          editing ? (
            <div className="hn-note-code-editing">
              <code
                ref={highlightRef}
                aria-hidden="true"
                className={`${codeClassName} hn-note-code-highlight`}
                {...richText(highlightedCode)}
              />
              <div
                ref={editorRef}
                aria-label={
                  block.filename ? `编辑代码：${block.filename}` : "编辑代码"
                }
                aria-multiline="true"
                role="textbox"
                tabIndex={0}
                {...editableProps((event) => {
                  const code = normalizeLineEndings(
                    event.currentTarget.innerText
                  )
                  setEditing(false)
                  onBlocksChange?.(updateCode(blocks, block.id, code))
                }, "hn-note-code-editor")}
                onInput={(event) =>
                  setDraftCode(
                    normalizeLineEndings(event.currentTarget.innerText)
                  )
                }
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return
                  // 代码块内回车：插入换行符 \n，不拆分代码块
                  // white-space: pre 会将 \n 正确渲染为换行
                  if (event.key === "Enter") {
                    event.preventDefault()
                    const selection = window.getSelection()
                    if (!selection || selection.rangeCount === 0) return
                    const range = selection.getRangeAt(0)
                    if (
                      !event.currentTarget.contains(
                        range.commonAncestorContainer
                      )
                    )
                      return
                    if (!range.collapsed) range.deleteContents()
                    // 插入换行符文本节点（而非 <br> 或 <div>），
                    // 配合 white-space: pre 保持纯文本格式
                    const newlineNode = document.createTextNode("\n")
                    range.insertNode(newlineNode)
                    // 将光标移到换行符之后
                    range.setStartAfter(newlineNode)
                    range.collapse(true)
                    selection.removeAllRanges()
                    selection.addRange(range)
                    // 同步草稿代码状态，驱动高亮层更新
                    setDraftCode(
                      normalizeLineEndings(event.currentTarget.innerText)
                    )
                    return
                  }
                  handleEditableBlockKeyDown({
                    ctx,
                    event,
                    mode: "plain-text",
                    sourceId: block.id
                  })
                }}
                onPaste={(event) => {
                  event.preventDefault()
                  const selection = window.getSelection()
                  if (!selection || selection.rangeCount === 0) return
                  const range = selection.getRangeAt(0)
                  if (
                    !event.currentTarget.contains(range.commonAncestorContainer)
                  )
                    return
                  range.deleteContents()
                  const textNode = document.createTextNode(
                    normalizeLineEndings(
                      event.clipboardData.getData("text/plain")
                    )
                  )
                  range.insertNode(textNode)
                  range.setStartAfter(textNode)
                  range.collapse(true)
                  selection.removeAllRanges()
                  selection.addRange(range)
                  setDraftCode(
                    normalizeLineEndings(event.currentTarget.innerText)
                  )
                }}
                onScroll={(event) => {
                  const highlight = highlightRef.current
                  if (!highlight) return
                  highlight.scrollLeft = event.currentTarget.scrollLeft
                  highlight.scrollTop = event.currentTarget.scrollTop
                }}
                data-editable-block-id={block.id}
              >
                {block.code}
              </div>
            </div>
          ) : (
            <button
              aria-label="编辑代码"
              className="hn-note-code-preview"
              data-editable-block-id={block.id}
              onFocus={() => {
                setDraftCode(block.code)
                setEditing(true)
              }}
              type="button"
            >
              <code className={codeClassName} {...richText(highlightedCode)} />
            </button>
          )
        ) : (
          <pre>
            <code className={codeClassName} {...richText(highlightedCode)} />
          </pre>
        )}
      </section>
    </>
  )
}
