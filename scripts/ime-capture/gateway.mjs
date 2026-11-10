import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// A replacement launch command for the existing DEVELOPMENT gateway only.
if (process.env.NODE_ENV === 'production') throw new Error('IME capture is development-only')
const hostRoot = process.argv[2]
if (!hostRoot) throw new Error('Usage: node scripts/ime-capture/gateway.mjs /path/to/WebBase')
const require = createRequire(import.meta.url)
const { createGatewayServer, resolveGatewayConfig } = require(path.resolve(hostRoot, 'scripts/proxy/gateway/server.js'))
const config = resolveGatewayConfig()
const editorPort = Number(process.env.IME_CAPTURE_EDITOR_PORT || 6219)
if (!Number.isInteger(editorPort) || editorPort < 1 || editorPort > 65535) throw new Error('Invalid IME_CAPTURE_EDITOR_PORT')
const server = createGatewayServer({ config })
const handlers = server.listeners('request')
server.removeAllListeners('request')
server.on('request', (req, res) => {
  if (new URL(req.url, 'http://localhost').pathname === '/__ime-capture') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(readFileSync(new URL('./page.html', import.meta.url), 'utf8').replace('__EDITOR_PORT__', String(editorPort)))
    return
  }
  for (const handler of handlers) handler.call(server, req, res)
})
server.listen(config.gatewayPort, config.gatewayHost, () => {
  console.log(`IME capture development gateway ready on ${config.gatewayPort}; Metro ${config.metroPort}`)
})
