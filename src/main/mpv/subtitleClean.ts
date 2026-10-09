/** Normalises raw mpv `sub-text` into one clean line. */
export function cleanSubtitle(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .replace(/\{\\[^}]*\}/g, '') // ASS override tags
    .replace(/<[^>]+>/g, '') // HTML-style tags
    .replace(/\\[Nn]/g, '\n') // ASS line breaks
    .replace(/^\s*-\s*/gm, '- ')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
