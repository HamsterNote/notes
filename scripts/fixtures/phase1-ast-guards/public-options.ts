type HostEditorOptions = {
  extensions?: readonly unknown[]
}

// 该导出只存在于守卫夹具中，用于证明别名后的参数形状不会绕过公开 API 检查。
export function createEditor(options: HostEditorOptions): void {
  void options
}
