import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Demo builds must never copy local camera videos or other public assets.
  publicDir: loadEnv(mode, process.cwd(), 'VITE_').VITE_DEMO_MODE === 'true' ? false : 'public',
  server: { proxy: { "/api": "http://127.0.0.1:5000", "/video_feed": "http://127.0.0.1:5000" } },
  preview: { proxy: { "/api": "http://127.0.0.1:5000", "/video_feed": "http://127.0.0.1:5000" } },
  plugins: [
    react(),
    tailwindcss(),
  ],
}))
