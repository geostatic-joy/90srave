/**
 * Lists the audio files in a sound-effects folder into an index.json the app
 * can fetch, because static hosting cannot list a directory.
 *
 *   node scripts/build-sfx-index.mjs [folder]     # default: public/sfx
 *
 * Point it at a deployed folder (dist/sfx, or wherever the site lives) to add
 * effects without rebuilding the app.
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.opus', '.m4a', '.aac']
const INDEX_FILE = 'index.json'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const folder = resolve(root, process.argv[2] ?? join('public', 'sfx'))

/** "needle-drop_02.wav" -> "Needle drop 02" */
function labelFor(file) {
  const base = file.slice(0, file.length - extname(file).length)
  const words = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

async function readExistingLabels(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    const labels = new Map()
    for (const sound of parsed?.sounds ?? []) {
      if (sound?.file && sound?.label) labels.set(sound.file, sound.label)
    }
    return labels
  } catch {
    return new Map()
  }
}

await mkdir(folder, { recursive: true })
const indexPath = join(folder, INDEX_FILE)
// Hand-edited labels survive a regeneration.
const existing = await readExistingLabels(indexPath)

const entries = await readdir(folder, { withFileTypes: true })
const sounds = entries
  .filter((entry) => entry.isFile() && AUDIO_EXTENSIONS.includes(extname(entry.name).toLowerCase()))
  .map((entry) => ({ file: entry.name, label: existing.get(entry.name) ?? labelFor(entry.name) }))
  .sort((a, b) => a.label.localeCompare(b.label))

await writeFile(indexPath, `${JSON.stringify({ sounds }, null, 2)}\n`)
console.log(`[sfx] indexed ${sounds.length} sound effect${sounds.length === 1 ? '' : 's'} in ${folder}`)
