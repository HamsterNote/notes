import { copyFile, readdir } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const assetsDirectory = path.resolve(process.cwd(), "dist/assets")
const outputFilePath = path.resolve(process.cwd(), "dist/styles.css")

const assetEntries = await readdir(assetsDirectory)
const stylesheetFileName = assetEntries.find((entry) =>
  /^styles-.*\.css$/u.test(entry)
)

if (!stylesheetFileName) {
  throw new Error("Could not find the built library stylesheet in dist/assets")
}

await copyFile(path.join(assetsDirectory, stylesheetFileName), outputFilePath)
