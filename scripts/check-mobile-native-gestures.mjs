/** node scripts/check-mobile-native-gestures.mjs [--before-ref=<commit>]
 * Uses trusted Chromium CDP touch input. Videos and DOM focus are observability
 * evidence, not a substitute for a physical OS keyboard or magnifier check.
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { createServer } from "vite"
import { chromium } from "playwright"

const beforeRef = process.argv.find(arg => arg.startsWith("--before-ref="))?.split("=")[1]
const baseline = beforeRef ? execFileSync("git", ["show", `${beforeRef}:src/lib/editor/blockReorder.ts`], { encoding: "utf8" }) : null
const label = beforeRef ? "before" : "after"
const output = `evidence/ham173-native-gestures`
mkdirSync(output, { recursive: true })
const fixture = { schemaVersion: 1, data: { type: "doc", content: [
  "HAM173 first paragraph", "HAM173 second paragraph", "HAM173 third paragraph"
].map((text, i) => ({ type: "paragraph", attrs: { nodeId: `123e4567-e89b-42d3-a456-${String(i).padStart(12, "0")}` }, content: [{ type: "text", text }] })) } }
const server = await createServer({ configFile: "vite.demo.config.ts", server: { host: "127.0.0.1", port: 0 },
  plugins: baseline ? [{ name: "ham173-before-source", enforce: "pre", transform(code, id) {
    if (id.split("?")[0].endsWith("/src/lib/editor/blockReorder.ts")) return { code: baseline, map: null }
  } }] : [] })
let browser
const results = []
try {
  await server.listen()
  browser = await chromium.launch()
  for (const scenario of ["unfocused-hold", "quick-tap", "focused-hold"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
      recordVideo: { dir: output, size: { width: 390, height: 844 } } })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const video = page.video()
    try {
      await page.goto(server.resolvedUrls.local[0])
      await page.locator('input[accept=".hnn,.json,application/json"]').setInputFiles({ name: "ham173.hnn", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) })
      const blocks = page.locator(".hn-editor-content > p")
      await page.waitForFunction(() => document.querySelector(".hn-editor-content > p")?.textContent === "HAM173 first paragraph")
      await page.evaluate(() => {
        document.activeElement?.blur()
        window.__ham173Events = []
        for (const type of ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "focusin", "focusout", "selectstart", "contextmenu"]) {
          document.addEventListener(type, event => {
            if (!event.isTrusted) return
            const entry = { type, ms: performance.now(), defaultPrevented: event.defaultPrevented,
              focused: !!document.querySelector(".hn-editor-content")?.contains(document.activeElement) }
            window.__ham173Events.push(entry)
            queueMicrotask(() => {
              entry.defaultPrevented = event.defaultPrevented
              entry.focusedAfterListeners = !!document.querySelector(".hn-editor-content")?.contains(document.activeElement)
            })
          }, true)
        }
      })
      const cdp = await context.newCDPSession(page)
      const first = await blocks.first().boundingBox()
      const third = await blocks.nth(2).boundingBox()
      const x = first.x + 16, y = first.y + 12
      const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y]) => ({ x, y, id: 1 })) })
      const snapshot = () => page.evaluate(() => {
        const root = document.querySelector(".hn-editor-content")
        const selection = getSelection()
        return {
          dragging: !!document.querySelector(".hn-editor-block-dragging"),
          focused: root.contains(document.activeElement),
          activeElement: document.activeElement?.tagName,
          selection: selection.toString(),
          anchorBlock: selection.anchorNode?.parentElement?.closest("p")?.textContent ?? null,
          userSelect: getComputedStyle(root).userSelect,
          inlineStyle: root.getAttribute("style")
        }
      })
      const beforeOrder = await blocks.allTextContents()
      const tap = async () => {
        await touch("touchStart", [[x, y]])
        await page.waitForTimeout(80)
        await touch("touchEnd", [])
        await page.waitForTimeout(120)
      }
      if (scenario === "quick-tap") {
        await tap()
      } else {
        if (scenario === "focused-hold") await tap()
        const eventStart = await page.evaluate(() => window.__ham173Events.length)
        await touch("touchStart", [[x, y]])
        await page.waitForTimeout(100)
        const pending = await snapshot()
        await page.waitForTimeout(550)
        const held = await snapshot()
        await page.screenshot({ path: `${output}/${label}-${scenario}-held.png` })
        if (scenario === "unfocused-hold") {
          await touch("touchMove", [[x, third.y + third.height - 2]])
          await page.waitForTimeout(100)
        }
        await touch("touchEnd", [])
        await page.waitForTimeout(120)
        const restored = await snapshot()
        const afterOrder = await blocks.allTextContents()
        await page.screenshot({ path: `${output}/${label}-${scenario}-drop.png` })
        const events = await page.evaluate(() => window.__ham173Events)
        const gestureEvents = events.slice(eventStart)
        results.push({ scenario, beforeOrder, pending, held, restored, afterOrder, events: gestureEvents })
        if (!beforeRef) {
          const pointerDown = gestureEvents.find(event => event.type === "pointerdown")
          if (scenario === "unfocused-hold") {
            assert.equal(pointerDown?.defaultPrevented, true)
            assert.equal(pending.focused, false)
            assert.equal(held.focused, false)
            assert.equal(held.dragging, true)
            assert.equal(held.selection, "")
            assert.equal(held.userSelect, "none")
            assert.equal(restored.focused, false)
            assert.notEqual(restored.userSelect, "none")
            assert.deepEqual(afterOrder, [beforeOrder[1], beforeOrder[2], beforeOrder[0]])
            assert(!gestureEvents.some(event => event.type === "pointercancel"))
          } else {
            assert.equal(pointerDown?.defaultPrevented, false)
            assert.equal(pending.focused, true)
            assert.equal(held.focused, true)
            assert.equal(held.dragging, false)
            assert.notEqual(held.userSelect, "none")
            assert.deepEqual(afterOrder, beforeOrder)
          }
        }
      }
      if (scenario === "quick-tap") {
        const tapped = await snapshot()
        const afterOrder = await blocks.allTextContents()
        const events = await page.evaluate(() => window.__ham173Events)
        await page.screenshot({ path: `${output}/${label}-quick-tap.png` })
        results.push({ scenario, beforeOrder, tapped, afterOrder, events })
        if (!beforeRef) {
          assert.equal(events.find(event => event.type === "pointerdown")?.defaultPrevented, true)
          assert.equal(tapped.focused, true)
          assert.equal(tapped.dragging, false)
          assert.equal(tapped.anchorBlock, "HAM173 first paragraph")
          assert.notEqual(tapped.userSelect, "none")
          assert.deepEqual(afterOrder, beforeOrder)
        }
      }
      console.log(label, scenario, await snapshot())
    } finally {
      await context.close()
      await video?.saveAs(`${output}/${label}-${scenario}.webm`)
      await video?.delete()
    }
  }
} finally {
  writeFileSync(`${output}/${label}.json`, JSON.stringify({ browser: browser?.version(),
    command: `node scripts/check-mobile-native-gestures.mjs${beforeRef ? ` --before-ref=${beforeRef}` : ""}`,
    source: beforeRef ? `blockReorder.ts from ${beforeRef}; remaining checkout unchanged` : "current checkout",
    results,
    limitations: "Trusted Chromium CDP touch, DOM focus/selection observations, screenshots and Playwright video. Headless Chromium does not display a physical soft keyboard, iOS loupe or Android native selection UI; those require device validation." }, null, 2) + "\n")
  await browser?.close()
  await server.close()
}
