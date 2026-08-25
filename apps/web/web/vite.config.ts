import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT) || 3000;
// Proxy the API to the Go backend so the SPA is same-origin in dev — this is what
// makes auth cookies (login/session) work. Override the target with VITE_API_PROXY.
const apiTarget = process.env.VITE_API_PROXY || "http://localhost:8080";
const proxy = {
  "/api": { target: apiTarget, changeOrigin: true },
  "/events": { target: apiTarget, changeOrigin: true },
  "/graphql": { target: apiTarget, changeOrigin: true },
  "/docs": { target: apiTarget, changeOrigin: true },
  "/openapi": { target: apiTarget, changeOrigin: true },
  "/schemas": { target: apiTarget, changeOrigin: true },
  "/mcp": { target: apiTarget, changeOrigin: true },
};

// The web app shares the design system (packages/ui-tokens) and the renderer /
// themes (packages/core) with the desktop app, imported from source exactly like
// apps/electron does — no workspace tooling.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@mid/tokens": `${repoRoot}packages/ui-tokens/src`,
      "@mid/core": `${repoRoot}packages/core/src`,
    },
  },
  server: { port, proxy, fs: { allow: [repoRoot] } },
  preview: { port, proxy },
});
