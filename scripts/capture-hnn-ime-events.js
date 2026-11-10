// Paste into the HNN editor frame's browser console. Use an empty test note.
// Observes events/DOM only; does not cancel input, change selection or send data.
(() => {
  window.ham172Ime?.stop()
  const events = []
  const observers = new Map()
  const transactionListeners = new Map()
  const types = ["compositionstart", "compositionupdate", "compositionend", "keydown", "keyup",
    "beforeinput", "input", "focusin", "focusout", "pointerdown", "pointerup", "pointercancel"]
  let running = true
  let truncated = false
  let sequence = 0
  let stoppedSnapshot = null
  const clip = (value, limit = 16384) => {
    const string = String(value ?? "")
    return { value: string.slice(0, limit), truncated: string.length > limit }
  }
  const html = node => clip(node?.nodeType === Node.ELEMENT_NODE ? node.outerHTML : node?.textContent, 4096)
  const nodePath = (root, node) => {
    if (!node) return null
    if (node === root) return []
    if (!root.contains(node)) return null
    const path = []
    for (let current = node; current !== root; current = current.parentNode) {
      path.unshift(Array.prototype.indexOf.call(current.parentNode.childNodes, current))
    }
    return path
  }
  const point = (root, node, offset) => ({ node: node?.nodeName ?? null, path: nodePath(root, node), offset })
  const range = (root, value) => ({ start: point(root, value.startContainer, value.startOffset),
    end: point(root, value.endContainer, value.endOffset) })
  const rootFor = node => (node instanceof Element ? node : node?.parentElement)?.closest(".hn-editor-content")
  const text = root => [...root.querySelectorAll(":scope > p, :scope > h1, :scope > h2, :scope > h3")]
    .slice(0, 10).map(node => node.textContent.slice(0, 1024))
  const snapshot = root => {
    const selection = getSelection()
    const anchor = selection?.anchorNode
    return { view: root.closest("[data-view-id]")?.getAttribute("data-view-id") ?? null,
      paragraphs: text(root), html: clip(root.innerHTML), focused: root.contains(document.activeElement),
      selection: { node: anchor?.nodeName, offset: selection?.anchorOffset,
        inside: !!anchor && root.contains(anchor), collapsed: selection?.isCollapsed,
        anchor: point(root, anchor, selection?.anchorOffset),
        focus: point(root, selection?.focusNode, selection?.focusOffset),
        ranges: selection ? Array.from({ length: selection.rangeCount }, (_, i) => range(root, selection.getRangeAt(i))) : [] },
      model: root.editor?.state ? clip(JSON.stringify(root.editor.state.doc.toJSON())) : null }
  }
  const push = entry => {
    if (!running) return
    if (events.length >= 1000) { truncated = true; return }
    events.push(Object.assign(entry, { id: ++sequence, at: performance.now() }))
  }
  const watch = root => {
    if (observers.has(root)) return
    const observer = new MutationObserver(records => push({ type: "mutation", ...snapshot(root),
      mutationsTruncated: records.length > 64,
      mutations: records.slice(0, 64).map(record => ({ type: record.type, node: record.target.nodeName,
        path: nodePath(root, record.target), oldValue: record.oldValue === null ? null : clip(record.oldValue),
        target: html(record.target),
        added: [...record.addedNodes].slice(0, 32).map(html),
        removed: [...record.removedNodes].slice(0, 32).map(html),
        addedTruncated: record.addedNodes.length > 32, removedTruncated: record.removedNodes.length > 32 })) }))
    observer.observe(root, { subtree: true, childList: true, characterData: true, characterDataOldValue: true })
    observers.set(root, observer)
    // Subscribe to Tiptap's existing notification, without wrapping dispatch or
    // changing plugins, state, DOM or selection. Some hosts may not expose it.
    const editor = root.editor
    if (editor?.on && editor?.off) {
      const onTransaction = ({ transaction, appendedTransactions = [] }) => push({ type: "transaction",
        ...snapshot(root), transactions: [transaction, ...appendedTransactions].map(tr => ({
          steps: clip(JSON.stringify(tr.steps.map(step => step.toJSON()))),
          selection: tr.selection.toJSON(), docChanged: tr.docChanged,
          composition: tr.getMeta("composition") ?? null, uiEvent: tr.getMeta("uiEvent") ?? null,
          addToHistory: tr.getMeta("addToHistory") ?? null,
          before: clip(JSON.stringify(tr.before.toJSON())), after: clip(JSON.stringify(tr.doc.toJSON()))
        })), stack: clip(new Error("transaction observer").stack, 8192) })
      editor.on("transaction", onTransaction)
      transactionListeners.set(root, { editor, onTransaction })
    }
  }
  const onEvent = event => {
    const root = rootFor(event.target)
    if (!root) return
    watch(root)
    const entry = { type: event.type, trusted: event.isTrusted, key: event.key, keyCode: event.keyCode,
      data: event.data, inputType: event.inputType, isComposing: event.isComposing,
      pointerType: event.pointerType, ...snapshot(root) }
    if (typeof event.getTargetRanges === "function") {
      entry.targetRanges = [...event.getTargetRanges()].map(value => range(root, value))
    }
    push(entry)
    queueMicrotask(() => {
      entry.defaultPrevented = event.defaultPrevented
      if (running && /^(beforeinput|input|compositionend)$/.test(event.type)) {
        push({ type: "after-event", eventId: entry.id, phase: "microtask", ...snapshot(root) })
      }
    })
  }
  const onSelection = () => {
    const root = rootFor(getSelection()?.anchorNode)
    if (root) push({ type: "selectionchange", ...snapshot(root) })
  }
  for (const type of types) document.addEventListener(type, onEvent, { capture: true, passive: true })
  document.addEventListener("selectionchange", onSelection, { passive: true })
  document.querySelectorAll(".hn-editor-content").forEach(watch)
  const read = () => stoppedSnapshot ? structuredClone(stoppedSnapshot) : ({ schemaVersion: 2, userAgent: navigator.userAgent, vendor: navigator.vendor,
    platform: navigator.platform, timeOrigin: performance.timeOrigin, truncated,
    transactionObservation: [...observers.keys()].map(root => ({
      view: root.closest("[data-view-id]")?.getAttribute("data-view-id") ?? null,
      available: transactionListeners.has(root) })),
    note: "Event data, complete test-note DOM and model text are included (per-field limits report truncation). No network request is made. Mutation nodes are serialized at observer delivery, not at the native mutation instant.",
    events: structuredClone(events) })
  const stop = () => {
    if (!running) return read()
    running = false
    for (const type of types) document.removeEventListener(type, onEvent, true)
    document.removeEventListener("selectionchange", onSelection)
    for (const observer of observers.values()) observer.disconnect()
    for (const { editor, onTransaction } of transactionListeners.values()) editor.off("transaction", onTransaction)
    stoppedSnapshot = read()
    observers.clear()
    transactionListeners.clear()
    return read()
  }
  window.ham172Ime = { read, stop, download() {
    const result = stop()
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "ham172-ime-events.json"
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return result
  } }
  return "Recording HNN input. Finish the test, then call ham172Ime.download() or ham172Ime.stop()."
})()
