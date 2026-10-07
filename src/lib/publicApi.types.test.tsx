/// <reference types="node" />
// @vitest-environment jsdom
/**
 * 8.2 公共 API 验收：根入口 runtime 精确为 8 项、旧导出与内部实现均不在；并用
 * TypeScript AST 明确列出当前 allowlist 及其来源（禁止内部模块）。`@ts-expect-error`
 * 断言旧 props/旧 types/内部实现无法从根入口注入（真实编译期拒绝，非注释掩盖）。
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import type { HnnDocument, NoteEditorProps } from "./index"

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const indexPath = path.join(currentDirectory, "index.ts")

interface ExpectedExport {
  name: string
  kind: "value" | "type"
  source: string
}

const EXPECTED_VALUE_EXPORTS: readonly ExpectedExport[] = [
  { name: "NoteEditor", kind: "value", source: "./editor/NoteEditor" },
  { name: "NoteSaveStatus", kind: "value", source: "./editor/NoteSaveStatus" },
  { name: "MarkdownExport", kind: "value", source: "./editor/MarkdownExport" },
  { name: "HnnCodecError", kind: "value", source: "./hnn/codec" },
  { name: "decodeHnn", kind: "value", source: "./hnn/codec" },
  { name: "encodeHnn", kind: "value", source: "./hnn/codec" },
  { name: "importMarkdown", kind: "value", source: "./hnn/markdown" },
  { name: "exportMarkdown", kind: "value", source: "./hnn/markdown" }
]

const EXPECTED_TYPE_EXPORTS: readonly ExpectedExport[] = [
  { name: "NoteEditorProps", kind: "type", source: "./editor/NoteEditor" },
  { name: "NoteSaveStatusProps", kind: "type", source: "./editor/NoteSaveStatus" },
  { name: "MarkdownExportContext", kind: "type", source: "./editor/MarkdownExport" },
  { name: "MarkdownExportProps", kind: "type", source: "./editor/MarkdownExport" },
  { name: "HnnDiagnostic", kind: "type", source: "./hnn/codec" },
  { name: "HnnDocument", kind: "type", source: "./hnn/codec" },
  { name: "MarkdownDiagnostic", kind: "type", source: "./hnn/markdown" },
  { name: "MarkdownExportResult", kind: "type", source: "./hnn/markdown" },
  { name: "MarkdownImportResult", kind: "type", source: "./hnn/markdown" },
  { name: "EditorSessionOptions", kind: "type", source: "./editor/types" },
  { name: "EditorSessionState", kind: "type", source: "./editor/types" },
  { name: "EditorSessionStatus", kind: "type", source: "./editor/types" },
  { name: "HostCandidateKind", kind: "type", source: "./editor/types" },
  { name: "HostCandidateProvider", kind: "type", source: "./editor/types" },
  { name: "HostCandidateState", kind: "type", source: "./editor/types" },
  { name: "HostCandidateStatus", kind: "type", source: "./editor/types" },
  { name: "HostReferenceActivate", kind: "type", source: "./editor/types" },
  { name: "HostReferenceActivation", kind: "type", source: "./editor/types" },
  { name: "HostReferenceCandidate", kind: "type", source: "./editor/types" },
  { name: "HostReferenceContext", kind: "type", source: "./editor/types" },
  { name: "HostReferenceKind", kind: "type", source: "./editor/types" },
  { name: "HostReferenceLookup", kind: "type", source: "./editor/types" },
  { name: "HostReferenceResolution", kind: "type", source: "./editor/types" },
  { name: "HostReferenceResolutionEntry", kind: "type", source: "./editor/types" },
  { name: "HostReferenceResolutionStatus", kind: "type", source: "./editor/types" },
  { name: "HostReferenceResolve", kind: "type", source: "./editor/types" },
  { name: "HostReferenceState", kind: "type", source: "./editor/types" },
  { name: "InitialLoadErrorContext", kind: "type", source: "./editor/types" },
  { name: "InitialLoadErrorHandler", kind: "type", source: "./editor/types" },
  { name: "NoteSave", kind: "type", source: "./editor/types" },
  { name: "NoteSaveContext", kind: "type", source: "./editor/types" },
  { name: "NoteSaveResult", kind: "type", source: "./editor/types" },
  { name: "PictureUploadHandler", kind: "type", source: "./editor/types" },
  { name: "PictureUploadItem", kind: "type", source: "./editor/types" },
  { name: "PictureUploadItemStatus", kind: "type", source: "./editor/types" },
  { name: "PictureUploadRequest", kind: "type", source: "./editor/types" },
  { name: "PictureUploadResult", kind: "type", source: "./editor/types" },
  { name: "PictureUploadState", kind: "type", source: "./editor/types" }
]

const EXPECTED_ALL = [...EXPECTED_VALUE_EXPORTS, ...EXPECTED_TYPE_EXPORTS]

const ALLOWED_SOURCES = new Set([
  "./editor/NoteEditor",
  "./editor/NoteSaveStatus",
  "./editor/MarkdownExport",
  "./hnn/codec",
  "./hnn/markdown",
  "./editor/types"
])

const OLD_RUNTIME_EXPORTS = ["NoteContent", "useNoteContentUndoRedo", "createNoteId", "noteBlockKinds"]

const INTERNAL_RUNTIME_EXPORTS = [
  "createEditorSession",
  "EditorSession",
  "installPictureUpload",
  "installHostReferences",
  "hnnRuntimeSchema",
  "createHnnExtensions",
  "createHnnEditorExtensions"
]

interface ParsedExport {
  name: string
  kind: "value" | "type"
  source?: string
}

/** 用 TypeScript AST 读取根入口导出；未知形态必须失败，避免漏检。 */
function extractExports(filePath: string): { exports: ParsedExport[]; failures: string[] } {
  const program = ts.createProgram([filePath], { noResolve: true })
  const sourceFile = program.getSourceFile(filePath)
  if (!sourceFile) throw new Error(`无法读取 TypeScript 文件: ${filePath}`)
  const results: ParsedExport[] = []
  const failures = program.getSyntacticDiagnostics(sourceFile).map(
    (diagnostic) => `无法解析 TypeScript: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`
  )
  for (const statement of sourceFile.statements) {
    // 允许副作用/普通 import（如 index.ts 的 "./styles.css"）；只校验 export 形态。
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) continue
    if (!ts.isExportDeclaration(statement)) {
      failures.push(`仅允许可枚举的 export 声明，发现: ${statement.getText(sourceFile)}`)
      continue
    }
    const source = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : undefined
    if (!statement.exportClause) {
      failures.push(`不支持 export-star: ${statement.getText(sourceFile)}`)
      continue
    }
    if (ts.isNamespaceExport(statement.exportClause)) {
      failures.push(`不支持 namespace export: ${statement.getText(sourceFile)}`)
      continue
    }
    if (!ts.isNamedExports(statement.exportClause)) {
      failures.push(`未知 export 声明形式: ${statement.getText(sourceFile)}`)
      continue
    }
    for (const specifier of statement.exportClause.elements) {
      results.push({
        name: specifier.name.text,
        kind: statement.isTypeOnly || specifier.isTypeOnly ? "type" : "value",
        ...(source ? { source } : {})
      })
    }
  }
  return { exports: results, failures }
}

const { exports: actualExports, failures: exportParseFailures } = extractExports(indexPath)

function identity(entry: { name: string; kind: string; source?: string }): string {
  return JSON.stringify({ name: entry.name, kind: entry.kind, source: entry.source })
}

describe("8.2 公共 API：AST 明确清单与来源", () => {
  it("根入口导出与 allowlist 完全一致（含 source，未知语法失败）", () => {
    expect(exportParseFailures).toEqual([])
    expect(actualExports.map(identity).sort()).toEqual(EXPECTED_ALL.map(identity).sort())
  })

  it("每项来源均为允许的公开模块，禁止内部实现", () => {
    for (const entry of actualExports) {
      expect(ALLOWED_SOURCES.has(entry.source ?? ""), `${entry.name} 的 source=${entry.source ?? "(缺失)"}`).toBe(true)
    }
    for (const forbidden of ["session", "extensions", "pictureUpload", "hostReferences", "nodeId", "codec.ts"]) {
      expect(actualExports.some((entry) => (entry.source ?? "").includes(forbidden))).toBe(false)
    }
  })

  it("runtime 精确 8 项，旧导出与内部实现均不在", async () => {
    const runtime = await import("./index")
    const keys = Object.keys(runtime).sort()
    expect(keys).toEqual(EXPECTED_VALUE_EXPORTS.map((entry) => entry.name).sort())
    for (const old of OLD_RUNTIME_EXPORTS) expect(runtime).not.toHaveProperty(old)
    for (const internal of INTERNAL_RUNTIME_EXPORTS) expect(runtime).not.toHaveProperty(internal)
  })
})

describe("8.2 公共 API：封闭模型的编译期拒绝", () => {
  it("宿主激活 payload 用 kind 区分资源引用与 hnmagic href", () => {
    // 既有引用形状不变；新增链接分支不能要求调用方伪造 resourceId/name。
    const references: import("./index").HostReferenceActivation[] = [
      { kind: "mention", resourceId: "u1", name: "Ada" },
      { kind: "resource", resourceId: "r1", name: "资料" },
      { kind: "externalItem", resourceId: "e1", name: "条目" },
      { kind: "hnmagic", href: "hnmagic://note/42" }
    ]
    expect(references.map((reference) => reference.kind === "hnmagic" ? reference.href : reference.resourceId))
      .toEqual(["u1", "r1", "e1", "hnmagic://note/42"])
    // @ts-expect-error hnmagic 只能提供 href，不支持伪资源 ID
    const invalid: import("./index").HostReferenceActivation = { kind: "hnmagic", resourceId: "42", name: "笔记" }
    void invalid
  })

  it("旧 props / 旧 types / 内部实现无法从根入口注入", () => {
    const document: HnnDocument = { schemaVersion: 1, data: { type: "doc", content: [] } }

    // @ts-expect-error 旧 NoteContent props（blocks/title）不得注入新 NoteEditor
    const badProps: NoteEditorProps = { documentId: "A", loadKey: 1, initialDocument: document, blocks: [] }
    void badProps

    // @ts-expect-error 旧 NoteBlock 类型不再从根入口导出
    const badBlock: import("./index").NoteBlock = null as never
    void badBlock

    // @ts-expect-error 内部 EditorSession 不公开
    const badSession: import("./index").EditorSession = null as never
    void badSession

    // @ts-expect-error 上传 installer 不公开
    const badInstaller: import("./index").PictureUploadInstaller = null as never
    void badInstaller

    // @ts-expect-error schema 不公开
    const badSchema: typeof import("./index")["hnnRuntimeSchema"] = null as never
    void badSchema

    // @ts-expect-error 会话工厂不公开
    const badFactory: typeof import("./index")["createEditorSession"] = null as never
    void badFactory
  })
})
