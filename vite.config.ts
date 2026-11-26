import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;

// Relative base so dist/ loads from the Tauri custom protocol. tests/fixtures
// is served in dev mode only (browser host); it is not copied into dist/.
export default defineConfig(({ command }) => ({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
  publicDir: command === "serve" ? "tests/fixtures" : false,
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
  server: { port: 5178, strictPort: true },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
}));
