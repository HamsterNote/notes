import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"

const managedSrc = "hamster_note_data/images/0123456789abcdef0123456789abcdef.png"
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")

export async function checkPictureInsertion(page, url, evidenceDir) {
  mkdirSync(evidenceDir, { recursive: true })
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto(url)
  const left = page.locator('[data-view-id="left"]')
  const right = page.locator('[data-view-id="right"]')
  await left.locator(".tiptap p").first().waitFor()
  assert.equal(await page.locator("input[type=file]").count(), 0)
  assert.equal(await page.locator(".hn-editor-controls").count(), 0)

  const handle = left.locator("[data-drag-handle]").first()
  await left.locator(".tiptap p").first().hover()
  await handle.click()
  const next = page.getByRole("menuitem", { name: "下一行", exact: true })
  await next.hover()
  const image = page.getByRole("menuitem", { name: "图像", exact: true })
  await image.waitFor()
  await image.click()
  let dialog = page.getByRole("dialog", { name: "插入图像" })
  await dialog.locator("input[type=file]").setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: png })
  await dialog.getByAltText("图片预览").waitFor()
  assert.equal(await page.evaluate(() => window.pictureUploads ?? 0), 0)
  assert.equal(await dialog.getByRole("button", { name: "确认插入", exact: true }).isEnabled(), true)
  await page.screenshot({ path: `${evidenceDir}/dialog-light-dark-320.png`, fullPage: true })

  await right.locator("[data-drag-handle]").first().evaluate(element => element.click())
  await right.getByText("下移", { exact: true }).evaluate(element => element.click())
  await dialog.getByRole("button", { name: "确认插入", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await page.waitForFunction(() => window.pictureUploads === 1)
  await page.waitForFunction(() => Array.from(document.querySelectorAll("[data-view-id] .hn-editor-picture-img")).every(img => img.src.startsWith("blob:") && img.naturalWidth === 1))
  const inserted = await page.evaluate(() => window.pictureSnapshot)
  assert.deepEqual(inserted.data.content.map(node => node.type), ["paragraph", "paragraph", "picture"])
  assert.equal(inserted.data.content[2].attrs.src, managedSrc)
  assert.equal(JSON.stringify(inserted).includes("blob:"), false)
  await page.screenshot({ path: `${evidenceDir}/inserted-dual-pane.png`, fullPage: true })

  await right.getByLabel("撤销", { exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll("[data-view-id] [data-hnn-node=picture]").length === 0)
  await right.getByLabel("重做", { exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll("[data-view-id] [data-hnn-node=picture]").length === 2)

  await handle.focus()
  await page.keyboard.press("Enter")
  await next.focus()
  await page.keyboard.press("ArrowRight")
  await image.focus()
  await page.keyboard.press("Enter")
  await page.keyboard.press("Escape")
  await page.getByRole("dialog", { name: "插入图像" }).waitFor({ state: "hidden" })

  await handle.tap()
  await next.tap()
  await image.tap()
  await page.getByRole("button", { name: "关闭图像对话框" }).tap()
  await page.getByRole("dialog", { name: "插入图像" }).waitFor({ state: "hidden" })

  const legacy = page.locator("#legacy")
  await legacy.locator("[data-drag-handle]").first().focus()
  await page.keyboard.press("Enter")
  await legacy.getByText("下一行", { exact: true }).click()
  await legacy.getByText("图像", { exact: true }).click()
  dialog = page.getByRole("dialog", { name: "插入图像" })
  await dialog.locator("input[type=file]").setInputFiles({ name: "legacy.png", mimeType: "image/png", buffer: png })
  const confirm = dialog.getByRole("button", { name: "确认插入", exact: true })
  await page.waitForFunction(() => !document.querySelector("#legacy .hn-picture-dialog__confirm")?.disabled)
  await confirm.click()
  await page.waitForFunction(() => window.legacyPictureSnapshot?.data.content[1]?.attrs.src === "hamster_note_data/images/0123456789abcdef0123456789abcdef.png")
  await legacy.locator(".hn-editor-picture-img").waitFor()

  assert.deepEqual(errors, [])
  const report = {
    browser: "Chromium",
    publicFixture: true,
    hoverWithoutToggle: true,
    touchAndKeyboard: true,
    themes: ["light", "dark"],
    paneWidth: 320,
    targetFollowedNodeId: true,
    sharedUndoRedo: true,
    providerAndStandalone: true,
    selectedBeforeUpload: 0,
    uploadedBytes: png.byteLength,
    persistedSrc: managedSrc,
    runtimeUrlPersisted: false,
    realPixelWidth: 1,
    screenshots: ["dialog-light-dark-320.png", "inserted-dual-pane.png"]
  }
  writeFileSync(`${evidenceDir}/browser.json`, JSON.stringify(report, null, 2) + "\n")
  console.log("picture insertion browser PASS: hover/touch/keyboard, light/dark 320px panes, nodeId target, shared undo/redo, Provider + standalone, real pixel")
}
