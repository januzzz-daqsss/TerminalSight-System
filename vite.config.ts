import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  server: { proxy: { "/api": "http://127.0.0.1:5000", "/video_feed": "http://127.0.0.1:5000" } },
  preview: { proxy: { "/api": "http://127.0.0.1:5000", "/video_feed": "http://127.0.0.1:5000" } },
  plugins: [
    react(),
    tailwindcss(),
  ],
})
