/**
 * Converts a browser recording (webm/opus) to 16 kHz mono WAV, a format Gemini accepts,
 * and returns it as base64. Runs locally; nothing is saved.
 */
export async function recordingToWavBase64(blob: Blob): Promise<string> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const rate = 16000
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate)
    const src = offline.createBufferSource()
    src.buffer = decoded
    src.connect(offline.destination)
    src.start()
    const pcm = (await offline.startRendering()).getChannelData(0)
    const buf = new ArrayBuffer(44 + pcm.length * 2)
    const v = new DataView(buf)
    const str = (o: number, s: string): void => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
    str(0, 'RIFF')
    v.setUint32(4, 36 + pcm.length * 2, true)
    str(8, 'WAVEfmt ')
    v.setUint32(16, 16, true)
    v.setUint16(20, 1, true)
    v.setUint16(22, 1, true)
    v.setUint32(24, rate, true)
    v.setUint32(28, rate * 2, true)
    v.setUint16(32, 2, true)
    v.setUint16(34, 16, true)
    str(36, 'data')
    v.setUint32(40, pcm.length * 2, true)
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true)
    let binary = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
  } finally {
    void ctx.close()
  }
}
