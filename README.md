# 90s Rave

A browser-only tool for cutting a 90-second snippet out of an MP3 or FLAC, landing it
with a record scratch, and exporting the result as MP3, FLAC or WAV.

Nothing is uploaded anywhere: decoding, editing and encoding all happen in the tab. Once the
page has loaded it makes no network requests at all, apart from fetching a sound effect from
its own folder if you pick one.

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
  everything outside it is shaded back.
- Click anywhere on the waveform — inside the window or out — to drop the playhead there and
  hear the **raw track** from that point, so you can roam around and find your spot.
  **Move selection to playhead** then drops the window where you are, keeping its length.
- Moving the window stops clip playback, since whatever is playing is no longer the clip you
  are looking at. It does not interrupt an audition of the track, which is unaffected by
  where the window sits.

**Record scratch**

- Off by default. Needs a clip of at least 3 seconds.
- Three placements: _Overlay_ (default) cuts the music and replaces the tail of the clip;
  _Append_ plays the ending after the full selection, making the output longer; _Mix_ lays it
  over the top of the last few seconds while the music runs to its own end. A mix is the one
  placement that leaves the fade-out available, since the music still ends on its own terms.
- Fifteen built-in endings, all synthesized from the track's own audio — a position or speed
  curve read out of the source, plus filtered noise, tones, filter sweeps, bit crushing and a
  feedback delay, so nothing licensed is bundled. _Hand on the record:_
  - **Classic scratch** (1s) — back, forward, back, then a coast to a dead stop.
  - **Chatter run** (1.6s) — six shrinking back-and-forth swings that settle onto the cut.
  - **Spin-back rewind** (1.5s) — the record yanked backwards, faster and faster, then dropped.
  - **Needle drag** (2s) — someone bumps the turntable and the needle skids across the record,
    lurching forward before the long scrape.
  - **Power down** (2.5s) — the turntable switched off: the music keeps rolling forward past
    the cut while the platter coasts to a halt and the pitch sags with it.

  _The machine gives up:_
  - **Power surge** (2s) — the deck browns out. The motor hunts either side of normal and
    lurches backwards on the worst sags, the sound gates in and out, and 60 Hz mains hum
    swells underneath until it all dies.
  - **Warped pressing** (3s) — a record with a bend in it: the pitch wows about once per
    revolution, deeper every turn, over a low thump, until the needle gives up.
  - **CD skip** (1.8s) — the last fragment sticks and repeats, each pass shorter than the one
    before, seams dipped so the stutter glitches without clicking.
  - **Tape chew** (2.5s) — the machine eats the tape: the speed sags hard then crawls, flutter
    wobbles it, the signal drops out where the tape loses the head, and it slurs to a stop.
  - **Radio tune-out** (3s) — the station drifts off the dial. The music keeps playing but
    static swells over it and a heterodyne whistle climbs away into nothing.

  _Taken somewhere else:_
  - **Dub echo out** (3s) — the last bar is thrown into a damped feedback delay: the dry
    signal is pulled and the repeats ring away on their own.
  - **Underwater** (3s) — the track sinks. A two-pole lowpass closes from 9 kHz down to about
    180 Hz while the pitch sags and a slow warble sets in.
  - **Digital death** (2s) — the player degrades: sample rate collapses from 48 kHz to a few
    hundred hertz and bit depth from 16 to about two, until it is a buzz that freezes over.
  - **Dissolve** (2.5s) — the track crumbles into 60 ms grains that scatter backwards, spread
    further apart, and thin out until nothing is left.
  - **Pass-by** (2s) — the track flies past like a car: the pitch drops through the middle,
    the level swells and recedes, and it muffles as it goes away from you.

- Picking an ending sets the length slider to that ending's natural length; move it from there.
- Or use your own sound effect: pick one from the **Sound effect** dropdown, which lists the
  [`public/sfx/`](public/sfx/) folder, or upload a file. Either way it is resampled and
  re-channelled to match the clip.
- Scratch length runs from 0.3s to 5s. The built-in gestures are defined in normalized time,
  so a longer setting stretches the same motion into a slower one. A custom sample loads at
  its own length and then follows the slider, either by **stretching** — varispeed, so it
  slows down and drops in pitch the way a turntable would — or by **trimming**, which can
  only shorten it. An overlaid scratch is capped so at least half a second of music survives
  in front of it.
- **Play sample** auditions a custom sample on its own, at the length, fit and volume the
  clip would use it at.
- Scratch volume runs from 0 to 150%.

**Preview**

- **Play selection** and **Play ending** play the rendered clip, effects and all, so they
  sound exactly like the export. Clicking the waveform plays the source track instead.

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

## Deploying

There is no backend. `npm run build` produces a `dist/` folder of static files — about a
megabyte — that any static host will serve: GitHub Pages, Netlify, Vercel, Cloudflare Pages,
S3, plain nginx. No rewrite rules (it is one page), no environment variables, and no
cross-origin isolation headers (nothing here uses `SharedArrayBuffer`).

`base` is `./` in the Vite config, so every asset path is relative and the app works at a
domain root or in a subdirectory — a GitHub Pages project site at `/90srave/` needs no
changes, sound-effects folder included.

`.github/workflows/deploy.yml` publishes to GitHub Pages on every push to `main`. It needs
one manual step first: **Settings → Pages → Source: GitHub Actions**.

The FLAC worker's `.wasm` is served as a plain file. Hosts generally send it as
`application/wasm`; on one that does not, libflac falls back to an XHR fetch, and if that
fails too the export falls back to WAV and says so rather than breaking.

There is no service worker, so the app is only as offline-capable as the browser's HTTP
cache makes it.

## Browser support

Latest Chrome, Firefox, Safari and Edge. FLAC decoding needs a recent version of any of
them; if the browser cannot decode a file, the app says so instead of failing silently.
