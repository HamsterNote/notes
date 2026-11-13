# HAM-237 交付核对与归档证据

本文件用于归档记录，不修改实现。归档基线 notes main `4893764e951034b4887bf40d4bc34d57ffc534f3`。原始任务的九项完成依据逐项保留在 [tasks.md](tasks.md) 的“M2/M3 逐项证据回填”。

## 版本链与合入

- M1：notes PR #26 → `5237b9bd59ef768015c1310199dd4a23776297ab`；增量 PR #27 → `e7e28077ab94e252e8ea8b9abfe97003e305b97b`。
- M2：notes PR #28 包装修正 → `5758f85c26ea7469d4645bfd60982f9899ac166b`；annotated tag v3.3.0 对象 `639785b51654316f15eb6f02c51f78c49e71123a` 指向该源码，既有 Release 工作流发布。仓库 package.json 的开发版本不是实际 npm 发布版本，工作流从 tag 注入 3.3.0。官方包 SHA1 `ae786ec68cd137e7333725e86d09490ed39a3f15`；SHA512/发布原始输出见 evidence/release-330-*。
- M3：WebBase PR #81，受测 `406bbc4237ce261ba4c72d2f7742fad9c1abc980`，证据 `35999a6d873d71423c934e196ebcdb2b756be141`；最终合入 `8d7de1a2afcb4da78520054fb09de0e055263536`。消费者 webview 精确 3.3.0，无私有源码或本地 link。其完整证据与回退说明已随 PR 合入，固定链接：[WebBase 交付记录](https://github.com/HamsterNote/WebBase/blob/8d7de1a2afcb4da78520054fb09de0e055263536/docs/testing/ham-237-notes-3.3.md)、[完整矩阵原始输出](https://github.com/HamsterNote/WebBase/blob/8d7de1a2afcb4da78520054fb09de0e055263536/docs/testing/evidence/ham-237/e2e-matrix-rerun.txt)。

## 独立官方包消费验证（补齐 2.2 / 2.4）

归档前新建空目录，未使用 pack/link、notes/WebBase 的 node_modules 链接、源码别名或私有入口。下面的 fixture npm manifest 精确安装 3.3.0；npm 从官方源安装并验证 registry integrity。独立消费的是 Release 工作流 build 后的正式包，不把本地 pack 当作正式安装证据。`evidence/official-consumer-environment.json` 包含实际环境、resolved/integrity、lock 和 fixture SHA256。消费者自己的构建日志验证公开 CSS 和所需字体解析。

```sh
npm install --registry https://registry.npmjs.org --no-audit --no-fund
node runtime.mjs esm
node runtime.mjs cjs
npm run typecheck
npm run build
node check.mjs
npm view @hamster-note/notes@3.3.0 version dist --registry https://registry.npmjs.org --json
```

原始结果均在 `evidence/official-consumer-*`：ESM/CJS 导出集合一致，typecheck/build exit 0，两个视口 browser PASS；保存 HNN JSON 和完整截图保留。类型检查使用真实公开 HnnDocument/codec/Provider/View 声明，未采用任意类型绕过。provider onSave 写入 fixture localStorage，并通过 reload + decode/encode 重建验证勾选、引用和链接；宿主 .hnn 外壳和真实 adapter 的证据另见 WebBase，不混淆两种边界。

环境：Linux x64、Node v24.15.0、npm 11.12.1、Playwright 1.60.0 / Chromium 148.0.7778.96；1440×900、390×844。WebBase 原矩阵使用 Chromium 153.0.8010.12，不将两次环境混写。

安装有 optional Tiptap peer 解析警告（3.33.1 / 3.31.3），保留在 install.txt，未改正式包或宿主依赖规避。首次类型检查失败来自夹具缺少 vite/client CSS 类型、误把 decodeHnn 的 PM Node 当 HnnDocument；按公开声明修正 fixture 后通过。首次浏览器窄屏保存点击被仍打开的文字工具栏遮挡，已用真实 Escape + 点击外部关闭选区工具栏后保存，两种视口均通过；未 force 点击、未改库或弱化功能断言。初次失败日志也保留。

## 回退及验收交接（3.5）

官方旧 3.2.0（SHA1 `8b6b37f1a5a88b8fdf93b4b8d34b68c2bf3e6ef8`）在独立 Web 消费者读取 rollback-sample.json，列表 start=5/27、bullet/task、checked=true、blockquote author、link href 均保留，decode→encode 精确相等，无 pageerror，1440/390 两视口通过。原始结果、样本、截图与复现脚本位于上述 WebBase 固定提交的 `docs/testing/evidence/ham-237/rollback-*`。

回退通过新 WebBase PR 同时恢复 `webview/package.json`、`webview/pnpm-lock.yaml` 与本次 toolbar 宿主适配（旧版 DOM 为 .hn-editor-controls），保留用户 .hnn；frozen install 后重跑 typecheck/test:run/build:web/test:e2e:web。旧版读取样本保真但只显示整数，不提供新的层级编号或编辑 UI，不能把兼容读取当作具备新功能。不 unpublish、不改 dist-tag、不修改用户正文补编号。

M1 已审核、M2 已正式发布、M3 全矩阵通过且 PR #81 已合入，现具备整条验收条件；归档 PR 待审核合并，done 由人类处理。开发验收仅 Web，未进行 native 构建/设备验证。

## 独立夹具复现来源

以下文件仅为验证样本，存在归档文档中，不参与 notes 产品构建。将各段复制到干净目录，配合 `evidence/official-consumer-package-lock.json` 复制为 package-lock.json 后可用 `npm ci --registry https://registry.npmjs.org` 重现同一依赖解析，再执行上面入口。Playwright 浏览器需按该环境预装；没有时执行其官方 Chromium 安装步骤。

### package.json

```json
{
  "name": "ham237-official-consumer",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "vite build"
  },
  "dependencies": {
    "@hamster-note/notes": "3.3.0",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "@types/react": "19.1.8",
    "@types/react-dom": "19.1.6",
    "typescript": "6.0.0-beta",
    "vite": "7.0.4",
    "jsdom": "29.1.1",
    "@playwright/test": "1.60.0"
  }
}

```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "lib": [
      "ES2022",
      "DOM"
    ],
    "ignoreDeprecations": "6.0",
    "types": [
      "vite/client"
    ]
  },
  "include": [
    "main.tsx"
  ]
}

```

### index.html

```html
<!doctype html><html><meta charset="utf-8"><div id="root"></div><script type="module" src="/main.tsx"></script></html>
```

### main.tsx

```tsx
import {createRoot} from 'react-dom/client';
import {NoteDocumentProvider, NoteEditorView, decodeHnn, encodeHnn, type HnnDocument} from '@hamster-note/notes';
import '@hamster-note/notes/styles.css';
import '@hamster-note/notes/formula.css';
const empty: HnnDocument={schemaVersion:1,data:{type:'doc',content:[{type:'paragraph',attrs:{nodeId:'123e4567-e89b-42d3-a456-426614174000'}}]}};
const saved=localStorage.getItem('official-save');
const initial=saved?encodeHnn(decodeHnn(JSON.parse(saved))):empty;
createRoot(document.getElementById('root')!).render(<NoteDocumentProvider documentId="official" loadKey={1} initialDocument={initial} initialHostSnapshot={{changeId:0,value:{title:'',summary:''}}} onChange={()=>{}} onSave={async payload=>{localStorage.setItem('official-save',JSON.stringify(payload.document));}}><NoteEditorView viewId="official" /></NoteDocumentProvider>);

```

### runtime.mjs

```js
import { createRequire } from "node:module"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://consumer.test/" })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "DOMParser", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true })
}
const api = process.argv[2] === "cjs"
  ? createRequire(import.meta.url)("@hamster-note/notes")
  : await import("@hamster-note/notes")
console.log(JSON.stringify(Object.keys(api).sort()))
dom.window.close()

```

### check.mjs

```js
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {preview} from 'vite';
import {chromium,expect} from '@playwright/test';
const server=await preview({preview:{host:'127.0.0.1',port:0}});
const browser=await chromium.launch();
const results=[];
try {
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
  const page=await browser.newPage({viewport}); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]);
  const body=page.getByRole('textbox',{name:'笔记内容编辑区 official',exact:true});
  const select=async p=>{await p.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');};
  const convert=async(p,label)=>{await select(p);const bar=page.getByRole('toolbar',{name:'文字与块操作',exact:true});await bar.getByRole('button',{name:'转换为',exact:true}).click();await bar.getByRole('button',{name:label,exact:true}).click();};
  await body.click();await page.keyboard.type('First');
  const labels=['有序列表','无序列表','待办列表'];const selectors=['ol','ul:not([data-type])','ul[data-type="taskList"]'];
  for(let source=0;source<3;source++) {
   await convert(body.locator('p').first(),labels[source]);await expect(body.locator(selectors[source]).first()).toBeVisible();
   for(let target=0;target<3;target++) {
    if(source===target)continue;
    await convert(body.locator('p').first(),labels[target]);await expect(body.locator(selectors[target]).first()).toBeVisible();
    await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(body.locator(selectors[source]).first()).toBeVisible();
   }
   await convert(body.locator('p').first(),'正文');await expect(body.locator(':scope > p')).toHaveText('First');
  }
  await convert(body.locator('p').first(),'待办列表');await body.getByRole('checkbox').check();
  await body.locator('p').first().click();await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.press('Enter');
  await page.keyboard.type('Parent');await convert(body.locator('p').last(),'有序列表');
  await body.locator('p').last().click();await page.keyboard.press('End');
  for(let i=2;i<=5;i++){await page.keyboard.press('Enter');await page.keyboard.type(`Level ${i}`);await page.keyboard.press('Tab');}
  const markers=await body.locator('li[data-hnn-marker]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-hnn-marker')));
  assert.deepEqual(markers,['1','a','i','1','a']);
  assert.match(await body.locator('li[data-hnn-marker]').first().evaluate(n=>getComputedStyle(n,'::marker').content),/\./);
  for(let i=0;i<4;i++)await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.type('> Quote text');
  await expect(body.locator('blockquote p')).toHaveText('Quote text');
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.type('Selected words');
  const last=body.locator(':scope > p').last();await select(last);
  await page.getByRole('toolbar',{name:'文字与块操作',exact:true}).getByRole('button',{name:'链接',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'配置链接',exact:true});
  await expect(dialog.getByLabel('链接标题',{exact:true})).toHaveValue('Selected words');
  await dialog.getByLabel('URL',{exact:true}).fill('https://example.com/official');
  await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await expect(last.locator('a')).toHaveAttribute('href','https://example.com/official');
  assert.match(await last.locator('a').evaluate(n=>getComputedStyle(n).textDecorationLine),/underline/);
  await page.keyboard.press('Escape');await page.mouse.click(2,2);
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('official-save'))).not.toBeNull();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('official-save')));
  assert.equal(saved.data.content[0].content[0].attrs.checked,true);
  await fs.writeFile(`saved-${viewport.width}.json`,JSON.stringify(saved,null,2)+'\n');
  await page.reload();
  await expect(body.getByRole('checkbox')).toBeChecked();
  await expect(body.locator('blockquote p')).toHaveText('Quote text');
  await expect(body.locator('a')).toHaveAttribute('href','https://example.com/official');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`official-${viewport.width}.png`,fullPage:true});
  results.push({viewport,threeCreations:3,sixConversions:6,markers,quote:true,link:true,checkedSaveReopen:true,pageErrors:errors});
  console.log(`PASS ${viewport.width}x${viewport.height}: 3 creations / 6 conversions / 1,a,i,1,a / quote / link / checked save + reload`);
  await page.close();
 }
 await fs.writeFile('browser-result.json',JSON.stringify({package:'@hamster-note/notes@3.3.0',browser:browser.version(),results},null,2)+'\n');
} finally {await browser.close();await new Promise(r=>server.httpServer.close(r));}

```

## 归档校验

`openspec archive add-list-conversion-and-webbase-delivery --yes --json` 完成，specsUpdated=true，added=15。四份 delta 的每个 Requirement 标题均已存在对应主规格；本 change 25/25 任务完成。`openspec validate --all --strict --no-interactive` 通过（原始输出 evidence/archive-validation.txt）；非交互 CLI 的严格校验使用 --all 明确覆盖所有活动 changes 与主 specs。`git diff --check` 退出 0。归档结果 JSON 见 evidence/archive-result.json。
