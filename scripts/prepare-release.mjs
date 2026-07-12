import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const packageJsonPath = path.resolve(process.cwd(), "package.json")
const tagName = process.env.GITHUB_REF_NAME

if (!tagName) {
  throw new Error("GITHUB_REF_NAME is required for release preparation")
}

if (!tagName.startsWith("v")) {
  throw new Error(`Release tag must start with v. Received: ${tagName}`)
}

const releaseVersion = tagName.slice(1)

const packageJsonContent = await readFile(packageJsonPath, "utf8")
const packageJson = JSON.parse(packageJsonContent)

packageJson.version = releaseVersion

await writeFile(
  packageJsonPath,
  `${JSON.stringify(packageJson, null, 2)}\n`,
  "utf8"
)

const prereleaseSegment = releaseVersion.split("-")[1]
const npmTag = prereleaseSegment ? prereleaseSegment.split(".")[0] : "latest"

process.stdout.write(`version=${releaseVersion}\n`)
process.stdout.write(`npm_tag=${npmTag}\n`)
