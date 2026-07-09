import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // PORT lets a second dev instance run next to the default one
    port: Number(process.env.PORT) || 5173,
    proxy: {
      // local dev: backend runs on :8000 (uv run uvicorn app.main:app --reload)
      "/api": "http://localhost:8000",
    },
  },
});
