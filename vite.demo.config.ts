import path from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

// GitHub Pages 子路径: https://hamsternote.github.io/notes/
const isGitHubActions = process.env.GITHUB_ACTIONS === "true"

export default defineConfig({
  plugins: [react()],
  base: isGitHubActions ? "/notes/" : "./",
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
