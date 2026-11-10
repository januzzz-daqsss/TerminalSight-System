import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const hostedDemo = loadEnv(mode, process.cwd(), 'VITE_').VITE_DEMO_MODE === 'true';
  // Never forward hosted auth, even if a demo bundle is previewed in local mode.
  const localProxy = hostedDemo ? undefined : { "^/api/(?!auth(?:/|$))": "http://127.0.0.1:5000", "/video_feed": "http://127.0.0.1:5000" };
  return {
  // Demo builds must never copy local camera videos or other public assets.
  publicDir: hostedDemo ? false : 'public',
  server: { proxy: localProxy },
  preview: { proxy: localProxy },
  plugins: [
    react(),
    tailwindcss(),
  ],
  };
})
