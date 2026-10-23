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
try {
  await server.listen()
  browser = await chromium.launch()
  const measurements = []
  for (const width of [320, 390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.goto(`${server.resolvedUrls.local[0]}?geometry=1`)
    await page.locator('[data-view-id="a"] .tiptap > p').first().waitFor()
    for (const zoom of [1, 2]) {
      await page.locator("html").evaluate((element, zoom) => { element.style.zoom = String(zoom) }, zoom)
      const blocks = await page.locator(".tiptap > p").evaluateAll(blocks => blocks.map(block => {
        const rect = block.getBoundingClientRect(), handle = block.previousElementSibling.getBoundingClientRect()
        const scale = rect.width / block.offsetWidth
        return { text: block.textContent, delta: (handle.top + handle.height / 2 - rect.top) / scale - parseFloat(getComputedStyle(block).lineHeight) / 2 }
      }))
      assert.equal(blocks.length, 6)
      for (const block of blocks) assert(Math.abs(block.delta) <= 2, JSON.stringify({ width, zoom, ...block }))
      measurements.push({ width, zoom, blocks })
    }
    await page.screenshot({ path: `evidence/ham107-handles-${width}.png`, fullPage: true })
    await page.close()
  }
  writeFileSync("evidence/ham107-handles.json", JSON.stringify({ browser: browser.version(), measurements }, null, 2))
  console.log("PASS single/multiline/empty paragraph handles, four widths, paired views, CSS zoom 1/2")
} finally { await browser?.close(); await server.close() }
