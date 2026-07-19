import {
  type ChangeEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState
} from "react"

import { renderBlockActionMenu } from "./NoteBlockEditingControls"
import {
  type EditContext,
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

// 防御：在 jsdom 或极端 blur 时机下 innerText 可能为 undefined，
// 这里做容错，避免 replaceAll 抛错影响行为。
const normalizeLineEndings = (value: string | undefined | null): string =>
  (value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n")

export const NoteCodeBlock = ({
  block,
  ctx
}: NoteCodeBlockProps): ReactElement => {
  const { editable, blocks, onBlocksChange } = ctx
  const [editing, setEditing] = useState(false)
  const [draftCode, setDraftCode] = useState(block.code)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
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
    if (!editor) return
    editor.focus()
    editor.setSelectionRange(editor.value.length, editor.value.length)
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
              <textarea
                ref={editorRef}
                aria-label={
                  block.filename ? `编辑代码：${block.filename}` : "编辑代码"
                }
                className="hn-note-code-editor hn-note-editable"
                rows={Math.max(1, draftCode.split("\n").length)}
                spellCheck={false}
                value={draftCode}
                onBlur={(event) => {
                  const code = normalizeLineEndings(event.currentTarget.value)
                  setEditing(false)
                  onBlocksChange?.(updateCode(ctx.getBlocks(), block.id, code))
                }}
                onChange={(event) =>
                  setDraftCode(normalizeLineEndings(event.currentTarget.value))
                }
                onScroll={(event) => {
                  const highlight = highlightRef.current
                  if (!highlight) return
                  highlight.scrollLeft = event.currentTarget.scrollLeft
                  highlight.scrollTop = event.currentTarget.scrollTop
                }}
                data-editable-block-id={block.id}
              />
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
