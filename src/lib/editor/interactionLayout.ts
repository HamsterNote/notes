/** Internal layout policy. Keep this query aligned with styles.css. */
export const MOBILE_EDITOR_QUERY = "(max-width: 840px)"
export function editorLayout() {
  const media = window.matchMedia?.(MOBILE_EDITOR_QUERY)
  return {
    isMobile: () => media?.matches ?? window.innerWidth <= 840,
    subscribe(listener: () => void) {
      if (media) media.addEventListener("change", listener)
      else window.addEventListener("resize", listener)
      return () => {
        media?.removeEventListener("change", listener)
        window.removeEventListener("resize", listener)
      }
    }
  }
}
