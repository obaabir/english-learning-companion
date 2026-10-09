import type { PreloadBridge } from '@shared/ipcContract'

declare global {
  interface Window {
    api: PreloadBridge
  }
}

export {}
