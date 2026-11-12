import type { HnnDocument } from "@hamster-note/notes"

const attrs = (extra = {}) => ({ nodeId: crypto.randomUUID(), ...extra })
const text = (value: string, marks: object[] = []) => ({ type: "text", text: value, ...(marks.length ? { marks } : {}) })
const p = (value: string) => ({ type: "paragraph", attrs: attrs(), content: [text(value)] })
const item = (value: string, extra: object[] = []) => ({ type: "listItem", attrs: attrs(), content: [p(value), ...extra] })
const ol = (content: object[], start = 1, type: string | null = null) => ({ type: "orderedList", attrs: attrs({ start, type }), content })
const shell = (content: object[]): HnnDocument => ({ schemaVersion: 1, data: { type: "doc", content } })
let deep = ol([item("level five")])
for (const value of ["level four", "level three", "level two", "level one"]) deep = ol([item(value, [deep])])
export const numbering = shell([deep, { type: "blockquote", attrs: attrs({ author: "author" }), content: [
  { type: "bulletList", attrs: attrs(), content: [item("bullet", [ol([item("mixed alpha")])])] },
  { type: "taskList", attrs: attrs(), content: [{ type: "taskItem", attrs: attrs({ checked: true }), content: [p("task"), ol([item("mixed task")])] }] },
  ol([item("explicit Roman")], 4, "I")
] }])
export const boundaries = shell([
  ol([item("alpha wrapper", [ol([item("z"), item("aa"), item("ab")], 26), ol([item("az"), item("ba")], 52)])]),
  ol([item("roman wrapper", [ol([item("level two", [ol([item("iv"), item("v"), item("vi"), item("vii"), item("viii"), item("ix")], 4),
    ol([item("3999"), item("4000")], 3999)])])])]),
  ol([item("explicit uppercase")], 27, "A")
])
export const refinements = shell([p("tail text"), { type: "paragraph", attrs: attrs(), content: [
  text("link [title]", [{ type: "bold" }, { type: "italic" }]), text(" (part)", [{ type: "bold" }])
] }, deep, p("last paragraph")])
