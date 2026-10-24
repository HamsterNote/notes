import assert from "node:assert/strict"
import path from "node:path"
import { mkdirSync, writeFileSync } from "node:fs"
import react from "@vitejs/plugin-react"
import { createServer } from "vite"
import { chromium } from "playwright"

mkdirSync("evidence", { recursive: true })
const server = await createServer({ configFile: false, root: path.resolve("scripts/fixtures/public-host"),
  plugins: [react()], server: { host: "127.0.0.1", port: 0 },
  resolve: { alias: [
    { find: "@hamster-note/notes/styles.css", replacement: path.resolve("src/lib/styles.css") },
    { find: "@hamster-note/notes/formula.css", replacement: path.resolve("node_modules/katex/dist/katex.min.css") },
    { find: "@hamster-note/notes", replacement: path.resolve("src/lib/index.ts") }
  ] } })
let browser
const measurements = []
try {
  await server.listen()
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${server.resolvedUrls.local[0]}?geometry=1`)
  await page.locator('[data-view-id="a"] .tiptap > h1').first().waitFor()
  const changesBeforeLayout = await page.evaluate(() => localStorage.getItem("changes"))
  const check = async (width, zoom, phase) => {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))))
      const blocks = await page.locator(".tiptap > :is(p,h1,h2,h3)").evaluateAll(blocks => blocks.map(block => {
        const rect = block.getBoundingClientRect(), handle = block.previousElementSibling.getBoundingClientRect()
        const scale = rect.width / block.offsetWidth
        const style = getComputedStyle(block)
        return { tag: block.tagName, text: block.textContent, height: rect.height / scale,
          lineHeight: parseFloat(style.lineHeight),
          delta: (handle.top + handle.height / 2 - rect.top) / scale - parseFloat(style.borderTopWidth) - parseFloat(style.paddingTop) - parseFloat(style.lineHeight) / 2 }
      }))
      measurements.push({ width, zoom, phase, blocks })
      assert.equal(blocks.length, 22)
      for (const block of blocks) assert(Math.abs(block.delta) <= 2, JSON.stringify({ width, zoom, ...block }))
  }
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const zoom of [1, 2]) {
      await page.locator("html").evaluate((element, zoom) => { element.style.zoom = String(zoom) }, zoom)
      await check(width, zoom, "resize")
      if (zoom === 1) await page.screenshot({ path: `evidence/ham107-handles-${width}.png`, fullPage: true })
    }
  }
  await page.addStyleTag({ content: ".hn-editor-content h2 { margin-top: 2rem; padding-top: 9px; border-top: 3px solid; line-height: 2.1; font-size: 27px }" })
  await check(1440, 2, "typography")
  assert.equal(await page.evaluate(() => localStorage.getItem("changes")), changesBeforeLayout, "layout must not change document/dirty state")
  await page.locator('[data-view-id="a"] .tiptap > h3').first().click()
  await page.keyboard.press("Control+Alt+2")
  assert.equal(await page.locator(".tiptap > h3").count(), 2, "heading conversion must reach both shared views")
  await check(1440, 2, "heading-conversion")
  await page.screenshot({ path: "evidence/ham107-headings-dynamic.png", fullPage: true })
  console.log("PASS mixed H1/H2/H3 and paragraph handles (single/multiline/empty), live resizing, paired views, CSS zoom 1/2")
} finally {
  writeFileSync("evidence/ham107-handles.json", JSON.stringify({ browser: browser?.version(), measurements }, null, 2))
  await browser?.close(); await server.close()
}
