// Reconstruct possible DOMs hidden by the HAM-213 v1 recorder. Synthetic only:
// no claim that any variant is the DOM produced by a physical input method.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { webkit } from 'playwright'
import { createServer } from 'vite'

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const consumer = option('consumer')
const initial = option('initial') ?? '你好'
const skipSyntheticKeymap = process.argv.includes('--skip-synthetic-keymap')
const output = path.resolve(option('output') ?? 'evidence/ham172/delete-replay-source.json')
const entry = consumer ? '@hamster-note/notes' : '/src/lib/index.ts'
const server = await createServer({
  configFile: false, root: path.resolve(consumer ?? '.'), optimizeDeps: { entries: [] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'delete-composition-probe', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== '/delete-probe.html') return next()
      res.setHeader('Content-Type', 'text/html')
      const html = `<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div>
        <script type="module">
        import React from 'react'; import { createRoot } from 'react-dom/client';
        import { NoteDocumentProvider, NoteEditorView } from '${entry}';
        import '${consumer ? '@hamster-note/notes/styles.css' : '/src/lib/styles.css'}';
        window.probe = { changes: [], controller: null };
        createRoot(document.getElementById('root')).render(React.createElement(NoteDocumentProvider, {
          documentId: 'delete-probe', loadKey: 1,
          initialHostSnapshot: { changeId: 0, value: { title: '', summary: '' } },
          initialDocument: { schemaVersion: 1, data: { type: 'doc', content: [
            { type: 'paragraph', attrs: { nodeId: '123e4567-e89b-42d3-a456-426614174000' },
              ${initial ? `content: [{ type: 'text', text: ${JSON.stringify(initial)} }]` : ''} }
          ] } },
          controllerRef: controller => { window.probe.controller = controller },
          onChange: doc => { window.probe.changes.push(doc) }
        }, React.createElement(NoteEditorView, { viewId: 'primary' })));
        </script>`
      void server.transformIndexHtml(req.url, html).then(html => res.end(html), next)
    })
  } }]
})
const variants = [
  ['empty-root', ''], ['root-br', '<br>'], ['one-div', '<div><br></div>'],
  ['two-divs', '<div><br></div><div><br></div>'],
  ['div-br', '<div><br></div><br>'], ['br-div', '<br><div><br></div>'],
  ['two-paragraphs', '<p><br></p><p><br></p>'],
  ['retained-text-div', '<div>你好</div><div><br></div>'],
  ['retained-text-br', '你好<br>'], ['empty-paragraph', '<p><br></p>']
]
let browser
const results = []
try {
  await server.listen()
  browser = await webkit.launch()
  for (const [name, html] of variants) {
    const page = await browser.newPage({ isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('pageerror', e => console.error(e.message))
    page.on('requestfailed', r => console.error(r.url(), r.failure()))
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'vendor', { get: () => 'Apple Computer' })
      Object.defineProperty(navigator, 'platform', { get: () => 'iPhone' })
    })
    await page.goto(`${server.resolvedUrls.local[0]}delete-probe.html`)
    const body = page.getByRole('textbox', { name: '笔记内容编辑区 primary', exact: true })
    await body.locator('p').tap({ timeout: 60000 })
    await page.addScriptTag({ path: path.resolve('scripts/capture-hnn-ime-events.js') })
    const result = await body.evaluate(async (root, { name, html, skipSyntheticKeymap }) => {
      const view = root.editor.view
      const traces = []
      const paragraphs = () => [...root.querySelectorAll(':scope > p')].map(p => p.textContent)
      const state = () => ({ html: root.innerHTML, paragraphs: paragraphs(), doc: view.state.doc.toJSON(),
        selection: view.state.selection.toJSON(), composing: view.composing })
      const dispatch = view.dispatch.bind(view)
      view.dispatch = tr => {
        const trace = { type: 'transaction', before: state(), steps: tr.steps.map(s => s.toJSON()),
          meta: { ...tr.meta }, stack: new Error().stack }
        traces.push(trace)
        dispatch(tr)
        trace.after = state()
      }
      const someProp = view.someProp.bind(view)
      view.someProp = (prop, callback) => prop === 'handleKeyDown' && skipSyntheticKeymap ? undefined
        : prop !== 'handleKeyDown' || !callback ? someProp(prop, callback)
        : someProp(prop, handler => callback((...args) => {
          const trace = { type: 'key-handler', key: args[1].key, trusted: args[1].isTrusted,
            stack: new Error().stack, before: state() }
          trace.handled = handler(...args)
          trace.after = state()
          if (trace.handled) traces.push(trace)
          return trace.handled
        }))
      const pause = () => new Promise(resolve => setTimeout(resolve, 100))
      const emit = (type, inputType) => root.dispatchEvent(new InputEvent(type, {
        bubbles: true, cancelable: type === 'beforeinput', inputType, isComposing: true
      }))
      const paragraph = root.querySelector('p')
      getSelection().setPosition(paragraph.firstChild?.nodeType === Node.TEXT_NODE ? paragraph.firstChild : paragraph,
        paragraph.textContent.length)
      root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
      await pause()
      const before = state()
      emit('beforeinput', 'deleteCompositionText')
      root.innerHTML = html
      getSelection().setPosition(root, Math.min(1, root.childNodes.length))
      emit('input', 'deleteCompositionText')
      const immediate = state()
      await pause()
      const settled = state()
      // Do not fake a commit: this probe isolates the delete/normalization gap.
      const recording = window.ham172Ime.stop()
      view.someProp = someProp
      view.dispatch = dispatch
      view.dispatch(view.state.tr.insertText('after-stop'))
      await pause()
      const afterStop = window.ham172Ime.read()
      const stoppedAgain = window.ham172Ime.stop()
      if (JSON.stringify(afterStop) !== JSON.stringify(recording) || JSON.stringify(stoppedAgain) !== JSON.stringify(recording)) {
        throw new Error('Recorder changed after stop')
      }
      return { name, suppliedDOM: html, before, immediate, settled, traces, recording }
    }, { name, html, skipSyntheticKeymap })
    assert.deepEqual(errors, [])
    assert.equal(result.recording.schemaVersion, 2)
    assert(result.recording.transactionObservation.some(view => view.available))
    assert(result.recording.events.some(e => e.type === 'transaction'))
    assert(result.recording.events.some(e => e.type === 'mutation' && e.mutations.some(m => m.removed.length)))
    assert(result.recording.events.some(e => e.type === 'after-event'))
    assert(result.recording.events.filter(e => e.type === 'beforeinput').every(e =>
      e.defaultPrevented === false && Array.isArray(e.targetRanges)))
    assert(result.recording.events.every(e => e.html && !e.html.truncated))
    assert.deepEqual(result.immediate.paragraphs, name === 'two-paragraphs' ? ['', '']
      : name === 'empty-paragraph' ? [''] : [])
    if (name === 'one-div' || name === 'root-br' || name === 'empty-paragraph') {
      assert.deepEqual(result.settled.paragraphs, skipSyntheticKeymap ? [''] : [initial, ''])
    }
    results.push(result)
    console.log(JSON.stringify({ name, paragraphs: result.settled.paragraphs,
      handledKeys: result.traces.filter(t => t.type === 'key-handler' && t.handled).map(t => t.key),
      steps: result.traces.filter(t => t.type === 'transaction').map(t => t.steps) }))
    await page.close()
  }
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify({ browser: browser.version(), consumer: consumer ?? 'source', initial, skipSyntheticKeymap,
    driver: 'Synthetic DOM reconstruction, not physical IME evidence', results }, null, 2))
} finally { await browser?.close(); await server.close() }
