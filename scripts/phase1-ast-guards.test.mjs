import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import {
  findBareProseMirrorReferences,
  inspectPublicApi
} from "./phase1-ast-guards.mjs"

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

function scan(source) {
  return findBareProseMirrorReferences(
    ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true)
  )
}

test("rejects bare ProseMirror ImportTypeNode and ImportEqualsDeclaration", () => {
  const references = scan(`
    type ProseMirrorNode = import("prosemirror-model").Node
    import PM = require("prosemirror-state")
    void PM
    void (null as unknown as ProseMirrorNode)
  `)

  assert.deepEqual(
    references.map(({ packageName, form }) => ({ packageName, form })),
    [
      { packageName: "prosemirror-model", form: "import type()" },
      { packageName: "prosemirror-state", form: "import = require()" }
    ]
  )
})

test("resolves local aliases in public function parameter types", () => {
  const fixturePath = path.join(
    currentDirectory,
    "fixtures/phase1-ast-guards/public-options.ts"
  )
  const result = inspectPublicApi(fixturePath)

  assert.equal(result.publicExportCount, 1)
  assert.ok(result.failures.some((failure) => failure.includes("extensions")))
})
