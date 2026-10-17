import { createRequire } from "node:module"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://consumer.test/" })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "DOMParser", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true })
}
const api = process.argv[2] === "cjs"
  ? createRequire(import.meta.url)("@hamster-note/notes")
  : await import("@hamster-note/notes")
console.log(JSON.stringify(Object.keys(api).sort()))
dom.window.close()
