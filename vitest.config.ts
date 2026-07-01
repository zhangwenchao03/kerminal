import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./tests/frontend/setup.ts",
    css: true,
    include: ["src/**/*.test.{ts,tsx}", "tests/frontend/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "src-tauri", ".codex", ".updeng"],
    testTimeout: 10000,
  },
});
