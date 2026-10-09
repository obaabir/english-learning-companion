import type { Api, ApiChannel, EventChannel, Events } from '@shared/ipcContract'

export function invoke<K extends ApiChannel>(channel: K, ...args: Parameters<Api[K]>): ReturnType<Api[K]> {
  return window.api.invoke(channel, ...args)
}

export function on<K extends EventChannel>(channel: K, listener: (payload: Events[K]) => void): () => void {
  return window.api.on(channel, listener)
}

/** Strips Electron's "Error invoking remote method…" wrapper from IPC errors. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(Error:\s*)+/, '')
}

export function newRequestId(): string {
  return crypto.randomUUID()
}

/** Calls a streaming AI channel, forwarding chunks for this request to onDelta. */
export async function streamCall<T>(requestId: string, onDelta: (delta: string) => void, call: () => Promise<T>): Promise<T> {
  const off = on('ai:chunk', (c) => {
    if (c.requestId === requestId) onDelta(c.delta)
  })
  try {
    return await call()
  } finally {
    off()
  }
}
