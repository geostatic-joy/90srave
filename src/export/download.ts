/** Hand a blob to the browser as a download, then let the URL go. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the download a moment to start before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
