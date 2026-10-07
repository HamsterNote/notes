/**
 * Phase 1 范围守卫（OpenSpec 变更 migrate-to-tiptap-prosemirror 任务 1.4）。
 *
 * 只验证依赖、模块导入与 src/lib/index.ts 的公开类型契约。它不会搜索或检查实现
 * 函数体，因此内部固定 schema/extensions 组合与无关浏览器 API 不会被误伤。
 *
 * 用法：`yarn verify:phase1-scope`
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import ts from "typescript"
import {
  findBareProseMirrorReferences,
  inspectPublicApi
} from "./phase1-ast-guards.mjs"

const projectRoot = process.cwd()
const sourceRoot = path.join(projectRoot, "src")
const indexPath = path.join(projectRoot, "src/lib/index.ts")
const packageJsonPath = path.join(projectRoot, "package.json")
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
]
const FORBIDDEN_DEPENDENCIES = [
  { label: "协作/Yjs", pattern: /^yjs$|^y-prosemirror$|^y-protocols$/u },
  { label: "协作扩展", pattern: /^@tiptap\/extension-collaboration(?:-caret)?$/u },
  {
    label: "Yjs 假设的拖拽手柄扩展",
    pattern: /^@tiptap\/extension-drag-handle(?:-vue|-react)?$/u
  },
  {
    label: "文件拖入/选择处理扩展",
    pattern: /^@tiptap\/extension-file-handler(?:-vue|-react)?$/u
  }
]
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"])

function collectSourceFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory)) {
    const filePath = path.join(directory, entry)
    if (statSync(filePath).isDirectory()) files.push(...collectSourceFiles(filePath))
    else if (SOURCE_EXTENSIONS.has(path.extname(entry))) files.push(filePath)
  }
  return files
}

function parseTypeScript(filePath) {
  // 只需 AST，不建立每个源码文件的 Program，保持守卫快速可重复执行。
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true
  )
}

const failures = []
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
const declaredDependencies = []
for (const section of DEPENDENCY_SECTIONS) {
  for (const name of Object.keys(packageJson[section] ?? {})) {
    declaredDependencies.push({ section, name })
  }
}
for (const dependency of declaredDependencies) {
  for (const forbidden of FORBIDDEN_DEPENDENCIES) {
    if (forbidden.pattern.test(dependency.name)) {
      failures.push(`依赖 ${dependency.name} (${dependency.section}) 属于禁止的 ${forbidden.label} 范围`)
    }
  }
}

const sourceFiles = collectSourceFiles(sourceRoot)
for (const filePath of sourceFiles) {
  const sourceFile = parseTypeScript(filePath)
  for (const reference of findBareProseMirrorReferences(sourceFile)) {
    failures.push(
      `${path.relative(projectRoot, filePath)}:${reference.line}:${reference.column} 以 ${reference.form} 引用 ${reference.packageName}，应通过 @tiptap/pm/* 使用`
    )
  }
}

const publicApi = inspectPublicApi(indexPath)
failures.push(...publicApi.failures)

process.stdout.write("Phase 1 范围守卫 (Phase 1 task 1.4)\n")
process.stdout.write(
  `  已检查依赖 ${declaredDependencies.length} 项、源码文件 ${sourceFiles.length} 个、公共导出 ${publicApi.publicExportCount} 个\n`
)
process.stdout.write("  范围: 禁止协作/Yjs、文件处理扩展、裸 ProseMirror 引用及公开 schema/extensions 注入契约\n")
if (failures.length > 0) {
  process.stderr.write("\nPhase 1 范围守卫失败:\n")
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`)
  process.exit(1)
}
process.stdout.write("\nPhase 1 范围守卫通过。\n")
