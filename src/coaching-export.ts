export async function copyCoachingText(text: string, clipboard: Pick<Clipboard, 'writeText'> | undefined): Promise<boolean> {
  if (!clipboard) return false
  try { await clipboard.writeText(text); return true } catch { return false }
}
export function downloadCoachingFile(contents: string, format: 'md' | 'json', exportDate: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = `athlete-lab-coaching-context-${exportDate.slice(0, 10)}.${format}`
  document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
