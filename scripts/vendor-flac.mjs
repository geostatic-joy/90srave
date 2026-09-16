// Copies the libflac.js runtime into public/flac/ so the FLAC worker can
// importScripts() it (and so emscripten finds the .wasm next to it).
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules', 'libflacjs', 'dist')
const to = join(root, 'public', 'flac')
const files = ['libflac.min.wasm.js', 'libflac.min.wasm.wasm']

await mkdir(to, { recursive: true })
for (const file of files) {
  try {
    await copyFile(join(from, file), join(to, file))
  } catch (error) {
    console.warn(`[vendor-flac] could not copy ${file}: ${error.message}`)
    console.warn('[vendor-flac] FLAC export will fall back to WAV.')
    process.exit(0)
  }
}
console.log(`[vendor-flac] copied ${files.length} files into public/flac/`)
