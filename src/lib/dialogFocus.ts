const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])'
].join(",")

export const trapDialogFocus = (
  dialog: HTMLElement | null,
  event: KeyboardEvent
): void => {
  if (event.key !== "Tab" || dialog === null) return
  const focusableElements = Array.from(
    dialog.querySelectorAll<HTMLElement>(focusableSelector)
  ).filter((element) => element.getAttribute("aria-hidden") !== "true")
  const firstElement = focusableElements[0]
  const lastElement = focusableElements.at(-1)
  if (firstElement === undefined || lastElement === undefined) return

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault()
    lastElement.focus()
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault()
    firstElement.focus()
  }
}
