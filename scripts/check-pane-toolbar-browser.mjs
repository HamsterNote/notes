import assert from "node:assert/strict"
import path from "node:path"
import { mkdirSync } from "node:fs"
import react from "@vitejs/plugin-react"
import { createServer } from "vite"
import { chromium } from "playwright"

mkdirSync("evidence", { recursive: true })
const server = await createServer({ configFile: false, root: path.resolve("scripts/fixtures/pane-toolbar"),
  plugins: [react()], server: { host: "127.0.0.1", port: 0 },
  resolve: { alias: [
    { find: "@hamster-note/notes/styles.css", replacement: path.resolve("src/lib/styles.css") },
    { find: "@hamster-note/notes", replacement: path.resolve("src/lib/index.ts") }
  ] } })
let browser
const closeEnough = (actual, expected, message) =>
  assert(Math.abs(actual - expected) <= 1.5, `${message}: expected ${expected} ±1.5, got ${actual}`)
try {
  await server.listen()
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto(`${server.resolvedUrls.local[0]}?edge=top&top=24&bottom=34&header=44`)
  const view = page.locator('[data-view-id="a"]')
  await view.locator(".tiptap").waitFor()

  const shell = page.locator("[data-toolbar-edge]")
  const content = view.locator(":scope > div").first()
  const padding = (side) => content.evaluate((element, property) => parseFloat(getComputedStyle(element)[property]), side)

  const topBox = await shell.boundingBox()
  assert.equal(await shell.getAttribute("data-toolbar-edge"), "top")
  closeEnough(topBox.y, 60, "top toolbar offset must be 16 + max(top=24, header=44)")
  assert.equal(await padding("paddingBottom"), 0)
  closeEnough(await padding("paddingTop"), 60 + topBox.height, "content must reserve the top toolbar")

  await page.getByRole("button", { name: "文件", exact: true }).click()
  const menu = page.getByRole("menu", { name: "文件列表", exact: true })
  await menu.getByRole("menuitemradio").nth(1).click()
  const selected = await page.evaluate(() => window.sessionLog)
  assert.deepEqual(selected.at(-1), { kind: "select", fileKey: "/local/b.hnn", paneId: "pane-a" })

  const marker = await view.locator(".tiptap").evaluate(element => { element.dataset.keep = "yes"; return true })
  assert.equal(marker, true)
  await page.getByRole("button", { name: "文件", exact: true }).click()
  await menu.getByRole("menuitem", { name: /移除 A\.hnn/ }).click()
  assert.deepEqual((await page.evaluate(() => window.sessionLog)).at(-1), { kind: "remove", fileKey: "/local/a.hnn", paneId: "pane-a" })

  await page.getByRole("button", { name: "切换方向", exact: true }).click()
  await page.waitForFunction(() => document.querySelector("[data-toolbar-edge]")?.getAttribute("data-toolbar-edge") === "bottom")
  const bottomBox = await shell.boundingBox()
  closeEnough(1000 - (bottomBox.y + bottomBox.height), 50, "bottom toolbar offset must be 16 + bottom=34")
  closeEnough(await padding("paddingBottom"), 50 + bottomBox.height, "content must reserve the bottom toolbar")
  assert.equal(await padding("paddingTop"), 0)
  assert.equal(await view.locator(".tiptap").getAttribute("data-keep"), "yes")

  await page.screenshot({ path: "evidence/ham229-pane-toolbar.png", fullPage: false })
  await page.setViewportSize({ width: 320, height: 450 })
  await view.locator(".tiptap").fill(Array.from({ length: 20 }, (_, i) => `正文 ${i}`).join("\n"))
  await view.locator('input[type="file"]').setInputFiles({ name: "retry.png", mimeType: "image/png", buffer: Buffer.from("fixture") })
  const retry = view.getByRole("button", { name: "重试上传 retry.png", exact: true })
  await retry.waitFor()
  // The padding must protect upload controls too, not end before their list.
  assert.equal(await content.locator(".hn-editor-uploads__list").count(), 1)
  await retry.click()
  await page.waitForFunction(() => window.sessionLog.filter(entry => entry.kind === "upload").length === 2)
  await view.getByRole("button", { name: "取消上传 retry.png", exact: true }).click()
  assert.equal(await view.locator(".hn-editor-uploads__list").count(), 0)
  await page.screenshot({ path: "evidence/ham229-upload-toolbar-320.png", fullPage: false })
  console.log("PASS upload retry/cancel remain inside reserved flow content at 320px")
  assert.deepEqual(errors, [])
  console.log("PASS top/bottom safe-area offsets, content reservation, file select/remove and edge switch without document remount")
} finally {
  await browser?.close()
  await server.close()
}
