if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverMock
}

// ProseMirror 的视图层会读取这些浏览器几何 API；jsdom 未实现它们，但会话测试只需
// 稳定的空几何结果，不依赖真实布局。
if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects === "undefined") {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

if (typeof Range !== "undefined" && typeof Range.prototype.getBoundingClientRect === "undefined") {
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}
