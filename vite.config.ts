import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
  },
  worker: {
    // Classic workers: the FLAC worker needs importScripts() for the
    // emscripten build of libflac, and lamejs bundles fine either way.
    format: 'iife',
  },
})
