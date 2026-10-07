/**
 * 校验 TipTap / ProseMirror 依赖锁版约束（OpenSpec 变更 migrate-to-tiptap-prosemirror D5）。
 *
 * 该脚本是可重复执行的依赖校验，检查：
 * 1. package.json 中所有直接 `@tiptap/*` 依赖都使用精确版本（不允许 `^` / `~` / range）。
 * 2. 所有直接 `@tiptap/*` 依赖版本完全一致（单一 TipTap 版本）。
 * 3. 不直接声明任何 `prosemirror-*` 依赖（ProseMirror 只能经由 `@tiptap/pm` 单一入口）。
 * 4. yarn.lock 中每个 `@tiptap/*` 必须解析为同一个期望版本；`prosemirror-*`
 *    仍只能解析出唯一版本（无多份副本）。
 *
 * 用法：`yarn verify:tiptap-deps`
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"

// 期望锁定的 TipTap 精确版本；与 tasks.md 1.1 保持一致。
const EXPECTED_TIPTAP_VERSION = "3.31.3"

// 必须存在的直接 TipTap 依赖（1.1 指定集合）。
const REQUIRED_TIPTAP_PACKAGES = [
  "@tiptap/core",
  "@tiptap/react",
  "@tiptap/pm",
  "@tiptap/starter-kit",
  "@tiptap/extension-list",
  "@tiptap/extension-table"
]

// 会被校验的直接依赖分区。
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
]

// 精确版本格式：x.y.z（可带 prerelease 等后缀，但不含比较运算符）。
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u

const projectRoot = process.cwd()
const packageJsonPath = path.join(projectRoot, "package.json")
const lockfilePath = path.join(projectRoot, "yarn.lock")

/** 收集所有依赖分区中声明过的依赖名与版本。 */
function collectDirectDependencies(packageJson) {
  const entries = []
  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = packageJson[section]
    if (!dependencies || typeof dependencies !== "object") continue
    for (const [name, version] of Object.entries(dependencies)) {
      entries.push({ section, name, version })
    }
  }
  return entries
}

/**
 * 解析 yarn v1 lockfile，返回 Map<包名, Set<解析到的版本>>。
 *
 * lockfile 顶层键形如：
 *   "@tiptap/core@3.31.3":
 *   "@tiptap/core@^3.0.0", "@tiptap/core@^3.31.0":
 * 其下缩进行 `version "x.y.z"` 为该条目解析后的版本。
 */
function parseLockfileVersions(lockfileText) {
  const versionsByName = new Map()
  let currentDescriptors = []

  const addVersion = (name, version) => {
    if (!versionsByName.has(name)) versionsByName.set(name, new Set())
    versionsByName.get(name).add(version)
  }

  for (const rawLine of lockfileText.split("\n")) {
    const line = rawLine.replace(/\r$/u, "")
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue

    if (!/^\s/u.test(line)) {
      // 顶层键行：去掉末尾冒号，按逗号拆分 descriptors。
      const key = line.trim().replace(/:$/u, "")
      currentDescriptors = key
        .split(",")
        .map((descriptor) => descriptor.trim().replace(/^"|"$/gu, ""))
        .filter(Boolean)
      continue
    }

    const versionMatch = /^\s+version\s+"([^"]+)"/u.exec(line)
    if (!versionMatch) continue
    const version = versionMatch[1]
    for (const descriptor of currentDescriptors) {
      const name = extractPackageName(descriptor)
      if (name) addVersion(name, version)
    }
  }

  return versionsByName
}

/** 从 `name@range` / `@scope/name@range` 描述符中提取包名。 */
function extractPackageName(descriptor) {
  const atIndex = descriptor.lastIndexOf("@")
  // 无 `@` 或仅存在作用域起始 `@`（如 `@scope/name`）时视为异常，忽略。
  if (atIndex <= 0) return null
  return descriptor.slice(0, atIndex)
}

const failures = []

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
const directDependencies = collectDirectDependencies(packageJson)
const directTiptap = directDependencies.filter((entry) =>
  entry.name.startsWith("@tiptap/")
)
const directProseMirror = directDependencies.filter((entry) =>
  entry.name.startsWith("prosemirror-")
)

// 1. 直接 @tiptap/* 依赖必须存在且为精确版本。
for (const required of REQUIRED_TIPTAP_PACKAGES) {
  const entry = directTiptap.find((candidate) => candidate.name === required)
  if (!entry) {
    failures.push(`缺少直接依赖 ${required}（应锁定 ${EXPECTED_TIPTAP_VERSION}）`)
    continue
  }
  if (!EXACT_VERSION_PATTERN.test(entry.version)) {
    failures.push(
      `${required} 使用了非精确版本 "${entry.version}"（禁止 ^ / ~ / range）`
    )
  }
}

// 2. 所有直接 @tiptap/* 版本必须完全一致。
const distinctVersions = new Set(directTiptap.map((entry) => entry.version))
if (distinctVersions.size > 1) {
  failures.push(
    `直接 @tiptap/* 依赖版本不一致: ${[...distinctVersions].join(", ")}`
  )
}
for (const entry of directTiptap) {
  if (entry.version !== EXPECTED_TIPTAP_VERSION) {
    failures.push(
      `${entry.name} 版本为 "${entry.version}"，期望 ${EXPECTED_TIPTAP_VERSION}`
    )
  }
}

// 3. 禁止直接声明 prosemirror-* 依赖。
for (const entry of directProseMirror) {
  failures.push(
    `禁止直接声明 prosemirror 依赖 ${entry.name}（应仅通过 @tiptap/pm 引入）`
  )
}

// 4. 锁文件是最终解析结果：每个 TipTap 子包都必须精确解析到直接依赖的单一 pin。
const lockfileText = readFileSync(lockfilePath, "utf8")
const lockfileVersions = parseLockfileVersions(lockfileText)
const lockedTiptap = [...lockfileVersions.entries()].filter(([name]) =>
  name.startsWith("@tiptap/")
)
const lockedProseMirror = [...lockfileVersions.entries()].filter(([name]) =>
  name.startsWith("prosemirror-")
)
const lockedTiptapAndProseMirror = [...lockedTiptap, ...lockedProseMirror]

if (lockedTiptap.length === 0) {
  failures.push(
    "yarn.lock 中未发现 @tiptap/* 条目，请先执行 yarn install"
  )
}

for (const [name, versionSet] of lockedTiptap) {
  if (versionSet.size !== 1) {
    failures.push(
      `${name} 在 yarn.lock 中解析出多个版本: ${[...versionSet].join(", ")}`
    )
    continue
  }

  const [resolvedVersion] = versionSet
  if (resolvedVersion !== EXPECTED_TIPTAP_VERSION) {
    failures.push(
      `${name} 在 yarn.lock 中解析为 "${resolvedVersion}"，期望 ${EXPECTED_TIPTAP_VERSION}`
    )
  }
}

// ProseMirror 由 @tiptap/pm 间接管理；只允许每个包一个解析版本。
for (const [name, versionSet] of lockedProseMirror) {
  if (versionSet.size !== 1) {
    failures.push(
      `${name} 在 yarn.lock 中解析出多个版本: ${[...versionSet].join(", ")}`
    )
  }
}

// 输出概要，便于人工核对。
process.stdout.write("TipTap 依赖校验:\n")
process.stdout.write(
  `  直接 @tiptap/*: ${directTiptap.length} 个，版本 = ${[
    ...distinctVersions
  ].join(", ")}\n`
)
process.stdout.write(
  `  yarn.lock 中 @tiptap/* + prosemirror-* 条目: ${lockedTiptapAndProseMirror.length} 个\n`
)
for (const [name, versionSet] of lockedTiptapAndProseMirror.sort((a, b) =>
  a[0].localeCompare(b[0])
)) {
  process.stdout.write(`    ${name} -> ${[...versionSet].join(", ")}\n`)
}

if (failures.length > 0) {
  process.stderr.write("\nTipTap 依赖校验失败:\n")
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`)
  process.exit(1)
}

process.stdout.write("\nTipTap 依赖校验通过。\n")
