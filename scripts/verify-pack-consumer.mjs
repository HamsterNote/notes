import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { chromium } from "playwright"

const tarball = path.resolve(process.argv[2] ?? "evidence/hamster-note-notes-3.1.0.tgz")
const consumer = path.resolve("../pack-consumer")
if (existsSync(consumer)) throw new Error("Consumer directory must be absent: use a new clean checkout for a repeat")
mkdirSync(consumer)
cpSync("scripts/fixtures/pack-consumer", consumer, { recursive: true })
cpSync("evidence/baseline/consumer.tsx", path.join(consumer, "legacy-consumer.tsx"))
writeFileSync(path.join(consumer, "package.json"), JSON.stringify({
  name: "notes-pack-consumer", private: true, type: "module", packageManager: "yarn@1.22.22",
  scripts: { typecheck: "tsc --noEmit", build: "vite build" },
  dependencies: { "@hamster-note/notes": `file:${tarball}`, react: "19.0.0", "react-dom": "19.0.0" },
  devDependencies: { "@types/react": "^19.1.8", "@types/react-dom": "^19.1.6", typescript: "6.0.0-beta", vite: "^7.0.4", jsdom: "^29.1.1" }
}, null, 2))
const run = (label, command, args) => {
  const result = spawnSync(command, args, { cwd: consumer, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
  writeFileSync(`evidence/consumer-${label}.log`, `exit: ${result.status}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`)
  assert.equal(result.status, 0, `${label} failed; inspect evidence/consumer-${label}.log`)
  console.log(label, "exit 0")
  return result.stdout
}
run("install", "corepack", ["yarn", "install", "--non-interactive"])
const root = path.join(consumer, "node_modules/@hamster-note/notes")
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
assert.equal(pkg.version, "3.1.0")
const baseline = JSON.parse(readFileSync("evidence/baseline/inventory.json", "utf8"))
const runtime = baseline.exports.filter((entry) => entry.kind === "value").map((entry) => entry.name)
const expected = [...runtime, "NoteDocumentProvider", "NoteEditorView"].sort()
const esm = run("esm", "node", ["runtime.mjs", "esm"])
const cjs = run("cjs", "node", ["runtime.mjs", "cjs"])
assert.deepEqual(JSON.parse(esm), expected)
assert.deepEqual(JSON.parse(cjs), expected)
run("typecheck", "corepack", ["yarn", "typecheck"])
run("build", "corepack", ["yarn", "build"])
const { preview } = await import(pathToFileURL(path.join(consumer, "node_modules/vite/dist/node/index.js")).href)
const server = await preview({ root: consumer, preview: { host: "127.0.0.1", port: 0 } })
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(server.resolvedUrls.local[0])
  const left = page.locator('[data-view-id="left"] .tiptap')
  const right = page.locator('[data-view-id="right"] .tiptap')
  await left.click(); await page.keyboard.press("Control+Home"); await page.keyboard.type("new ")
  await page.waitForFunction(() => document.querySelector('[data-view-id="right"] .tiptap p')?.textContent === "new package body")
  await page.locator('[data-view-id="right"]').getByRole("button", { name: "保存", exact: true }).click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("pack-save") ?? "null")?.document.data.content[0].content[0].text === "new package body")
  assert.equal(await right.locator("p").textContent(), "new package body")
  const legacy = page.locator("#legacy")
  await legacy.locator(".tiptap").click(); await page.keyboard.press("Control+Home"); await page.keyboard.type("old ")
  await legacy.getByRole("button", { name: "保存", exact: true }).click()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("legacy-save") ?? "null")?.baseRevision === "r1")
  assert.deepEqual(errors, [])
  await page.screenshot({ path: "evidence/consumer.png", fullPage: true })
  console.log("consumer browser", browser.version(), "new Provider/dual View/save + legacy NoteSave/revision PASS")
} finally { await browser.close(); await new Promise((resolve) => server.httpServer.close(resolve)) }
writeFileSync("evidence/consumer-identity.json", JSON.stringify({
  packageVersion: pkg.version, tarballSha256: createHash("sha256").update(readFileSync(tarball)).digest("hex"),
  runtime: expected, installedResolution: JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).name,
  consumerLockfile: readFileSync(path.join(consumer, "yarn.lock"), "utf8"),
  evidence: ["install", "esm", "cjs", "typecheck", "build"].map((name) => `consumer-${name}.log`)
}, null, 2) + "\n")
console.log("independent consumer PASS: no source aliases, private imports, or patches")
