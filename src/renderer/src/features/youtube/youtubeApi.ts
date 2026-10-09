/** Minimal types for YouTube's official IFrame Player API. */
export interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  setPlaybackRate(rate: number): void
  destroy(): void
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string
      host?: string
      width?: string
      height?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: (e: { target: YTPlayer }) => void
        onStateChange?: (e: { data: number; target: YTPlayer }) => void
        onError?: (e: { data: number }) => void
      }
    }
  ) => YTPlayer
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number; CUED: number }
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let loading: Promise<YTNamespace> | null = null

/** Loads the official IFrame Player API once. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        previous?.()
        resolve(window.YT!)
      }
      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      script.onerror = () => {
        loading = null
        reject(new Error('Could not load the YouTube player. Check your internet connection.'))
      }
      document.head.append(script)
    })
  }
  return loading
}

/** Player error codes → plain messages. */
export function playerErrorMessage(code: number): string {
  if (code === 2) return 'This video link is not valid.'
  if (code === 5) return "This video can't be played in the embedded player."
  if (code === 100) return 'This video was not found. It may be private or deleted.'
  if (code === 101 || code === 150) return "The video's owner doesn't allow it to be played inside other apps."
  if (code === 152 || code === 153) return 'YouTube refused to load the player here (embedding check failed).'
  return `The YouTube player reported an error (${code}).`
}
