import assert from "node:assert/strict"
import path from "node:path"
import { mkdirSync } from "node:fs"
import react from "@vitejs/plugin-react"
import { createServer } from "vite"
import { chromium } from "playwright"

mkdirSync("evidence/ham237", { recursive: true })
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
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(server.resolvedUrls.local[0])
    const pane = page.locator('[data-view-id="a"]')
    const area = pane.locator(".tiptap")
    const toolbar = page.getByRole("toolbar", { name: "文字与块操作" })
    await area.waitFor()
    const choose = async label => {
      await toolbar.getByRole("button", { name: "转换为", exact: true }).click()
      await toolbar.getByRole("button", { name: label, exact: true }).click()
    }
    const selectParagraph = async (index = 0) => {
      await area.locator("p").nth(index).click()
      await page.keyboard.press("Home")
      await page.keyboard.press("Shift+End")
    }
    const reset = async label => { await page.getByRole("button", { name: label, exact: true }).click(); await area.locator("p").first().waitFor() }
    for (const label of ["有序列表", "无序列表", "待办列表"]) {
      await reset("重置段落"); await selectParagraph(); await choose(label)
      assert.equal(await area.locator(label === "有序列表" ? "ol" : label === "无序列表" ? "ul:not([data-type])" : 'ul[data-type="taskList"]').count(), 1)
    }
    for (const [source, target] of [["有序列表", "无序列表"], ["有序列表", "待办列表"], ["无序列表", "有序列表"], ["无序列表", "待办列表"], ["待办列表", "有序列表"], ["待办列表", "无序列表"]]) {
      await reset("重置段落"); await selectParagraph(); await choose(source); await choose(target)
      const snapshot = await page.evaluate(() => window.listSnapshot)
      assert.equal(snapshot.data.content[0].type, { 有序列表: "orderedList", 无序列表: "bulletList", 待办列表: "taskList" }[target])
      assert.equal(snapshot.data.content[1].type, "paragraph")
    }
    console.log(`PASS ${width}px: three creation entries and six directed conversions via toolbar`)
    await reset("混合列表")
    await selectParagraph(2) // second direct item, after parent + nested child
    await choose("无序列表")
    assert.deepEqual((await area.locator(":scope > ol").evaluateAll(nodes => nodes.map(node => Number(node.start)))), [5, 7])
    await choose("有序列表")
    assert.deepEqual((await area.locator(":scope > ol").evaluateAll(nodes => nodes.map(node => Number(node.start)))), [5, 1, 7])
    const child = area.getByRole("checkbox", { name: "待办：child", exact: true })
    assert.equal(await child.isChecked(), true)
    await child.focus(); await page.keyboard.press("Space")
    assert.equal(await child.isChecked(), false)
    if (width === 390) await child.tap()
    else await child.click()
    assert.equal(await child.isChecked(), true)
    assert.equal(await page.evaluate(() => window.dragStarts ?? 0), 0)
    console.log(`PASS ${width}px: partial numbering 5/1/7, child preserved, checkbox Space/click, no reorder`)
    const done = area.getByRole("checkbox", { name: "待办：done", exact: true })
    await area.locator("p").filter({ hasText: /^done$/ }).click()
    // Native selectionchange is asynchronous after focus leaves a checkbox.
    await page.waitForFunction(() => document.querySelector('[data-view-id="a"] .tiptap').editor.state.selection.$from.parent.textContent === "done", null, { timeout: 3000 })
    await page.keyboard.press("End"); await page.keyboard.press("Enter")
    const empty = area.getByRole("checkbox", { name: "待办：空白事项", exact: true })
    assert.equal(await done.isChecked(), true)
    assert.equal(await empty.isChecked(), false)
    await page.keyboard.press("Enter")
    assert.equal(await empty.count(), 0)
    await reset("混合列表")
    await area.locator("p").filter({ hasText: /^open$/ }).click()
    await page.waitForFunction(() => document.querySelector('[data-view-id="a"] .tiptap').editor.state.selection.$from.parent.textContent === "open")
    await page.keyboard.press("Tab")
    assert.equal(await area.locator('ul[data-type="taskList"] ul[data-type="taskList"]').count(), 1)
    await page.keyboard.press("Shift+Tab")
    assert.equal(await area.locator('ul[data-type="taskList"] ul[data-type="taskList"]').count(), 0)
    await toolbar.getByRole("button", { name: "缩进", exact: true }).click()
    await toolbar.getByRole("button", { name: "反缩进", exact: true }).click()
    await page.getByRole("button", { name: "冻结切换" }).click()
    await page.waitForFunction(() => document.querySelector("#status").textContent === "frozen")
    const before = await page.evaluate(() => JSON.stringify(window.listSnapshot))
    await child.click({ force: true })
    assert.equal(await page.evaluate(() => JSON.stringify(window.listSnapshot)), before)
    assert.equal(await child.isChecked(), true)
    await page.getByRole("button", { name: "冻结切换" }).click()
    await page.waitForFunction(() => document.querySelector("#status").textContent === "editable")
    await child.click()
    await page.getByRole("button", { name: "切换保存失败" }).click()
    await page.getByRole("navigation").getByRole("button", { name: "保存", exact: true }).click()
    await page.waitForFunction(() => document.querySelector("#status").textContent === "failure:dirty")
    await page.getByRole("button", { name: "切换保存失败" }).click()
    await page.getByRole("navigation").getByRole("button", { name: "保存", exact: true }).click()
    await page.waitForFunction(() => /^(saved|clean):clean$/.test(document.querySelector("#status").textContent))
    const saved = await page.evaluate(() => window.listSnapshot)
    await page.getByRole("button", { name: "重开", exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.listSnapshot), saved)
    assert.equal(await child.isChecked(), false)
    await page.getByText("共享视图", { exact: true }).click()
    const peer = page.locator('[data-view-id="b"]')
    await peer.locator(".tiptap").click()
    await child.focus(); await page.keyboard.press("Space")
    assert.equal(await peer.getByRole("checkbox", { name: "待办：child", exact: true }).isChecked(), true)
    await peer.getByLabel("撤销", { exact: true }).click()
    assert.equal(await child.isChecked(), false)
    await peer.getByLabel("重做", { exact: true }).click()
    assert.equal(await child.isChecked(), true)
    await page.screenshot({ path: `evidence/ham237/lists-${width}.png`, fullPage: true })
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}px: Enter/exit, indent/lift, freeze, failed save/retry/reopen, shared undo/redo; screenshot saved`)
    for (const kind of ["card", "drawing"]) {
      await reset("列表与抽屉")
      await page.getByText("共享视图", { exact: true }).click()
      await pane.getByLabel(kind === "card" ? "编辑卡片" : "编辑画板", { exact: true }).click()
      const dialog = page.getByRole("dialog")
      assert.equal(await area.getAttribute("contenteditable"), "false")
      assert.equal(await peer.locator(".tiptap").getAttribute("contenteditable"), "false")
      if (kind === "card") {
        await dialog.getByRole("button", { name: "添加卡片", exact: true }).click()
        await dialog.getByLabel("卡片 card-1 标题", { exact: true }).fill("列表旁的卡片回归")
      } else {
        // Use a real line stroke. Existing pen strokes include timestamp fields
        // rejected by drawingPayload's point whitelist (tracked in evidence).
        await dialog.getByRole("button", { name: "直线", exact: true }).click()
        const surface = dialog.locator(".hn-editor-drawing-canvas svg").first()
        const box = await surface.boundingBox()
        assert.ok(box && box.width > 100 && box.height > 100)
        await page.mouse.click(box.x + 30, box.y + 30)
        await page.mouse.dblclick(box.x + 90, box.y + 80)
      }
      await dialog.getByRole("button", { name: "完成", exact: true }).click()
      if (await dialog.getByRole("alert").isVisible()) throw new Error(await dialog.getByRole("alert").textContent())
      await dialog.waitFor({ state: "hidden" })
      const committed = await page.evaluate(() => window.listSnapshot)
      const data = JSON.parse(committed.data.content.find(node => node.type === kind).attrs.data)
      assert.equal(kind === "card" ? data.cards.length : data.strokes.length, 1)
      const peerDoc = () => page.evaluate(() => ["a", "b"].map(id =>
        document.querySelector(`[data-view-id="${id}"] .tiptap`).editor.state.doc.toJSON()))
      let documents = await peerDoc()
      assert.deepEqual(documents[0], documents[1])
      await peer.getByLabel("撤销", { exact: true }).click()
      const undone = await page.evaluate(() => window.listSnapshot)
      assert.equal(JSON.parse(undone.data.content.find(node => node.type === kind).attrs.data)[kind === "card" ? "cards" : "strokes"].length, 0)
      await pane.getByLabel("重做", { exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.listSnapshot), committed)
      documents = await peerDoc()
      assert.deepEqual(documents[0], documents[1])
      await page.getByRole("navigation").getByRole("button", { name: "保存", exact: true }).click()
      await page.waitForFunction(() => /^(saved|clean):clean$/.test(document.querySelector("#status").textContent))
      await page.getByRole("button", { name: "重开", exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.listSnapshot), committed)
      console.log(`PASS ${width}px: real ${kind === "drawing" ? "drawing (line)" : kind} drawer + lists, locked body, shared commit/undo/redo, save/reopen`)
    }
    assert.deepEqual(errors, [])
    await context.close()
  }
} finally { await browser?.close(); await server.close() }
