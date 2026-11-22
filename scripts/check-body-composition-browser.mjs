import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import react from "@vitejs/plugin-react"
import { chromium, webkit } from "playwright"
import { createServer } from "vite"

const engines = process.env.CHROMIUM_ONLY ? { chromium } : { webkit, chromium }
const packageDirectory = process.env.COMPOSITION_PACKAGE ? path.resolve(process.env.COMPOSITION_PACKAGE) : null
const directory = `evidence/ham132/${packageDirectory ? "package" : "source"}`
mkdirSync(directory, { recursive: true })
const results = []
const server = await createServer({
  configFile: false, plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"], alias: packageDirectory ? [
    { find: "../../../src/lib/index", replacement: `${packageDirectory}/dist/index.js` },
    { find: "../../../src/lib/styles.css", replacement: `${packageDirectory}/dist/styles.css` }
  ] : [] },
  optimizeDeps: { entries: ["scripts/fixtures/body-composition/index.html"] },
  server: { host: "127.0.0.1", port: 19325, fs: { allow: [process.cwd(), ...(packageDirectory ? [packageDirectory] : [])] } }
})
await server.listen()

async function expectBody(page, texts) {
  const result = await page.evaluate(() => {
    const doc = window.bodyComposition.snapshots.at(-1)?.data
    return { doc, texts: doc?.content?.map(node => node.content?.map(child => child.text ?? "").join("") ?? "") }
  })
  assert.equal(result.doc.content.length, texts.length)
  assert.deepEqual(result.texts, texts)
  assert.equal(await page.locator(".tiptap > p").count(), texts.length)
  assert.equal(result.doc.content[0].attrs.nodeId, "123e4567-e89b-42d3-a456-426614174000")
}

// Models DOM replacement during composition; does not invoke an OS IME.
async function compose(page, pinyin, chinese, selection = null) {
  const expected = await page.locator(".tiptap").evaluate(async (root, { pinyin, chinese, selection }) => {
    const p = root.querySelector("p")
    const text = p.firstChild?.nodeType === Node.TEXT_NODE ? p.firstChild : document.createTextNode("")
    const [from, to] = selection ?? [text.length, text.length]
    const prefix = text.data.slice(0, from), suffix = text.data.slice(to)
    if (text.parentNode) window.getSelection().setBaseAndExtent(text, from, text, to)
    else window.getSelection().setPosition(p, 0)
    document.dispatchEvent(new Event("selectionchange"))
    root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }))
    if (!text.parentNode) { p.querySelector("br")?.remove(); p.append(text) }
    const input = (data) => {
      root.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertCompositionText", data, isComposing: true }))
      text.data = prefix + data + suffix
      window.getSelection().setPosition(text, prefix.length + data.length)
      root.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data }))
      root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data, isComposing: true }))
    }
    input(pinyin)
    // Let MutationObserver, host rerender and layout run mid-composition.
    await new Promise(resolve => setTimeout(resolve, 30))
    if (!text.isConnected) throw new Error("Composition text detached during preedit")
    input(chinese)
    root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: chinese }))
    return prefix + chinese + suffix
  }, { pinyin, chinese, selection })
  await page.waitForFunction(expected => {
    const node = window.bodyComposition.snapshots.at(-1)?.data.content[0]
    return (node?.content?.map(child => child.text ?? "").join("") ?? "") === expected
  }, expected)
}

try {
  for (const [engineName, engine] of Object.entries(engines)) {
    const browser = await engine.launch()
    try {
      for (const mode of ["single", "shared"]) for (const width of [390, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390,
          ...(width === 390 ? { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1" } : {}) })
        const errors = []
        page.on("pageerror", error => errors.push(error.message))
        const url = `${server.resolvedUrls.local[0]}scripts/fixtures/body-composition/index.html?mode=${mode}`
        await page.goto(url)
        const root = page.locator(".tiptap")
        await root.locator("p").click()
        await compose(page, "ni hao", "你好")
        await expectBody(page, ["你好"])
        await compose(page, "ha ha", "哈哈")
        await expectBody(page, ["你好哈哈"])
        await compose(page, "zhong wen", "中文", [1, 3])
        await expectBody(page, ["你中文哈"])
        await compose(page, "qu xiao", "")
        await expectBody(page, ["你中文哈"])
        // A later intentional Enter still splits (Safari ignores the first key
        // immediately after compositionend to avoid candidate confirmation).
        await page.waitForFunction(() => performance.now() - window.bodyComposition.events.findLast(event => event.type === "compositionend").at > 550)
        await page.keyboard.press("Enter")
        await page.waitForFunction(() => window.bodyComposition.snapshots.at(-1)?.data.content.length === 2)
        await expectBody(page, ["你中文哈", ""])
        writeFileSync(`${directory}/${engineName}-${mode}-${width}-dom.json`, JSON.stringify(await page.evaluate(() => window.bodyComposition), null, 2))

        if (engineName === "chromium") {
          await page.goto(url)
          await root.locator("p").click()
          const cdp = await page.context().newCDPSession(page)
          for (const [pinyin, chinese] of [["ni hao", "你好"], ["ha ha", "哈哈"]]) {
            for (let index = 1; index <= pinyin.length; index++) {
              const text = pinyin.slice(0, index)
              await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length })
            }
            await cdp.send("Input.insertText", { text: chinese })
          }
          await expectBody(page, ["你好哈哈"])
          const evidence = await page.evaluate(() => window.bodyComposition)
          assert(evidence.events.some(event => event.type === "compositionstart" && event.trusted), "CDP must dispatch trusted composition")
          writeFileSync(`${directory}/${engineName}-${mode}-${width}-cdp.json`, JSON.stringify(evidence, null, 2))
          await cdp.detach()
        }
        assert.deepEqual(errors, [])
        results.push({ engine: engineName, version: browser.version(), mode, width, status: "passed", domComposition: "simulated", cdpComposition: engineName === "chromium" })
        console.log("PASS", engineName, mode, width)
        await page.close()
      }
    } finally { await browser.close() }
  }
  console.log("NOT REPRODUCED: pinyin/chinese in separate blocks. NOT TESTED: iOS OS keyboard, native App.")
} finally {
  writeFileSync(`${directory}/summary.json`, JSON.stringify({ entry: packageDirectory ? "package" : "source", results, physicalImeTested: false }, null, 2))
  await server.close()
}
