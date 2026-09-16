import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/plugins/regions'
import { MIN_LENGTH } from '../selection'

export interface WaveformHandlers {
  /** Fired while a region is dragged (`side` undefined) or resized. */
  onRegionChange: (start: number, end: number, side: 'start' | 'end' | undefined) => void
  /** Fired when a region drag or resize finishes. */
  onRegionCommit: () => void
  /** Fired when the user clicks the waveform outside the region. */
  onSeek: (time: number) => void
}

const REGION_ID = 'selection'

/** Peaks for the waveform display, mirroring wavesurfer's own exportPeaks(). */
function computePeaks(buffer: AudioBuffer, maxLength = 8000): number[][] {
  const channels = Math.min(2, buffer.numberOfChannels)
  const peaks: number[][] = []
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    const bucket = data.length / maxLength
    const channelPeaks: number[] = []
    for (let i = 0; i < maxLength; i++) {
      const from = Math.floor(i * bucket)
      const to = Math.min(data.length, Math.ceil((i + 1) * bucket))
      let peak = 0
      for (let j = from; j < to; j++) {
        if (Math.abs(data[j]) > Math.abs(peak)) peak = data[j]
      }
      channelPeaks.push(Math.round(peak * 10000) / 10000)
    }
    peaks.push(channelPeaks)
  }
  return peaks
}

/** wavesurfer + the selection region. Display only — playback runs through PreviewPlayer. */
export class WaveformView {
  private wavesurfer: WaveSurfer | null = null
  private region: Region | null = null
  private duration = 0
  private dimBefore: HTMLElement | null = null
  private dimAfter: HTMLElement | null = null

  constructor(
    private container: HTMLElement,
    private handlers: WaveformHandlers,
  ) {}

  async load(buffer: AudioBuffer, start: number, end: number, resizable: boolean): Promise<void> {
    this.destroy()
    this.duration = buffer.duration

    const regions = RegionsPlugin.create()
    const wavesurfer = WaveSurfer.create({
      container: this.container,
      height: 120,
      waveColor: '#6c5f9c',
      progressColor: '#ff5ea8',
      cursorColor: '#4be0d0',
      cursorWidth: 2,
      normalize: true,
      interact: true,
      // No media: the waveform is drawn from peaks we decoded ourselves, and
      // preview playback is handled by the Web Audio pipeline instead.
      peaks: computePeaks(buffer),
      duration: buffer.duration,
      plugins: [regions],
    })

    this.wavesurfer = wavesurfer

    await new Promise<void>((resolve) => {
      wavesurfer.once('ready', () => resolve())
    })

    this.region = regions.addRegion({
      id: REGION_ID,
      start,
      end,
      drag: true,
      resize: resizable,
      minLength: MIN_LENGTH,
      color: 'rgba(255, 94, 168, 0.26)',
    })

    // Shade everything outside the selection, so the window reads at a glance.
    this.dimBefore = this.addDimmer()
    this.dimAfter = this.addDimmer()
    this.syncDimmers(start, end)

    regions.on('region-update', (region, side) => {
      if (region.id !== REGION_ID) return
      this.handlers.onRegionChange(region.start, region.end, side)
    })
    regions.on('region-updated', (region) => {
      if (region.id !== REGION_ID) return
      this.handlers.onRegionCommit()
    })
    wavesurfer.on('interaction', (time: number) => {
      this.handlers.onSeek(time)
    })
  }

  /** Push a selection into the region without echoing a change event back. */
  setRegion(start: number, end: number): void {
    this.region?.setOptions({ start, end })
    this.syncDimmers(start, end)
  }

  private addDimmer(): HTMLElement {
    const dimmer = document.createElement('div')
    dimmer.className = 'waveform__dim'
    this.container.appendChild(dimmer)
    return dimmer
  }

  private syncDimmers(start: number, end: number): void {
    if (!this.dimBefore || !this.dimAfter || this.duration <= 0) return
    const from = Math.max(0, Math.min(100, (start / this.duration) * 100))
    const to = Math.max(0, Math.min(100, (end / this.duration) * 100))
    this.dimBefore.style.left = '0'
    this.dimBefore.style.width = `${from}%`
    this.dimAfter.style.left = `${to}%`
    this.dimAfter.style.width = `${100 - to}%`
  }

  setResizable(resizable: boolean): void {
    this.region?.setOptions({ resize: resizable })
  }

  setPlayhead(time: number): void {
    if (!this.wavesurfer || this.duration <= 0) return
    this.wavesurfer.setTime(Math.max(0, Math.min(this.duration, time)))
  }

  destroy(): void {
    this.wavesurfer?.destroy()
    this.wavesurfer = null
    this.region = null
    // The dimmers live next to wavesurfer's host, so they are ours to clean up.
    this.dimBefore?.remove()
    this.dimAfter?.remove()
    this.dimBefore = null
    this.dimAfter = null
  }
}
