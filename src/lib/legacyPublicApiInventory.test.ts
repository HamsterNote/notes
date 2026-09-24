/**
 * OpenSpec 变更 migrate-to-tiptap-prosemirror 任务 1.3 的冻结校验。
 *
 * 该测试把当前公共 API 导出清单冻结为可维护的数据（见
 * `legacyPublicApiInventory.json`），并断言 `src/lib/index.ts` 的实际导出与该
 * 清单完全一致。任何新增/删除/重命名导出都会让测试失败，从而在 Phase 1 明确
 * "哪些导出属于待移除的旧 API"（移除本身在任务 8 执行）。
 *
 * 该测试不改变、也不破坏现有公共 API 行为。
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(currentDirectory, "../..")
const inventoryPath = path.join(
  currentDirectory,
  "legacyPublicApiInventory.json"
)
const indexPath = path.join(currentDirectory, "index.ts")

interface PublicApiInventoryEntry {
  name: string
  kind: "value" | "type"
  source?: string
  path?: string
  category: string
  removalTask: string
  note: string
}

interface LegacyInternalModuleEntry {
  path: string
  category: string
  note: string
}

interface LegacyPublicApiInventory {
  frozenForChange: string
  removalTask: string
  publicApiTask: string
  publicExports: PublicApiInventoryEntry[]
  legacyInternalModules: LegacyInternalModuleEntry[]
}

interface ParsedExport {
  name: string
  kind: "value" | "type"
  source?: string
}

/**
 * 用 TypeScript AST 读取公共导出。未知形态必须报告，避免正则遗漏新增的语法。
 */
function extractExports(filePath: string): {
  exports: ParsedExport[]
  failures: string[]
} {
  const program = ts.createProgram([filePath], { noResolve: true })
  const sourceFile = program.getSourceFile(filePath)
  if (!sourceFile) throw new Error(`无法读取 TypeScript 文件: ${filePath}`)
  const results: ParsedExport[] = []
  const failures = program.getSyntacticDiagnostics(sourceFile).map(
    (diagnostic) =>
      `无法解析 TypeScript: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`
  )
  const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      const source = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined
      if (!statement.exportClause) {
        failures.push(`不支持无法枚举名称的 export-star: ${statement.getText(sourceFile)}`)
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        results.push({
          name: statement.exportClause.name.text,
          kind: "value",
          ...(source ? { source } : {})
        })
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) {
          results.push({
            name: specifier.name.text,
            kind: statement.isTypeOnly || specifier.isTypeOnly ? "type" : "value",
            ...(source ? { source } : {})
          })
        }
      } else {
        failures.push(`未知 export 声明形式: ${statement.getText(sourceFile)}`)
      }
      continue
    }

    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals) {
        failures.push(`不支持 export = 形式: ${statement.getText(sourceFile)}`)
      } else {
        results.push({ name: "default", kind: "value" })
      }
      continue
    }

    if (ts.isNamespaceExportDeclaration(statement)) {
      failures.push(`不支持 UMD namespace export: ${statement.getText(sourceFile)}`)
      continue
    }

    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      results.push({ name: "default", kind: "value" })
      continue
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          results.push({ name: declaration.name.text, kind: "value" })
        } else {
          failures.push(`不支持解构变量导出: ${statement.getText(sourceFile)}`)
        }
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
      results.push({ name: statement.name.text, kind: "value" })
      continue
    }

    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      results.push({ name: statement.name.text, kind: "type" })
      continue
    }

    failures.push(`未知导出形式: ${statement.getText(sourceFile)}`)
  }

  return { exports: results, failures }
}

const inventory = JSON.parse(
  readFileSync(inventoryPath, "utf8")
) as LegacyPublicApiInventory

const { exports: actualExports, failures: exportParseFailures } = extractExports(indexPath)
const inventoryByName = new Map(
  inventory.publicExports.map((entry) => [entry.name, entry])
)
const publicApiIdentity = (entry: ParsedExport | PublicApiInventoryEntry): string =>
  JSON.stringify({
    name: entry.name,
    kind: entry.kind,
    // 清单可选地以 source/path 锁定 re-export 来源；当前清单尚未使用该字段。
    source:
      (inventoryByName.get(entry.name)?.source ??
        inventoryByName.get(entry.name)?.path) !== undefined
      ? entry.source ?? ("path" in entry ? entry.path : undefined) ?? undefined
      : undefined
  })

describe("legacy public API inventory (Phase 1 task 1.3)", () => {
  it("冻结清单面向本变更且标记了移除任务", () => {
    expect(inventory.frozenForChange).toBe("migrate-to-tiptap-prosemirror")
    expect(inventory.removalTask).toBe("8.1")
    expect(inventory.publicApiTask).toBe("8.2")
  })

  it("src/lib/index.ts 的导出与冻结清单完全一致（无静默漂移）", () => {
    expect(exportParseFailures).toEqual([])
    expect(actualExports.map(publicApiIdentity).sort()).toEqual(
      inventory.publicExports.map(publicApiIdentity).sort()
    )
  })

  it("每个导出都标记了种类、分类与移除任务", () => {
    for (const entry of inventory.publicExports) {
      expect(entry.name).toBeTruthy()
      expect(["value", "type"]).toContain(entry.kind)
      expect(entry.category).toBeTruthy()
      expect(entry.removalTask).toBeTruthy()
      expect(entry.note).toBeTruthy()
    }
  })

  it("冻结清单无重复导出名", () => {
    const names = inventory.publicExports.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it("导出种类与冻结清单一致", () => {
    const actualByName = new Map(
      actualExports.map((entry) => [entry.name, entry.kind])
    )
    for (const entry of inventory.publicExports) {
      expect(actualByName.get(entry.name)).toBe(entry.kind)
    }
  })

  it("待移除的内部模块当前仍然存在（移除在任务 8 执行）", () => {
    for (const moduleEntry of inventory.legacyInternalModules) {
      const absolutePath = path.join(projectRoot, moduleEntry.path)
      expect(existsSync(absolutePath), moduleEntry.path).toBe(true)
    }
  })
})
