/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// בפיתוח: /api מופנה ל-API המקומי (ברירת מחדל localhost:3000). אפשר לשנות עם DEV_API_TARGET.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.DEV_API_TARGET ?? "http://localhost:3000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  test: { environment: "jsdom", globals: false, setupFiles: ["./src/test/setup.ts"] },
});
