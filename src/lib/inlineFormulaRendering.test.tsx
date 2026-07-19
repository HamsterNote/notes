/**
 * @vitest-environment jsdom
 *
 * Red-phase tests for read-only inline formula rendering.
 *
 * 这些测试描述的是「内联公式在只读模式下渲染」的契约，目标模块
 * `./inlineFormulaRendering` 尚未实现，因此用例应当因为导入失败而失败，
 * 而不是因为 vitest 配置 / setup 问题失败。
 *
 * 契约要点：
 *  1. `renderInlineFormulas(root)` 在给定 DOM 子树中查找所有满足
 *     `.hn-note-inline-formula[data-hn-inline-formula]` 选择器的内联公式占位
 *     span，并调用 `katex.render` 以 `displayMode: false` 渲染。
 *  2. `useInlineFormulaRendering` hook 在 `renderKey` 变化时触发重新渲染。
 *  3. `NoteContent` 在只读模式下（`editable={false}`）会通过上述机制把
 *     富文本中嵌入的内联公式 span 渲染出 KaTeX 结果。
 */
import katex from "katex"
import { type ReactNode, useLayoutEffect, useRef } from "react"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { NoteContent } from "./NoteContent"
import { renderInlineFormulas, useInlineFormulaRendering } from "./inlineFormulaRendering"

// 让 katex.render 在 jsdom 中既能被断言，也能在 DOM 留下可被查询的标记，
// 避免 KaTeX 在 jsdom 下字体 / 样式相关的非确定性输出让用例变得脆弱。
vi.mock("katex", () => {
  const render = vi.fn((tex: string, element: HTMLElement) => {
    // 给真实 KaTeX 渲染行为留下一个可辨识的占位标记，
    // 便于 integration 用例检测「公式 span 内确实写入了渲染产物」。
    element.innerHTML = `<span class="katex-mocked" data-tex="${tex}">${tex}</span>`
  })
  return { default: { render } }
})

// 取回 mock 的 spy 以便断言调用次数与参数。
const katexRender = vi.mocked(katex.render)

afterEach(() => {
  cleanup()
  katexRender.mockClear()
})

beforeEach(() => {
  katexRender.mockClear()
})

describe("renderInlineFormulas", () => {
  it("renders every inline formula span inside the given root with displayMode false", () => {
    // Given: a DOM root containing two inline formula placeholders marked with the
    //hn-note-inline-formula class and data-hn-inline-formula carrying the LaTeX source.
    const root = document.createElement("div")
    root.innerHTML = `
      <p>
        Plain text before
        <span
          class="hn-note-inline-formula"
          data-hn-inline-formula="E = mc^2"
        >E = mc^2</span>
        and another
        <span
          class="hn-note-inline-formula"
          data-hn-inline-formula="\\frac{a}{b}"
        >\\frac{a}{b}</span>
        trailing text.
      </p>
    `

    // When: the inline formula renderer scans the root once.
    renderInlineFormulas(root)

    // Then: katex.render is invoked once per formula span, with displayMode=false,
    // and the LaTeX source is read from the data attribute.
    expect(katexRender).toHaveBeenCalledTimes(2)
    const firstSpan = root.querySelector<HTMLElement>(
      ".hn-note-inline-formula[data-hn-inline-formula='E = mc^2']"
    )
    const secondSpan = root.querySelector<HTMLElement>(
      ".hn-note-inline-formula[data-hn-inline-formula='\\\\frac{a}{b}']"
    )
    expect(firstSpan).not.toBeNull()
    expect(secondSpan).not.toBeNull()

    expect(katexRender).toHaveBeenNthCalledWith(1, "E = mc^2", firstSpan, {
      displayMode: false,
      throwOnError: false
    })
    expect(katexRender).toHaveBeenNthCalledWith(2, "\\frac{a}{b}", secondSpan, {
      displayMode: false,
      throwOnError: false
    })

    // And: the mocked KaTeX output is written into the span so the placeholder
    // text is replaced by the rendered result.
    expect(firstSpan?.querySelector(".katex-mocked")).not.toBeNull()
  })

  it("ignores elements that look like formulas but miss the required attribute or class", () => {
    // Given: a root with three look-alikes — missing the data attribute, missing
    // the class, and a real formula span as control.
    const root = document.createElement("div")
    root.innerHTML = `
      <span class="hn-note-inline-formula">missing-attr</span>
      <span data-hn-inline-formula="x^2">missing-class</span>
      <span
        class="hn-note-inline-formula"
        data-hn-inline-formula="x^2"
      >x^2</span>
    `

    // When: the renderer scans the root.
    renderInlineFormulas(root)

    // Then: only the span that simultaneously carries the class and the attribute is rendered.
    expect(katexRender).toHaveBeenCalledTimes(1)
    expect(katexRender).toHaveBeenCalledWith(
      "x^2",
      expect.any(HTMLElement),
      { displayMode: false, throwOnError: false }
    )
  })

  it("does not throw and renders nothing when the root contains no formula spans", () => {
    // Given: a root with no formula placeholders.
    const root = document.createElement("div")
    root.innerHTML = `<p>just text, nothing to render</p>`

    // When/Then: calling the renderer is a no-op and never invokes katex.
    expect(() => renderInlineFormulas(root)).not.toThrow()
    expect(katexRender).not.toHaveBeenCalled()
  })
})

describe("useInlineFormulaRendering", () => {
  function Harness({
    renderKey,
    html
  }: {
    readonly renderKey: unknown
    readonly html: string
  }): ReactNode {
    const ref = useRef<HTMLDivElement>(null)
    // 注入顺序：useLayoutEffect 按注册顺序执行。这个注入 effect 在
    // useInlineFormulaRendering 之前注册，因此 DOM 内容会在 hook 的扫描
    // effect 运行前就位，模拟 NoteContent 通过 dangerouslySetInnerHTML
    // 注入富文本后立刻触发内联公式渲染的时序。
    useLayoutEffect(() => {
      if (ref.current) ref.current.innerHTML = html
    }, [html])
    useInlineFormulaRendering({ root: ref, renderKey })

    return <div ref={ref} />
  }

  it("renders formulas on mount and re-renders when renderKey changes", async () => {
    // Given: rich text with one inline formula rendered through the harness.
    const html = `
      <span
        class="hn-note-inline-formula"
        data-hn-inline-formula="a + b"
      >a + b</span>
    `

    // When: the harness mounts with an initial renderKey.
    const view = render(<Harness renderKey={0} html={html} />)

    // Then: katex.render fires once against the formula span.
    await waitFor(() => {
      expect(katexRender).toHaveBeenCalledTimes(1)
    })
    expect(
      view.container.querySelector(".hn-note-inline-formula .katex-mocked")
    ).not.toBeNull()

    // When: the renderKey changes while the formula HTML stays the same.
    view.rerender(<Harness renderKey={1} html={html} />)

    // Then: the hook triggers a fresh render pass, writing the KaTeX output again.
    await waitFor(() => {
      expect(katexRender).toHaveBeenCalledTimes(2)
    })

    // When: the harness re-renders with the same renderKey as before (no change).
    view.rerender(<Harness renderKey={1} html={html} />)

    // Then: the hook does not schedule a redundant render pass for an unchanged key.
    const callsAfterSecond = katexRender.mock.calls.length
    await act(async () => {
      // 让一帧事件循环跑完，确认没有延迟的额外渲染。
      await Promise.resolve()
    })
    expect(katexRender.mock.calls.length).toBe(callsAfterSecond)
  })
})

describe("NoteContent read-only inline formula integration", () => {
  it("renders inline formulas embedded in rich text paragraph blocks via KaTeX", async () => {
    // Given: a read-only note whose paragraph block contains an inline formula span.
    const paragraphHtml = `
      Hello
      <span
        class="hn-note-inline-formula"
        data-hn-inline-formula="E = mc^2"
      >E = mc^2</span>
      world
    `
    const blocks = [
      { id: "p1", kind: "paragraph", text: paragraphHtml } as const
    ]

    // When: the note renders in read-only mode.
    const view = render(
      <NoteContent
        blocks={[...blocks]}
        title="Formula integration"
        editable={false}
      />
    )

    // Then: the inline formula span gets KaTeX output injected inside it.
    await waitFor(() => {
      const formulaSpan = view.container.querySelector<HTMLElement>(
        ".hn-note-inline-formula[data-hn-inline-formula='E = mc^2']"
      )
      expect(formulaSpan).not.toBeNull()
      expect(formulaSpan?.querySelector(".katex-mocked")).not.toBeNull()
      expect(katexRender).toHaveBeenCalledWith(
        "E = mc^2",
        formulaSpan,
        { displayMode: false, throwOnError: false }
      )
    })

    // And: katex.render was invoked with displayMode=false exactly for inline
    // formula spans, distinguishing this path from the displayMode=true block path.
    for (const call of katexRender.mock.calls) {
      const options = call[2] as { displayMode: boolean } | undefined
      expect(options?.displayMode).toBe(false)
    }
  })
})