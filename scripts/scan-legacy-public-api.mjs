/**
 * 扫描并列出待移除的旧公共 API 导出及其引用点
 * （OpenSpec 变更 migrate-to-tiptap-prosemirror 任务 1.3）。
 *
 * 数据源：`src/lib/legacyPublicApiInventory.json`（冻结清单）。
 *
 * 行为：
 * 1. 校验 `src/lib/index.ts` 的实际导出与冻结清单一致；不一致即视为清单漂移并失败。
 * 2. 对清单中的每个导出名与每个待移除内部模块，扫描 `src/` 下的引用点并汇总。
 * 3. 仅列出与检查，不修改任何代码；移除动作在任务 8 执行。
 *
 * 用法：`yarn verify:legacy-api`
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import ts from "typescript"
import { findBareProseMirrorReferences } from "./phase1-ast-guards.mjs"

const projectRoot = process.cwd()
const libraryRoot = path.join(projectRoot, "src/lib")
const indexFilePath = path.join(libraryRoot, "index.ts")
const inventoryPath = path.join(libraryRoot, "legacyPublicApiInventory.json")
// 归档规划/历史清单与新 allowlist 测试会以字符串形式提及旧名，引用统计必须排除，
// 避免把“清单/证据”误算成真实源码引用。
const HISTORY_ARTIFACT_EXCLUDES = new Set([
  indexFilePath,
  path.join(libraryRoot, "legacyPublicApiInventory.test.ts"),
  path.join(libraryRoot, "publicApi.types.test.tsx")
])

const SCAN_EXTENSIONS = new Set([".ts", ".tsx"])

/** 递归收集 src 下所有 .ts/.tsx 文件。 */
function collectSourceFiles(directory) {
  const collected = []
  for (const entry of readdirSync(directory)) {
    const absolutePath = path.join(directory, entry)
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) {
      collected.push(...collectSourceFiles(absolutePath))
    } else if (SCAN_EXTENSIONS.has(path.extname(entry))) {
      collected.push(absolutePath)
    }
  }
  return collected
}

/** AST 导出记录；source 用于冻结清单未来选择锁定 re-export 来源。 */
function extractExports(filePath) {
  const program = ts.createProgram([filePath], { noResolve: true })
  const sourceFile = program.getSourceFile(filePath)
  if (!sourceFile) throw new Error(`无法读取 TypeScript 文件: ${filePath}`)
  const results = []
  const failures = program.getSyntacticDiagnostics(sourceFile).map(
    (diagnostic) =>
      `无法解析 TypeScript: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`
  )
  const record = (name, kind, source) => results.push({ name, kind, source })
  const hasModifier = (node, kind) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      const source = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined
      if (!statement.exportClause) {
        failures.push(`不支持无法枚举名称的 export-star: ${statement.getText(sourceFile)}`)
        continue
      }
      if (ts.isNamespaceExport(statement.exportClause)) {
        record(statement.exportClause.name.text, "value", source)
        continue
      }
      if (!ts.isNamedExports(statement.exportClause)) {
        failures.push(`未知 export 声明形式: ${statement.getText(sourceFile)}`)
        continue
      }
      for (const specifier of statement.exportClause.elements) {
        record(
          specifier.name.text,
          statement.isTypeOnly || specifier.isTypeOnly ? "type" : "value",
          source
        )
      }
      continue
    }

    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals) {
        failures.push(`不支持 export = 形式: ${statement.getText(sourceFile)}`)
      } else {
        record("default", "value")
      }
      continue
    }

    if (ts.isNamespaceExportDeclaration(statement)) {
      failures.push(`不支持 UMD namespace export: ${statement.getText(sourceFile)}`)
      continue
    }

    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      record("default", "value")
      continue
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) record(declaration.name.text, "value")
        else failures.push(`不支持解构变量导出: ${statement.getText(sourceFile)}`)
      }
      continue
    }

    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name
    ) {
      record(statement.name.text, "value")
      continue
    }

    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      record(statement.name.text, "type")
      continue
    }

    // 新语法必须显式加入上方分支，避免冻结清单在未知导出形态下静默失效。
    failures.push(`未知导出形式: ${statement.getText(sourceFile)}`)
  }

  return { results, failures }
}

/** 统计某个标识符在给定文件集合中的出现次数（按单词边界）。 */
function countReferences(identifier, files, excludePaths = new Set()) {
  const pattern = new RegExp(`\\b${escapeRegExp(identifier)}\\b`, "gu")
  const references = []
  for (const file of files) {
    if (excludePaths.has(file)) continue
    const content = readFileSync(file, "utf8")
    const matches = content.match(pattern)
    if (matches && matches.length > 0) {
      references.push({
        file: path.relative(projectRoot, file),
        count: matches.length
      })
    }
  }
  return references
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"))
const { results: indexExports, failures: exportParseFailures } = extractExports(indexFilePath)
const phase = inventory.phase ?? "frozen"
if (!["frozen", "root-switched", "deleted"].includes(phase)) {
  process.stderr.write(`未知 inventory.phase: ${String(phase)}\n`)
  process.exit(1)
}
// frozen 阶段以冻结旧清单为准；root-switched/deleted 均以当前 allowlist 为准。
const activeExports = phase === "frozen" ? inventory.publicExports : inventory.currentPublicExports
const activeByName = new Map(
  activeExports.map((entry) => [entry.name, entry])
)
const publicApiIdentity = (entry) =>
  JSON.stringify({
    name: entry.name,
    kind: entry.kind,
    // `source` and `path` are optional inventory fields used to lock provenance.
    source:
      (activeByName.get(entry.name)?.source ??
        activeByName.get(entry.name)?.path) !== undefined
        ? entry.source ?? entry.path ?? undefined
        : undefined
  })
const actualExports = indexExports.map(publicApiIdentity).sort()
const expectedExports = activeExports.map(publicApiIdentity).sort()
const actualNames = new Set(indexExports.map((entry) => entry.name))

const sourceFiles = collectSourceFiles(path.join(projectRoot, "src"))

/** Phase 1 不允许源码绕过 @tiptap/pm 直接导入 ProseMirror 包。 */
function findBareProseMirrorImports(filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true
  )
  return findBareProseMirrorReferences(sourceFile)
}

process.stdout.write("旧公共 API 移除清单扫描\n")
process.stdout.write(`  冻结导入变化: ${inventory.frozenForChange}\n`)
process.stdout.write(`  移除任务: ${inventory.removalTask} / ${inventory.publicApiTask}\n`)
process.stdout.write(`  阶段: ${phase}（allowlist=${phase === "frozen" ? "publicExports" : "currentPublicExports"}）\n\n`)

let drifted = exportParseFailures.length > 0
for (const failure of exportParseFailures) {
  process.stderr.write(`index.ts 导出解析失败: ${failure}\n`)
}

for (const file of sourceFiles) {
  for (const reference of findBareProseMirrorImports(file)) {
    drifted = true
    process.stderr.write(
      `${path.relative(projectRoot, file)}:${reference.line}:${reference.column} 以 ${reference.form} 引用了禁止的 ${reference.packageName}（应通过 @tiptap/pm/* 使用）\n`
    )
  }
}
if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports)) {
  drifted = true
  process.stderr.write("index.ts 导出与冻结清单不一致（清单漂移）:\n")
  const actualSet = new Set(actualExports)
  const expectedSet = new Set(expectedExports)
  for (const name of actualExports) {
    if (!expectedSet.has(name)) {
      process.stderr.write(`  + 新增导出: ${name}\n`)
    }
  }
  for (const exportEntry of expectedExports) {
    if (!actualSet.has(exportEntry)) {
      process.stderr.write(`  - 缺失导出: ${exportEntry}\n`)
    }
  }
}

// root-switched/deleted 后旧导出必须全部从根入口消失；出现即清单漂移。
if (phase !== "frozen") {
  for (const entry of inventory.publicExports) {
    if (actualNames.has(entry.name)) {
      drifted = true
      process.stderr.write(`旧导出仍出现在根入口（禁止回归）: [${entry.kind}] ${entry.name}\n`)
    }
  }
}

process.stdout.write("公共 API 待移除导出引用点:\n")
for (const entry of inventory.publicExports) {
  const references = countReferences(entry.name, sourceFiles, HISTORY_ARTIFACT_EXCLUDES)
  const referenceCount = references.reduce((total, item) => total + item.count, 0)
  process.stdout.write(
    `  [${entry.kind}] ${entry.name} (${entry.category}) — ${referenceCount} 处引用\n`
  )
  for (const reference of references) {
    process.stdout.write(`      ${reference.file} x${reference.count}\n`)
  }
}

process.stdout.write("\n待移除内部模块引用点:\n")
let missingModules = 0
for (const moduleEntry of inventory.legacyInternalModules) {
  const absolutePath = path.join(projectRoot, moduleEntry.path)
  if (!existsSync(absolutePath)) {
    missingModules += 1
    process.stdout.write(
      `  [缺失] ${moduleEntry.path} (${moduleEntry.category}) — 已不存在，可能在任务 8 已移除\n`
    )
    continue
  }
  const moduleName = path.basename(moduleEntry.path).replace(/\.(tsx?|json)$/u, "")
  const references = countReferences(moduleName, sourceFiles, HISTORY_ARTIFACT_EXCLUDES)
  process.stdout.write(
    `  ${moduleEntry.path} (${moduleEntry.category}) — 模块名引用 ${references.length} 个文件\n`
  )
}

process.stdout.write("\n说明: 本扫描仅列出与检查，不修改代码；移除动作在任务 8 执行。\n")

if (drifted) {
  process.stderr.write("\n旧公共 API 扫描失败: 冻结清单需要同步更新。\n")
  process.exit(1)
}

if (missingModules > 0) {
  if (phase === "deleted") {
    process.stdout.write(
      `\n阶段 deleted：${missingModules} 个旧实现模块已按计划移除（历史清单保留为证据）。\n`
    )
  } else {
    process.stderr.write(
      `\n注意: 有 ${missingModules} 个待移除内部模块已不存在，但阶段 ${phase} 尚未允许移除。\n`
    )
    process.exit(1)
  }
}

process.stdout.write("\n旧公共 API 扫描通过。\n")
