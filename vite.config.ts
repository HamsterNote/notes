import path from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import dts from "vite-plugin-dts"

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    dts({
      include: ["src/lib"],
      outDir: "dist",
      insertTypesEntry: true,
      tsconfigPath: "./tsconfig.app.json",
      exclude: ["src/demo/**/*", "src/lib/**/*.test.*"]
    })
  ],
  build: {
    lib: {
      entry: path.resolve(currentDirectory, "src/lib/index.ts"),
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "index.js" : "index.cjs"),
      cssFileName: "styles"
    },
    sourcemap: true,
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
      output: {
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
})
