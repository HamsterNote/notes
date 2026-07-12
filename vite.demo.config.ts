import path from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 9235
  },
  preview: {
    host: "0.0.0.0",
    port: 9235
  },
  build: {
    outDir: "dist/demo"
  },
  resolve: {
    alias: {
      "@": path.resolve(currentDirectory, "src")
    }
  }
})
