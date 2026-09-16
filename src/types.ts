import { DEFAULT_SCRATCH_LENGTH, DEFAULT_SCRATCH_STYLE, type ScratchStyleId } from './audio/scratch'

export type ScratchPlacement = 'overlay' | 'append' | 'mix'
export type ScratchSource = 'synth' | 'custom'
export type ExportFormat = 'mp3' | 'flac' | 'wav'
export type Bitrate = 128 | 192 | 320

export interface ScratchState {
  enabled: boolean
  placement: ScratchPlacement
  source: ScratchSource
  /** Which synthesized ending to build; ignored for a custom sample. */
  style: ScratchStyleId
  customBuffer: AudioBuffer | null
  customName: string | null
  /** Seconds. Trims a custom sample; stretches the synthesized gesture. */
  length: number
  /** 0..1.5 (UI shows 0–150%) */
  volume: number
}

export interface FadeState {
  fadeIn: boolean
  fadeInLength: number
  fadeOut: boolean
  fadeOutLength: number
}

export interface ExportState {
  format: ExportFormat
  bitrate: Bitrate
  filename: string
}

export interface AppState {
  file: File | null
  sourceBuffer: AudioBuffer | null
  startTime: number
  endTime: number
  customLength: boolean
  scratch: ScratchState
  fades: FadeState
  normalize: boolean
  export: ExportState
}

export function createInitialState(): AppState {
  return {
    file: null,
    sourceBuffer: null,
    startTime: 0,
    endTime: 90,
    customLength: false,
    scratch: {
      enabled: false,
      placement: 'overlay',
      source: 'synth',
      style: DEFAULT_SCRATCH_STYLE,
      customBuffer: null,
      customName: null,
      length: DEFAULT_SCRATCH_LENGTH,
      volume: 1,
    },
    fades: {
      fadeIn: false,
      fadeInLength: 0.5,
      fadeOut: false,
      fadeOutLength: 0.5,
    },
    normalize: false,
    export: {
      format: 'mp3',
      bitrate: 320,
      filename: 'snippet.mp3',
    },
  }
}
