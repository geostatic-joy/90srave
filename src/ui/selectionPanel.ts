import type { Selection } from '../selection'
import { DEFAULT_LENGTH } from '../selection'
import { byId } from '../util/dom'
import { formatTime, parseTime } from '../util/time'

export interface SelectionPanelHandlers {
  onStart: (value: number) => void
  onEnd: (value: number) => void
  onLength: (value: number) => void
  onNudge: (target: 'start' | 'end', delta: number) => void
  onCustomLength: (value: boolean) => void
  onReset: () => void
}

/** Time inputs, nudge buttons, the custom-length toggle and the reset button. */
export class SelectionPanel {
  private startInput = byId<HTMLInputElement>('start-input')
  private endInput = byId<HTMLInputElement>('end-input')
  private lengthInput = byId<HTMLInputElement>('duration-input')
  private customLength = byId<HTMLInputElement>('custom-length')
  private resetButton = byId<HTMLButtonElement>('reset-90')
  private note = byId<HTMLElement>('selection-note')
  private selection: Selection = { start: 0, end: DEFAULT_LENGTH }

  constructor(handlers: SelectionPanelHandlers) {
    const commit = (input: HTMLInputElement, apply: (value: number) => void) => {
      input.addEventListener('change', () => {
        const value = parseTime(input.value)
        if (value === null) {
          this.render()
          return
        }
        apply(value)
      })
    }

    commit(this.startInput, handlers.onStart)
    commit(this.endInput, handlers.onEnd)
    commit(this.lengthInput, handlers.onLength)

    // The end and length fields are read-only while the length is locked.
    // Trying to edit one is taken as a request to unlock, so the keystroke
    // that follows lands in a field that is already editable.
    const unlockOnEdit = (input: HTMLInputElement) => {
      const unlock = () => {
        if (input.readOnly) handlers.onCustomLength(true)
      }
      input.addEventListener('pointerdown', unlock)
      input.addEventListener('keydown', (event) => {
        const typing = event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete'
        if (typing) unlock()
      })
    }
    unlockOnEdit(this.endInput)
    unlockOnEdit(this.lengthInput)

    for (const group of document.querySelectorAll<HTMLElement>('.nudges')) {
      const target = group.dataset.target === 'end' ? 'end' : 'start'
      for (const button of group.querySelectorAll<HTMLButtonElement>('button[data-nudge]')) {
        button.addEventListener('click', () => {
          handlers.onNudge(target, Number(button.dataset.nudge))
        })
      }
    }

    this.customLength.addEventListener('change', () => handlers.onCustomLength(this.customLength.checked))
    this.resetButton.addEventListener('click', () => handlers.onReset())
  }

  update(selection: Selection, customLength: boolean, trackDuration: number): void {
    this.selection = selection
    this.customLength.checked = customLength
    this.endInput.readOnly = !customLength
    this.lengthInput.readOnly = !customLength
    const length = selection.end - selection.start
    if (trackDuration > 0 && trackDuration < DEFAULT_LENGTH) {
      this.note.textContent = `Track is shorter than ${DEFAULT_LENGTH}s — using the whole thing.`
    } else if (!customLength) {
      this.note.textContent = `Length locked at ${formatTime(length)} — drag the region to move it.`
    } else {
      this.note.textContent = 'Drag the region edges to resize.'
    }
    this.render()
  }

  private render(): void {
    this.startInput.value = formatTime(this.selection.start)
    this.endInput.value = formatTime(this.selection.end)
    this.lengthInput.value = formatTime(this.selection.end - this.selection.start)
  }
}
