import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { PreloadBridge } from '@shared/ipcContract'

const bridge: PreloadBridge = {
  invoke: ((channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)) as PreloadBridge['invoke'],
  on(channel, listener) {
    const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

contextBridge.exposeInMainWorld('api', bridge)
