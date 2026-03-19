import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/',

  plugins: [react()],

  server: {
    host: '0.0.0.0',
    port: 3001,
    allowedHosts: true,

    hmr: {
      host: 'debate.phosphorusforum.com'
    },

    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      }
    }
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})