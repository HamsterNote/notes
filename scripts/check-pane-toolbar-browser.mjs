import assert from "node:assert/strict"
import path from "node:path"
import { mkdirSync } from "node:fs"
import react from "@vitejs/plugin-react"
import { createServer } from "vite"
import { chromium } from "playwright"

mkdirSync("evidence/ham257", { recursive: true })
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

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const theme of ["light", "dark", "light"]) {
      const currentlyDark = await view.evaluate(e => e.classList.contains("hn-editor--dark"))
      if (currentlyDark !== (theme === "dark")) await page.locator("#toggle-theme").click()
      const palette = await shell.locator('[role="toolbar"]').evaluate(e => {
        const s = getComputedStyle(e); return { bg: s.backgroundColor, text: s.color }
      })
      assert.equal(palette.bg, theme === "dark" ? "rgb(23, 32, 51)" : "rgb(248, 250, 252)")
      assert.equal(palette.text, theme === "dark" ? "rgb(241, 245, 249)" : "rgb(30, 41, 59)")
      const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
      const lum = color => rgb(color).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0)
      const contrast = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05)
      assert(contrast(palette.bg, palette.text) >= 4.5)
      await page.getByRole("button", { name: "文件", exact: true }).click()
      const menuPalette = await menu.evaluate(e => ({ bg: getComputedStyle(e).backgroundColor, text: getComputedStyle(e).color }))
      assert.equal(menuPalette.bg, theme === "dark" ? "rgb(15, 23, 42)" : "rgb(255, 255, 255)")
      assert(contrast(menuPalette.bg, menuPalette.text) >= 4.5)
      await page.screenshot({ path: `evidence/ham257/toolbar-${width}-${theme}.png` })
      await page.keyboard.press("Escape")
      await page.getByRole("button", { name: "文件", exact: true }).focus()
      const focus = await page.getByRole("button", { name: "文件", exact: true }).evaluate(e => getComputedStyle(e).outlineColor)
      assert(contrast(palette.bg, focus) >= 3)
      console.log(`PASS ${width}px ${theme}: toolbar/menu text contrast ${contrast(palette.bg, palette.text).toFixed(2)}, focus ${contrast(palette.bg, focus).toFixed(2)}`)
      assert.equal(await view.locator(".tiptap").getAttribute("data-keep"), "yes")
    }
  }
  await page.setViewportSize({ width: 900, height: 1000 })
  await page.screenshot({ path: "evidence/ham257/toolbar-pane.png", fullPage: false })
  await page.setViewportSize({ width: 320, height: 450 })
  await view.locator(".tiptap").fill(Array.from({ length: 20 }, (_, i) => `正文 ${i}`).join("\n"))
  await view.locator(".tiptap").evaluate(element => {
    const clipboardData = new DataTransfer()
    clipboardData.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "retry.png", { type: "image/png" }))
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }))
  })
  const retry = view.getByRole("button", { name: "重试上传 retry.png", exact: true })
  await retry.waitFor()
  // The padding must protect upload controls too, not end before their list.
  assert.equal(await content.locator(".hn-editor-uploads__list").count(), 1)
  await retry.click()
  await page.waitForFunction(() => window.sessionLog.filter(entry => entry.kind === "upload").length === 2)
  await view.getByRole("button", { name: "取消上传 retry.png", exact: true }).click()
  assert.equal(await view.locator(".hn-editor-uploads__list").count(), 0)
  await page.screenshot({ path: "evidence/ham257/toolbar-upload-320.png", fullPage: false })
  console.log("PASS upload retry/cancel remain inside reserved flow content at 320px")
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${server.resolvedUrls.local[0]}?split=1&inline=1`)
  await page.locator('[data-view-id="b"] .tiptap').waitFor()
  const views = page.locator("[data-view-id]")
  const state = () => views.evaluateAll(elements => elements.map(e => {
    const editor = e.querySelector(".tiptap").editor
    return { doc: editor.getJSON(), selection: editor.state.selection.toJSON(), dom: e.querySelector(".tiptap").dataset.keep }
  }))
  await views.locator(".tiptap").evaluateAll(es => es.forEach(e => e.dataset.keep = "stable"))
  const before = await state()
  const sessionBefore = await page.evaluate(() => window.toolbarState())
  await page.locator("#toggle-theme").click()
  const colors = await views.locator('[role="toolbar"]').evaluateAll(es => es.map(e => getComputedStyle(e).backgroundColor))
  assert.deepEqual(colors, ["rgb(23, 32, 51)", "rgb(248, 250, 252)"])
  for (let i = 0; i < 2; i++) {
    const pane = views.nth(i)
    await pane.getByRole("button", { name: "文件", exact: true }).click()
    assert.equal(await pane.getByRole("menu").evaluate(e => getComputedStyle(e).backgroundColor), i === 0 ? "rgb(15, 23, 42)" : "rgb(255, 255, 255)")
    await page.keyboard.press("Escape")
  }
  assert.deepEqual(await state(), before)
  assert.deepEqual(await page.evaluate(() => window.toolbarState()), sessionBefore)
  await page.screenshot({ path: "evidence/ham257/toolbar-split-inline.png" })
  console.log("PASS inline mixed light/dark views: isolated shell/menu themes; unchanged document, selection and DOM identity")
  assert.deepEqual(errors, [])
  console.log("PASS top/bottom safe-area offsets, content reservation, file select/remove and edge switch without document remount")
} finally {
  await browser?.close()
  await server.close()
}
