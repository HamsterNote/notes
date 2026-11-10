/** Run from repo root: node scripts/check-mobile-interactions.mjs
 * Starts/stops the repository Demo itself. CDP touch input produces trusted browser
 * touch/pointer events; no synthetic PointerEvent is used for the touch evidence.
 */
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { createServer } from "vite"
import { chromium } from "playwright"

mkdirSync("evidence", { recursive: true })
const document = { schemaVersion: 1, data: { type: "doc", content: [
  "HAM124 first paragraph", "HAM124 second paragraph", "HAM124 third paragraph",
  "Long wrapped text 中文长段落 ".repeat(70), ...Array.from({ length: 12 }, (_, i) => `Scroll paragraph ${i}`)
].map((text, i) => ({ type: "paragraph", attrs: { nodeId: `123e4567-e89b-42d3-a456-${String(i).padStart(12, "0")}` }, content: [{ type: "text", text }] })) } }
const server = await createServer({ configFile: "vite.demo.config.ts", server: { host: "127.0.0.1", port: 0 } })
const results = []
let browser
const toolbarSelector = '.hn-editor-interaction-toolbar:not([hidden])'
const mobileLabels = ["转换为", "插入", "加粗", "斜体", "下划线", "上移", "下移"]
async function checkBounds(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "page horizontal overflow")
  const toolbar = page.locator(toolbarSelector)
  const box = await toolbar.boundingBox()
  assert(box && box.x >= 0 && box.x + box.width <= (await page.evaluate(() => innerWidth)) + 1, "toolbar width")
  return box
}
async function order(page) { return page.locator(".hn-editor-content > p").allTextContents() }
async function load(page, width, theme) {
  await page.goto(server.resolvedUrls.local[0])
  await page.locator('input[accept=".hnn,.json,application/json"]').setInputFiles({
    name: "ham124.hnn", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document))
  })
  await page.waitForFunction(() => document.querySelector(".hn-editor-content > p")?.textContent === "HAM124 first paragraph")
  if (theme === "dark") await page.getByRole("switch").first().click()
  await page.locator(".hn-editor-content > p").first().scrollIntoViewIfNeeded()
  const paragraph = page.locator(".hn-editor-content > p").first()
  await paragraph.click({ position: { x: 12, y: 10 } })
  await page.keyboard.press("Home")
  await page.locator(width <= 840 ? toolbarSelector : ".hn-editor-content").waitFor()
}
try {
  await server.listen()
  browser = await chromium.launch()
  for (const width of [320, 390, 840, 841, 1440]) for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    page.on("console", msg => { if (msg.type() === "warning") console.log("browser warning", msg.text()) })
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    try {
      await load(page, width, theme)
      const mobile = width <= 840
      const handle = page.locator(".hn-editor-block-handle").first()
      assert.equal(await handle.isVisible(), !mobile, "handle boundary")
      if (mobile) {
        assert.deepEqual(await page.locator(toolbarSelector).locator("button").allTextContents(), mobileLabels)
        await checkBounds(page)
        // Keyboard navigation and native Enter/Space on real buttons.
        await page.locator(toolbarSelector).getByRole("button", { name: "转换为", exact: true }).focus()
        await page.keyboard.press("ArrowRight")
        assert.equal(await page.evaluate(() => document.activeElement.textContent), "插入")
        await page.keyboard.press("End")
        assert.equal(await page.evaluate(() => document.activeElement.textContent), "下移")
        await page.keyboard.press("Home")
        await page.keyboard.press("Enter")
        await page.locator(toolbarSelector).getByRole("button", { name: "标题 1", exact: true }).waitFor()
        await page.keyboard.press("Space")
        assert.equal(await page.locator(toolbarSelector).getByRole("button", { name: "标题 1", exact: true }).count(), 0)
        await page.keyboard.press("Space")
        await page.locator(toolbarSelector).getByRole("button", { name: "标题 1", exact: true }).waitFor()
        await page.keyboard.press("Escape")
        assert.equal(await page.locator(toolbarSelector).count(), 0)
        assert(await page.locator(".hn-editor-content").evaluate(el => el === document.activeElement))
        // Trusted native touch long press; observe browser-generated events and vibration contract.
        await page.evaluate(() => {
          window.__ham124Events = []
          window.__ham124Vibrations = []
          for (const type of ["touchstart", "touchmove", "touchend", "pointerdown", "pointermove", "pointerup", "pointercancel", "dragstart", "contextmenu", "selectstart"])
            document.addEventListener(type, e => { if (e.type !== "contextmenu" || e.isTrusted) window.__ham124Events.push({ type: e.type, trusted: e.isTrusted, cancelable: e.cancelable }) }, { capture: true })
          Object.defineProperty(navigator, "vibrate", { configurable: true, value: ms => { window.__ham124Vibrations.push(ms); return false } })
        })
        const cdp = await context.newCDPSession(page)
        let x, y, third
        const positionTarget = async () => {
          // Focusing another paragraph may scroll; measure the actual touch target anew.
          await page.keyboard.press("Escape")
          await page.locator(".hn-editor-content > p").first().evaluate(el => el.scrollIntoView({ block: "center", behavior: "instant" }))
          const first = await page.locator(".hn-editor-content > p").first().boundingBox()
          third = await page.locator(".hn-editor-content > p").nth(2).boundingBox()
          x = first.x + 12
          y = first.y + 10
          assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("p")?.textContent, [x, y]), "HAM124 first paragraph", "touch hit target")
        }
        const focusOtherBlock = async () => {
          await page.keyboard.press("Escape")
          await page.locator(".hn-editor-content > p").nth(1).click({ position: { x: 12, y: 10 } })
          await page.keyboard.press("Home")
          await page.waitForFunction(() => {
            const selection = getSelection()
            const node = selection?.anchorNode
            const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node
            return selection?.isCollapsed && element?.closest("p")?.textContent === "HAM124 second paragraph"
          })
        }
        const touch = async (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y]) => ({ x, y, id: 1 })) })
        // Synthetic contextmenu probes test cancellation only; all touch input is trusted CDP.
        const contextMenu = (index = 0) => page.locator(".hn-editor-content > p").nth(index).evaluate(el => {
          const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
          el.dispatchEvent(event)
          return event.defaultPrevented
        })
        const contextMenus = { probe: "synthetic cancelable MouseEvent; not an OS menu observation" }
        await page.locator(".hn-editor-content > p").first().click({ position: { x: 12, y: 10 } })
        await positionTarget()
        await touch("touchStart", [[x, y]])
        contextMenus.focusedPending = await contextMenu()
        assert.equal(contextMenus.focusedPending, false)
        await page.waitForTimeout(550)
        assert.equal(await page.locator(".hn-editor-block-dragging").count(), 0, "focused block retains native hold")
        contextMenus.focusedHeld = await contextMenu()
        assert.equal(contextMenus.focusedHeld, false)
        assert.deepEqual(await page.evaluate(() => window.__ham124Vibrations), [])
        const nativeSelectionAfterHold = await page.evaluate(() => getSelection().toString())
        await touch("touchEnd", [])
        // Other block is focused at pointerdown; natural focus change must not cancel drag intent.
        await focusOtherBlock()
        await positionTarget()
        await touch("touchStart", [[x, y]])
        contextMenus.pending = await contextMenu()
        contextMenus.pendingOtherBlock = await contextMenu(1)
        assert.equal(contextMenus.pending, false)
        assert.equal(contextMenus.pendingOtherBlock, false)
        assert.equal(await page.locator(".hn-editor-content").evaluate(el => getComputedStyle(el).userSelect), "none")
        await touch("touchCancel", [])
        assert.notEqual(await page.locator(".hn-editor-content").evaluate(el => getComputedStyle(el).userSelect), "none")
        contextMenus.cancelledPending = await contextMenu()
        assert.equal(contextMenus.cancelledPending, false)
        await focusOtherBlock()
        await positionTarget()
        await touch("touchStart", [[x, y]])
        assert.equal(await contextMenu(), false)
        await page.waitForTimeout(550) // Protocol gesture hold, not a CI/background poll.
        assert.equal(await page.locator(".hn-editor-block-dragging").count(), 1, `body hold ${width}/${theme}`)
        contextMenus.active = await contextMenu()
        assert.equal(contextMenus.active, false)
        assert.equal(await page.evaluate(() => getSelection().toString()), "")
        await touch("touchMove", [[x, third.y + third.height - 2]])
        await page.waitForTimeout(100)
        await touch("touchEnd", [])
        await page.waitForTimeout(100)
        assert.deepEqual((await order(page)).slice(0, 3), ["HAM124 second paragraph", "HAM124 third paragraph", "HAM124 first paragraph"])
        assert.equal(await page.locator(".hn-editor-block-dragging").count(), 0)
        assert.deepEqual(await page.evaluate(() => window.__ham124Vibrations), [10])
        const events = await page.evaluate(() => window.__ham124Events)
        assert(events.some(e => e.type === "touchmove") && events.some(e => e.type === "pointerup"))
        assert(events.every(e => e.trusted))
        // Drag intentionally leaves the mobile editor blurred; explicitly focus before hardware-keyboard undo.
        assert.equal(await page.locator(".hn-editor-content").evaluate(el => el.contains(document.activeElement)), false)
        await page.locator(".hn-editor-content").focus()
        await page.keyboard.press("Control+z")
        assert.equal((await order(page))[0], "HAM124 first paragraph")
        await focusOtherBlock()
        await positionTarget()
        const start = await page.locator(".hn-editor-content > p").first().boundingBox()
        const beforeScroll = await page.locator(".demo-note-preview > .hn-editor").evaluate(el => ({ editor: el.scrollTop, page: scrollY }))
        await touch("touchStart", [[start.x + 15, start.y + 24]])
        await touch("touchMove", [[start.x + 15, start.y - 50]])
        await touch("touchMove", [[start.x + 15, start.y - 100]])
        await touch("touchEnd", [])
        await page.waitForTimeout(550)
        assert.equal((await order(page))[0], "HAM124 first paragraph")
        assert.equal(await page.locator(".hn-editor-block-dragging").count(), 0)
        assert.deepEqual(await page.evaluate(() => window.__ham124Vibrations), [10])
        const afterScroll = await page.locator(".demo-note-preview > .hn-editor").evaluate(el => ({ editor: el.scrollTop, page: scrollY }))
        const scrollDelta = { editor: afterScroll.editor - beforeScroll.editor, page: afterScroll.page - beforeScroll.page }
        assert(scrollDelta.editor > 0 || scrollDelta.page > 0, "native touch scroll remains available")
        contextMenus.scrollCancelled = await contextMenu()
        assert.equal(contextMenus.scrollCancelled, false)
        // Long block, visible viewport resize (same layout width), and offscreen anchor.
        const long = page.locator(".hn-editor-content > p").nth(3)
        await long.click({ position: { x: 10, y: 10 } })
        await page.keyboard.press("Home")
        await page.setViewportSize({ width, height: 650 })
        await page.waitForTimeout(50)
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "long text overflow")
        await page.locator(".hn-editor-content > p").first().click({ position: { x: 12, y: 10 } })
        await page.locator(toolbarSelector).waitFor()
        await checkBounds(page)
        await page.screenshot({ path: `evidence/ham124-${width}-${theme}.png` })
        await page.locator(".demo-note-preview > .hn-editor").evaluate(el => { el.scrollTop = el.scrollHeight })
        await page.waitForTimeout(50)
        assert.equal(await page.locator(toolbarSelector).count(), 0, "offscreen anchor closes toolbar")
        results.push({ width, theme, layout: "mobile", result: "PASS", trustedTouch: events, contextMenus, focusedHold: { drag: false, vibration: false, nativeSelectionAfterHold }, scrollDelta, vibration: "stubbed false return, [10]; no hardware claim" })
      } else {
        // Actual mouse drag creates a native TextSelection, then all three marks.
        const first = await page.locator(".hn-editor-content > p").first().boundingBox()
        await page.mouse.move(first.x + 2, first.y + 10)
        await page.mouse.down()
        await page.mouse.move(first.x + Math.min(first.width - 5, 135), first.y + 10, { steps: 8 })
        await page.mouse.up()
        await page.locator(toolbarSelector).waitFor()
        assert.deepEqual(await page.locator(toolbarSelector).locator("button").allTextContents(), ["加粗", "斜体", "下划线"])
        const selected = await page.evaluate(() => window.getSelection().toString())
        assert(selected.length > 0)
        for (const label of ["加粗", "斜体", "下划线"]) {
          await page.locator(toolbarSelector).getByRole("button", { name: label, exact: true }).click()
          assert.equal(await page.evaluate(() => window.getSelection().toString()), selected)
        }
        assert(await page.locator(".hn-editor-content > p").first().locator("u").count())
        await checkBounds(page)
        await page.screenshot({ path: `evidence/ham124-${width}-${theme}.png` })
        await page.keyboard.press("Escape")
        await page.keyboard.press("ArrowRight")
        assert.equal(await page.locator(toolbarSelector).count(), 0)
        await page.keyboard.press("Shift+ArrowLeft")
        await page.locator(toolbarSelector).waitFor()
        // Dynamic boundary transition: text toolbar replaced by mobile toolbar.
        await page.setViewportSize({ width: 840, height: 900 })
        await page.locator(toolbarSelector).getByRole("button", { name: "转换为", exact: true }).waitFor()
        await checkBounds(page)
        results.push({ width, theme, layout: "desktop", result: "PASS", mouseSelection: selected, keyboardSelection: true, breakpoint: "840 mobile" })
      }
      assert.deepEqual(errors, [], "browser errors")
    } catch (error) {
      await page.screenshot({ path: `evidence/ham124-failure-${width}-${theme}.png` })
      console.log("failure context", await page.evaluate(() => ({ focus: document.activeElement?.outerHTML.slice(0, 200), selection: { text: getSelection()?.toString(), anchor: getSelection()?.anchorNode?.parentElement?.outerHTML }, events: window.__ham124Events?.slice(-12), toolbar: document.querySelector(".hn-editor-interaction-toolbar")?.outerHTML, scrollY, viewport: { width: innerWidth, height: innerHeight } })))
      throw error
    } finally {
      await context.tracing.stop({ path: `evidence/ham124-${width}-${theme}-trace.zip` })
      await context.close()
    }
    console.log("PASS", width, theme)
  }
  const report = { browser: browser.version(), command: "node scripts/check-mobile-interactions.mjs", results,
    limitations: "Web Chromium touch emulation with trusted touch input; viewport resize approximates keyboard occlusion. Contextmenu cancellation uses explicitly synthetic probes, not OS menu observation. Focused hold checks non-interference; native selection text is recorded as observed. No physical device, OS keyboard, or hardware vibration evidence." }
  writeFileSync("evidence/ham124-browser-results.json", JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify({ browser: report.browser, cases: results.length, result: "PASS" }))
} finally { await browser?.close(); await server.close() }
