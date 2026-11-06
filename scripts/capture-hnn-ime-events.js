// Paste into the HNN editor frame's browser console. Use an empty test note.
// Observes events/DOM only; does not cancel input, change selection or send data.
(() => {
  window.ham172Ime?.stop()
  const events = []
  const observers = new Map()
  const types = ["compositionstart", "compositionupdate", "compositionend", "keydown", "keyup",
    "beforeinput", "input", "focusin", "focusout", "pointerdown", "pointerup", "pointercancel"]
  let running = true
  let truncated = false
  const rootFor = node => (node instanceof Element ? node : node?.parentElement)?.closest(".hn-editor-content")
  const text = root => [...root.querySelectorAll(":scope > p, :scope > h1, :scope > h2, :scope > h3")]
    .slice(0, 10).map(node => node.textContent.slice(0, 1024))
  const snapshot = root => {
    const selection = getSelection()
    const anchor = selection?.anchorNode
    return { view: root.closest("[data-view-id]")?.getAttribute("data-view-id") ?? null,
      paragraphs: text(root), focused: root.contains(document.activeElement),
      selection: { node: anchor?.nodeName, offset: selection?.anchorOffset,
        inside: !!anchor && root.contains(anchor), collapsed: selection?.isCollapsed } }
  }
  const push = entry => {
    if (!running) return
    if (events.length >= 1000) { truncated = true; return }
    events.push(Object.assign(entry, { at: performance.now() }))
  }
  const watch = root => {
    if (observers.has(root)) return
    const observer = new MutationObserver(records => push({ type: "mutation", ...snapshot(root),
      mutations: records.map(record => ({ type: record.type, node: record.target.nodeName })) }))
    observer.observe(root, { subtree: true, childList: true, characterData: true })
    observers.set(root, observer)
  }
  const onEvent = event => {
    const root = rootFor(event.target)
    if (!root) return
    watch(root)
    const entry = { type: event.type, trusted: event.isTrusted, key: event.key, keyCode: event.keyCode,
      data: event.data, inputType: event.inputType, isComposing: event.isComposing,
      pointerType: event.pointerType, ...snapshot(root) }
    push(entry)
    queueMicrotask(() => { entry.defaultPrevented = event.defaultPrevented })
  }
  const onSelection = () => {
    const root = rootFor(getSelection()?.anchorNode)
    if (root) push({ type: "selectionchange", ...snapshot(root) })
  }
  for (const type of types) document.addEventListener(type, onEvent, { capture: true, passive: true })
  document.addEventListener("selectionchange", onSelection, { passive: true })
  document.querySelectorAll(".hn-editor-content").forEach(watch)
  const read = () => ({ schemaVersion: 1, userAgent: navigator.userAgent, vendor: navigator.vendor,
    platform: navigator.platform, timeOrigin: performance.timeOrigin, truncated,
    note: "Event data and test-note text are included. No network request is made.", events: structuredClone(events) })
  const stop = () => {
    running = false
    for (const type of types) document.removeEventListener(type, onEvent, true)
    document.removeEventListener("selectionchange", onSelection)
    for (const observer of observers.values()) observer.disconnect()
    observers.clear()
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
