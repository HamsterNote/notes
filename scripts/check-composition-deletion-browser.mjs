// Controlled reconstruction of HAM-172's second device trace and HAM-224.
// This verifies DOM/event orderings, not a physical keyboard or IME.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const baseline = process.argv.includes('--baseline')
const engine = option('browser') ?? 'chromium'
const output = path.resolve(option('output') ?? `evidence/ham172/deletion-${baseline ? 'before' : 'after'}-${engine}.json`)
const server = await createServer({ configFile: false,
  cacheDir: path.resolve('node_modules/.cache/ham172-deletion', path.basename(process.cwd()), engine),
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { entries: [] }, plugins: [{ name: 'deletion-replay', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== '/deletion.html') return next()
      res.setHeader('Content-Type', 'text/html')
      void server.transformIndexHtml(req.url, `<!doctype html><div id="editor"></div><script type="module">
        import { Editor } from '@tiptap/core';
        import { createHnnEditorExtensions } from '/src/lib/hnn/extensions.ts';
        import { encodeHnn, decodeHnn } from '/src/lib/hnn/codec.ts';
        window.replay = { Editor, createHnnEditorExtensions, encodeHnn, decodeHnn };
      </script>`).then(html => res.end(html), next)
    })
  } }] })
let browser
const results = []
try {
  await server.listen()
  browser = await ({ chromium, webkit }[engine]).launch()
  for (const heading of [false, true]) for (const timing of [
    'observer-before-input', 'end-before-delete', 'end-between-delete-input',
    'same-task-text', 'same-task-paragraph', 'same-task-execCommand', 'no-commit',
  ]) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', e => { errors.push(e.message); console.error(e.message) })
    await page.goto(`${server.resolvedUrls.local[0]}deletion.html`)
    await page.waitForFunction(() => window.replay)
    const result = await page.evaluate(async ({ heading, timing }) => {
      const { Editor, createHnnEditorExtensions, encodeHnn, decodeHnn } = window.replay
      const id = '123e4567-e89b-42d3-a456-426614174000'
      const editor = new Editor({ element: document.querySelector('#editor'), extensions: createHnnEditorExtensions(),
        content: { type: 'doc', content: [{ type: heading ? 'heading' : 'paragraph', attrs: { nodeId: id, ...(heading ? { level: 2 } : {}) } }] } })
      window.replay.editor = editor
      const root = editor.view.dom
      const transactions = []
      editor.on('transaction', ({ transaction }) => {
        if (transaction.docChanged) transactions.push(transaction.steps.map(step => step.toJSON()))
      })
      const snapshot = () => editor.state.doc.toJSON()
      const pause = () => new Promise(resolve => setTimeout(resolve, 60))
      const events = []
      const input = (type, inputType, data, target) => {
        const e = new InputEvent(type, { bubbles: true, cancelable: type === 'beforeinput', data, isComposing: true })
        // Chromium does not implement deleteCompositionText. Specify the
        // exact contract rather than silently testing inputType="".
        Object.defineProperty(e, 'inputType', { value: inputType })
        if (target) Object.defineProperty(e, 'getTargetRanges', { value: () => [target] })
        root.dispatchEvent(e)
        events.push({ type, inputType, prevented: e.defaultPrevented })
      }
      const end = () => root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }))
      editor.view.focus()
      root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
      const block = root.querySelector('p,h2')
      input('beforeinput', 'insertCompositionText', '你好')
      const preedit = document.createTextNode('你好')
      block.replaceChildren(preedit)
      getSelection().setPosition(preedit, 2)
      input('input', 'insertCompositionText', '你好')
      await pause()
      editor.commands.setTextSelection(3)
      const before = snapshot()
      if (timing === 'end-before-delete') end()
      const range = new StaticRange({ startContainer: preedit, startOffset: 0, endContainer: preedit, endOffset: 2 })
      input('beforeinput', 'deleteCompositionText', null, range)
      if (timing === 'end-between-delete-input') end()
      const br = document.createElement('br')
      block.replaceWith(br)
      // Neither recognition nor parsing may depend on the root caret anchor.
      getSelection().setPosition(br, 0)
      if (timing === 'observer-before-input') await pause()
      const beforeInput = snapshot()
      input('input', 'deleteCompositionText', null)
      if (!timing.startsWith('same-task')) await pause()
      const afterDelete = snapshot()
      if (timing !== 'no-commit') {
        if (timing.startsWith('same-task')) end()
        input('beforeinput', 'insertFromComposition', '你好')
        if (br.isConnected) {
          if (timing === 'same-task-execCommand') {
            getSelection().setPosition(root, [...root.childNodes].indexOf(br))
            document.execCommand('insertText', false, '你好')
          } else {
            const committed = document.createTextNode('你好')
            if (timing === 'same-task-paragraph') {
              const p = document.createElement('p'); p.append(committed); br.replaceWith(p)
            } else br.replaceWith(committed)
            getSelection().setPosition(committed, 2)
          }
        } else {
          const p = root.querySelector('p:last-child,h2:last-child')
          p.replaceChildren(document.createTextNode('你好'))
          getSelection().setPosition(p.firstChild, 2)
        }
        input('input', 'insertFromComposition', '你好')
      }
      end()
      await pause()
      const after = snapshot()
      const roundtrip = decodeHnn(encodeHnn(editor.state.doc)).toJSON()
      const selection = editor.state.selection.toJSON()
      const undo = editor.commands.undo(); const undone = snapshot()
      const redo = editor.commands.redo(); const redone = snapshot()
      return { heading, timing, id, before, beforeInput, afterDelete, after, roundtrip, selection, undo, undone, redo, redone, events, transactions }
    }, { heading, timing })
    // Use a real key, including the browser default action. A synthetic
    // keydown alone cannot test WebKit's native Enter near compositionend.
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
    result.afterEnter = await page.evaluate(() => {
      const editor = window.replay.editor, doc = editor.state.doc.toJSON()
      editor.destroy()
      return doc
    })
    const block = result.after.content[0]
    const correct = result.after.content.length === 1 && block.type === (heading ? 'heading' : 'paragraph')
      && block.attrs.nodeId === result.id && (!heading || block.attrs.level === 2)
      && (block.content?.map(n => n.text).join('') ?? '') === (timing === 'no-commit' ? '' : '你好')
    results.push({ ...result, correct, errors })
    console.log(`${heading ? 'H2' : 'P'} ${timing}: ${correct ? 'PASS' : 'FAIL'} ${JSON.stringify(result.after)}`)
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, JSON.stringify({ engine, version: browser.version(), baseline, synthetic: true, results }, null, 2))
    if (!baseline) {
      assert.equal(correct, true)
      assert.deepEqual(result.roundtrip, result.after)
      assert.deepEqual(result.redone, result.after)
      assert.equal(result.undo, true); assert.equal(result.redo, true)
      assert.equal(result.undone.content.length, 1)
      assert.equal(result.undone.content[0].attrs.nodeId, result.id)
      assert.equal(result.afterEnter.content.length, 2)
      assert.equal(result.events.some(e => e.prevented), false)
      assert.deepEqual(errors, [])
    }
    await page.close()
  }
} finally { await browser?.close(); await server.close() }
