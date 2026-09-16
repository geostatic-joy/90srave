import { byId } from '../util/dom'

/** Drop zone plus file picker for the main track. */
export function initFileLoader(onFile: (file: File) => void): void {
  const zone = byId<HTMLElement>('drop-zone')
  const button = byId<HTMLButtonElement>('file-button')
  const input = byId<HTMLInputElement>('file-input')

  button.addEventListener('click', () => input.click())
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (file) onFile(file)
    // Allow re-picking the same file.
    input.value = ''
  })

  const setOver = (over: boolean) => zone.classList.toggle('drop-zone--over', over)

  zone.addEventListener('dragover', (event) => {
    event.preventDefault()
    setOver(true)
  })
  zone.addEventListener('dragleave', () => setOver(false))
  zone.addEventListener('drop', (event) => {
    event.preventDefault()
    setOver(false)
    const file = event.dataTransfer?.files?.[0]
    if (file) onFile(file)
  })

  // Stop the browser from navigating away when a file misses the drop zone.
  window.addEventListener('dragover', (event) => event.preventDefault())
  window.addEventListener('drop', (event) => event.preventDefault())
}
