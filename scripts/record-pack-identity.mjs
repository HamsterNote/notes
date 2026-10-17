import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const tarball = process.argv[2] ?? "evidence/hamster-note-notes-3.1.0.tgz"
const sourceRef = process.argv[3] ?? "HEAD"
assert.equal(execFileSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" }).trim(), "", "Commit source before packing")
assert.equal(execFileSync("git", ["diff", "--name-only", sourceRef, "--", "src/lib", "package.json", "vite.config.ts", "scripts/sync-library-css.mjs"], { encoding: "utf8" }).trim(), "", "Packaged source must match the recorded commit")
const files = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n")
const read = (file) => execFileSync("tar", ["-xOzf", tarball, file], { maxBuffer: 32 * 1024 * 1024 })
const pkg = JSON.parse(read("package/package.json").toString())
assert.equal(pkg.version, "3.1.0")
for (const file of ["dist/index.js", "dist/index.cjs", "dist/index.d.ts", "dist/styles.css", "dist/formula.css"]) {
  assert(files.includes(`package/${file}`), `Missing ${file}`)
}
assert(files.some((file) => file.startsWith("package/dist/fonts/")))
assert(files.some((file) => file.startsWith("package/dist/lib/")))
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const identity = {
  sourceCommit: execFileSync("git", ["rev-parse", sourceRef], { encoding: "utf8" }).trim(),
  packageName: pkg.name, version: pkg.version, tarball, tarballSha256: sha256(readFileSync(tarball)),
  node: process.version,
  artifacts: Object.fromEntries(["index.js", "index.cjs", "index.d.ts", "styles.css", "formula.css"].map((name) => [name, sha256(read(`package/dist/${name}`))])),
  files
}
writeFileSync("evidence/pack-identity.json", JSON.stringify(identity, null, 2) + "\n")
console.log(JSON.stringify({ ...identity, files: `${files.length} files; complete list in pack-identity.json` }, null, 2))
