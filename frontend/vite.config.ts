import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const proxy = process.env.TEAM_CANVAS_DEV_PROXY ?? "http://localhost:8080";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: {
    "/api": proxy,
    "/ws": { target: proxy, ws: true },
  } },
});
