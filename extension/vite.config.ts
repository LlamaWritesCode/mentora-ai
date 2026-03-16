import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  build: {
    rollupOptions: {
      // Explicitly declare offscreen.html as an entry point so Vite
      // compiles its TypeScript and bundles all imports correctly.
      // crxjs alone won't do this for files only listed in web_accessible_resources.
      input: {
        offscreen:   'src/offscreen/offscreen.html',
        permission:  'src/permission/permission.html',
      },
    },
  },
})
