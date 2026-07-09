import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // local dev: backend runs on :8000 (uv run uvicorn app.main:app --reload)
      "/api": "http://localhost:8000",
    },
  },
});
