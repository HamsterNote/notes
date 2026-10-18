import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import ts from "typescript"

const commit = "2b4a2bfc7e48f4a5bd5845fb251dc24e903e254c"
const original = (path) => execFileSync("git", ["show", `${commit}:${path}`], { encoding: "utf8" })
mkdirSync("evidence/baseline", { recursive: true })
const source = ts.createSourceFile("index.ts", original("src/lib/index.ts"), ts.ScriptTarget.Latest, true)
const exports = source.statements.filter(ts.isExportDeclaration).flatMap((statement) =>
  statement.exportClause.elements.map((item) => ({
    name: item.name.text,
    kind: statement.isTypeOnly || item.isTypeOnly ? "type" : "value",
    source: statement.moduleSpecifier.text
  }))
)
const pkg = JSON.parse(original("package.json"))
const declaration = readFileSync("dist/index.d.ts")
writeFileSync("evidence/baseline/inventory.json", JSON.stringify({
  commit, version: pkg.version, exports, packageExports: pkg.exports,
  declarationSha256: createHash("sha256").update(declaration).digest("hex")
}, null, 2) + "\n")
writeFileSync("evidence/baseline/index.d.ts", declaration)
for (const file of ["publicApi.test.tsx", "publicApi.types.test.tsx"]) {
  writeFileSync(`evidence/baseline/${file}.txt`, original(`src/lib/${file}`))
}
