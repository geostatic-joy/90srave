/**
 * End-to-end checks: drives the built app in Chromium, exports real files and
 * inspects the audio that comes back out.
 *
 *   npm run build && npm run preview &
 *   npm run test:browser
 *
 * Needs Playwright:  npm i -D playwright && npx playwright install chromium
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureFixtures } from './fixtures.mjs'

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/'
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '.out')

let chromium
try {
  const playwright = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
  chromium = playwright.chromium ?? playwright.default.chromium
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium')
  process.exit(2)
}

const fixtures = ensureFixtures()
rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass })
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`)
}
function section(title) {
  console.log(`\n${title}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ acceptDownloads: true })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(message.text())
})

async function loadTrack(path) {
  const name = path.split('/').pop()
  await page.setInputFiles('#file-input', path)
  await page.waitForFunction(
    (expected) => document.querySelector('#meta-name')?.textContent === expected,
    name,
    {
      timeout: 60_000,
    },
  )
  await page.waitForSelector('#waveform canvas')
}

const values = () =>
  page.evaluate(() => ({
    start: document.querySelector('#start-input').value,
    end: document.querySelector('#end-input').value,
    length: document.querySelector('#duration-input').value,
    custom: document.querySelector('#custom-length').checked,
    endReadOnly: document.querySelector('#end-input').readOnly,
    duration: document.querySelector('#meta-duration').textContent,
    rate: document.querySelector('#meta-samplerate').textContent,
    channels: document.querySelector('#meta-channels').textContent,
    filename: document.querySelector('#filename-input').value,
    note: document.querySelector('#selection-note').textContent,
    scratchNote: document.querySelector('#scratch-note').textContent,
    scratchDisabled: document.querySelector('#scratch-enabled').disabled,
    exportStatus: document.querySelector('#export-status').textContent,
  }))

async function exportTo(name) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 180_000 }),
    page.click('#export-button'),
  ])
  const target = join(OUT_DIR, name)
  await download.saveAs(target)
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#export-status').textContent), null, {
    timeout: 180_000,
  })
  return { target, suggested: download.suggestedFilename() }
}

async function setEnd(value) {
  await page.click('#end-input')
  await page.fill('#end-input', value)
  await page.press('#end-input', 'Enter')
}

function readWav(path) {
  const buffer = readFileSync(path)
  const channels = buffer.readUInt16LE(22)
  const sampleRate = buffer.readUInt32LE(24)
  let offset = 12
  let dataStart = 0
  let dataSize = 0
  while (offset < buffer.length - 8) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'data') {
      dataStart = offset + 8
      dataSize = size
      break
    }
    offset += 8 + size + (size % 2)
  }
  const frames = dataSize / (channels * 2)
  const left = new Float32Array(frames)
  for (let i = 0; i < frames; i++) left[i] = buffer.readInt16LE(dataStart + i * channels * 2) / 32768
  return { channels, sampleRate, frames, duration: frames / sampleRate, left }
}

const rms = (data, from, to) => {
  let sum = 0
  for (let i = from; i < to; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / Math.max(1, to - from))
}
const maxStep = (data, from, to) => {
  let max = 0
  for (let i = Math.max(1, from); i < to; i++) max = Math.max(max, Math.abs(data[i] - data[i - 1]))
  return max
}

// ---------------------------------------------------------------- selection

section('Selection')
await page.goto(APP_URL)
await loadTrack(fixtures.track)

let v = await values()
check(
  'metadata reads back from the file',
  v.duration === '2:00.0' && v.rate === '44,100 Hz' && v.channels === 'Stereo',
  JSON.stringify(v),
)
check('defaults to 90s from the top', v.start === '0:00.0' && v.end === '1:30.0' && v.length === '1:30.0')
check('end input is read-only while the length is locked', v.endReadOnly === true)
check('filename is derived from the track', /_snippet_00-00_90s\.mp3$/.test(v.filename), v.filename)
check(
  'scratch options stay hidden until the scratch is on',
  await page.locator('#scratch-options').isHidden(),
)

await page.click('.nudges[data-target="start"] button[data-nudge="1"]')
await page.click('.nudges[data-target="start"] button[data-nudge="0.1"]')
v = await values()
check(
  'nudging the start slides the whole window',
  v.start === '0:01.1' && v.end === '1:31.1' && v.length === '1:30.0',
  JSON.stringify(v),
)

await page.fill('#start-input', '0:30')
await page.press('#start-input', 'Enter')
v = await values()
check(
  'typed start syncs end and length',
  v.start === '0:30.0' && v.end === '2:00.0' && v.length === '1:30.0',
  JSON.stringify(v),
)

await page.fill('#start-input', '5:00')
await page.press('#start-input', 'Enter')
v = await values()
check('start is clamped so 90s still fits', v.start === '0:30.0' && v.end === '2:00.0', JSON.stringify(v))

await page.fill('#start-input', 'banana')
await page.press('#start-input', 'Enter')
v = await values()
check('unparseable input falls back to state', v.start === '0:30.0', v.start)

await setEnd('1:00')
v = await values()
check('editing the end switches on custom length', v.custom === true && v.end === '1:00.0', JSON.stringify(v))

await page.fill('#duration-input', '0:00.2')
await page.press('#duration-input', 'Enter')
v = await values()
check('length is clamped to the 1s minimum', v.length === '0:01.0', v.length)

await page.uncheck('#custom-length')
await page.click('#reset-90')
v = await values()
check('reset restores a 90s window', v.length === '1:30.0' && v.custom === false, JSON.stringify(v))

const region = page.locator('#waveform [part~="region"]').first()
const box = await region.boundingBox()
check('the region is on the waveform', box !== null)
if (box) {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx - 120, cy, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  v = await values()
  check(
    'dragging moves the window without resizing it',
    v.length === '1:30.0' && v.start !== '0:30.0',
    JSON.stringify(v),
  )

  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(box.x - 900, cy, { steps: 15 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  v = await values()
  check(
    'dragging past the start clamps instead of shrinking',
    v.start === '0:00.0' && v.length === '1:30.0',
    JSON.stringify(v),
  )
}

await page.click('#play-selection')
await page.waitForFunction(
  () => /Playing/.test(document.querySelector('#preview-status').textContent),
  null,
  { timeout: 60_000 },
)
check('preview plays the rendered clip', true, await page.textContent('#preview-status'))

const playing = () =>
  page.waitForFunction(() => /Playing/.test(document.querySelector('#preview-status').textContent), null, {
    timeout: 60_000,
  })

await page.click('.nudges[data-target="start"] button[data-nudge="1"]')
await page.waitForTimeout(150)
check(
  'nudging the selection stops playback',
  (await page.textContent('#preview-status')) === '',
  await page.textContent('#preview-status'),
)

if (box) {
  await page.click('#play-selection')
  await playing()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 60, cy, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  check(
    'dragging the region stops playback',
    (await page.textContent('#preview-status')) === '',
    await page.textContent('#preview-status'),
  )
}
await page.click('#stop')

const dimmers = await page.evaluate(() =>
  [...document.querySelectorAll('#waveform .waveform__dim')].map((node) => ({
    left: node.style.left,
    width: node.style.width,
  })),
)
check('the waveform outside the selection is shaded', dimmers.length === 2, JSON.stringify(dimmers))

// ------------------------------------------------------------------ export

section('Export')
await page.fill('#start-input', '0:10')
await page.press('#start-input', 'Enter')
const mp3 = await exportTo('clean.mp3')
check('MP3 downloads', /\.mp3$/.test(mp3.suggested), mp3.suggested)
await loadTrack(mp3.target)
check('exported MP3 is 90s', (await values()).duration === '1:30.0')

await page.goto(APP_URL)
await loadTrack(fixtures.track)
await setEnd('0:20')
await page.check('#scratch-enabled')
await page.waitForTimeout(600)
const overlayMp3 = await exportTo('overlay.mp3')
await loadTrack(overlayMp3.target)
check('overlay scratch keeps the clip length', (await values()).duration === '0:20.0')

await page.goto(APP_URL)
await loadTrack(fixtures.track)
await setEnd('0:20')
await page.check('#scratch-enabled')
await page.check('input[name="scratch-placement"][value="append"]')
await page.waitForTimeout(600)
const appendMp3 = await exportTo('append.mp3')
await loadTrack(appendMp3.target)
check('appended scratch adds ~1s', (await values()).duration === '0:21.0')

await page.goto(APP_URL)
await loadTrack(fixtures.track)
await page.selectOption('#format-select', 'flac')
const flac = await exportTo('clip.flac')
v = await values()
check(
  'FLAC encodes without falling back to WAV',
  /\.flac$/.test(flac.suggested) && !/unavailable/i.test(v.exportStatus),
  v.exportStatus,
)
await loadTrack(flac.target)
check('exported FLAC decodes back at 90s', (await values()).duration === '1:30.0')

// --------------------------------------------------------- rendered audio

section('Rendered audio')
async function renderWav(name, configure) {
  await page.goto(APP_URL)
  await loadTrack(fixtures.track)
  await page.selectOption('#format-select', 'wav')
  await setEnd('0:20')
  if (configure) await configure()
  await page.waitForTimeout(700)
  const { target } = await exportTo(name)
  return readWav(target)
}

const clean = await renderWav('analysis-clean.wav')
const overlay = await renderWav('analysis-overlay.wav', () => page.check('#scratch-enabled'))
const append = await renderWav('analysis-append.wav', async () => {
  await page.check('#scratch-enabled')
  await page.check('input[name="scratch-placement"][value="append"]')
})
const longScratch = await renderWav('analysis-long-scratch.wav', async () => {
  await page.check('#scratch-enabled')
  await page.check('input[name="scratch-placement"][value="append"]')
  await page.locator('#scratch-length').fill('2.5')
  await page.locator('#scratch-length').dispatchEvent('change')
})
const overlayLong = await renderWav('analysis-overlay-long.wav', async () => {
  await page.check('#scratch-enabled')
  await page.locator('#scratch-length').fill('3')
  await page.locator('#scratch-length').dispatchEvent('change')
})
const polished = await renderWav('analysis-polish.wav', async () => {
  await page.check('#fade-in-enabled')
  await page.check('#normalize')
})
const sr = clean.sampleRate

check('clean clip is 20s (±50ms)', Math.abs(clean.duration - 20) <= 0.05, `${clean.duration.toFixed(4)}s`)
check('clean clip keeps stereo @ 44.1 kHz', clean.channels === 2 && sr === 44100)
check(
  'the cut starts and ends on silence',
  Math.abs(clean.left[0]) < 0.002 && Math.abs(clean.left[clean.frames - 1]) < 0.002,
)
const edgeStep = Math.max(maxStep(clean.left, 0, 441), maxStep(clean.left, clean.frames - 441, clean.frames))
check(
  'no click at the edges',
  edgeStep <= maxStep(clean.left, 0, clean.frames),
  `edge step ${edgeStep.toFixed(4)}`,
)

check(
  'overlay scratch keeps the length',
  Math.abs(overlay.duration - 20) <= 0.05,
  `${overlay.duration.toFixed(4)}s`,
)
check('overlay tail carries audio', rms(overlay.left, overlay.frames - sr, overlay.frames) > 0.01)
let tailDiff = 0
for (let i = overlay.frames - sr; i < overlay.frames; i++)
  tailDiff += Math.abs(overlay.left[i] - clean.left[i])
check(
  'overlay tail is not just the original audio',
  tailDiff / sr > 0.05,
  `mean |diff| ${(tailDiff / sr).toFixed(4)}`,
)
let firstDiff = -1
for (let i = 0; i < overlay.frames - sr - 441; i++) {
  if (Math.abs(overlay.left[i] - clean.left[i]) > 0.002) {
    firstDiff = i
    break
  }
}
check(
  'overlay leaves the music before the scratch alone',
  firstDiff === -1,
  firstDiff === -1 ? '' : `differs at ${(firstDiff / sr).toFixed(3)}s`,
)
check('the scratch ends on a hard stop', Math.abs(overlay.left[overlay.frames - 1]) < 0.01)

check('appended scratch adds ~1s', Math.abs(append.duration - 21) <= 0.05, `${append.duration.toFixed(4)}s`)
let appendMatches = true
for (let i = 0; i < clean.frames; i += 97) {
  if (Math.abs(append.left[i] - clean.left[i]) > 0.002) {
    appendMatches = false
    break
  }
}
check('appending leaves the selection untouched', appendMatches)

check(
  'the scratch length slider sets the appended length',
  Math.abs(longScratch.duration - 22.5) <= 0.05,
  `${longScratch.duration.toFixed(4)}s`,
)
check(
  'a longer overlaid scratch still fits inside the clip',
  Math.abs(overlayLong.duration - 20) <= 0.05,
  `${overlayLong.duration.toFixed(4)}s`,
)
let overlayLongDiff = -1
for (let i = 0; i < overlayLong.frames; i++) {
  if (Math.abs(overlayLong.left[i] - clean.left[i]) > 0.002) {
    overlayLongDiff = i
    break
  }
}
check(
  'a 3s overlaid scratch starts 3s before the end',
  overlayLongDiff > 0 && Math.abs(overlayLong.duration - overlayLongDiff / sr - 3) < 0.05,
  `music ends at ${(overlayLongDiff / sr).toFixed(3)}s`,
)

check('fade-in ramps up from silence', rms(polished.left, 0, 2205) < rms(polished.left, sr, sr + 2205))
let peak = 0
for (let i = 0; i < polished.frames; i++) peak = Math.max(peak, Math.abs(polished.left[i]))
check('normalize lifts the peak near full scale', peak > 0.9, peak.toFixed(4))

// -------------------------------------------------------------- edge cases

section('Edge cases')
await page.goto(APP_URL)
await loadTrack(fixtures.mono48k)
v = await values()
check(
  'mono 48 kHz metadata survives decoding',
  v.duration === '0:45.0' && v.rate === '48,000 Hz' && v.channels === 'Mono',
  JSON.stringify(v),
)
check(
  'a track under 90s selects the whole thing',
  v.start === '0:00.0' && v.end === '0:45.0' && /shorter than 90s/.test(v.note),
)
const monoMp3 = await exportTo('mono.mp3')
await loadTrack(monoMp3.target)
v = await values()
check(
  'mono export stays mono at 48 kHz',
  v.channels === 'Mono' && v.rate === '48,000 Hz' && v.duration === '0:45.0',
  JSON.stringify(v),
)

await page.goto(APP_URL)
await loadTrack(fixtures.short)
v = await values()
check('a 2.5s track loads as a whole-track selection', v.start === '0:00.0' && v.end === '0:02.5')
check(
  'the scratch is disabled under 3s',
  v.scratchDisabled === true && /under 3s/.test(v.scratchNote),
  v.scratchNote,
)
await page.selectOption('#format-select', 'wav')
const shortWav = await exportTo('short.wav')
await loadTrack(shortWav.target)
check('a 2.5s clip exports at full length', (await values()).duration === '0:02.5')

await page.goto(APP_URL)
await loadTrack(fixtures.hires)
check('96 kHz source decodes at 96 kHz', (await values()).rate === '96,000 Hz')
const hiresMp3 = await exportTo('hires.mp3')
v = await values()
check('resampling for MP3 is reported', /resampled to 48/i.test(v.exportStatus), v.exportStatus)
await loadTrack(hiresMp3.target)
v = await values()
check(
  '96 kHz MP3 export lands at 48 kHz, same length',
  v.rate === '48,000 Hz' && v.duration === '0:10.0',
  JSON.stringify(v),
)

await page.goto(APP_URL)
await loadTrack(fixtures.hires)
await page.selectOption('#format-select', 'flac')
const hiresFlac = await exportTo('hires.flac')
await loadTrack(hiresFlac.target)
v = await values()
check(
  'FLAC keeps 96 kHz stereo',
  v.rate === '96,000 Hz' && v.channels === 'Stereo' && v.duration === '0:10.0',
  JSON.stringify(v),
)

await page.goto(APP_URL)
await loadTrack(fixtures.lofi)
await exportTo('lofi.mp3')
check('MP3 bitrate ceiling at 22.05 kHz is reported', /tops out at 160/.test((await values()).exportStatus))

await page.goto(APP_URL)
await loadTrack(fixtures.track)
await setEnd('0:20')
await page.check('#scratch-enabled')
await page.setInputFiles('#scratch-file-input', fixtures.short)
await page.waitForFunction(
  () => document.querySelector('#scratch-file-name').textContent === 'short-2s.wav',
  null,
  {
    timeout: 60_000,
  },
)
await page.check('input[name="scratch-placement"][value="append"]')
await page.selectOption('#format-select', 'wav')
await page.waitForTimeout(700)
const customAppend = await exportTo('custom-append.wav')
await loadTrack(customAppend.target)
check('a custom sample is appended at its own length', (await values()).duration === '0:22.5')

await browser.close()

check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

const failed = results.filter((result) => !result.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
