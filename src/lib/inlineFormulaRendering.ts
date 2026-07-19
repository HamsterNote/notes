import katex from "katex"
import { type RefObject, useLayoutEffect } from "react"

/**
 * 内联公式占位 span 的选择器。
 *
 * 同时要求类名 `hn-note-inline-formula` 与 `data-hn-inline-formula` 属性，
 * 避免误判只有类名或只有属性之一的“形似”节点。
 * 属性值为 LaTeX 源码，渲染时以 inline（displayMode:false）模式呈现。
 */
const INLINE_FORMULA_SELECTOR =
  ".hn-note-inline-formula[data-hn-inline-formula]"

/**
 * 在给定 DOM 子树中渲染所有内联公式占位 span。
 *
 * 选取 `.hn-note-inline-formula[data-hn-inline-formula]` 节点，
 * 从 `data-hn-inline-formula` 属性读取 LaTeX 源码，调用 `katex.render`
 * 以 inline 模式（displayMode:false）渲染进该 span。
 *
 * 设计为幂等的 DOM 副作用函数：不读取也不修改 React state，
 * 仅供只读展示路径调用。可编辑模式下应避免调用，因为 contentEditable
 * 需要保留原始文本以便用户直接编辑，KaTeX 渲染产物会破坏选区与编辑语义。
 *
 * 失败（属性缺失或 KaTeX 抛错）由 KaTeX 的 throwOnError:false 兜底，
 * 不会中断后续公式渲染。
 */
export function renderInlineFormulas(root: HTMLElement): void {
  // querySelectorAll 返回的是静态 NodeList，渲染过程中改写 DOM 不会
  // 影响迭代顺序，逐个调用 katex.render 即可。
  const nodes = root.querySelectorAll<HTMLElement>(INLINE_FORMULA_SELECTOR)
  nodes.forEach((node) => {
    // data-hn-inline-formula 由选择器保证存在，但严格类型仍需 null 检查；
    // 缺失则跳过此节点，避免把 null 传给 katex。
    const formula = node.getAttribute("data-hn-inline-formula")
    if (formula === null) return
    katex.render(formula, node, {
      displayMode: false,
      // throwOnError:false 让单个公式出错不影响后续公式渲染，
      // 与 NoteFormulaBlock 的 display 模式渲染保持一致的容错策略。
      throwOnError: false
    })
  })
}

type UseInlineFormulaRenderingOptions = {
  /** 包含内联公式占位 span 的容器 ref；通常指向只读模式下渲染 blocks 的根节点。 */
  readonly root: RefObject<HTMLElement | null>
  /**
   * 重新渲染的触发键。当此值变化（且不为 null/undefined）时触发一次渲染。
   * 传 null/undefined 表示禁用渲染（用于可编辑模式下避免覆盖 contentEditable 内容）。
   * 注意：falsy 的字面值（如 0、""）仍会触发渲染，仅 null/undefined 被视为禁用。
   */
  readonly renderKey: unknown
}

/**
 * 在组件挂载 / `renderKey` 变化时触发内联公式渲染的副作用 hook。
 *
 * 使用 useLayoutEffect 在 DOM 变更后、浏览器绘制前同步渲染公式，
 * 避免出现“先显示原始 LaTeX 文本再闪烁为渲染结果”的视觉抖动。
 *
 * 只做 DOM 副作用，不修改 React state，避免在渲染阶段触发状态更新导致循环。
 */
export function useInlineFormulaRendering({
  root,
  renderKey
}: UseInlineFormulaRenderingOptions): void {
  useLayoutEffect(() => {
    // renderKey 为 null/undefined 视为禁用信号：调用方可在可编辑模式下传 null，
    // 让 hook 始终被无条件调用（符合 React hooks 规则）的同时不执行实际渲染。
    if (renderKey === null || renderKey === undefined) return
    const node = root.current
    if (!node) return
    renderInlineFormulas(node)
    // 依赖 renderKey 显式驱动重新渲染；root 为稳定 ref 对象。
  }, [renderKey, root])
}