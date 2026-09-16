/** Look up an element by id, failing loudly when the markup and code disagree. */
export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing element #${id}`)
  return element as T
}

export type StatusKind = 'info' | 'error' | 'ok'

export function setStatus(element: HTMLElement, message: string, kind: StatusKind = 'info'): void {
  element.textContent = message
  element.classList.toggle('status--error', kind === 'error')
  element.classList.toggle('status--ok', kind === 'ok')
}
