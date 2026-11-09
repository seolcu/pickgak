import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // 같은 와이파이의 폰에서도 접속 가능
    // Host를 그대로 넘긴다: 백엔드의 교차 출처 차단(Origin과 Host 비교)이 배포와 똑같이 동작하게
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: false } },
  },
});
