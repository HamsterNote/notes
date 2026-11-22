import { Extension } from "@tiptap/core"
import { isHistoryTransaction } from "@tiptap/pm/history"
import type { Mark, Node } from "@tiptap/pm/model"
import { Plugin, type Transaction } from "@tiptap/pm/state"
import { AddMarkStep, RemoveMarkStep, type Step } from "@tiptap/pm/transform"

export const HNN_LINK_BLOCK_TRANSACTION = "hnnLinkBlockTransaction"

type LinkRange = { from: number; to: number; link: Mark }

export function markLinkBlockTransaction(transaction: Transaction): Transaction {
  return transaction.setMeta(HNN_LINK_BLOCK_TRANSACTION, true)
}

function linkRanges(doc: Node): LinkRange[] {
  const ranges: LinkRange[] = []
  let current: LinkRange | null = null
  doc.descendants((node, pos) => {
    if (!node.isText) {
      current = null
      return true
    }
    const link = node.marks.find(mark => mark.type.name === "link")
    if (!link) {
      current = null
      return true
    }
    if (current?.link.eq(link) && current.to === pos) current.to = pos + node.nodeSize
    else {
      current = { from: pos, to: pos + node.nodeSize, link }
      ranges.push(current)
    }
    return true
  })
  return ranges
}

function touchesLink(step: Step, doc: Node): boolean {
  const ranges = linkRanges(doc)
  if (!ranges.length) return false
  if (step instanceof AddMarkStep || step instanceof RemoveMarkStep)
    return ranges.some(range => step.from < range.to && step.to > range.from)
  let touched = false
  step.getMap().forEach((oldStart, oldEnd) => {
    if (ranges.some(range =>
      oldStart < range.to && oldEnd > range.from ||
      oldStart === oldEnd && oldStart > range.from && oldStart < range.to
    )) touched = true
  })
  return touched
}

function touchesLinkAcrossSteps(transaction: Transaction): boolean {
  let current = transaction.before
  for (const step of transaction.steps) {
    if (touchesLink(step, current)) return true
    const applied = step.apply(current)
    if (applied.failed) return true
    current = applied.doc!
  }
  return false
}

export const HnnLinkBlockProtection = Extension.create({
  name: "hnnLinkBlockProtection",
  addProseMirrorPlugins() {
    return [new Plugin({
      filterTransaction(transaction) {
        return !transaction.docChanged ||
          isHistoryTransaction(transaction) ||
          transaction.getMeta(HNN_LINK_BLOCK_TRANSACTION) === true ||
          !touchesLinkAcrossSteps(transaction)
      }
    })]
  }
})
