import { defineConfig } from "vitest/config";
import path from "node:path";

// 테스트 전용 구성. jsdom 환경 + @/ alias(tsconfig paths와 일치).
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
