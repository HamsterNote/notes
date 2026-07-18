import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  ssr: {
    noExternal: ["@system-ui-js/multi-drag"],
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
    setupFiles: ["src/lib/test-setup.ts"],
  },
})
