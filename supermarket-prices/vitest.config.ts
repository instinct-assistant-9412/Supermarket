import { defineConfig } from "vitest/config";

// web/ is a separate package with its own tests (jsdom): `npm --prefix web test`
export default defineConfig({ test: { exclude: ["**/node_modules/**", "dist/**", "web/**"] } });
