import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/workqueue': {
        target: 'http://localhost:4004',
        changeOrigin: true,
      },
      '/agent': {
        target: 'http://localhost:4004',
        changeOrigin: true,
      },
      '/assistant': {
        target: 'http://localhost:4004',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
