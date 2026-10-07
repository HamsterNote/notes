import type { HnnDocument } from "../lib"

/**
 * 7.4 demo 手写 fixture：直接以新 codec 的 HNN 节点结构书写（不迁移旧 NoteBlock），
 * 覆盖公式 / picture / list / table / callout / collapsible / directory / card /
 * drawing / mention / resource / externalItem，供多文档切换与导出诊断演示。
 * 所有持久 nodeId 都是合法小写 UUID v4（codec 强校验）。
 */

let fixtureIdCounter = 0
/** 生成 fixture 内唯一、合法的小写 UUID v4 nodeId。 */
const nid = (): string =>
  `00000000-0000-4000-8000-${String(++fixtureIdCounter).padStart(12, "0")}`

type JsonObject = Record<string, unknown>

const text = (value: string, marks?: readonly JsonObject[]): JsonObject =>
  marks === undefined ? { type: "text", text: value } : { type: "text", text: value, marks }

const paragraph = (...content: readonly JsonObject[]): JsonObject => ({
  type: "paragraph",
  attrs: { nodeId: nid() },
  content
})

const heading = (level: number, ...content: readonly JsonObject[]): JsonObject => ({
  type: "heading",
  attrs: { nodeId: nid(), level },
  content
})

/** 列表/引用等容器内的段落（每个节点同样需要持久 nodeId）。 */
const innerParagraph = (value: string): JsonObject => paragraph(text(value))

const listItem = (...blocks: readonly JsonObject[]): JsonObject => ({
  type: "listItem",
  attrs: { nodeId: nid() },
  content: blocks
})

const tableCell = (type: "tableHeader" | "tableCell", align: "left" | "center", value: string): JsonObject => ({
  type,
  attrs: { nodeId: nid(), colspan: 1, rowspan: 1, colwidth: null, align },
  content: [innerParagraph(value)]
})

const tableRow = (...cells: readonly JsonObject[]): JsonObject => ({
  type: "tableRow",
  attrs: { nodeId: nid() },
  content: cells
})

const documentOf = (...content: readonly JsonObject[]): HnnDocument => ({
  schemaVersion: 1,
  data: { type: "doc", content }
})

/** 新建空文档的 canonical 结构：空段落必须省略 content 字段。 */
export function emptyDocument(nodeId: string): HnnDocument {
  return { schemaVersion: 1, data: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId } }] } }
}

/* ===== 文档一：功能巡览（覆盖绝大多数自定义块） ===== */

const tourDocument = documentOf(
  heading(1, text("编辑器功能巡览")),
  paragraph(
    text("这份文档是"),
    text("手写 HNN fixture", [{ type: "bold" }]),
    text("，经严格 codec 校验后载入；编辑后点保存，宿主会以 "),
    text("CAS revision", [{ type: "code" }]),
    text(" 真实比较后写入 localStorage。详见 "),
    text("宿主集成契约", [{ type: "link", attrs: { href: "https://example.test/spec" } }]),
    text("。")
  ),
  { type: "callout", attrs: { nodeId: nid(), tone: "info", title: "演示说明" }, content: [innerParagraph("侧边栏可切换文档、模拟另一客户端制造 CAS 冲突、查看已存 HNN 与宿主事件。")] },
  heading(2, text("列表与待办")),
  {
    type: "bulletList",
    attrs: { nodeId: nid() },
    content: [listItem(innerParagraph("无序列表项：块结构与旧 NoteBlock 无关")), listItem(innerParagraph("支持嵌套与拖拽重排"))]
  },
  {
    type: "taskList",
    attrs: { nodeId: nid() },
    content: [
      { type: "taskItem", attrs: { nodeId: nid(), checked: true }, content: [innerParagraph("迁移到 TipTap/ProseMirror")] },
      { type: "taskItem", attrs: { nodeId: nid(), checked: false }, content: [innerParagraph("完成真实浏览器验收")] }
    ]
  },
  heading(2, text("表格")),
  {
    type: "table",
    attrs: { nodeId: nid() },
    content: [
      tableRow(tableCell("tableHeader", "center", "能力"), tableCell("tableHeader", "center", "状态"), tableCell("tableHeader", "center", "备注")),
      tableRow(tableCell("tableCell", "left", "HNN 保存"), tableCell("tableCell", "left", "默认"), tableCell("tableCell", "left", "严格校验")),
      tableRow(tableCell("tableCell", "left", "Markdown"), tableCell("tableCell", "left", "显式导出"), tableCell("tableCell", "left", "降级需确认"))
    ]
  },
  heading(2, text("引用与代码")),
  { type: "blockquote", attrs: { nodeId: nid(), author: "设计笔记" }, content: [innerParagraph("可读性不止于 Markdown 支持，更在于节奏、对比与重要细节的留存。")] },
  { type: "codeBlock", attrs: { nodeId: nid(), language: "ts", filename: "save.ts" }, content: [{ type: "text", text: "const result = await onSave(snapshot, { documentId, baseRevision, signal })" }] },
  heading(2, text("公式")),
  paragraph(text("行内公式 "), { type: "inlineFormula", attrs: { nodeId: nid(), latex: "e^{i\\pi}+1=0" } }, text(" 与块级公式：")),
  { type: "formula", attrs: { nodeId: nid(), latex: "\\int_a^b x^2\\,dx = \\frac{b^3-a^3}{3}" } },
  heading(2, text("更多块")),
  { type: "collapsible", attrs: { nodeId: nid(), title: "折叠块：实现细节", collapsed: false }, content: [innerParagraph("折叠块内容仅在展开时可见，可拖拽排序。")] },
  { type: "picture", attrs: { nodeId: nid(), src: "https://picsum.photos/seed/hamster-tour/960/540", alt: "示例配图（持久 https 地址）" } },
  { type: "directory", attrs: { nodeId: nid(), config: "headings" } },
  {
    type: "card",
    attrs: {
      nodeId: nid(),
      data: JSON.stringify({
        schemaVersion: 1,
        cards: [
          { id: "card-release", title: "发布清单", content: "导出诊断、真实浏览器验收", x: 40, y: 40, width: 240, height: 160 },
          { id: "card-review", title: "设计走查", content: "840px 断点与暗色 token", x: 340, y: 120, width: 240, height: 160 }
        ]
      })
    }
  },
  { type: "drawing", attrs: { nodeId: nid(), data: '{"strokes":[],"schemaVersion":2}' } },
  { type: "horizontalRule", attrs: { nodeId: nid() } },
  paragraph(text("试试输入 "), text("@", [{ type: "code" }]), text(" 或 "), text("[[", [{ type: "code" }]), text(" 唤起引用候选，或拖入一张图片体验上传占位与重试。"))
)

/* ===== 文档二：引用与外部条目（含失效引用占位演示） ===== */

const referencesDocument = documentOf(
  heading(1, text("引用与外部条目")),
  paragraph(
    text("在正文中输入 "), text("@", [{ type: "code" }]), text(" 唤起成员候选、输入 "),
    text("[[", [{ type: "code" }]), text(" 唤起文档候选；点击引用，或用 Tab 聚焦后按 Enter 激活（事件记录在侧边栏）。")
  ),
  paragraph(
    text("本周与 "),
    { type: "mention", attrs: { nodeId: nid(), resourceId: "u-lin", name: "林晚" } },
    text(" 和 "),
    { type: "mention", attrs: { nodeId: nid(), resourceId: "u-ghost", name: "已注销成员" } },
    text(" 对齐了进度；后者已从成员目录移除，解析失败以占位呈现。")
  ),
  paragraph(
    text("模板参考 "),
    { type: "resource", attrs: { nodeId: nid(), resourceId: "n-weekly", name: "周报模板" } },
    text("，旧文档 "),
    { type: "resource", attrs: { nodeId: nid(), resourceId: "n-lost", name: "已删除的文档" } },
    text(" 已被清理，同样只剩占位。")
  ),
  { type: "externalItem", attrs: { nodeId: nid(), resourceId: "ext-1", name: "Figma · 编辑器视觉稿" } },
  { type: "externalItem", attrs: { nodeId: nid(), resourceId: "ext-lost", name: "已失效的外部条目" } },
  { type: "callout", attrs: { nodeId: nid(), tone: "warning", title: "失效引用" }, content: [innerParagraph("「已注销成员」「已删除的文档」「已失效的外部条目」都不在宿主解析表中，用于演示 loading / missing 占位，不会写入文档。")] }
)

/* ===== 文档三：周会纪要（Markdown 导出与降级诊断演示） ===== */

const meetingDocument = documentOf(
  heading(1, text("周会纪要 · 2026-10-02")),
  paragraph(text("GFM 可表达的内容导出无诊断；卡片等私有块会产出降级诊断，需在导出界面确认后才写出。")),
  {
    type: "bulletList",
    attrs: { nodeId: nid() },
    content: [listItem(innerParagraph("HNN codec 全量回归通过")), listItem(innerParagraph("演示宿主接入 localStorage CAS")), listItem(innerParagraph("下周：真实浏览器走查"))]
  },
  {
    type: "table",
    attrs: { nodeId: nid() },
    content: [
      tableRow(tableCell("tableHeader", "center", "负责人"), tableCell("tableHeader", "center", "事项")),
      tableRow(tableCell("tableCell", "left", "林晚"), tableCell("tableCell", "left", "视觉走查")),
      tableRow(tableCell("tableCell", "left", "沈策"), tableCell("tableCell", "left", "演示宿主收尾"))
    ]
  },
  { type: "callout", attrs: { nodeId: nid(), tone: "success", title: "结论" }, content: [innerParagraph("按计划在周五前冻结公开 API。")] },
  {
    type: "card",
    attrs: {
      nodeId: nid(),
      data: JSON.stringify({
        schemaVersion: 1,
        cards: [{ id: "card-actions", title: "行动项", content: "真实浏览器验收 · 发布说明", x: 40, y: 40, width: 260, height: 160 }]
      })
    }
  },
  paragraph(text("点击编辑器下方的「导出 Markdown」，观察诊断确认流程；未确认前宿主绝不落盘。"))
)

/* ===== fixture 注册表与引用数据 ===== */

export interface DemoFixture {
  readonly documentId: string
  readonly title: string
  readonly document: HnnDocument
}

/** 侧边栏文档切换的内置 fixture（顺序即展示顺序）。 */
export const demoFixtures: readonly DemoFixture[] = [
  { documentId: "demo-tour", title: "功能巡览", document: tourDocument },
  { documentId: "demo-references", title: "引用与外部条目", document: referencesDocument },
  { documentId: "demo-export", title: "周会纪要（导出演示）", document: meetingDocument }
]

export interface DemoReferenceCandidate {
  readonly resourceId: string
  readonly name: string
}

/** @ 候选（成员目录）与 [[ 候选（文档目录）。 */
export const demoMentionCandidates: readonly DemoReferenceCandidate[] = [
  { resourceId: "u-lin", name: "林晚" },
  { resourceId: "u-shen", name: "沈策" },
  { resourceId: "u-ada", name: "Ada Wong" },
  { resourceId: "u-qiao", name: "乔安" }
]

export const demoResourceCandidates: readonly DemoReferenceCandidate[] = [
  { resourceId: "n-weekly", name: "周报模板" },
  { resourceId: "n-roadmap", name: "产品路线图" },
  { resourceId: "n-handbook", name: "团队手册" }
]

export interface DemoReferenceResolution {
  readonly label: string
  readonly description?: string
}

/**
 * 宿主解析表：key 为 `${kind}:${resourceId}`。fixture 中的 u-ghost / n-lost /
 * ext-lost 刻意缺席，命中 null → 编辑器以失效占位呈现。
 */
export const demoReferenceResolutions: Readonly<Record<string, DemoReferenceResolution>> = {
  "mention:u-lin": { label: "林晚", description: "产品设计师" },
  "mention:u-shen": { label: "沈策", description: "前端工程师" },
  "mention:u-ada": { label: "Ada Wong", description: "技术写作" },
  "mention:u-qiao": { label: "乔安", description: "项目经理" },
  "resource:n-weekly": { label: "周报模板", description: "文档 · 更新于 2026-09-28" },
  "resource:n-roadmap": { label: "产品路线图", description: "文档 · 2026 Q4" },
  "resource:n-handbook": { label: "团队手册", description: "内部文档" },
  "externalItem:ext-1": { label: "Figma · 编辑器视觉稿", description: "外部设计稿" },
  "externalItem:ext-jira": { label: "JIRA NOTE-1234", description: "外部任务" }
}
