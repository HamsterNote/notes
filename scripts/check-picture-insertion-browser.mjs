import path from "node:path"
import react from "@vitejs/plugin-react"
import { createServer } from "vite"
import { chromium } from "playwright"
import { checkPictureInsertion } from "./picture-insertion-browser.mjs"

const server = await createServer({ configFile: false, root: path.resolve("scripts/fixtures/pack-consumer"), plugins: [react()],
  server: { host: "127.0.0.1", port: 0, watch: null }, resolve: { alias: [
    { find: "@hamster-note/notes/styles.css", replacement: path.resolve("src/lib/styles.css") },
    { find: "@hamster-note/notes/formula.css", replacement: path.resolve("node_modules/katex/dist/katex.min.css") },
    { find: "@hamster-note/notes", replacement: path.resolve("src/lib/index.ts") }
  ] } })
let browser
try {
  await server.listen()
  browser = await chromium.launch()
  console.log(`Chromium ${browser.version()}; Linux; public picture fixture; source alias`)
  const context = await browser.newContext({ viewport: { width: 900, height: 900 }, hasTouch: true })
  await checkPictureInsertion(await context.newPage(), server.resolvedUrls.local[0], "evidence/ham240")
  await context.close()
} finally {
  await browser?.close()
  await server.close()
}
