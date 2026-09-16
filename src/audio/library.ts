import { decodeArrayBuffer } from './decode'

/** One entry from the sound-effects folder's index.json. */
export interface SfxEntry {
  file: string
  label: string
  url: string
}

/** Where the effects live, relative to the deployed app. */
export const SFX_FOLDER = 'sfx'

function sfxBase(): URL {
  return new URL(`${SFX_FOLDER}/`, new URL(import.meta.env.BASE_URL, document.baseURI))
}

/** A plain filename, no paths or schemes: the index is just a directory listing. */
function isPlainFilename(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('.') &&
    !/[\\/]/.test(value) &&
    !value.includes(':')
  )
}

/**
 * Read the sound-effects folder. Static hosting cannot list a directory, so the
 * folder carries an index.json written by scripts/build-sfx-index.mjs. A
 * missing or unreadable index just means no built-in effects.
 */
export async function loadSfxLibrary(): Promise<SfxEntry[]> {
  const base = sfxBase()
  try {
    const response = await fetch(new URL('index.json', base), { cache: 'no-cache' })
    if (!response.ok) return []
    const data: unknown = await response.json()
    const sounds = (data as { sounds?: unknown })?.sounds
    if (!Array.isArray(sounds)) return []
    return sounds
      .filter((sound): sound is { file: string; label?: unknown } =>
        isPlainFilename((sound as { file?: unknown })?.file),
      )
      .map((sound) => ({
        file: sound.file,
        label: typeof sound.label === 'string' && sound.label ? sound.label : sound.file,
        url: new URL(sound.file, base).href,
      }))
  } catch {
    return []
  }
}

/** Fetch and decode one of the folder's effects. */
export async function loadSfxBuffer(entry: SfxEntry): Promise<AudioBuffer> {
  const response = await fetch(entry.url)
  if (!response.ok) {
    throw new Error(`Could not load "${entry.label}" (${response.status}).`)
  }
  return decodeArrayBuffer(await response.arrayBuffer(), entry.label)
}
