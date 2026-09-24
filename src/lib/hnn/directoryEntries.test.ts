import { describe, expect, it } from "vitest"
import { encodeHnn } from "./codec"
import { deriveHnnDirectoryEntries } from "./directoryEntries"
import { hnnRuntimeSchema } from "./extensions"

const headingId = "123e4567-e89b-42d3-a456-426614174000"
const directoryId = "123e4567-e89b-42d3-a456-426614174001"

describe("directory 派生条目", () => {
  it("按 PM 文档顺序从 heading 派生 nodeId、level、text 和 position，空标题使用回退文本", () => {
    const document = hnnRuntimeSchema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "directory", attrs: { nodeId: directoryId, config: "headings" } },
        { type: "heading", attrs: { nodeId: headingId, level: 2 } },
        { type: "heading", attrs: { nodeId: "123e4567-e89b-42d3-a456-426614174002", level: 3 }, content: [{ type: "text", text: "Details" }] }
      ]
    })

    expect(deriveHnnDirectoryEntries(document)).toEqual([
      { nodeId: headingId, level: 2, text: "未命名标题", position: 1 },
      { nodeId: "123e4567-e89b-42d3-a456-426614174002", level: 3, text: "Details", position: 3 }
    ])
  })

  it("只持久化 directory 的 nodeId 与 config，拒绝条目快照", () => {
    const data = {
      type: "doc",
      content: [{ type: "directory", attrs: { nodeId: directoryId, config: "headings" } }]
    }
    expect(encodeHnn(data)).toEqual({ schemaVersion: 1, data })
    expect(() => encodeHnn({
      type: "doc",
      content: [{ type: "directory", attrs: { nodeId: directoryId, config: "headings", entries: [] } }]
    })).toThrow(/不允许的字段 entries/u)
  })
})
