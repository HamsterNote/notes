import assert from "node:assert/strict"
import path from "node:path"
import { mkdirSync } from "node:fs"
import react from "@vitejs/plugin-react"
import { createServer } from "vite"
import { chromium } from "playwright"

const evidenceDir = "evidence/ham237/refinements"
mkdirSync(evidenceDir, { recursive: true })
const server = await createServer({ configFile: false, root: path.resolve("scripts/fixtures/lists"), plugins: [react()],
  server: { host: "127.0.0.1", port: 0 }, resolve: { alias: [
    { find: "@hamster-note/notes/styles.css", replacement: path.resolve("src/lib/styles.css") },
    { find: "@hamster-note/notes", replacement: path.resolve("src/lib/index.ts") }
  ] } })
let browser
try {
  await server.listen()
  browser = await chromium.launch()
  console.log(`Chromium ${browser.version()}; Linux; public Provider/View fixture; source alias`)
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width === 390 })
    const page = await context.newPage(), errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(server.resolvedUrls.local[0])
    const pane = page.locator('[data-view-id="a"]'), area = pane.locator(".tiptap")
    const peer = page.locator('[data-view-id="b"]')
    const toolbar = page.getByRole("toolbar", { name: "文字与块操作" })
    const nav = page.getByRole("navigation")
    const dialog = page.getByRole("dialog", { name: "配置链接" })
    const reset = async name => { await nav.getByRole("button", { name, exact: true }).click(); await area.waitFor() }
    const snapshot = () => page.evaluate(() => window.listSnapshot)
    const docs = () => page.evaluate(() => ["a", "b"].map(id => document.querySelector(`[data-view-id="${id}"] .tiptap`).editor.state.doc.toJSON()))
    const select = async (value, cursor = false, end = false) => {
      const para = area.locator("p").filter({ hasText: value }).first()
      // Native Home/End target visual lines; at 390px the same paragraph wraps.
      // Set a native DOM range over the logical paragraph, then await PM's
      // selectionchange before using real keyboard/toolbar interactions.
      await para.evaluate((node, { cursor, end }) => {
        node.scrollIntoView({ block: "center" })
        node.closest(".tiptap").focus()
        const range = document.createRange()
        range.selectNodeContents(node)
        if (cursor) range.collapse(!end)
        const selection = window.getSelection()
        selection.removeAllRanges(); selection.addRange(range)
      }, { cursor, end })
      await page.waitForFunction(({ value, cursor, end }) => {
        const selection = document.querySelector('[data-view-id="a"] .tiptap').editor.state.selection
        return selection.$from.parent.textContent.includes(value) && selection.empty === cursor &&
          (!cursor || selection.$from.parentOffset === (end ? selection.$from.parent.content.size : 0))
      }, { value, cursor, end })
    }
    const openLink = async () => { await toolbar.getByRole("button", { name: "链接", exact: true }).click(); await dialog.waitFor() }
    const checkPanelBounds = async () => {
      const bounds = await dialog.boundingBox()
      assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 1000)
    }
    await area.waitFor()
    await reset("深层编号")
    const numberingBefore = await docs()
    assert.deepEqual(await area.locator("ol").evaluateAll(nodes => nodes.map(node => node.dataset.hnnListStyle)), ["1", "a", "i", "1", "a", "a", "a", "I"])
    assert.deepEqual(await area.locator("li[data-hnn-marker]").evaluateAll(nodes => nodes.map(node => node.dataset.hnnMarker)), ["1", "a", "i", "1", "a", "a", "a", "IV"])
    await pane.getByLabel("撤销", { exact: true }).click()
    assert.deepEqual(await docs(), numberingBefore)
    assert.equal(await area.locator("ol").first().evaluate(node => getComputedStyle(node.querySelector("li"), "::marker").content), '"1. "')
    assert.deepEqual(await docs(), numberingBefore)
    await page.screenshot({ path: `${evidenceDir}/numbering-${width}.png`, fullPage: true })
    await reset("编号边界")
    const markers = await area.locator("li[data-hnn-marker]").evaluateAll(nodes => nodes.map(node => node.dataset.hnnMarker))
    for (const marker of ["z", "aa", "ab", "az", "ba", "iv", "ix", "mmmcmxcix", "4000", "AA"]) assert.ok(markers.includes(marker), marker)
    const longMarker = await area.locator('li[data-hnn-marker="mmmcmxcix"]').evaluate(node => ({
      padding: parseFloat(getComputedStyle(node.parentElement).paddingInlineStart),
      ch: getComputedStyle(node.parentElement).getPropertyValue("--hn-list-marker-width")
    }))
    assert.equal(longMarker.ch.trim(), "11ch")
    assert.ok(longMarker.padding > 60)
    console.log(`PASS ${width}px 1.11/1.12: 1/a/i/1/a, mixed ancestors, explicit I/A, z/aa/ab/az/ba, iv/ix/3999/4000, width, clean load`)

    await reset("编辑增量")
    await page.getByText("共享视图", { exact: true }).click()
    await select("tail text", true)
    const originalId = await area.locator("p").first().getAttribute("nodeid")
    await page.keyboard.type(">")
    assert.equal(await area.locator("blockquote").count(), 0)
    await page.keyboard.type(" ")
    assert.equal(await area.locator("blockquote").count(), 1)
    assert.equal(await area.locator("blockquote p").first().textContent(), "tail text")
    assert.equal(await area.locator("blockquote p").first().getAttribute("nodeid"), originalId)
    assert.deepEqual(...await docs())
    await pane.getByLabel("撤销", { exact: true }).click()
    assert.equal(await area.locator("p").first().textContent(), "> tail text")
    await peer.getByLabel("重做", { exact: true }).click()
    await select("tail text", true)
    await page.keyboard.type("> ")
    assert.equal(await area.locator("blockquote blockquote").count(), 1)
    await select("tail text", true, true)
    await page.keyboard.press("Shift+Enter"); await page.keyboard.type("soft")
    assert.equal(await area.locator("blockquote blockquote br").count(), 1)
    await page.keyboard.press("Enter"); await page.keyboard.press("Enter")
    assert.equal(await area.locator("blockquote blockquote").count(), 1)
    assert.equal(await area.locator("blockquote").first().locator(":scope > .hn-editor-quote-body > p").count(), 1)
    console.log(`PASS ${width}px 1.13: native > / > space, paragraph ID/tail, shared undo literal/redo, nesting, soft break, Enter/nearest exit`)

    await select("link [title]")
    await openLink()
    assert.equal(await dialog.getByLabel("链接标题").inputValue(), "link [title] (part)")
    await checkPanelBounds()
    await page.keyboard.press("Tab")
    assert.equal(await dialog.getByLabel("URL").evaluate(node => document.activeElement === node), true)
    await dialog.getByLabel("URL").fill("javascript:alert(1)")
    const beforeLink = await snapshot()
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    assert.equal(await dialog.getByRole("alert").isVisible(), true)
    assert.equal(await dialog.getByLabel("URL").inputValue(), "javascript:alert(1)")
    assert.deepEqual(await snapshot(), beforeLink)
    await dialog.getByLabel("URL").fill("  https://example.com/path(a)  ")
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    await dialog.waitFor({ state: "hidden" })
    assert.equal(await area.locator('a[href="https://example.com/path(a)"]').count(), 1) // distinct mark slices retained inside one contiguous link
    assert.equal(await area.locator("a strong em").textContent(), "link [title]")
    assert.deepEqual(...await docs())
    await select("link [title]", true); await page.keyboard.press("ArrowRight")
    await openLink()
    assert.equal(await dialog.getByLabel("链接标题").inputValue(), "link [title] (part)")
    await dialog.getByLabel("链接标题").fill("[官网](站点)")
    await dialog.getByLabel("URL").fill("hnmagic://resource/123")
    await page.screenshot({ path: `${evidenceDir}/link-dialog-${width}.png`, fullPage: true })
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    await dialog.waitFor({ state: "hidden" })
    assert.equal(await area.locator('a[href="hnmagic://resource/123"] strong').textContent(), "[官网](站点)")
    assert.equal(await area.locator('a[href="hnmagic://resource/123"] em').count(), 0)
    const linked = await snapshot()
    await peer.getByLabel("撤销", { exact: true }).click()
    assert.equal(await area.locator('a[href="https://example.com/path(a)"]').count(), 1)
    await pane.getByLabel("重做", { exact: true }).click()
    assert.deepEqual(await snapshot(), linked)
    for (const action of ["取消", "Escape", "outside"]) {
      await select("[官网](站点)", true); await page.keyboard.press("ArrowRight"); await openLink()
      await dialog.getByLabel("链接标题").fill("uncommitted")
      if (action === "取消") await dialog.getByRole("button", { name: action, exact: true }).click()
      else if (action === "Escape") await page.keyboard.press("Escape")
      else await nav.click({ position: { x: 1, y: 1 } })
      await dialog.waitFor({ state: "hidden" })
      assert.deepEqual(await snapshot(), linked)
      if (action !== "outside") assert.equal(await area.evaluate(node => node.contains(document.activeElement)), true)
    }
    await select("[官网](站点)", true); await page.keyboard.press("ArrowRight"); await openLink()
    await dialog.getByRole("button", { name: "移除链接", exact: true }).click()
    await dialog.waitFor({ state: "hidden" })
    assert.equal(await area.locator("a").count(), 0)
    assert.equal(await area.locator("strong").filter({ hasText: "[官网](站点)" }).count(), 1)
    await peer.getByLabel("撤销", { exact: true }).click()
    assert.deepEqual(await snapshot(), linked)
    // A remote doc transaction and even its undo permanently invalidate this dialog.
    await select("[官网](站点)", true); await page.keyboard.press("ArrowRight"); await openLink()
    await page.evaluate(() => {
      const editor = document.querySelector('[data-view-id="b"] .tiptap').editor
      editor.commands.insertContent("remote")
      editor.commands.undo()
    })
    const staleBefore = await snapshot()
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    assert.match(await dialog.getByRole("alert").textContent(), /重新选择/u)
    assert.deepEqual(await snapshot(), staleBefore)
    await dialog.getByRole("button", { name: "取消", exact: true }).click()
    await nav.getByRole("button", { name: "保存", exact: true }).click()
    await page.waitForFunction(() => /^(saved|clean):clean$/.test(document.querySelector("#status").textContent))
    const saved = await snapshot()
    await nav.getByRole("button", { name: "重开", exact: true }).click()
    assert.deepEqual(await snapshot(), saved)
    assert.equal(await area.locator('a[href="hnmagic://resource/123"]').textContent(), "[官网](站点)")
    assert.equal(await area.locator("blockquote blockquote").count(), 1)
    assert.deepEqual(await area.locator("ol").evaluateAll(nodes => nodes.map(node => node.dataset.hnnListStyle)), ["1", "a", "i", "1", "a"])
    await pane.getByLabel("撤销", { exact: true }).click()
    assert.deepEqual(await snapshot(), saved)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: `${evidenceDir}/saved-editor-${width}.png`, fullPage: true })
    console.log(`PASS ${width}px 1.14/1.15/1.16: toolbar link create/edit/remove, marks, title/href, dangerous URL draft retained, Tab/focus, cancel/Escape/outside, stale remote+undo rejection, shared history, HNN save/reopen all three features; screenshots saved`)
    await context.close()
  }
} finally { await browser?.close(); await server.close() }
