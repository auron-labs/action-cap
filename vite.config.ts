import { crx } from '@crxjs/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import manifest from './src/manifest'

declare const process: { env: Record<string, string | undefined> }

const targetBrowser = process.env.ACTIONCAP_BROWSER === 'firefox' ? 'firefox' : 'chrome'

export default defineConfig({
  plugins: [react(), crx({ manifest, browser: targetBrowser })],
  define: {
    __BROWSER_TARGET__: JSON.stringify(targetBrowser),
  },
  build: {
    sourcemap: process.env.ACTIONCAP_SOURCE_MAPS === 'true',
    rollupOptions: {
      input: {
        popup: new URL('./popup.html', import.meta.url).pathname,
        results: new URL('./results.html', import.meta.url).pathname,
      },
    },
  },
})
