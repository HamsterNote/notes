import { describe, expect, it } from "vitest"
import { decodeHnn, encodeHnn, HnnCodecError } from "./codec"
import { importMarkdown, exportMarkdown } from "./markdown"
import { normalizeInitialHnnContent } from "./nodeId"

const paragraph = { type: "paragraph", content: [{ type: "text", text: "列表", marks: [{ type: "bold" }] }] }
const task = (checked: boolean) => ({ type: "taskItem", attrs: { checked }, content: [structuredClone(paragraph)] })
const sample = () => ({ schemaVersion: 1 as const, data: normalizeInitialHnnContent({ type: "doc", content: [
  { type: "orderedList", attrs: { start: 5, type: null }, content: [{ type: "listItem", content: [structuredClone(paragraph),
    { type: "bulletList", content: [{ type: "listItem", content: [structuredClone(paragraph)] }] },
    { type: "taskList", content: [task(true), task(false)] }
  ] }] }
] }) })
const withoutIds = (value: unknown): unknown => JSON.parse(JSON.stringify(value), (key, item: unknown) => key === "nodeId" ? undefined : item)

describe("M1.8 strict v1 list persistence and Markdown", () => {
  it("roundtrips a mixed list tree including IDs, numbering, marks and both task states", () => {
    const original = encodeHnn(decodeHnn(sample()))
    expect(encodeHnn(decodeHnn(original))).toEqual(original)
    const markdown = exportMarkdown(original)
    const imported = importMarkdown(markdown.markdown)
    expect("document" in imported).toBe(true)
    if (!("document" in imported)) throw new Error("missing import")
    expect(withoutIds(imported.document)).toEqual(withoutIds(original))
    expect(markdown.markdown.includes("hamster-note-json-b64") || markdown.diagnostics.length === 0).toBe(true)
  })
  it.each([undefined, "false", 0, null])("rejects checked=%s with its attribute path and leaves input untouched", checked => {
    const data = normalizeInitialHnnContent({ type: "doc", content: [{ type: "taskList", content: [task(false)] }] })
    const attrs = ((data["content"] as { content: { attrs: Record<string, unknown> }[] }[])[0]!.content[0]!).attrs
    if (checked === undefined) delete attrs["checked"]
    else attrs["checked"] = checked
    const shell = { schemaVersion: 1, data }
    const before = JSON.stringify(shell)
    try { decodeHnn(shell); expect.fail("must reject") } catch (error) {
      expect(error).toBeInstanceOf(HnnCodecError)
      expect((error as HnnCodecError).diagnostics.some(d => d.path === "/data/content/0/content/0/attrs/checked")).toBe(true)
    }
    expect(JSON.stringify(shell)).toBe(before)
  })
  it("rejects checked on ordinary items; old valid v1 without tasks is readable", () => {
    const shell = { schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content: [{ type: "bulletList", content: [
      { type: "listItem", attrs: { checked: false }, content: [paragraph] }
    ] }] }) }
    expect(() => decodeHnn(shell)).toThrow(/checked/)
    const plain = { schemaVersion: 1, data: normalizeInitialHnnContent({ type: "doc", content: [paragraph] }) }
    expect(decodeHnn(plain).textContent).toBe("列表")
  })
  it("imports uppercase X and exports canonical GFM task/number markers", () => {
    const imported = importMarkdown("- [ ] 未做\n- [x] 已做\n- [X] 也已做\n\n5. 五\n6. 六")
    if (!("document" in imported)) throw new Error("missing import")
    const doc = decodeHnn(imported.document)
    expect(Array.from({ length: 3 }, (_, i) => doc.firstChild!.child(i).attrs["checked"] as unknown)).toEqual([false, true, true])
    expect(doc.lastChild!.attrs["start"]).toBe(5)
    const exported = exportMarkdown(imported.document)
    expect(exported.markdown).toContain("[x]")
    expect(exported.markdown).toContain("[ ]")
    expect(exported.markdown).toMatch(/5[.)] /)
    const again = importMarkdown(exported.markdown)
    if (!("document" in again)) throw new Error("missing import")
    expect(withoutIds(again.document)).toEqual(withoutIds(imported.document))
  })
  it("special numbering and complex content use the existing lossless fence", () => {
    const original = sample()
    const list = (original.data["content"] as { attrs: Record<string, unknown> }[])[0]!
    list.attrs["type"] = "A"
    const exported = exportMarkdown(original)
    expect(exported.markdown).toContain("hamster-note-json-b64")
    const imported = importMarkdown(exported.markdown)
    if (!("document" in imported)) throw new Error("missing import")
    expect(withoutIds(imported.document)).toEqual(withoutIds(encodeHnn(decodeHnn(original))))
  })
})
