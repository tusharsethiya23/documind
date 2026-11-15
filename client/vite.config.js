import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development, /api requests go to the Express server, so the browser
// sees one origin and no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
})
