/**
 * HNN 预算化事务助手（内部模块，仅 blockMenu 与 tableEdgeControls 使用）。
 *
 * 编辑器结构动作（块转换、插入表格/公式、表格增删行列/移动）在真实 dispatch 前
 * 必须完成两件事：
 * 1. 为新产生的持久节点补齐合法唯一 nodeId（命令产生的新行/列/单元格/表格默认
 *    nodeId 为空，真实 dispatch 后由 nodeId 插件补，但预检必须在补之前完成）；
 * 2. 对最终候选整文档跑严格 encodeHnn 预检（节点总数、表格几何、512 KiB 外壳预算、
 *    深度、attrs/marks/URL 等全部 codec 规则）。
 *
 * 失败语义：全部预检只在 isolated EditorState 上计算、绝不 applyTransaction 到 live
 * editor；失败返回 false 且保持 doc/selection/history/dirty 完全不变。这与
 * pictureUpload/hostReferences 的“先预算后 dispatch”一致。
 *
 * 历史隔离：每个结构动作 closeHistory(tr) 使动作独立成一个 undo step；dispatch 后
 * 再补一个无 step 的 closeHistory(editor.state.tr) 栅栏，令紧随其后的同 tick 输入
 * 另起一个 undo step。
 *
 * 模块加载环：extensions.ts 静态 import tableEdgeControls.ts，而 codec.ts 依赖
 * schema.ts（re-export extensions.ts）。若本模块静态 import codec.ts，就会形成
 * extensions → tableEdgeControls → budgetedTransaction → codec → schema → extensions
 * 的加载环，令 codec 在 extensions 初始化前求值、读到未初始化的 HNN_NODE_TYPES。
 * 因此本模块不静态 import codec，而是由已加载 codec 的入口注入 encodeHnn（blockMenu
 * 在模块求值时注入；session 必然先加载 codec 再加载 blockMenu）。
 *
 * Fail-closed：未注入编码器时绝不退回任何自研弱化检查，normalizeBudgetedCandidate
 * 直接返回 null（零 dispatch）。只有严格 encodeHnn 通过才允许提交。
 */

import type { ChainedCommands, Editor } from "@tiptap/core"
import { closeHistory } from "@tiptap/pm/history"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { EditorState, type Transaction } from "@tiptap/pm/state"

import { repairHnnDocument } from "./nodeId"

/** 严格 HNN 编码器（codec.encodeHnn）。 */
export type HnnBudgetEncoder = (document: ProseMirrorNode) => unknown

let injectedEncoder: HnnBudgetEncoder | undefined

/**
 * 由已加载 codec 的入口注入 encodeHnn。见文件头“模块加载环”说明：直接静态 import
 * codec 会破坏 extensions 的初始化顺序。生产路径（EditorSession）必然先加载 codec，
 * 再由 blockMenu 注入，因此始终走严格 encodeHnn。
 */
export function installHnnBudgetEncoder(encoder: HnnBudgetEncoder): void {
  injectedEncoder = encoder
}

/** Editor 内部 CommandManager 的最小结构（TipTap 3.x 标为 private，运行期仍存在）。 */
interface InternalCommandManager {
  createChain(startTr?: Transaction, shouldDispatch?: boolean): ChainedCommands
}

/**
 * 捕获 TipTap 命令链产生的单个事务，但不 dispatch。
 *
 * 依据本地 @tiptap/core CommandManager 源码：
 * - `editor.chain().run()` 无论各命令回调返回 true 还是 false 都会 `view.dispatch(tr)`；
 * - `createChain(startTr, true)` 传入 startTr 后，run() 因 hasStartTransaction 跳过
 *   dispatch，同时链内命令仍以真实 dispatch 语义把 step 写进同一个 startTr。
 *
 * run() 返回 false 表示链中至少一个命令失败（且可能已把部分 step 写进 tr）：此时一律
 * 返回 null，绝不因“部分 tr 恰好能过 encodeHnn”就把它当成成功提交。
 */
export function captureChainTransaction(
  editor: Editor,
  build: (chain: ChainedCommands) => ChainedCommands
): Transaction | null {
  const manager = (editor as unknown as { commandManager?: InternalCommandManager }).commandManager
  if (!manager || typeof manager.createChain !== "function") return null
  const tr = editor.state.tr
  try {
    if (!build(manager.createChain(tr, true)).run()) return null
  } catch {
    return null
  }
  return tr
}

/**
 * 在 isolated EditorState 上补齐候选事务里的新节点 nodeId，并把修复 steps 并入原 tr；
 * 随后对最终候选整文档跑严格 encodeHnn 预检。成功返回原 tr，失败返回 null。
 *
 * 关键约束：
 * - 未注入编码器时 fail-closed：直接返回 null，绝不退回任何弱化结构检查；
 * - 只在 isolated state 上计算，绝不 `editor.view.dispatch`/`applyTransaction`；
 * - 已合法唯一的原 nodeId 由 repairHnnDocument 原样保留，只为缺失/非法/重复的节点
 *   生成新 UUID，因此正常插入不会被误禁；
 * - 修复 steps 的坐标基于 tr.doc，可安全并入 tr（此时 tr.doc 尚未改变）。
 */
export function normalizeBudgetedCandidate(schema: Editor["schema"], tr: Transaction): Transaction | null {
  // 必须在 repair 之前 fail-closed：没有严格编码器就不产生任何候选。
  if (!injectedEncoder) return null
  try {
    const isolated = EditorState.create({ doc: tr.doc, schema })
    const repair = repairHnnDocument(isolated)
    if (repair) {
      for (const step of repair.steps) tr.step(step)
    }
    injectedEncoder(tr.doc)
    return tr
  } catch {
    return null
  }
}

/**
 * 提交一个已捕获的候选事务：
 * - 只读/已销毁编辑器、no-op（doc 未变）一律拒绝，零 dispatch；
 * - 先把新节点 nodeId 补齐并对最终候选严格 encodeHnn 预检，失败回 false 且零变更；
 * - 成功才 closeHistory(tr) + dispatch，并补空 closeHistory 栅栏隔离后续输入。
 * 返回是否真实提交。
 */
export function commitBudgetedTransaction(editor: Editor, tr: Transaction): boolean {
  if (editor.isDestroyed || !editor.view.editable) return false
  if (tr.doc.eq(editor.state.doc)) return false
  const candidate = normalizeBudgetedCandidate(editor.schema, tr)
  if (!candidate) return false
  closeHistory(candidate)
  editor.view.dispatch(candidate)
  // closeHistory 只重置 prevTime/prevRanges，隔离前序；再补一个无 step 的 close 事务，
  // 令紧随其后的同 tick 输入另起一个 undo step（文档/历史条目/dirty 均不受影响）。
  editor.view.dispatch(closeHistory(editor.state.tr))
  return true
}
