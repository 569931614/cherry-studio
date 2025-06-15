import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react({
      plugins: [
        [
          '@swc/plugin-styled-components',
          {
            displayName: true,
            fileName: false,
            pure: true,
            ssr: false
          }
        ]
      ]
    })
  ],
  root: 'src/renderer',
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'packages/shared')
    }
  },
  optimizeDeps: {
    exclude: ['pyodide']
  },
  worker: {
    format: 'es'
  },
  server: {
    port: 5174
  }
})
