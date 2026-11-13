import type { Editor } from "@tiptap/core"
import { hasUnsafeHnnUrlCharacters, isManagedHnnPicturePath, isSafeHnnPictureUrl, isSafeHnnUrl } from "../hnn/urlPolicy"
import type { PictureResolveHandler, PictureResolveResult } from "./types"

const PICTURE_RESOLVER_CHANGE_EVENT = "pictureResolverChange"
const resolverEvents = new WeakMap<Editor, EventTarget>()

function resolverEventTarget(editor: Editor): EventTarget {
  let target = resolverEvents.get(editor)
  if (!target) {
    target = new EventTarget()
    resolverEvents.set(editor, target)
  }
  return target
}

export function notifyPictureResolverChange(editor: Editor): void {
  resolverEventTarget(editor).dispatchEvent(new Event(PICTURE_RESOLVER_CHANGE_EVENT))
}

export function isSafeRuntimePictureUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || hasUnsafeHnnUrlCharacters(value)) return false
  if (/^https?:/.test(value)) return isSafeHnnUrl(value)
  if (!value.startsWith("blob:") || value.length === "blob:".length) return false
  try {
    return new URL(value).protocol === "blob:"
  } catch {
    return false
  }
}

interface PictureResolutionOptions {
  readonly editor: Editor
  readonly image: HTMLImageElement
  readonly placeholder: HTMLElement
  readonly message: HTMLElement
  readonly retryButton: HTMLButtonElement
  readonly documentId: string
  readonly loadKey: string | number
  readonly getResolver: () => PictureResolveHandler | undefined
}

export interface PictureResolution {
  update(src: string, alt: string): void
  destroy(): void
}

export function createPictureResolution(options: PictureResolutionOptions): PictureResolution {
  const { editor, image, placeholder, message, retryButton } = options
  let destroyed = false
  let src = ""
  let initialized = false
  let controller: AbortController | undefined
  let token: symbol | undefined
  let disposeResult: (() => void) | undefined

  const release = (): void => {
    controller?.abort()
    controller = undefined
    token = undefined
    const dispose = disposeResult
    disposeResult = undefined
    if (dispose) {
      try { dispose() } catch { /* Host cleanup cannot break the editor view. */ }
    }
  }

  const showPlaceholder = (text: string, retry: boolean): void => {
    image.removeAttribute("src")
    image.hidden = true
    placeholder.hidden = false
    message.textContent = text
    retryButton.hidden = !retry
  }

  const showImage = (url: string, dispose?: () => void): void => {
    disposeResult = dispose
    if (image.getAttribute("src") !== url) image.setAttribute("src", url)
    image.hidden = false
    placeholder.hidden = true
  }

  const refresh = (): void => {
    if (destroyed) return
    release()
    if (!isSafeHnnPictureUrl(src)) {
      showPlaceholder("图片不可用", false)
      return
    }
    const resolver = options.getResolver()
    if (!resolver && !isManagedHnnPicturePath(src)) {
      showImage(src)
      return
    }
    if (!resolver) {
      showPlaceholder("缺少图片解析能力", true)
      return
    }

    const currentController = new AbortController()
    const currentToken = Symbol(src)
    controller = currentController
    token = currentToken
    showPlaceholder("图片加载中…", false)
    let pending: Promise<PictureResolveResult>
    try {
      pending = resolver(src, {
        signal: currentController.signal,
        documentId: options.documentId,
        loadKey: options.loadKey
      })
    } catch {
      if (token === currentToken) showPlaceholder("图片加载失败", true)
      return
    }
    Promise.resolve(pending).then((result) => {
      const current = !destroyed && !editor.isDestroyed && token === currentToken && !currentController.signal.aborted
      if (!current) {
        try { result?.dispose?.() } catch { /* Late host cleanup is isolated. */ }
        return
      }
      if (!result || !isSafeRuntimePictureUrl(result.url)) {
        showPlaceholder("图片地址不安全或不可用", true)
        try { result?.dispose?.() } catch { /* Invalid results still release host resources. */ }
        return
      }
      showImage(result.url, result.dispose)
    }, () => {
      if (!destroyed && token === currentToken && !currentController.signal.aborted) {
        showPlaceholder("图片加载失败", true)
      }
    })
  }

  const onRetry = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
    refresh()
  }
  const onResolverChange = (): void => refresh()
  const events = resolverEventTarget(editor)
  retryButton.addEventListener("click", onRetry)
  events.addEventListener(PICTURE_RESOLVER_CHANGE_EVENT, onResolverChange)

  return {
    update(nextSrc, alt) {
      image.alt = alt
      const changed = !initialized || src !== nextSrc
      src = nextSrc
      initialized = true
      if (changed) refresh()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      retryButton.removeEventListener("click", onRetry)
      events.removeEventListener(PICTURE_RESOLVER_CHANGE_EVENT, onResolverChange)
      release()
      image.removeAttribute("src")
    }
  }
}
