import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Tauri 데스크톱 셸을 위한 Vite 구성.
// base: './' — file:// 환경에서 자산을 상대경로로 참조(release 번들 404 방지).
export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    // shadcn/ui 컴포넌트가 '@/lib/utils' 등 절대 import를 사용. tsconfig paths와 일치.
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    // 벤더 청크 분리(메인 번들 축소). recharts/react를 별도 청크로.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
        },
      },
    },
  },
});
