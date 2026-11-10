// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import { createHnnEditorExtensions } from "../hnn/extensions"
import { encodeHnn } from "../hnn/codec"

const id = "123e4567-e89b-42d3-a456-426614174000"
const sessions: Editor[] = []
afterEach(() => { for (const session of sessions.splice(0)) session.destroy(); document.body.replaceChildren() })
const pause = () => new Promise(resolve => setTimeout(resolve, 30))

function setup(text = "ni\u2006hao", preceding = false) {
  // Widget/caret geometry is covered by the WebKit Provider/View regression;
  // jsdom only exercises the parser and native-event contract here.
  const session = { editor: new Editor({ extensions: createHnnEditorExtensions(), content: {
    type: "doc", content: [
      ...(preceding ? [{ type: "paragraph", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174001" }, content: [{ type: "text", text: "前段" }] }] : []),
      { type: "paragraph", attrs: { nodeId: id }, content: [{ type: "text", text }] }
    ]
  } }) }
  sessions.push(session.editor)
  const root = session.editor.view.dom
  document.body.append(root)
  session.editor.commands.setTextSelection(session.editor.state.doc.content.size - 1)
  session.editor.view.focus()
  const block = root.querySelectorAll("p")[preceding ? 1 : 0]!
  getSelection()!.setPosition(block.firstChild, block.textContent.length)
  root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }))
  return { session, root, block }
}

function beforeDelete(root: HTMLElement, block: Element, start = 0, end = block.textContent.length) {
  const range = document.createRange()
  range.setStart(block.firstChild!, start)
  range.setEnd(block.firstChild!, end)
  getSelection()!.removeAllRanges()
  getSelection()!.addRange(range)
  const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteCompositionText", isComposing: true })
  Object.defineProperty(event, "getTargetRanges", { value: () => [range] })
  root.dispatchEvent(event)
  return event
}

function removeBlock(root: HTMLElement, block: Element) {
  const br = document.createElement("br")
  block.replaceWith(br)
  getSelection()!.setPosition(root, [...root.childNodes].indexOf(br))
  const event = new InputEvent("input", { bubbles: true, inputType: "deleteCompositionText", isComposing: true })
  root.dispatchEvent(event)
  return event
}

describe("confirmed WebKit composition deletion", () => {
  for (const preceding of [false, true]) {
    it(`removes the preedit without splitting or changing paragraph identity (preceding=${String(preceding)})`, async () => {
      const { session, root, block } = setup("ni\u2006hao", preceding)
      const before = beforeDelete(root, block)
      const input = removeBlock(root, block)
      expect(before.defaultPrevented).toBe(false)
      expect(input.defaultPrevented).toBe(false)
      await pause()
      expect([...root.querySelectorAll("p")].map(p => p.textContent)).toEqual(preceding ? ["前段", ""] : [""])
      expect(session.editor.state.doc.lastChild!.attrs["nodeId"]).toBe(id)
      root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }))
      session.editor.commands.insertContent("你好")
      const doc = encodeHnn(session.editor.state.doc)
      expect(doc.data["content"]).toHaveLength(preceding ? 2 : 1)
      expect(session.editor.state.doc.lastChild!.textContent).toBe("你好")
      expect(session.editor.state.doc.lastChild!.attrs["nodeId"]).toBe(id)
    })
  }
  it("leaves normal in-paragraph native deletion to the DOM observer", async () => {
    const { session, root, block } = setup("前nihao后")
    beforeDelete(root, block, 1, 6)
    block.firstChild!.textContent = "前后"
    getSelection()!.setPosition(block.firstChild, 1)
    root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteCompositionText", isComposing: true }))
    await pause()
    expect(session.editor.state.doc.textContent).toBe("前后")
    expect(session.editor.state.doc.childCount).toBe(1)
  })
  it("does not apply a saved range to a newer document", () => {
    const { session, root, block } = setup()
    beforeDelete(root, block)
    session.editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", attrs: { nodeId: id }, content: [{ type: "text", text: "新内容" }] }] })
    root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteCompositionText", isComposing: true }))
    expect(session.editor.state.doc.textContent).toBe("新内容")
  })
})
