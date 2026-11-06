// A synthetic event-order hypothesis probe, plus Chromium CDP composition.
// The WebKit sequence deliberately inserts a plain Enter and a manual DOM
// replacement. Matching the screenshot does NOT establish the reported cause.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import path from "node:path"
import { chromium, webkit } from "playwright"
import { createServer } from "vite"

const option = (name) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const consumer = option("consumer")
const reorderRef = option("reorder-ref")
const output = path.resolve(option("evidence-dir") ?? "evidence/ham172")
const label = option("label") ?? "baseline"
const expectSplit = !process.argv.includes("--expect-no-native-paragraph")
const entry = consumer ? "@hamster-note/notes" : "/src/lib/index.ts"
const overrides = new Map()
if (reorderRef) overrides.set("/src/lib/editor/blockReorder.ts", execFileSync("git", ["show", `${reorderRef}:src/lib/editor/blockReorder.ts`], { encoding: "utf8" }))
if (option("reorder-source")) overrides.set("/src/lib/editor/blockReorder.ts", readFileSync(option("reorder-source"), "utf8"))
const server = await createServer({
  configFile: false,
  root: path.resolve(consumer ?? "."),
  optimizeDeps: { entries: [] },
  plugins: [{
    name: "composition-input-check",
    enforce: "pre",
    transform(_code, id) {
      for (const [suffix, source] of overrides) if (id.split("?")[0].endsWith(suffix)) return { code: source, map: null }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== "/composition-input-check.html") return next()
        res.setHeader("Content-Type", "text/html")
        const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>HAM-172 composition protocol probe</title></head><body>
        <h1>HAM-172 ${label}</h1><p>Simulated composition; native browser Enter</p><div id="root"></div><script type="module">
        import React from 'react'; import { createRoot } from 'react-dom/client';
        import { NoteDocumentProvider, NoteEditorView } from '${entry}';
        import '${consumer ? "@hamster-note/notes/styles.css" : "/src/lib/styles.css"}';
        window.compositionCheck = { controller: null, documents: [], saves: [], events: [] };
        const initialDocument = { schemaVersion: 1, data: { type: 'doc', content: [
          { type: 'paragraph', attrs: { nodeId: '123e4567-e89b-42d3-a456-426614174000' } }
        ] } };
        createRoot(document.getElementById('root')).render(React.createElement(NoteDocumentProvider, {
          documentId: 'composition-input-browser', loadKey: 1, initialDocument,
          initialHostSnapshot: { changeId: 0, value: { title: '', summary: '' } },
          controllerRef: (controller) => { window.compositionCheck.controller = controller },
          onChange: (document) => { window.compositionCheck.documents.push(document) },
          onSave: async (payload) => { window.compositionCheck.saves.push(payload.document) }
        }, React.createElement(NoteEditorView, { viewId: 'primary' }), React.createElement(NoteEditorView, { viewId: 'secondary' })));
        </script></body></html>`
        void server.transformIndexHtml(req.url, html).then(html => res.end(html), next)
      })
    }
  }],
  server: { port: 0, host: "127.0.0.1" }
})
const results = []
let browser
async function openPage(browser, options = {}) {
  const page = await browser.newPage(options)
  page.setDefaultTimeout(15000)
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  if (options.isMobile) await page.addInitScript(() => {
    Object.defineProperty(navigator, "vendor", { configurable: true, get: () => "Apple Computer" })
    Object.defineProperty(navigator, "platform", { configurable: true, get: () => "iPhone" })
  })
  await page.goto(`${server.resolvedUrls.local[0]}composition-input-check.html`)
  await page.addScriptTag({ path: path.resolve("scripts/capture-hnn-ime-events.js") })
  const body = page.getByRole("textbox", { name: "笔记内容编辑区 primary", exact: true })
  if (options.isMobile) await body.locator("p").tap()
  else await body.locator("p").click()
  await body.evaluate(root => {
    for (const type of ["compositionstart", "compositionupdate", "compositionend", "keydown", "beforeinput", "input"]) {
      root.addEventListener(type, event => {
        const entry = { type, trusted: event.isTrusted, key: event.key, keyCode: event.keyCode,
          data: event.data, inputType: event.inputType, isComposing: event.isComposing,
          paragraphs: [...root.querySelectorAll("p")].map(p => p.textContent) }
        window.compositionCheck.events.push(entry)
        queueMicrotask(() => { entry.prevented = event.defaultPrevented })
      }, true)
    }
  })
  return { page, body, errors }
}
async function save(page) {
  return page.evaluate(async () => {
    const state = window.compositionCheck
    const controller = state.controller
    const result = controller.requestSave({ reason: "editor-button", expectedSessionId: controller.getState().identity.sessionId })
    if (result.kind === "pending") await result.completion
    return state.saves.at(-1)
  })
}
try {
  await mkdir(output, { recursive: true })
  await server.listen()
  browser = await webkit.launch()
  for (const chinese of ["你", "你好"]) {
    const { page, body, errors } = await openPage(browser, {
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"
    })
    const pinyin = chinese === "你" ? "ni" : "nihao"
    await body.evaluate(async (root, pinyin) => {
      const paragraph = root.querySelector("p")
      const text = document.createTextNode("")
      getSelection().setPosition(paragraph, 0)
      document.dispatchEvent(new Event("selectionchange"))
      root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }))
      paragraph.querySelector("br")?.remove()
      paragraph.append(text)
      root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true,
        inputType: "insertCompositionText", data: pinyin, isComposing: true }))
      text.data = pinyin
      getSelection().setPosition(text, pinyin.length)
      root.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: pinyin }))
      root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: pinyin, isComposing: true }))
      await new Promise(resolve => setTimeout(resolve, 50))
      root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: pinyin }))
    }, pinyin)
    assert.deepEqual(await body.locator("p").allTextContents(), [pinyin])
    await page.keyboard.press("Enter")
    await page.waitForTimeout(60)
    assert.deepEqual(await body.locator("p").allTextContents(), expectSplit ? [pinyin, ""] : [pinyin])
    // Emulate the late IME replacement at the browser's CURRENT caret. The
    // before case deliberately exposes how a native split strands the preedit.
    await body.evaluate(async (root, chinese) => {
      const anchor = getSelection().anchorNode
      const paragraph = (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement).closest("p")
      assertParagraph(paragraph)
      function assertParagraph(p) { if (!p || !root.contains(p)) throw new Error("Caret left editor paragraph") }
      const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true,
        inputType: "insertFromComposition", data: chinese, isComposing: false })
      root.dispatchEvent(event)
      if (event.defaultPrevented) throw new Error("Final composition replacement was cancelled")
      const text = document.createTextNode(chinese)
      paragraph.replaceChildren(text)
      getSelection().setPosition(text, chinese.length)
      root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromComposition", data: chinese, isComposing: false }))
      await new Promise(resolve => setTimeout(resolve, 60))
    }, chinese)
    const paragraphs = await body.locator("p").allTextContents()
    assert.deepEqual(paragraphs, expectSplit ? [pinyin, chinese] : [chinese])
    const peer = page.getByRole("textbox", { name: "笔记内容编辑区 secondary", exact: true })
    assert.deepEqual(await peer.locator("p").allTextContents(), paragraphs)
    const saved = await save(page)
    assert.deepEqual(saved.data.content.map(p => p.content?.map(t => t.text).join("") ?? ""), paragraphs)
    await page.screenshot({ path: path.join(output, `${label}-${pinyin}.png`), fullPage: true })
    const events = await page.evaluate(() => window.compositionCheck.events)
    const recording = await page.evaluate(() => window.ham172Ime.stop())
    assert(recording.events.some(event => event.type === "compositionstart"))
    assert(recording.events.some(event => event.type === "keydown" && event.trusted))
    assert(recording.events.some(event => event.type === "mutation"))
    assert(recording.events.filter(event => event.type === "beforeinput").every(event => typeof event.defaultPrevented === "boolean"))
    await page.keyboard.press("Enter")
    await page.waitForTimeout(60)
    assert.deepEqual(await body.locator("p").allTextContents(), [...paragraphs, ""])
    assert.equal(await page.evaluate(() => window.ham172Ime.read().events.length), recording.events.length)
    assert.deepEqual(errors, [])
    results.push({ browser: `WebKit ${browser.version()}`, chinese, paragraphs, saved, events,
      driver: "synthetic composition/DOM replacement, trusted Enter; NOT a physical IME", errors })
    await page.close()
  }
  await browser.close()
  browser = await chromium.launch()
  const { page, body, errors } = await openPage(browser)
  const cdp = await page.context().newCDPSession(page)
  for (const chinese of ["你", "你好"]) {
    for (const text of ["n", "ni", "nihao"]) {
      await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length })
      assert.equal(await body.locator("p").count(), 1)
    }
    await cdp.send("Input.insertText", { text: chinese })
  }
  await page.waitForTimeout(60)
  assert.deepEqual(await body.locator("p").allTextContents(), ["你你好"])
  const saved = await save(page)
  assert.equal(saved.data.content.length, 1)
  assert.equal(saved.data.content[0].content[0].text, "你你好")
  await page.keyboard.press("Enter")
  assert.equal(await body.locator("p").count(), 2)
  assert.deepEqual(errors, [])
  results.push({ browser: `Chromium ${browser.version()}`, driver: "native CDP composition; NOT a physical IME",
    paragraphs: ["你你好"], saved, events: await page.evaluate(() => window.compositionCheck.events), errors })
  await writeFile(path.join(output, `${label}.json`), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results.map(({ browser, driver, paragraphs }) => ({ browser, driver, paragraphs })), null, 2))
  console.log("PASS: DOM, shared view and saved HNN agree; a later intentional Enter splits normally")
} finally {
  await browser?.close()
  await server.close()
}
