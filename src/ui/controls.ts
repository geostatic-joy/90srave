import type { SfxEntry } from '../audio/library'
import { SFX_FOLDER } from '../audio/library'
import { SCRATCH_STYLE_LIST, type ScratchStyleId } from '../audio/scratch'
import type { AppState, Bitrate, ExportFormat, ScratchPlacement, ScratchSource } from '../types'
import { byId, setStatus } from '../util/dom'

export interface ControlsHandlers {
  onScratchEnabled: (value: boolean) => void
  onScratchPlacement: (value: ScratchPlacement) => void
  onScratchSource: (value: ScratchSource) => void
  onScratchStyle: (value: ScratchStyleId) => void
  onScratchFile: (file: File) => void
  onScratchLibrary: (entry: SfxEntry) => void
  onScratchLength: (value: number) => void
  onScratchVolume: (value: number) => void
  onFadeIn: (enabled: boolean, length: number) => void
  onFadeOut: (enabled: boolean, length: number) => void
  onNormalize: (value: boolean) => void
  onFormat: (value: ExportFormat) => void
  onBitrate: (value: Bitrate) => void
  onFilename: (value: string) => void
  onExport: () => void
}

/** Scratch, polish and export controls. */
export class ControlsPanel {
  private scratchEnabled = byId<HTMLInputElement>('scratch-enabled')
  private scratchOptions = byId<HTMLElement>('scratch-options')
  private scratchStyle = byId<HTMLSelectElement>('scratch-style')
  private scratchStyleHint = byId<HTMLElement>('scratch-style-hint')
  private scratchLibrary = byId<HTMLSelectElement>('scratch-library')
  private scratchLibraryField = byId<HTMLElement>('scratch-library-field')
  private scratchLibraryHint = byId<HTMLElement>('scratch-library-hint')
  private library: SfxEntry[] = []
  private scratchFileButton = byId<HTMLButtonElement>('scratch-file-button')
  private scratchFileInput = byId<HTMLInputElement>('scratch-file-input')
  private scratchFileName = byId<HTMLElement>('scratch-file-name')
  private scratchLength = byId<HTMLInputElement>('scratch-length')
  private scratchLengthOut = byId<HTMLOutputElement>('scratch-length-out')
  private scratchVolume = byId<HTMLInputElement>('scratch-volume')
  private scratchVolumeOut = byId<HTMLOutputElement>('scratch-volume-out')
  private scratchNote = byId<HTMLElement>('scratch-note')
  private fadeInEnabled = byId<HTMLInputElement>('fade-in-enabled')
  private fadeInLength = byId<HTMLInputElement>('fade-in-length')
  private fadeInOut = byId<HTMLOutputElement>('fade-in-out')
  private fadeOutEnabled = byId<HTMLInputElement>('fade-out-enabled')
  private fadeOutLength = byId<HTMLInputElement>('fade-out-length')
  private fadeOutOut = byId<HTMLOutputElement>('fade-out-out')
  private fadeOutNote = byId<HTMLElement>('fade-out-note')
  private normalize = byId<HTMLInputElement>('normalize')
  private format = byId<HTMLSelectElement>('format-select')
  private bitrate = byId<HTMLSelectElement>('bitrate-select')
  private bitrateField = byId<HTMLElement>('bitrate-field')
  private filename = byId<HTMLInputElement>('filename-input')
  private exportButton = byId<HTMLButtonElement>('export-button')
  private exportProgress = byId<HTMLProgressElement>('export-progress')
  private exportStatus = byId<HTMLElement>('export-status')

  constructor(handlers: ControlsHandlers) {
    this.scratchEnabled.addEventListener('change', () =>
      handlers.onScratchEnabled(this.scratchEnabled.checked),
    )

    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="scratch-placement"]')) {
      radio.addEventListener('change', () => {
        if (radio.checked) handlers.onScratchPlacement(radio.value as ScratchPlacement)
      })
    }
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="scratch-source"]')) {
      radio.addEventListener('change', () => {
        if (radio.checked) handlers.onScratchSource(radio.value as ScratchSource)
      })
    }

    for (const style of SCRATCH_STYLE_LIST) {
      const option = document.createElement('option')
      option.value = style.id
      option.textContent = style.label
      this.scratchStyle.appendChild(option)
    }
    this.scratchStyle.addEventListener('change', () =>
      handlers.onScratchStyle(this.scratchStyle.value as ScratchStyleId),
    )

    this.scratchLibrary.addEventListener('change', () => {
      const entry = this.library.find((sound) => sound.file === this.scratchLibrary.value)
      if (entry) handlers.onScratchLibrary(entry)
    })

    this.scratchFileButton.addEventListener('click', () => this.scratchFileInput.click())
    this.scratchFileInput.addEventListener('change', () => {
      const file = this.scratchFileInput.files?.[0]
      if (file) handlers.onScratchFile(file)
      this.scratchFileInput.value = ''
    })

    this.scratchLength.addEventListener('input', () => {
      this.scratchLengthOut.value = `${Number(this.scratchLength.value).toFixed(1)}s`
    })
    this.scratchLength.addEventListener('change', () =>
      handlers.onScratchLength(Number(this.scratchLength.value)),
    )

    this.scratchVolume.addEventListener('input', () => {
      this.scratchVolumeOut.value = `${this.scratchVolume.value}%`
    })
    this.scratchVolume.addEventListener('change', () =>
      handlers.onScratchVolume(Number(this.scratchVolume.value) / 100),
    )

    const fadeIn = () => handlers.onFadeIn(this.fadeInEnabled.checked, Number(this.fadeInLength.value))
    const fadeOut = () => handlers.onFadeOut(this.fadeOutEnabled.checked, Number(this.fadeOutLength.value))
    this.fadeInEnabled.addEventListener('change', fadeIn)
    this.fadeInLength.addEventListener('input', () => {
      this.fadeInOut.value = `${Number(this.fadeInLength.value).toFixed(1)}s`
    })
    this.fadeInLength.addEventListener('change', fadeIn)
    this.fadeOutEnabled.addEventListener('change', fadeOut)
    this.fadeOutLength.addEventListener('input', () => {
      this.fadeOutOut.value = `${Number(this.fadeOutLength.value).toFixed(1)}s`
    })
    this.fadeOutLength.addEventListener('change', fadeOut)

    this.normalize.addEventListener('change', () => handlers.onNormalize(this.normalize.checked))
    this.format.addEventListener('change', () => handlers.onFormat(this.format.value as ExportFormat))
    this.bitrate.addEventListener('change', () => handlers.onBitrate(Number(this.bitrate.value) as Bitrate))
    this.filename.addEventListener('change', () => handlers.onFilename(this.filename.value))
    this.exportButton.addEventListener('click', () => handlers.onExport())
  }

  /** Fill the dropdown from the sound-effects folder. */
  setLibrary(entries: SfxEntry[]): void {
    this.library = entries
    for (const option of [...this.scratchLibrary.options].slice(1)) option.remove()
    for (const entry of entries) {
      const option = document.createElement('option')
      option.value = entry.file
      option.textContent = entry.label
      this.scratchLibrary.appendChild(option)
    }
    this.scratchLibraryField.hidden = entries.length === 0
    this.scratchLibraryHint.textContent = entries.length
      ? ''
      : `Drop audio files into ${SFX_FOLDER}/ next to the app to list them here.`
  }

  update(state: AppState, scratchAvailable: boolean, scratchNote: string | null): void {
    const { scratch, fades } = state

    this.scratchEnabled.checked = scratch.enabled
    this.scratchEnabled.disabled = !scratchAvailable
    this.scratchOptions.hidden = !scratch.enabled
    this.scratchLength.value = String(scratch.length)
    this.scratchLengthOut.value = `${scratch.length.toFixed(1)}s`
    this.scratchVolume.value = String(Math.round(scratch.volume * 100))
    this.scratchVolumeOut.value = `${Math.round(scratch.volume * 100)}%`
    this.scratchFileName.textContent = scratch.customName ?? 'No sample loaded'
    const selected = this.library.find((sound) => sound.label === scratch.customName)
    this.scratchLibrary.value = selected?.file ?? ''
    this.scratchStyle.value = scratch.style
    this.scratchStyle.disabled = scratch.source !== 'synth'
    this.scratchStyleHint.textContent =
      scratch.source === 'synth'
        ? (SCRATCH_STYLE_LIST.find((style) => style.id === scratch.style)?.hint ?? '')
        : 'Endings apply to the built-in scratch.'
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="scratch-placement"]')) {
      radio.checked = radio.value === scratch.placement
    }
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="scratch-source"]')) {
      radio.checked = radio.value === scratch.source
    }

    if (!scratchAvailable) {
      this.scratchNote.textContent = 'Clips under 3s are too short for a scratch.'
    } else if (scratchNote) {
      this.scratchNote.textContent = scratchNote
    } else {
      this.scratchNote.textContent = ''
    }

    this.fadeInEnabled.checked = fades.fadeIn
    this.fadeInLength.value = String(fades.fadeInLength)
    this.fadeInOut.value = `${fades.fadeInLength.toFixed(1)}s`
    this.fadeOutEnabled.checked = fades.fadeOut
    this.fadeOutLength.value = String(fades.fadeOutLength)
    this.fadeOutOut.value = `${fades.fadeOutLength.toFixed(1)}s`
    // A mix lets the music finish on its own terms, so the fade-out still applies.
    const fadeOutBlocked = scratch.enabled && scratchAvailable && scratch.placement !== 'mix'
    this.fadeOutEnabled.disabled = fadeOutBlocked
    this.fadeOutLength.disabled = fadeOutBlocked
    this.fadeOutNote.textContent = fadeOutBlocked ? 'The scratch is the ending, so the fade-out is off.' : ''
    this.normalize.checked = state.normalize

    this.format.value = state.export.format
    this.bitrate.value = String(state.export.bitrate)
    this.bitrateField.hidden = state.export.format !== 'mp3'
    if (document.activeElement !== this.filename) {
      this.filename.value = state.export.filename
    }
  }

  setExportBusy(busy: boolean, progress = 0): void {
    this.exportButton.disabled = busy
    this.exportProgress.hidden = !busy
    this.exportProgress.value = Math.round(progress * 100)
  }

  setExportStatus(message: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
    setStatus(this.exportStatus, message, kind)
  }
}
