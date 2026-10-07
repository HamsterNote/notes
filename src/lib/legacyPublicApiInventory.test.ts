/// <reference types="node" />
/**
 * OpenSpec 变更 migrate-to-tiptap-prosemirror：公共 API 阶段校验（最终阶段 deleted）。
 *
 * 历史事实：`legacyPublicApiInventory.json` 保留 Phase 1 冻结（任务 1.3）的旧导出证据
 * （`publicExports` / `legacyInternalModules`），该证据永久保留、不得抹除。文件另含显式
 * `phase` 与 `currentPublicExports` allowlist。
 *
 * 阶段语义：
 * - `frozen`：根入口仍是旧 API（本变更起点）。
 * - `root-switched`：7.1 根入口已切换为新 API，旧实现模块仍存在。
 * - `deleted`（当前）：8.1 已删除旧实现，断言历史 13 个模块全部不存在；根入口仍是
 *   新 API（`currentPublicExports`）。
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
const inventoryPath = path.join(currentDirectory, "legacyPublicApiInventory.json")
const indexPath = path.join(currentDirectory, "index.ts")

interface PublicApiInventoryEntry {
  name: string
  kind: "value" | "type"
  source?: string
  path?: string
  category?: string
  removalTask?: string
  note?: string
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
  phase: "frozen" | "root-switched" | "deleted"
  publicExports: PublicApiInventoryEntry[]
  currentPublicExports: PublicApiInventoryEntry[]
  legacyInternalModules: LegacyInternalModuleEntry[]
}

interface ParsedExport {
  name: string
  kind: "value" | "type"
  source?: string
}

/** 用 TypeScript AST 读取公共导出；未知形态必须报告，避免正则遗漏新增语法。 */
function extractExports(filePath: string): { exports: ParsedExport[]; failures: string[] } {
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
        results.push({ name: statement.exportClause.name.text, kind: "value", ...(source ? { source } : {}) })
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
      if (statement.isExportEquals) failures.push(`不支持 export = 形式: ${statement.getText(sourceFile)}`)
      else results.push({ name: "default", kind: "value" })
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
        if (ts.isIdentifier(declaration.name)) results.push({ name: declaration.name.text, kind: "value" })
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

const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as LegacyPublicApiInventory
const { exports: actualExports, failures: exportParseFailures } = extractExports(indexPath)

/** 导出身份包含 name/kind/source，锁定来源，防止用同名内部实现冒充。 */
function identity(entry: { name: string; kind: string; source?: string; path?: string }): string {
  return JSON.stringify({ name: entry.name, kind: entry.kind, source: entry.source ?? entry.path })
}

describe("legacy public API inventory：冻结证据 (Phase 1 task 1.3)", () => {
  it("冻结清单面向本变更且标记了移除任务", () => {
    expect(inventory.frozenForChange).toBe("migrate-to-tiptap-prosemirror")
    expect(inventory.removalTask).toBe("8.1")
    expect(inventory.publicApiTask).toBe("8.2")
  })

  it("冻结的旧导出与内部模块清单作为历史证据保留且无重复", () => {
    const names = inventory.publicExports.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
    expect(inventory.publicExports.length).toBeGreaterThan(0)
    for (const entry of inventory.publicExports) {
      expect(entry.name).toBeTruthy()
      expect(["value", "type"]).toContain(entry.kind)
      expect(entry.category).toBeTruthy()
      expect(entry.removalTask).toBeTruthy()
      expect(entry.note).toBeTruthy()
    }
  })
})

describe("根入口切换后的公共 API (task 7.1 / 8.1 / 8.2)", () => {
  it("phase 是显式已知阶段，当前为 deleted（旧实现已清理）", () => {
    expect(["frozen", "root-switched", "deleted"]).toContain(inventory.phase)
    expect(inventory.phase).toBe("deleted")
  })

  it("根入口导出精确等于当前 allowlist（含 source），未知语法失败", () => {
    expect(exportParseFailures).toEqual([])
    expect(actualExports.map(identity).sort()).toEqual(inventory.currentPublicExports.map(identity).sort())
  })

  it("旧导出不再从根入口出现（禁止回归）", () => {
    const actualNames = new Set(actualExports.map((entry) => entry.name))
    for (const entry of inventory.publicExports) {
      expect(actualNames.has(entry.name), `旧导出仍出现在根入口: ${entry.name}`).toBe(false)
    }
  })

  it("当前 allowlist 无重复且 value 恰为 runtime 八项", () => {
    const names = inventory.currentPublicExports.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
    expect(inventory.currentPublicExports.filter((entry) => entry.kind === "value")).toHaveLength(8)
  })

  it("历史 13 个旧实现模块在 deleted 阶段全部不存在", () => {
    expect(inventory.legacyInternalModules).toHaveLength(13)
    const remaining = inventory.legacyInternalModules.filter((moduleEntry) =>
      existsSync(path.join(projectRoot, moduleEntry.path))
    )
    if (inventory.phase === "deleted") {
      expect(remaining).toEqual([])
    } else {
      expect(remaining).toHaveLength(inventory.legacyInternalModules.length)
    }
  })
})
