/**
 * Phase 1 可复用的 TypeScript AST / 类型系统守卫。
 *
 * 此模块没有脚本入口，供两个验证脚本和聚焦测试共享，确保所有裸 ProseMirror
 * 模块引用以同一套规则被拒绝。公开 API 检查只读取声明和类型信息，不进入实现体。
 */
import ts from "typescript"

function isBareProseMirror(packageName) {
  return packageName.startsWith("prosemirror-")
}

function stringModuleSpecifier(node) {
  return ts.isStringLiteral(node) ? node.text : undefined
}

/**
 * 找出所有绕过 @tiptap/pm 的裸 ProseMirror 模块引用。
 * 包含 ESM import/re-export、import type()、import = require()、CommonJS require
 * 与动态 import()；@tiptap/pm/* 不满足 `prosemirror-` 前缀，天然允许。
 */
export function findBareProseMirrorReferences(sourceFile) {
  const matches = []
  const record = (packageName, form, node) => {
    if (isBareProseMirror(packageName)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      matches.push({
        packageName,
        form,
        line: position.line + 1,
        column: position.character + 1
      })
    }
  }
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      const packageName = stringModuleSpecifier(node.moduleSpecifier)
      if (packageName) record(packageName, ts.isImportDeclaration(node) ? "import" : "re-export", node)
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument
      const packageName = ts.isLiteralTypeNode(argument)
        ? stringModuleSpecifier(argument.literal)
        : undefined
      if (packageName) record(packageName, "import type()", node)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const packageName = node.moduleReference.expression
        ? stringModuleSpecifier(node.moduleReference.expression)
        : undefined
      if (packageName) record(packageName, "import = require()", node)
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require"
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      if (isRequire || isDynamicImport) {
        record(node.arguments[0].text, isRequire ? "require()" : "dynamic import()", node)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return matches
}

function promisesHostCustomization(name) {
  return (
    /^(?:add|register|provide|configure|create|set|with|custom|host|editor|tiptap)?(?:extensions?|schema)$/iu.test(
      name
    ) ||
    /^(?:extensions?|schema)(?:config|configuration|options|factory|builder|provider|registry)$/iu.test(
      name
    )
  )
}

function declarationLocation(declaration) {
  const sourceFile = declaration.getSourceFile()
  const position = sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile))
  return `${sourceFile.fileName}:${position.line + 1}:${position.character + 1}`
}

/**
 * 使用 TypeChecker 展开 index.ts 的每个公开符号。它会追随本地类型别名、re-export
 * 别名及命名空间成员，并枚举所有 call/construct overload。任何无法解析的出口或
 * 类型会形成可操作失败，而非静默放过宿主 schema/extensions 注入契约。
 */
export function inspectPublicApi(indexFilePath) {
  const sourceRoot = ts.sys.resolvePath(
    `${ts.getDirectoryPath(indexFilePath)}/..`
  )
  const program = ts.createProgram({
    rootNames: [indexFilePath],
    options: {
      strict: true,
      target: ts.ScriptTarget.ES2024,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      skipLibCheck: true,
      // index.ts 以副作用方式 import "./styles.css"；加载 vite/client 提供 *.css 声明。
      types: ["vite/client"]
    }
  })
  const sourceFile = program.getSourceFile(indexFilePath)
  if (!sourceFile) {
    return { publicExportCount: 0, failures: [`无法读取公共入口 ${indexFilePath}`] }
  }

  const checker = program.getTypeChecker()
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  if (!moduleSymbol) {
    return { publicExportCount: 0, failures: [`无法解析公共入口模块 ${indexFilePath}`] }
  }

  const failures = []
  const rootExports = checker.getExportsOfModule(moduleSymbol)
  const rootExportNames = new Set(rootExports.map((symbol) => symbol.name))
  const seenSymbols = new Set()
  const seenTypes = new Set()
  const fail = (path, message) => failures.push(`${path}: ${message}`)

  // TypeChecker 会解析 re-export 链；若语义解析本身失败，守卫不能把不完整类型当作安全。
  for (const diagnostic of [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile)
  ]) {
    fail(
      "公共 API",
      `无法完整解析入口: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`
    )
  }
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && statement.isExportEquals) {
      fail("公共 API", "不支持 export =；无法枚举其公开类型契约")
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals && !rootExportNames.has("default")) {
      fail("公共 API", "默认导出未能由 TypeChecker 解析")
    }
    if (ts.isExportDeclaration(statement) && ts.isNamespaceExport(statement.exportClause)) {
      if (!rootExportNames.has(statement.exportClause.name.text)) {
        fail("公共 API", `命名空间导出 ${statement.exportClause.name.text} 未能由 TypeChecker 解析`)
      }
    }
  }

  const isProjectDeclaration = (declaration) =>
    ts.sys.resolvePath(declaration.getSourceFile().fileName).startsWith(`${sourceRoot}/`)

  const isTerminalType = (type) =>
    Boolean(
      type.flags &
        (ts.TypeFlags.Any |
          ts.TypeFlags.Unknown |
          ts.TypeFlags.StringLike |
          ts.TypeFlags.NumberLike |
          ts.TypeFlags.BooleanLike |
          ts.TypeFlags.BigIntLike |
          ts.TypeFlags.ESSymbolLike |
          ts.TypeFlags.VoidLike |
          ts.TypeFlags.Null |
          ts.TypeFlags.Never)
    )

  const resolveAlias = (symbol, path) => {
    let resolved = symbol
    const aliases = new Set()
    while (resolved.flags & ts.SymbolFlags.Alias) {
      if (aliases.has(resolved)) {
        fail(path, `别名循环，无法解析 ${symbol.name}`)
        return undefined
      }
      aliases.add(resolved)
      resolved = checker.getAliasedSymbol(resolved)
      if (!resolved || resolved.flags & ts.SymbolFlags.Unknown) {
        fail(path, `无法解析别名 ${symbol.name}`)
        return undefined
      }
    }
    return resolved
  }

  const inspectType = (type, path) => {
    if (!type) {
      fail(path, "无法解析公开类型")
      return
    }
    if (seenTypes.has(type)) return
    seenTypes.add(type)
    if (isTerminalType(type)) {
      // any 会完全绕过封闭契约，必须拒绝；unknown 是不透明的不可信输入（如初始 HNN
      // `initialDocument`），静态上无法访问 schema/extensions，允许作为受控输入类型。
      if (type.flags & ts.TypeFlags.Any) {
        fail(path, "公开类型为 any，无法证明未隐藏 schema/extensions 注入契约")
      }
      return
    }

    // 标准库与第三方声明不属于本包能定义的注入入口，且递归其完整成员会使 Array /
    // String 等内建 API 无限扩大。仍检查外部类型的直接属性和签名名称，以免公开
    // 参数直接引用带 `extensions`/`schema` 字段的外部 Options 类型时被绕过。
    const declarations = type.aliasSymbol?.declarations ?? type.symbol?.declarations
    const isExternalType = declarations?.length && !declarations.some(isProjectDeclaration)

    for (const property of checker.getPropertiesOfType(type)) {
      const propertyPath = `${path}.${property.name}`
      if (isExternalType) {
        if (promisesHostCustomization(property.name)) {
          fail(propertyPath, `外部公开类型以 ${property.name} 承诺宿主自定义 schema/extensions`)
        }
      } else {
        inspectSymbol(property, propertyPath)
      }
    }
    for (const signature of checker.getSignaturesOfType(type, ts.SignatureKind.Call)) {
      if (isExternalType) inspectExternalSignature(signature, `${path}()`)
      else inspectSignature(signature, `${path}()`)
    }
    for (const signature of checker.getSignaturesOfType(type, ts.SignatureKind.Construct)) {
      if (isExternalType) inspectExternalSignature(signature, `new ${path}()`)
      else inspectSignature(signature, `new ${path}()`)
    }
    if (type.isUnionOrIntersection()) {
      for (const member of type.types) inspectType(member, path)
    }
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      const reference = type
      for (const argument of checker.getTypeArguments(reference)) inspectType(argument, path)
    }
  }

  const inspectSignature = (signature, path) => {
    for (const parameter of signature.getParameters()) {
      inspectSymbol(parameter, `${path}.${parameter.name}`)
    }
    inspectType(checker.getReturnTypeOfSignature(signature), `${path}.return`)
  }

  const inspectExternalSignature = (signature, path) => {
    for (const parameter of signature.getParameters()) {
      if (promisesHostCustomization(parameter.name)) {
        fail(path, `外部公开签名参数 ${parameter.name} 承诺宿主自定义 schema/extensions`)
      }
    }
  }

  const inspectSymbol = (symbol, path) => {
    if (seenSymbols.has(symbol)) return
    seenSymbols.add(symbol)
    if (promisesHostCustomization(symbol.name)) {
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
      fail(path, `公开名称 ${symbol.name} 承诺宿主自定义 schema/extensions${declaration ? ` (${declarationLocation(declaration)})` : ""}`)
    }
    const resolved = resolveAlias(symbol, path)
    if (!resolved) return
    const declaration = resolved.valueDeclaration ?? resolved.declarations?.[0]
    if (!declaration) {
      fail(path, `无法取得公开符号 ${resolved.name} 的声明`)
      return
    }
    if (resolved.flags & ts.SymbolFlags.NamespaceModule) {
      const namespaceExports = checker.getExportsOfModule(resolved)
      if (namespaceExports.length === 0) {
        fail(path, `无法枚举命名空间导出 ${resolved.name}`)
        return
      }
      for (const member of namespaceExports) inspectSymbol(member, `${path}.${member.name}`)
      return
    }
    try {
      // 对类型别名应优先从 declared type 展开，避免 value-side 的 any 掩盖对象成员。
      if (resolved.flags & ts.SymbolFlags.Type) {
        inspectType(checker.getDeclaredTypeOfSymbol(resolved), path)
      } else {
        inspectType(checker.getTypeOfSymbolAtLocation(resolved, declaration), path)
      }
    } catch (error) {
      fail(path, `无法解析公开符号 ${resolved.name} 的类型: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const exported of rootExports) {
    inspectSymbol(exported, `公共 API ${exported.name}`)
  }
  return { publicExportCount: rootExports.length, failures }
}
