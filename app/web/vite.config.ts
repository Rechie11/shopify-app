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
  },
});
