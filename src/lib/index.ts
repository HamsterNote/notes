/**
 * @hamster-note/notes 新公共入口（OpenSpec 变更 migrate-to-tiptap-prosemirror 任务 7.1）。
 *
 * 只公开新内核的 runtime 导出与宿主契约类型：
 * - runtime：NoteEditor / NoteSaveStatus / MarkdownExport / HnnCodecError / decodeHnn /
 *   encodeHnn / importMarkdown / exportMarkdown（八个）；
 * - 类型：新组件 props、HNN 与 Markdown codec 类型，以及 editor 内部定义的宿主回调契约。
 *
 * 旧 NoteContent / NoteBlock / 受限 HTML / 自研选区与剪贴板的导出在此移除（旧实现模块
 * 本身仍在，删除在任务 8.1）。schema、extensions、EditorSession、installer 及任何
 * ProseMirror 句柄一律不公开；根入口是封闭模型。
 */
import "./styles.css"

export { NoteEditor, type NoteEditorProps } from "./editor/NoteEditor"
export { NoteSaveStatus, type NoteSaveStatusProps } from "./editor/NoteSaveStatus"
export {
  MarkdownExport,
  type MarkdownExportContext,
  type MarkdownExportProps
} from "./editor/MarkdownExport"
export {
  HnnCodecError,
  decodeHnn,
  encodeHnn,
  type HnnDiagnostic,
  type HnnDocument
} from "./hnn/codec"
export {
  exportMarkdown,
  importMarkdown,
  type MarkdownDiagnostic,
  type MarkdownExportResult,
  type MarkdownImportResult
} from "./hnn/markdown"
export type {
  EditorSessionOptions,
  EditorSessionState,
  EditorSessionStatus,
  HostCandidateKind,
  HostCandidateProvider,
  HostCandidateState,
  HostCandidateStatus,
  HostReferenceActivate,
  HostReferenceActivation,
  HostReferenceCandidate,
  HostReferenceContext,
  HostReferenceKind,
  HostReferenceLookup,
  HostReferenceResolution,
  HostReferenceResolutionEntry,
  HostReferenceResolutionStatus,
  HostReferenceResolve,
  HostReferenceState,
  InitialLoadErrorContext,
  InitialLoadErrorHandler,
  NoteSave,
  NoteSaveContext,
  NoteSaveResult,
  PictureUploadHandler,
  PictureUploadItem,
  PictureUploadItemStatus,
  PictureUploadRequest,
  PictureUploadResult,
  PictureUploadState
} from "./editor/types"
