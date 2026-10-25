import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const proxy = process.env.TEAM_CANVAS_DEV_PROXY ?? "http://localhost:8080";
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "local-excalidraw-font-fallback",
      apply: "build",
      // Excalidraw 0.18.1 always adds its CDN even when ASSET_PATH is configured.
      // Keep both font candidates local so CSP never probes an external source.
      transform(source, id) {
        if (!id.includes("/@excalidraw/excalidraw/dist/") || !source.includes("ASSETS_FALLBACK_URL")) return;
        const code = source.replace(/`https:\/\/esm\.sh\/\$\{.*?\/dist\/prod\/`/gs, "`${window.location.origin}/`");
        if (code === source) this.error("Excalidraw font fallback changed. Review local font configuration before upgrading.");
        return { code, map: null };
      },
    },
  ],
  server: { port: 5173, proxy: {
    "/api": { target: proxy, xfwd: true },
    "/ws": { target: proxy, xfwd: true, ws: true },
  } },
});
