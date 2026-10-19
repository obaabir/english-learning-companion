import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      // article.js runs sandboxed inside pages of the Articles in-app browser, so Readability is bundled into it.
      externalizeDeps: { exclude: ['@mozilla/readability'] },
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          article: resolve('src/preload/article.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    // No live reloading: code edits must never change the app while it's in use.
    // Changes take effect on the next app restart.
    server: { hmr: false }
  }
})
