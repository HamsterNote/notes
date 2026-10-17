import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"

const [label, command, ...args] = process.argv.slice(2)
if (!label || !command || !/^[a-z0-9-]+$/.test(label)) {
  throw new Error("Usage: node scripts/capture-check.mjs <label> <command> [...args]")
}
mkdirSync("evidence", { recursive: true })
const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
const exitCode = result.status ?? 1
writeFileSync(`evidence/${label}.log`, [
  `command: ${[command, ...args].join(" ")}`,
  `node: ${process.version}`,
  `exit: ${exitCode}`,
  result.stdout ?? "",
  result.stderr ?? "",
  result.error?.message ?? ""
].join("\n"))
console.log(`${label}: exit ${exitCode}; evidence/${label}.log`)
console.log((result.stdout ?? "").slice(-3500))
console.error((result.stderr ?? "").slice(-1500))
process.exitCode = exitCode
