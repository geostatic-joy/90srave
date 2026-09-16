# 90s Rave

A browser-only tool for cutting a 90-second snippet out of an MP3 or FLAC, landing it
with a record scratch, and exporting the result as MP3, FLAC or WAV.

Nothing is uploaded anywhere: decoding, editing and encoding all happen in the tab, and
the app works offline after the first load.

## Quick start

```bash
npm install
npm run dev
```

Then drop an MP3 or FLAC on the page.

```bash
npm run build     # typecheck + production build into dist/
npm run preview   # serve the production build
```

## What it does

**Selection**

- Loads any file the browser can decode (`.mp3`, `.flac`, `.wav`, and whatever else the
  platform supports), and shows duration, sample rate and channel count.
- Defaults to a 90-second window at `0:00`, drawn as a draggable region on the waveform.
  Tracks shorter than 90s select the whole thing.
- **Custom length** is off by default: the region drags but never resizes, and the end and
  length fields follow the start. Turning it on (or trying to edit the end or length, or
  nudging the end) makes both edges resizable and all three fields editable.
- Start, end and length inputs accept `mm:ss.s`, `h:mm:ss.s` or plain seconds, stay in sync
  with the region in both directions, and clamp out-of-range values instead of rejecting them.
- Nudge buttons for the start and end (±1s, ±0.1s), a **Reset to 90s** button, a 1-second
  minimum, and clamping that keeps the region inside the track.
- The window is marked with thick edges (and chunky grab handles once it is resizable), and
  everything outside it is shaded back. Moving the window stops preview playback, since
  whatever is playing is no longer the clip you are looking at.

**Record scratch**

- Off by default. Needs a clip of at least 3 seconds.
- Three placements: _Overlay_ (default) cuts the music and replaces the tail of the clip;
  _Append_ plays the ending after the full selection, making the output longer; _Mix_ lays it
  over the top of the last few seconds while the music runs to its own end. A mix is the one
  placement that leaves the fade-out available, since the music still ends on its own terms.
- Five built-in endings, all synthesized from the track's own audio — a position curve read
  out of the source plus filtered surface noise, so nothing licensed is bundled:
  - **Classic scratch** (1s) — back, forward, back, then a coast to a dead stop.
  - **Chatter run** (1.6s) — six shrinking back-and-forth swings that settle onto the cut.
  - **Spin-back rewind** (1.5s) — the record yanked backwards, faster and faster, then dropped.
  - **Needle drag** (2s) — someone bumps the turntable and the needle skids across the record,
    lurching forward before the long scrape.
  - **Power down** (2.5s) — the turntable switched off: the music keeps rolling forward past
    the cut while the platter coasts to a halt and the pitch sags with it.
- Picking an ending sets the length slider to that ending's natural length; move it from there.
- Or use your own sound effect: pick one from the **Sound effect** dropdown, which lists the
  [`public/sfx/`](public/sfx/) folder, or upload a file. Either way it is resampled and
  re-channelled to match the clip.
- Scratch length runs from 0.3s to 5s. The gestures are defined in normalized time, so a
  longer setting stretches the same motion into a slower one; for a custom sample it trims
  instead (the sample loads at its own length to start with).
  An overlaid scratch is capped so at least half a second of music survives in front of it.
- Scratch volume runs from 0 to 150%.

**Polish and export**

- Optional fade-in (0–3s), fade-out (switched off while the scratch is the ending, but
  available with a mix), and peak normalization.
- MP3 (128/192/320 kbps), FLAC, or WAV. Sample rate and channel count are preserved;
  more than two channels are folded down to stereo.
- Filename defaults to `{original}_snippet_{mm-ss}_{length}s.{ext}` and is editable.
- Encoding runs in a worker, so the UI stays responsive, and the download is handed over
  through a blob URL that is revoked afterwards.

## How it works

```
src/
  main.ts              app state, debounced re-render, wiring
  selection.ts         selection rules (clamping, locked vs custom length)
  types.ts             app state shape
  audio/
    context.ts         shared AudioContext and buffer allocation
    sniff.ts           reads the native sample rate out of WAV/FLAC/MP3 headers
    decode.ts          File -> AudioBuffer
    buffers.ts         slicing, downmixing, resampling, normalizing
    scratch.ts         synthesized scratch, custom sample conforming
    library.ts         the sfx folder's index and its sound effects
    render.ts          OfflineAudioContext: slice + fades + scratch -> AudioBuffer
    player.ts          preview playback of the rendered buffer
  ui/
    fileLoader.ts      drop zone and file picker
    waveform.ts        wavesurfer.js + the selection region
    selectionPanel.ts  time inputs, nudges, custom-length toggle, reset
    controls.ts        scratch, polish and export controls
  export/
    pcm.ts             AudioBuffer -> transferable Float32Arrays
    encodeMp3.worker.ts
    encodeWav.ts
    encode.ts          format dispatch, worker plumbing, fallbacks
    download.ts
public/flac/
  flacEncoderWorker.js the FLAC worker (plain JS, loads libflac via importScripts)
public/sfx/            drop sound effects here (see below)
```

Every state change debounces into a single `renderClip()` pass that produces one
`AudioBuffer`. Preview plays that buffer and export encodes that same buffer, so what you
hear is what you get. Both ends of the clip always get a 5 ms micro-fade, so cuts do not click.

Two details worth knowing:

- **Native sample rate.** `decodeAudioData` resamples to the decoding context's rate, which
  would silently turn a 96 kHz master into 44.1 kHz. The header sniffer in `audio/sniff.ts`
  reads the file's real rate first so the decode can happen at that rate, with a fallback to
  the shared context if the header is unreadable.
- **MP3 limits.** MPEG only carries a fixed set of sample rates, so anything else is
  resampled to 48 kHz, and 320 kbps is not available below 32 kHz. Either case is reported
  in the export status line rather than being applied silently.

## Sound effects folder

Put audio files in **`public/sfx/`** and they appear in the scratch panel's **Sound effect**
dropdown. `.mp3`, `.wav`, `.flac`, `.ogg`, `.opus`, `.m4a` and `.aac` are picked up, and the
label comes from the filename (`needle-drop_02.wav` → "Needle drop 02").

Static hosting cannot list a directory, so the app fetches `sfx/index.json` to know what is
there. `scripts/build-sfx-index.mjs` writes that file and runs as part of `npm run dev`,
`npm run build` and `npm install` — so in development, just drop files in and restart.

On an already-deployed site the same script works against the deployed folder, no rebuild
needed:

```bash
node scripts/build-sfx-index.mjs /path/to/deployed/sfx
```

To rename an entry, edit its `label` in `index.json`; regenerating keeps labels you changed.
An empty or missing folder simply hides the dropdown, leaving the upload button.

`libflac.js` is an emscripten build that has to be loaded with `importScripts()` and finds its
`.wasm` next to itself, so `scripts/vendor-flac.mjs` copies it into `public/flac/` on install
and before each build. If the FLAC worker cannot start for any reason, the export falls back
to WAV and says so.

## The plan

The original build plan this was written from is kept at [`docs/build-plan.md`](docs/build-plan.md).
Two places where the build departs from it:

- The plan does not mention sample-rate sniffing, but "preserve source sample rate" is not
  reachable without it — see the note above.
- The plan asks for the end and length fields to be read-only while the length is locked _and_
  for editing them to switch custom length on. Both hold here: the fields are read-only, and a
  click or keystroke on one switches custom length on first.

## Tests

End-to-end checks drive the built app in Chromium, export real files, and measure the audio
that comes back out (lengths, silent edges, scratch placement, fades, normalization) plus
mono / 48 kHz / 96 kHz / 22.05 kHz / sub-3-second edge cases.

```bash
npm i -D playwright && npx playwright install chromium
npm run build
npm run preview &
npm run test:browser          # override APP_URL to point somewhere else
```

Fixtures are generated on first run into `tests/.fixtures`.

## Browser support

Latest Chrome, Firefox, Safari and Edge. FLAC decoding needs a recent version of any of
them; if the browser cannot decode a file, the app says so instead of failing silently.
