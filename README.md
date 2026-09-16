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
- _Overlay_ (default) replaces the final second of the clip; _Append_ plays the scratch
  after the full selection, making the output about a second longer.
- The built-in scratch is synthesized from the clip's own final moments — a playback
  position sweep (backwards, forwards, backwards, then a coast to a dead stop) over a
  burst of filtered surface noise. Nothing licensed is bundled.
- Or upload your own scratch sample, which gets resampled and re-channelled to match.
- Scratch volume runs from 0 to 150%.

**Polish and export**

- Optional fade-in (0–3s), fade-out (switched off while the scratch is the ending), and
  peak normalization.
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
