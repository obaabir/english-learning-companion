// Speaking Coach: Vite asset URL imports used by audioExtract.ts (Vite turns each into a URL string).
declare module '@ffmpeg/ffmpeg/worker?worker&url' {
  const url: string
  export default url
}
declare module '@ffmpeg/core?url' {
  const url: string
  export default url
}
declare module '@ffmpeg/core/wasm?url' {
  const url: string
  export default url
}
