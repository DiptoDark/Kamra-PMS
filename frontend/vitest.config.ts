import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// Unit and component tests (Vitest + React Testing Library + jsdom).
// Kept apart from vite.config.ts so the build config stays as upstream has it.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
})
