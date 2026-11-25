import { defineConfig } from "vite";

// Relative base so the same dist/ works from tauri.localhost and from the
// WebView2 virtual host used by the WPF shell. The samples folder is only
// served in dev mode (browser host); it is not copied into dist/.
export default defineConfig(({ command }) => ({
  base: "./",
  publicDir: command === "serve" ? "../samples" : false,
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
  server: { port: 5178, strictPort: true },
}));
