/** node scripts/check-mobile-hold.mjs [--before-ref=66034bb]
 * Only blockReorder.ts is overridden in before mode; no checkout is mutated.
 * Gestures and the pre-existing range use trusted CDP touch / keyboard input.
 * selectstart/contextmenu probes are explicitly synthetic cancellation checks.
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { createServer } from "vite"
import { chromium } from "playwright"

const beforeRef = process.argv.find(arg => arg.startsWith("--before-ref="))?.split("=")[1]
const baseline = beforeRef ? execFileSync("git", ["show", `${beforeRef}:src/lib/editor/blockReorder.ts`], { encoding: "utf8" }) : null
const label = beforeRef ? "before" : "after"
const fixture = { schemaVersion: 1, data: { type: "doc", content: [
  "HAM124 first paragraph", "HAM124 second paragraph", "HAM124 third paragraph"
].map((text, i) => ({ type: "paragraph", attrs: { nodeId: `123e4567-e89b-42d3-a456-${String(i).padStart(12, "0")}` }, content: [{ type: "text", text }] })) } }
const server = await createServer({ configFile: "vite.demo.config.ts", server: { host: "127.0.0.1", port: 0 },
  plugins: baseline ? [{ name: "ham124-before-source", enforce: "pre", transform(code, id) {
    if (id.split("?")[0].endsWith("/src/lib/editor/blockReorder.ts")) return { code: baseline, map: null }
  } }] : [] })
mkdirSync("evidence", { recursive: true })
let browser
const results = []
try {
  await server.listen()
  browser = await chromium.launch()
  for (const scenario of ["other-block-cursor", "other-block-range", "focused-block"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    try {
      await page.goto(server.resolvedUrls.local[0])
      await page.locator('input[accept=".hnn,.json,application/json"]').setInputFiles({ name: "ham124.hnn", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) })
      const blocks = page.locator(".hn-editor-content > p")
      await page.waitForFunction(() => document.querySelector(".hn-editor-content > p")?.textContent === "HAM124 first paragraph")
      await blocks.nth(scenario === "focused-block" ? 0 : 1).click({ position: { x: 12, y: 10 } })
      await page.keyboard.press("Home")
      await page.waitForFunction(() => getSelection()?.isCollapsed && getSelection().anchorOffset === 0)
      await blocks.first().evaluate(el => el.scrollIntoView({ block: "center", behavior: "instant" }))
      // Do not press Escape: restoring a toolbar bookmark can collapse/move the
      // native range under test. The first paragraph is above the second's toolbar.
      if (scenario === "other-block-range") {
        await page.keyboard.press("Shift+ArrowRight")
        await page.waitForFunction(() => getSelection().toString() === "H")
      }
      const precondition = await page.evaluate(() => ({ selected: getSelection().toString(), anchor: getSelection().anchorNode?.parentElement?.closest("p")?.textContent }))
      assert.equal(precondition.anchor, scenario === "focused-block" ? "HAM124 first paragraph" : "HAM124 second paragraph")
      assert.equal(precondition.selected.length > 0, scenario === "other-block-range")
      await page.evaluate(() => {
        window.__holdEvents = []
        window.__holdSelections = []
        for (const type of ["pointerdown", "pointercancel", "pointerup", "touchstart", "touchmove", "touchend", "selectstart", "contextmenu"]) {
          document.addEventListener(type, event => {
            if (!event.isTrusted) return
            const entry = { type, trusted: event.isTrusted, ms: performance.now(), prevented: false }
            window.__holdEvents.push(entry)
            queueMicrotask(() => { entry.prevented = event.defaultPrevented })
          }, true)
        }
        // Native dispatch can checkpoint microtasks between listeners. Observe
        // the range next task, after both PM and the drag guard, retaining the raw
        // range for comparison. A NodeSelection after drop may select the block.
        document.addEventListener("selectionchange", () => {
          const rawText = getSelection().toString()
          setTimeout(() => window.__holdSelections.push({
            ms: performance.now(), rawText, text: getSelection().toString(), userSelect: getComputedStyle(document.querySelector(".hn-editor-content")).userSelect
          }), 0)
        })
      })
      const cdp = await context.newCDPSession(page)
      const first = await blocks.first().boundingBox()
      const third = await blocks.nth(2).boundingBox()
      const x = first.x + 12, y = first.y + 10
      assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("p")?.textContent, [x, y]), "HAM124 first paragraph")
      const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y]) => ({ x, y, id: 1 })) })
      const snapshot = () => page.evaluate(() => {
        const root = document.querySelector(".hn-editor-content")
        return { dragging: !!document.querySelector(".hn-editor-block-dragging"), selection: getSelection().toString(), userSelect: getComputedStyle(root).userSelect, inlineStyle: root.getAttribute("style") }
      })
      const probe = type => blocks.first().evaluate((el, type) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        el.dispatchEvent(event)
        return event.defaultPrevented
      }, type)
      const beforeOrder = await blocks.allTextContents()
      await touch("touchStart", [[x, y]])
      await page.waitForTimeout(100)
      const pending = await snapshot()
      const syntheticProbes = { selectstartPrevented: await probe("selectstart"), contextmenuPrevented: await probe("contextmenu") }
      await page.waitForTimeout(550)
      const held = await snapshot()
      syntheticProbes.heldContextmenuPrevented = await probe("contextmenu")
      await page.screenshot({ path: `evidence/ham124-hold-${label}-${scenario}.png` })
      await touch("touchMove", [[x, third.y + third.height - 2]])
      await page.waitForTimeout(100)
      await touch("touchEnd", [])
      await page.waitForTimeout(100)
      const afterOrder = await blocks.allTextContents()
      const restored = await snapshot()
      await page.screenshot({ path: `evidence/ham124-hold-${label}-${scenario}-drop.png` })
      const events = await page.evaluate(() => window.__holdEvents)
      const selections = await page.evaluate(() => window.__holdSelections)
      const result = { scenario, precondition, beforeOrder, pending, syntheticProbes, held, afterOrder, restored, events, selections }
      results.push(result)
      if (!beforeRef) {
        assert.equal(held.dragging, scenario !== "focused-block", "unfocused hold activates; focused hold stays native")
        assert.equal(syntheticProbes.contextmenuPrevented, false)
        assert.equal(syntheticProbes.heldContextmenuPrevented, false)
        assert.equal(syntheticProbes.selectstartPrevented, scenario !== "focused-block")
        assert.equal(pending.userSelect === "none", scenario !== "focused-block")
        assert.notEqual(restored.userSelect, "none", "temporary CSS restored")
        if (scenario !== "focused-block") {
          assert.equal(pending.selection, "")
          assert.equal(held.selection, "")
          assert(selections.filter(entry => entry.userSelect === "none").every(entry => entry.text === ""), "no range survives a pending/active selectionchange")
          assert.deepEqual(afterOrder, [beforeOrder[1], beforeOrder[2], beforeOrder[0]])
          assert(!events.some(e => e.type === "pointercancel"), "hold/drop keeps the pointer")
        } else assert.deepEqual(afterOrder, beforeOrder)
      }
      console.log(label, scenario, { dragging: held.dragging, reordered: afterOrder[0] !== beforeOrder[0], pendingUserSelect: pending.userSelect })
    } finally {
      await context.tracing.stop({ path: `evidence/ham124-hold-${label}-${scenario}-trace.zip` })
      await context.close()
    }
  }
} finally {
  writeFileSync(`evidence/ham124-hold-${label}.json`, JSON.stringify({ browser: browser?.version(), command: `node scripts/check-mobile-hold.mjs${beforeRef ? ` --before-ref=${beforeRef}` : ""}`, source: beforeRef ? `blockReorder.ts from ${beforeRef}, remaining checkout unchanged` : "current checkout", results,
    limitations: "Trusted Chromium CDP touch and native keyboard input; explicit synthetic event cancellation probes. Not a physical phone/OS menu or hardware vibration test. Native long-press word-selection pointercancel is reported only if observed." }, null, 2) + "\n")
  await browser?.close()
  await server.close()
}
