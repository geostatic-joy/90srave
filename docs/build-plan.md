# Build Plan: 90-Second Audio Snippet Tool (Browser-Based)

## Goal
A client-side web app that loads an MP3 or FLAC file, lets the user pick a window on a waveform (90 seconds by default, adjustable), preview it, optionally add a record-scratch effect at the end, and export the result as MP3 (required) or FLAC (if feasible). No server; all processing happens in the browser.

## Tech Stack
- **Build:** Vite + TypeScript (vanilla, no framework needed; React is fine if preferred)
- **Decoding:** Web Audio API `AudioContext.decodeAudioData` (handles MP3 and FLAC in current Chrome, Firefox, Safari, Edge)
- **Waveform + draggable window:** `wavesurfer.js` v7 with the Regions plugin
- **Rendering:** `OfflineAudioContext` (same pipeline for preview and export so they sound identical)
- **MP3 encoding:** `@breezystack/lamejs` (maintained lamejs fork), run in a Web Worker
- **FLAC encoding:** `libflacjs` in a Web Worker, lazy-loaded only when FLAC is selected. If it proves unworkable, fall back to offering WAV and note it in the UI.

## Core Features

### 1. File Loading
- Drag-and-drop zone plus a file picker button
- Accept `.mp3`, `.flac` (`audio/mpeg`, `audio/flac`, `audio/x-flac`)
- Show filename, duration, sample rate, channels
- Clear error message if decoding fails or the file type is unsupported

### 2. Waveform and Selection Window
- Render full-track waveform
- Default selection: 90s region starting at 0:00, draggable along the track
- **"Custom length" checkbox** (unchecked by default):
  - *Unchecked:* length locked at 90s; region is drag-only; end time and duration inputs are read-only and follow the start time
  - *Checked:* region edges become resizable by dragging; start, end, and duration inputs are all editable
- **Inputs (mm:ss.s), all kept in sync with the region:**
  - Start time
  - End time
  - Duration (editing this moves the end time, keeping start fixed)
- Editing the end or duration input, or dragging a region edge, while unchecked automatically checks "Custom length"
- **"Reset to 90s" button:** restores 90s length from the current start (shifts start back if needed to fit)
- Nudge buttons for start and end separately: −1s, −0.1s, +0.1s, +1s
- Constraints:
  - Minimum length 1s; maximum is the full track
  - Region is clamped so it never extends past the start or end of the track
  - Invalid typed values are clamped on blur, not rejected
- If the track is shorter than 90s, default to the whole track
- Scratch overlay (~1s) is disabled with a note when the clip is under 3s

### 3. Preview
- **Play selection:** plays the selected window from the start
- **Play ending:** plays the last ~8 seconds of the processed clip (to audition the scratch quickly)
- Stop button; playhead shown on the waveform
- Preview uses the rendered buffer (with effects applied), not the raw source

### 4. Record Scratch Effect
- Toggle: on/off (default off)
- **Placement option:**
  - *Overlay* (default): scratch occupies the final ~1s of the clip; music is cut at the scratch
  - *Append*: scratch plays after the full selection (output is ~1s longer)
- **Sound source option:**
  - *Built-in synthesized scratch* (default): take the last ~0.8s of the clip audio and apply a fast playback-rate sweep (forward→reverse→forward "wiggle") plus a short burst of filtered noise, then a hard stop. Generate procedurally so no licensed audio is bundled.
  - *Custom sample:* user uploads their own scratch SFX file (MP3/FLAC/WAV)
- Scratch volume slider (0–150%)

### 5. Optional Polish (nice to have)
- Fade-in toggle with length (0–3s)
- Fade-out toggle (disabled when scratch is on, since the scratch acts as the ending)
- Normalize output toggle

### 6. Export
- Format select: MP3 (default), FLAC, WAV fallback
- MP3 bitrate select: 128 / 192 / 320 kbps (default 320)
- Preserve source sample rate and channel count (downmix to stereo if more than 2 channels)
- Editable output filename, default `{original}_snippet_{start mm-ss}_{duration}s.mp3`
- Progress indicator while encoding; UI stays responsive (worker)
- Trigger download via Blob URL

## Architecture
```
src/
  main.ts              # wiring, app state
  ui/
    fileLoader.ts
    waveform.ts        # wavesurfer + region, custom-length toggle, time inputs, nudges
    controls.ts        # scratch, fades, export options
  audio/
    decode.ts          # File -> AudioBuffer
    render.ts          # OfflineAudioContext: slice, fades, scratch -> AudioBuffer
    scratch.ts         # synthesized scratch + custom sample handling
    player.ts          # preview playback of rendered buffer
  export/
    encodeMp3.worker.ts
    encodeFlac.worker.ts
    encodeWav.ts
    download.ts
index.html
```

**State:** `{ sourceBuffer, startTime, endTime, customLength, scratch: { enabled, placement, source, customBuffer, volume }, fades, export: { format, bitrate, filename } }`

**Render flow:** state change → debounce (~300ms) → `render(sourceBuffer, state)` → cached rendered buffer used for both preview and export.

## Milestones
1. Scaffold Vite + TS project; file load and decode; show metadata
2. Waveform with 90s draggable region, clamping, start/end/duration inputs, custom-length toggle with resizable edges, reset to 90s, nudge buttons
3. Render pipeline (slice only) and preview playback with playhead
4. MP3 export in a worker with bitrate options
5. Synthesized record scratch (overlay + append modes), then custom sample upload
6. FLAC export (lazy-loaded), WAV fallback
7. Fades, normalize, polish, error handling, responsive layout

## Acceptance Criteria
- Loads a typical 5-minute MP3 and FLAC file without freezing the tab
- Region cannot be dragged or resized outside track bounds or below 1s
- Start, end, and duration inputs stay in sync with the region in both directions
- With custom length off, the length never changes from 90s
- Exported MP3 matches the selected duration (±50ms) in overlay mode, +~1s in append mode
- Preview and exported audio sound the same
- Scratch toggle off produces a clean cut with no clicks (apply a 5ms micro-fade at edges)
- Works in latest Chrome, Firefox, and Safari
- Nothing is uploaded anywhere; works offline after first load

## Notes for the Builder
- Keep large buffers off the main thread where possible; transfer `Float32Array`s to workers
- lamejs expects 16-bit PCM `Int16Array` chunks (1152 samples per frame)
- Revoke Blob URLs after download
- Test with mono files, 48kHz files, files under 90s, and very short (1–3s) and full-track selections
- wavesurfer Regions: toggle `resize` on the region when the checkbox changes; listen to `region-updated` to sync inputs
