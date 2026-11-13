import { describe, expect, it } from "vitest"
import { decodeHnn, encodeHnn, HnnCodecError, type HnnDocument } from "./codec"
import { exportMarkdown, importMarkdown } from "./markdown"
import { isManagedHnnPicturePath, isSafeHnnPictureUrl, isSafeHnnUrl } from "./urlPolicy"

const nodeId = "123e4567-e89b-42d3-a456-426614174000"
const md5 = "0123456789abcdef0123456789abcdef"
const managedPath = `hamster_note_data/images/${md5}.png`

function pictureDocument(src: string, alt = "示例图片"): HnnDocument {
  return {
    schemaVersion: 1,
    data: {
      type: "doc",
      content: [{ type: "picture", attrs: { nodeId, src, alt } }]
    }
  }
}

describe("picture 专属持久引用", () => {
  it.each(["png", "jpg", "webp"])("托管 MD5 .%s 路径在 HNN 中保留 src/alt/nodeId", (extension) => {
    const src = `hamster_note_data/images/${md5}.${extension}`
    const input = pictureDocument(src)
    const output = encodeHnn(decodeHnn(input))
    expect(output).toEqual(input)
    expect(output.schemaVersion).toBe(1)
    expect(isManagedHnnPicturePath(src)).toBe(true)
    expect(isSafeHnnPictureUrl(src)).toBe(true)
  })

  it.each([
    "https://cdn.example.test/image.png",
    "http://localhost:8080/image.jpg"
  ])("旧 HTTP(S) 图片保持兼容：%s", (src) => {
    expect(encodeHnn(decodeHnn(pictureDocument(src)))).toEqual(pictureDocument(src))
  })

  it.each([
    "/hamster_note_data/images/0123456789abcdef0123456789abcdef.png",
    "hamster_note_data/images/../0123456789abcdef0123456789abcdef.png",
    "hamster_note_data/images/%2e%2e/0123456789abcdef0123456789abcdef.png",
    "hamster_note_data\\images\\0123456789abcdef0123456789abcdef.png",
    "hamster_note_data/images/0123456789abcdef0123456789abcdef.png?x=1",
    "hamster_note_data/images/0123456789abcdef0123456789abcdef.png#x",
    "hamster_note_data/images/0123456789ABCDEF0123456789ABCDEF.png",
    "hamster_note_data/images/0123456789abcdef0123456789abcdef.jpeg",
    "file:///hamster_note_data/images/0123456789abcdef0123456789abcdef.png",
    "blob:https://example.test/00000000-0000-0000-0000-000000000000",
    "data:image/png;base64,AA=="
  ])("拒绝绕过或运行时持久地址：%s", (src) => {
    expect(isSafeHnnPictureUrl(src)).toBe(false)
    expect(() => decodeHnn(pictureDocument(src))).toThrowError(HnnCodecError)
    try {
      decodeHnn(pictureDocument(src))
    } catch (error) {
      expect((error as HnnCodecError).diagnostics[0]?.path).toBe("/data/content/0/attrs/src")
    }
  })

  it("普通 link 不因图片规则而接受相对托管路径", () => {
    const input: HnnDocument = {
      schemaVersion: 1,
      data: {
        type: "doc",
        content: [{
          type: "paragraph",
          attrs: { nodeId },
          content: [{ type: "text", text: "not a link", marks: [{ type: "link", attrs: { href: managedPath } }] }]
        }]
      }
    }
    expect(isSafeHnnUrl(managedPath)).toBe(false)
    expect(() => decodeHnn(input)).toThrowError(HnnCodecError)
  })

  it("Markdown 独占图片往返保留托管路径和 alt，不写入 blob 或字节", () => {
    const exported = exportMarkdown(pictureDocument(managedPath, "托管图片"))
    expect(exported.markdown).toContain(`![托管图片](${managedPath})`)
    expect(exported.markdown).not.toContain("blob:")
    const imported = importMarkdown(exported.markdown)
    expect("document" in imported).toBe(true)
    if (!("document" in imported)) return
    const picture = imported.document.data["content"] as Array<Record<string, unknown>>
    expect(picture[0]?.["type"]).toBe("picture")
    expect(picture[0]?.["attrs"]).toMatchObject({ src: managedPath, alt: "托管图片" })
    expect(imported.diagnostics).toEqual([])
  })

  it("Markdown 的 link 与旧 HTTP 图片行为不退化", () => {
    const markdown = "[链接](https://example.test/a)\n\n![旧图](https://example.test/a.png)"
    const imported = importMarkdown(markdown)
    expect("document" in imported).toBe(true)
    if (!("document" in imported)) return
    const exported = exportMarkdown(imported.document)
    expect(exported.markdown).toContain("[链接](https://example.test/a)")
    expect(exported.markdown).toContain("![旧图](https://example.test/a.png)")
  })
})
