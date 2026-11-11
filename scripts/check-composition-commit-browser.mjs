// Replay the DOM/event sequence from the user's 75-event iPhone trace.
// Synthetic reconstruction, NOT a physical-device acceptance test.
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { webkit } from 'playwright'
import { createServer } from 'vite'

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const consumer = option('consumer')
const expectedSplit = process.argv.includes('--expect-split')
const output = path.resolve(option('output') ?? 'evidence/ham172/commit-replay-fixed.json')
const entry = option('entry') ?? (consumer ? '@hamster-note/notes' : '/src/lib/index.ts')
const server = await createServer({ configFile: false, root: path.resolve(consumer ?? '.'),
  cacheDir: path.resolve('node_modules/.cache/ham172-commit-replay', consumer ? 'consumer' : 'source'),
  optimizeDeps: { entries: [] }, server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'composition-commit', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== '/commit.html') return next()
      res.setHeader('Content-Type', 'text/html')
      void server.transformIndexHtml(req.url, `<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div>
        <script type="module">
        import React from 'react'; import { createRoot } from 'react-dom/client';
        import { NoteDocumentProvider, NoteEditorView } from '${entry}';
        import '${consumer ? '@hamster-note/notes/styles.css' : '/src/lib/styles.css'}';
        window.probe = { controller: null, saves: [] };
        createRoot(document.getElementById('root')).render(React.createElement(NoteDocumentProvider, {
          documentId: 'commit-probe', loadKey: 1,
          initialDocument: { schemaVersion: 1, data: { type: 'doc', content: [
            { type: 'paragraph', attrs: { nodeId: '123e4567-e89b-42d3-a456-426614174000' } }
          ] } },
          initialHostSnapshot: { changeId: 0, value: { title: '', summary: '' } },
          controllerRef: controller => { window.probe.controller = controller },
          onSave: async payload => { window.probe.saves.push(payload.document) }
        }, React.createElement(NoteEditorView, { viewId: 'primary' }), React.createElement(NoteEditorView, { viewId: 'peer' })));
        </script>`).then(html => res.end(html), next)
    })
  } }] })
let browser
const results = []
try {
  await server.listen()
  browser = await webkit.launch()
  for (const mode of ['empty-end-insertText', 'empty-end-before-flush', 'insertFromComposition', 'simulator-selected-candidate', 'converted-collapsed', 'raw-pinyin']) {
    const page = await browser.newPage({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1' })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('pageerror', e => console.error(e.message))
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'vendor', { get: () => 'Apple Computer, Inc.' })
      Object.defineProperty(navigator, 'platform', { get: () => 'iPhone' })
    })
    await page.goto(`${server.resolvedUrls.local[0]}commit.html`)
    const body = page.getByRole('textbox', { name: '笔记内容编辑区 primary', exact: true })
    await body.locator('p').tap({ timeout: 60000 }).catch(async error => {
      console.error((await page.locator('body').innerText()).slice(0, 2000))
      throw error
    })
    await page.addScriptTag({ path: path.resolve('scripts/capture-hnn-ime-events.js') })
    const result = await body.evaluate(async (root, mode) => {
      const pause = () => new Promise(resolve => setTimeout(resolve, 60))
      const paragraphs = () => [...root.querySelectorAll(':scope > p')].map(p => p.textContent)
      const event = (type, inputType, data, isComposing, target) => {
        const e = new InputEvent(type, { bubbles: true, cancelable: type === 'beforeinput', inputType, data, isComposing })
        if (target) Object.defineProperty(e, 'getTargetRanges', { value: () => [target] })
        root.dispatchEvent(e)
        if (e.defaultPrevented) throw new Error('Input was cancelled')
      }
      const p = root.querySelector('p')
      getSelection().setPosition(p, 0)
      root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
      const preedit = mode === 'simulator-selected-candidate' || mode === 'converted-collapsed' ? '你好' : 'ni\u2006hao'
      root.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: preedit }))
      event('beforeinput', 'insertCompositionText', preedit, true)
      const text = document.createTextNode(preedit)
      p.replaceChildren(text)
      const selected = document.createRange()
      selected.setStart(text, 0); selected.setEnd(text, preedit.length)
      getSelection().removeAllRanges(); getSelection().addRange(selected)
      event('input', 'insertCompositionText', preedit, true)
      await pause()
      // Device event #51 has a collapsed MODEL selection at 7 while the native
      // preedit range still spans 1..7. This state matters: a selected model
      // range would let Enter delete the preedit and only leave two EMPTY Ps.
      root.editor.commands.setTextSelection(mode === 'simulator-selected-candidate' ? { from: 1, to: preedit.length + 1 } : preedit.length + 1)
      const nativeSelected = document.createRange()
      nativeSelected.setStart(text, 0); nativeSelected.setEnd(text, preedit.length)
      getSelection().removeAllRanges(); getSelection().addRange(nativeSelected)
      const before = { paragraphs: paragraphs(), model: root.editor.state.doc.toJSON(), selection: root.editor.state.selection.toJSON() }
      if (root.editor.state.doc.textContent !== preedit) throw new Error(`Preedit did not reach model: ${JSON.stringify(before)}`)
      const target = new StaticRange({ startContainer: text, startOffset: 0, endContainer: text, endOffset: preedit.length })
      event('beforeinput', 'deleteCompositionText', null, true, target)
      const br = document.createElement('br')
      p.replaceWith(br) // Real trace keeps the PM widget and replaces only P.
      getSelection().setPosition(root, [...root.childNodes].indexOf(br))
      event('input', 'deleteCompositionText', null, true)
      const plain = mode.startsWith('empty-end') || mode === 'converted-collapsed'
      if (mode === 'empty-end-before-flush') root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
      await pause()
      const afterDelete = { paragraphs: paragraphs(), model: root.editor.state.doc.toJSON() }
      const value = mode === 'raw-pinyin' ? 'nihao' : '你好'
      if (plain) {
        if (mode !== 'empty-end-before-flush') root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
        root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value, keyCode: 229, isComposing: false }))
      }
      const inputType = plain ? 'insertText' : 'insertFromComposition'
      const caret = getSelection().getRangeAt(0)
      event('beforeinput', inputType, value, !plain, caret)
      const paragraph = (caret.startContainer.nodeType === Node.ELEMENT_NODE ? caret.startContainer : caret.startContainer.parentElement).closest('p')
      if (!paragraph) throw new Error('Commit caret left paragraph')
      paragraph.querySelector('br')?.remove()
      const committed = document.createTextNode(value)
      paragraph.append(committed)
      getSelection().setPosition(committed, value.length)
      event('input', inputType, value, !plain)
      if (!plain) root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }))
      await pause()
      const after = { paragraphs: paragraphs(), model: root.editor.state.doc.toJSON() }
      const controller = window.probe.controller
      const save = controller.requestSave({ reason: 'editor-button', expectedSessionId: controller.getState().identity.sessionId })
      if (save.kind === 'pending') await save.completion
      return { mode, before, afterDelete, after, saved: window.probe.saves.at(-1), recording: window.ham172Ime.stop() }
    }, mode)
    const value = mode === 'raw-pinyin' ? 'nihao' : '你好'
    const retained = mode === 'simulator-selected-candidate' ? '' : mode === 'converted-collapsed' ? '你好' : 'ni\u2006hao'
    const expected = expectedSplit ? [retained, value] : [value]
    assert.deepEqual(result.afterDelete.paragraphs, expectedSplit ? [retained, ''] : [''])
    assert.deepEqual(result.after.paragraphs, expected)
    assert.deepEqual(await page.getByRole('textbox', { name: '笔记内容编辑区 peer', exact: true }).locator('p').allTextContents(), expected)
    assert.deepEqual(result.saved.data.content.map(p => p.content?.map(t => t.text).join('') ?? ''), expected)
    await mkdir(path.dirname(output), { recursive: true })
    await page.screenshot({ path: output.replace(/\.json$/, `-${mode}.png`), fullPage: true })
    if (!expectedSplit) {
      assert.equal(await body.evaluate(root => root.editor.commands.undo()), true)
      assert.deepEqual(await body.locator('p').allTextContents(), [''])
      assert.equal(await body.evaluate(root => root.editor.commands.redo()), true)
      assert.deepEqual(await body.locator('p').allTextContents(), [value])
    }
    // A genuine newline still works immediately after confirmation (no timer).
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
    assert.deepEqual(await body.locator('p').allTextContents(), [...expected, ''])
    assert.deepEqual(errors, [])
    results.push(result)
    console.log(`${mode}: ${JSON.stringify(expected)}; shared view, save and Enter pass; history=${expectedSplit ? "not checked on baseline" : "pass"}`)
    await page.close()
  }
  await writeFile(output, JSON.stringify({ browser: browser.version(), consumer: consumer ?? 'source',
    driver: 'Synthetic replay of device DOM/events, not a physical IME acceptance', results }, null, 2))
} finally { await browser?.close(); await server.close() }
