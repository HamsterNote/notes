/**
 * 兼容内部 codec 的 schema 入口。唯一真相来源为 createHnnExtensions()；不得在此
 * 维护第二份手写 ProseMirror Schema。
 */
export {
  createHnnExtensions,
  HNN_MARK_TYPES,
  HNN_NODE_TYPES,
  hnnRuntimeSchema as hnnSchema
} from "./extensions"
