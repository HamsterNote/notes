import path from "node:path"
import { mkdirSync } from "node:fs"
import react from "@vitejs/plugin-react"
import { createServer } from "vite"
import { chromium } from "playwright"
import { checkPublicHost } from "./public-host-browser.mjs"

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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  try { await checkPublicHost(await context.newPage(), server.resolvedUrls.local[0]) }
  finally { await context.tracing.stop({ path: "evidence/ham49-public-host-trace.zip" }) }
  console.log("browser", browser.version(), "public root Provider contract PASS")
} finally { await browser?.close(); await server.close() }
