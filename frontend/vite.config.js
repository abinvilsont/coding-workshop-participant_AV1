import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  },
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely, so they get their own long-cached files
        manualChunks: {
          react: ['react', 'react-dom', 'react-responsive'],
          mui: ['@mui/material', '@emotion/react', '@emotion/styled'],
        },
      },
    },
  },
  // Unit / component tests (npm test). End-to-end tests live in ../e2e.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    // MUI renders make the typing-heavy admin tests take a few seconds each
    testTimeout: 20000,
    include: ['src/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/main.jsx', 'src/test/**', 'src/**/*.test.{js,jsx}'],
      reporter: ['text-summary', 'text', 'html'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
})
