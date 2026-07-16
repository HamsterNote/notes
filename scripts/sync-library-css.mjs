import { copyFile, cp, readdir } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const assetsDirectory = path.resolve(process.cwd(), "dist/assets")
const outputFilePath = path.resolve(process.cwd(), "dist/styles.css")
const formulaSourcePath = path.resolve(
  process.cwd(),
  "node_modules/katex/dist/katex.min.css"
)
const formulaOutputPath = path.resolve(process.cwd(), "dist/formula.css")
const formulaFontsSourcePath = path.resolve(
  process.cwd(),
  "node_modules/katex/dist/fonts"
)
const formulaFontsOutputPath = path.resolve(process.cwd(), "dist/fonts")

const assetEntries = await readdir(assetsDirectory)
const stylesheetFileName = assetEntries.find((entry) =>
  /^styles-.*\.css$/u.test(entry)
)

if (!stylesheetFileName) {
  throw new Error("Could not find the built library stylesheet in dist/assets")
}

await copyFile(path.join(assetsDirectory, stylesheetFileName), outputFilePath)
await copyFile(formulaSourcePath, formulaOutputPath)
await cp(formulaFontsSourcePath, formulaFontsOutputPath, { recursive: true })
