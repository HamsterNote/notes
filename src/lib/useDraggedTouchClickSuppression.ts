import { type RefObject, useCallback, useEffect, useRef } from "react"

/**
 * 拖动结束后，浏览器可能补发一次 click。
 * 只拦截这一次兼容事件，避免误触发拖动源或正文空白区域的操作。
 */
export const useDraggedClickSuppression = (
  rootRef: RefObject<HTMLElement | null>
): (() => void) => {
  const suppressClickRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const suppressDraggedTouchClick = (event: MouseEvent): void => {
      if (!suppressClickRef.current) return
      if (!rootRef.current?.contains(event.target as Node)) {
        suppressClickRef.current = false
        return
      }
      suppressClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener("click", suppressDraggedTouchClick, true)
    return () => {
      document.removeEventListener("click", suppressDraggedTouchClick, true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [rootRef])

  return useCallback(() => {
    suppressClickRef.current = true
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false
      timerRef.current = null
    }, 0)
  }, [])
}
