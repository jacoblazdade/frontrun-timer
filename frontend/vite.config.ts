import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // PWA: precaches the hashed build assets so the finish screen loads
    // offline. API calls are never cached — offline finishes live in the
    // IndexedDB outbox (src/outbox.ts).
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Frontrun Timer",
        short_name: "Frontrun",
        description: "Race timing for the yearly club run",
        start_url: "/admin/finish",
        display: "standalone",
        orientation: "portrait",
        background_color: "#111318",
        theme_color: "#111318",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    // PORT lets a second dev instance run next to the default one
    port: Number(process.env.PORT) || 5173,
    proxy: {
      // local dev: backend runs on :8000 (uv run uvicorn app.main:app --reload)
      "/api": "http://localhost:8000",
    },
  },
});
