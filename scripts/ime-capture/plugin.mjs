import { readFileSync } from 'node:fs'

// Install in the host's Vite config, never in an application entry point.
export function imeCapturePlugin({ gatewayPort = 6218 } = {}) {
  return {
    name: 'hnn-ime-capture-dev-only',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url, 'http://localhost').pathname
        const files = {
          '/__ime-capture/bridge.js': new URL('./bridge.js', import.meta.url),
          '/__ime-capture/recorder.js': new URL('../capture-hnn-ime-events.js', import.meta.url),
        }
        if (!files[pathname]) return next()
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(readFileSync(files[pathname], 'utf8').replace('__GATEWAY_PORT__', String(gatewayPort)))
      })
    },
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module', src: '/__ime-capture/bridge.js' }, injectTo: 'head' }]
    },
  }
}
