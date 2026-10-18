import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { createServer } from "vite"

const evidenceDir = "evidence/ham43-http"
mkdirSync(evidenceDir, { recursive: true })
const server = await createServer({ configFile: "vite.demo.config.ts", server: { port: 0, host: "0.0.0.0" } })
await server.listen()
let browser
try {
  const origin = server.resolvedUrls.network[0]
  assert.ok(origin, "A non-loopback network interface is required for the insecure HTTP check")
  browser = await chromium.launch({ headless: true })
  console.log("browser", browser.version())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on("pageerror", (error) => { errors.push(error.message); console.log("pageerror", error.message) })
  const response = await page.goto(`${origin}shared.html`)
  assert.equal(response.status(), 200)
  const context = await page.evaluate(() => ({
    isSecureContext, randomUUID: typeof crypto.randomUUID, getRandomValues: typeof crypto.getRandomValues
  }))
  console.log("context", context)
  assert.deepEqual(context, { isSecureContext: false, randomUUID: "undefined", getRandomValues: "function" })
  const a = page.locator('[data-view-id="a"] .tiptap')
  const b = page.locator('[data-view-id="b"] .tiptap')
  await a.waitFor({ timeout: 10000 })
  await b.waitFor()
  await a.locator("p").first().click()
  await page.keyboard.press("Control+Home")
  await page.keyboard.type("AA")
  await page.waitForFunction(() => [...document.querySelectorAll(".tiptap > p:first-of-type")].every((node) => node.textContent === "AA共享正文"))
  await page.getByLabel("撤销", { exact: true }).nth(1).click()
  await page.waitForFunction(() => [...document.querySelectorAll(".tiptap > p:first-of-type")].every((node) => node.textContent === "共享正文"))
  await page.getByLabel("重做", { exact: true }).first().click()
  await a.getByLabel("编辑卡片", { exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click()
  await page.getByLabel("锁定输入", { exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll(".tiptap")].every((node) => node.getAttribute("contenteditable") === "false"))
  assert.equal(await page.getByLabel("笔记标题").isDisabled(), true)
  await page.getByRole("button", { name: "保存笔记", exact: true }).click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("notes-shared-demo") ?? "null")?.document.data.content[0].content[0].text === "AA共享正文")
  await page.getByLabel("锁定输入", { exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll(".tiptap")].every((node) => node.getAttribute("contenteditable") === "true"))
  await page.screenshot({ path: `${evidenceDir}/desktop.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${evidenceDir}/mobile.png`, fullPage: true })
  assert.deepEqual(errors, [])
  console.log("PASS: insecure HTTP Provider mount, shared undo/redo, draft, acquire/release and save")
} finally {
  await browser?.close()
  await server.close()
}
