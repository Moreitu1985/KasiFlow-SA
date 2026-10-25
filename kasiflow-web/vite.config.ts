import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The API only allows these origins (CORS). Fail loudly instead of silently moving to 5174 when 5173 is busy.
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
          forms: ['zod', 'react-hook-form', '@hookform/resolvers'],
          query: ['@tanstack/react-query'],
          charts: ['recharts'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
})
