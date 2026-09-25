import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, serve the hub's manual controls page at / like the hub does, so it
// can be viewed without a robot.
const controlsPage: Plugin = {
  name: 'hub-controls-page',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== '/') return next()
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(readFileSync(new URL('../index.html', import.meta.url)))
    })
  },
}

// The hub serves the built app under /app/. In dev, API calls are forwarded
// to a hub running locally.
export default defineConfig({
  base: '/app/',
  plugins: [react(), controlsPage],
  server: {
    proxy: {
      '/api': 'http://localhost:8765',
      '/video.mjpeg': 'http://localhost:8765',
    },
  },
})
