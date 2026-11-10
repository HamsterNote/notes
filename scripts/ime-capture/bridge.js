// Dev-server injection only. Remains dormant outside the explicit capture page.
const captureOrigin = new URL(location.origin)
captureOrigin.port = '__GATEWAY_PORT__'
let session = null
let starting = null
const reply = (type, extra = {}) => window.top.postMessage({ channel: 'hnn-ime-capture', session, type, ...extra }, captureOrigin.origin)
const start = () => {
  if (starting) return starting
  starting = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/__ime-capture/recorder.js'
    script.onload = () => { script.remove(); resolve() }
    script.onerror = () => { script.remove(); reject(new Error('记录器加载失败，请刷新页面')) }
    document.head.append(script)
  }).finally(() => { starting = null })
  return starting
}
window.addEventListener('message', async event => {
  const message = event.data
  if (window.top === window || event.source !== window.top || event.origin !== captureOrigin.origin
    || message?.channel !== 'hnn-ime-capture' || typeof message.session !== 'string') return
  try {
    if (message.type === 'hello') {
      if (session !== message.session) {
        session = message.session
        await start()
      }
      await starting
      reply('ready', { editors: document.querySelectorAll('.hn-editor-content').length })
    } else if (message.session === session && message.type === 'start') {
      await start()
      reply('started')
    } else if (message.session === session && message.type === 'export') {
      await starting
      reply('exported', { requestId: message.requestId, result: window.ham172Ime.stop() })
    }
  } catch (error) {
    reply('error', { message: error.message })
  }
})
