import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

// TAURI_ENV_DEBUG is "true" during `tauri dev`
const isDev = process.env.TAURI_ENV_DEBUG === "true"

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    // 生产默认 minify，开发不压缩
    minify: isDev ? false : "esbuild",
    // 生产强制关闭 sourcemap：安装包不得包含 .map 文件，无论环境变量如何设置。
    // 开发模式（tauri dev）仍可使用 sourcemap 辅助调试。
    sourcemap: isDev ? "inline" : false,
    rollupOptions: {
      output: {
        manualChunks: {
          "vuetify": ["vuetify"],
          "vue-vendor": ["vue", "vue-router", "pinia"]
        }
      }
    }
  }
})
