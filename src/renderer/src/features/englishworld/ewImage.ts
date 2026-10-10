// English World: photos are compressed on this device before posting.
export const MAX_SIDE = 1080
export const MAX_BYTES = 1024 * 1024

/** Bytes of a base64 data URL. */
export const dataUrlBytes = (url: string): number => Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4)

/** Longest side 1080 px, JPEG ~0.7 (lower if needed); rejects if still over 1 MB. */
export async function compressPhoto(file: Blob): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error('Please choose a photo (JPG or PNG).')
  const bmp = await createImageBitmap(file).catch(() => null)
  if (!bmp) throw new Error("This photo can't be opened. Try another one.")
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("This photo can't be prepared.")
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  for (const q of [0.7, 0.6, 0.5]) {
    const url = canvas.toDataURL('image/jpeg', q)
    if (dataUrlBytes(url) <= MAX_BYTES) return url
  }
  throw new Error('This photo is still bigger than 1 MB after making it smaller. Please choose another one.')
}
