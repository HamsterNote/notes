/**
 * React key 必须区分类型和值，尤其是 JavaScript 的 -0 与 0。非有限数字没有稳定的
 * 会话语义，因此在渲染前硬失败而非静默碰撞。
 */
export function encodeNoteEditorSessionKey(documentId: string, loadKey: string | number): string {
  if (typeof loadKey === "number" && !Number.isFinite(loadKey)) throw new TypeError("loadKey 数字必须是有限值")
  const encodedLoadKey = typeof loadKey === "string"
    ? `string:${JSON.stringify(loadKey)}`
    : `number:${Object.is(loadKey, -0) ? "-0" : String(loadKey)}`
  return `document:${JSON.stringify(documentId)}|${encodedLoadKey}`
}
