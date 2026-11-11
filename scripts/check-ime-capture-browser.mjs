import { chromium, webkit, expect as baseExpect } from 'playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const url = process.env.IME_CAPTURE_URL || 'http://192.168.0.145:6218/__ime-capture'
const engine = process.env.BROWSER_ENGINE || 'chromium'
const output = new URL(`../evidence/ham219/${engine === 'webkit' ? 'webkit/' : ''}`, import.meta.url)
const expect = baseExpect.configure({ timeout: 60000 })
await mkdir(output, { recursive: true })
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ executablePath: engine === 'webkit' ? process.env.WEBKIT_PATH : process.env.CHROMIUM_PATH })
const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, hasTouch: true, isMobile: true, acceptDownloads: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.setDefaultTimeout(60000)
try {
  await page.goto(url)
  const app = page.frameLocator('#app')
  await expect(app.getByRole('tab', { name: /(?:^|\s)文件$/ })).toBeVisible()
  await app.getByRole('tab', { name: /(?:^|\s)文件$/ }).click()
  await expect(app.getByRole('heading', { name: '本地存储', exact: true })).toBeVisible()
  await page.screenshot({ path: new URL('01-open.png', output).pathname, fullPage: true })
  const button = name => app.getByRole('button', { name, exact: true })
  await button('新建').click()
  await button('新建文件…').click()
  const name = `HAM219-${Date.now()}`
  await app.getByLabel('笔记名称', { exact: true }).fill(name)
  await button('创建笔记').click()
  await button(`${name}.hnn`).click()
  const editor = app.getByTitle(`${name}.hnn HNN 编辑器`, { exact: true }).contentFrame()
  const body = editor.getByRole('textbox', { name: '笔记内容编辑区 primary', exact: true })
  await expect(body).toBeVisible()
  await expect(page.locator('#status')).toHaveText('正在记录，可以输入了。')
  await page.getByRole('button', { name: '开始记录', exact: true }).click()
  await expect(page.locator('#status')).toContainText('已开始一份新记录')
  await body.click()
  // Controlled browser input only; neither branch represents a phone's system IME.
  if (engine === 'webkit') {
    await body.dispatchEvent('compositionstart', { data: '' })
    await body.dispatchEvent('compositionupdate', { data: 'nihao' })
    await page.keyboard.insertText('你')
    await page.keyboard.insertText('好')
    await body.dispatchEvent('compositionend', { data: '你好' })
  } else {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 })
    await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 })
    await cdp.send('Input.insertText', { text: '你好' })
  }
  await expect(body).toContainText('你好')
  await page.screenshot({ path: new URL('02-input.png', output).pathname, fullPage: true })
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await expect(page.locator('#output')).toBeVisible()
  const json = await page.locator('#json').inputValue()
  const result = JSON.parse(json)
  expect(result.schemaVersion).toBe(2)
  expect(result.truncated).toBe(false)
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'mutation', 'selectionchange', 'transaction']) {
    expect(result.events.some(event => event.type === type), `Missing ${type}`).toBe(true)
  }
  expect(result.events.some(event => event.type === 'beforeinput' && event.targetRanges.length && event.inputType && event.data)).toBe(true)
  expect(result.events.some(event => event.type === 'mutation' && event.mutations.some(mutation => mutation.oldValue !== null))).toBe(true)
  expect(result.events.some(event => event.type === 'transaction' && event.transactions.some(transaction => transaction.steps.value !== '[]'))).toBe(true)
  expect(result.transactionObservation.some(observation => observation.available)).toBe(true)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('link', { name: '下载 .json 文件' }).click()
  const download = await downloadEvent
  const downloadPath = new URL(download.suggestedFilename(), output)
  await download.saveAs(downloadPath.pathname)
  expect(await readFile(downloadPath, 'utf8')).toBe(json)
  await page.getByRole('button', { name: '一键复制', exact: true }).click()
  await expect(page.locator('#copy-status')).toHaveText('已复制完整 JSON。')
  // Paste the actual clipboard via the browser's keyboard path, without mocking it.
  await page.evaluate(() => {
    const textarea = document.createElement('textarea')
    textarea.id = 'clipboard-proof'
    document.querySelector('#output').append(textarea)
  })
  await page.locator('#clipboard-proof').focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
  await expect(page.locator('#clipboard-proof')).toHaveValue(json)
  await page.locator('#clipboard-proof').evaluate(node => node.remove())
  await page.locator('#json').evaluate(node => { node.scrollTop = 0 })
  await page.screenshot({ path: new URL('03-export.png', output).pathname, fullPage: true })
  // Exercise manual long-text fallback when automatic copy is unavailable.
  await page.evaluate(() => { document.execCommand = () => false })
  await page.getByRole('button', { name: '一键复制', exact: true }).click()
  await expect(page.locator('#copy-status')).toContainText('已全选')
  expect(await page.locator('#json').evaluate(node => node.selectionEnd - node.selectionStart)).toBe(json.length)
  await page.getByRole('button', { name: '全选文本', exact: true }).click()
  expect(await page.locator('#json').evaluate(node => node.selectionEnd - node.selectionStart)).toBe(json.length)
  // Stopped snapshots must not be overwritten by discovery or a second export.
  await body.click()
  await page.keyboard.insertText('停止后')
  await page.getByRole('button', { name: '导出', exact: true }).click()
  await expect(page.locator('#status')).toContainText('已导出')
  expect(await page.locator('#json').inputValue()).toBe(json)
  expect(errors).toEqual([])
  const report = { url, source: engine === 'webkit' ? 'Linux WebKit, synthetic composition events + keyboard.insertText; not a phone IME' : 'Controlled Chromium CDP composition, not a physical phone or system IME',
    events: result.events.length, bytes: Buffer.byteLength(json), download: download.suggestedFilename(),
    httpClipboardExact: true, manualSelectionExact: true, stoppedSnapshotStable: true, errors }
  await writeFile(new URL('verification.json', output), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  await page.screenshot({ path: new URL('failure.png', output).pathname, fullPage: true }).catch(() => {})
  console.error(JSON.stringify({ errors, frames: page.frames().map(frame => frame.url()), body: await page.locator('body').innerText() }, null, 2))
  throw error
} finally {
  await browser.close()
}
