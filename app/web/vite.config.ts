import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Read .env from the repo root, not this workspace, so the whole app
  // shares one env file per README.md setup step 3.
  envDir: '../..',
  server: {
    // `shopify app dev` assigns and injects this port per run and routes
    // its tunnel to it - a hardcoded port here causes ECONNREFUSED on
    // whatever port the CLI actually expects.
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    // The Shopify CLI's tunnel proxies to this dev server during
    // `shopify app dev`; host-checking is relaxed for the tunnel host.
    allowedHosts: true,
    // The tunnel only fronts the frontend dev server, so backend-bound
    // paths have to be forwarded from here. `BACKEND_PORT` is injected by
    // the CLI per run alongside this server's own `PORT`.
    proxy: {
      '^/(api|webhooks|auth)(/|$)': {
        target: `http://127.0.0.1:${process.env.BACKEND_PORT ?? 3000}`,
        changeOrigin: false,
      },
    },
  },
});
