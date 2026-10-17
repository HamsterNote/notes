import assert from "node:assert/strict"
import path from "node:path"
import { chromium } from "playwright"
import { createServer } from "vite"

const consumer = process.argv[2]
const entry = consumer ? "@hamster-note/notes" : "/src/lib/index.ts"
function installPortalPage(server) {
  server.middlewares.use((req, res, next) => {
    if (req.url !== "/portal-composition-check.html") return next()
    res.setHeader("Content-Type", "text/html")
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { NoteDocumentProvider, NoteEditorView } from '${entry}';
    window.portalCheck = { changes: 0, controller: null };
    const initialDocument = { schemaVersion: 1, data: { type: 'doc', content: [
      { type: 'paragraph', attrs: { nodeId: '123e4567-e89b-42d3-a456-426614174000' }, content: [{ type: 'text', text: 'body' }] },
      { type: 'formula', attrs: { nodeId: '123e4567-e89b-42d3-a456-426614174001', latex: 'x' } }
    ] } };
    createRoot(document.getElementById('root')).render(React.createElement(NoteDocumentProvider, {
      documentId: 'portal-browser', loadKey: 1, initialDocument,
      initialHostSnapshot: { changeId: 0, value: { title: '', summary: '' } },
      controllerRef: (controller) => { window.portalCheck.controller = controller },
      onChange: () => { window.portalCheck.changes++ }, onSave: async () => {}
    }, React.createElement(NoteEditorView, { viewId: 'a' }), React.createElement(NoteEditorView, { viewId: 'b' })));
  </script></body></html>`
    void server
      .transformIndexHtml(req.url, html)
      .then((transformed) => res.end(transformed), next)
  })
}
const server = await createServer({
  configFile: false,
  root: path.resolve(consumer ?? "."),
  plugins: [
    { name: "portal-composition-check", configureServer: installPortalPage }
  ],
  server: { port: 0, host: "127.0.0.1" }
})
await server.listen()
const browser = await chromium.launch()
try {
  console.log(
    "browser",
    browser.version(),
    "entry",
    entry,
    "root",
    consumer ?? "source"
  )
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 }
  ]) {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on("pageerror", (error) => {
      errors.push(error.message)
      console.error("pageerror", error.message)
    })
    page.on("console", (message) => {
      if (message.type() === "error") console.error("console", message.text())
    })
    page.on("response", (response) => {
      if (response.status() >= 400)
        console.error("http", response.status(), response.url())
    })
    await page.goto(
      `${server.resolvedUrls.local[0]}portal-composition-check.html`
    )
    await page.waitForFunction(() => !!window.portalCheck?.controller, null, {
      timeout: 10000
    })
    assert.equal(await page.evaluate(() => window.portalCheck.controller.getState().lifecycle), "ready")
    await page.locator('[data-view-id="a"] .hn-editor-formula-preview').click()
    const before = await page.evaluate(async () => {
      const { controller } = window.portalCheck
      const textarea = document.querySelector(".hn-editor-mini-textarea")
      textarea.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true, data: "x+y" })
      )
      textarea.value = "x+y"
      textarea.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "x+y",
          isComposing: true
        })
      )
      const expectedSessionId = controller.getState().identity.sessionId
      window.portalCheck.context = {
        expectedSessionId,
        requestId: "portal-browser-ime"
      }
      const result = await controller.setInputFrozen(
        true,
        window.portalCheck.context
      )
      return {
        result,
        connected: textarea.isConnected,
        value: textarea.value,
        changes: window.portalCheck.changes,
        state: controller.getState()
      }
    })
    console.log("composing", viewport, JSON.stringify(before))
    assert.equal(before.result.kind, "failure")
    assert.equal(before.result.reason, "pending-edit")
    assert.equal(before.connected, true)
    assert.equal(before.value, "x+y")
    assert.equal(before.changes, 0)
    assert.equal(before.state.inputFrozen, false)
    assert.equal(before.state.dirty.body, false)
    const after = await page.evaluate(async () => {
      const { controller, context } = window.portalCheck
      const textarea = document.querySelector(".hn-editor-mini-textarea")
      textarea.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "x+y" })
      )
      textarea.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "x+y",
          isComposing: false
        })
      )
      const result = await controller.setInputFrozen(true, context)
      const state = controller.getState()
      const changes = window.portalCheck.changes
      const release = await controller.setInputFrozen(false, {
        ...context,
        leaseId: result.leaseId
      })
      return {
        result,
        connected: textarea.isConnected,
        changes,
        state,
        release
      }
    })
    console.log("retry", JSON.stringify(after))
    assert.equal(after.result.kind, "applied")
    assert.equal(after.result.action, "acquired")
    assert.equal(after.connected, false)
    assert.equal(after.changes, 1)
    assert.equal(after.state.inputFrozen, true)
    assert.equal(after.release.action, "released")
    await page
      .locator('[data-view-id="b"]')
      .getByLabel("撤销", { exact: true })
      .click()
    assert.equal(
      await page.evaluate(
        () => window.portalCheck.controller.getState().dirty.body
      ),
      false
    )
    assert.equal(await page.evaluate(() => window.portalCheck.changes), 2)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    "PASS: simulated portal composition rejects acquire without commit/removal/lease; same request retries after compositionend; peer undo restores baseline"
  )
  console.log("NOT RUN: physical IME, WebBase bridge, remote storage")
} finally {
  await browser.close()
  await server.close()
}
