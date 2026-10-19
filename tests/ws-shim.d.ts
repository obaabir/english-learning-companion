// Minimal types for the `ws` package (installed with @google/genai), used by the fake Gemini Live
// server in tests/liveVoice.test.ts.
declare module 'ws' {
  import type { AddressInfo } from 'node:net'
  export interface WebSocket {
    send(data: string): void
    close(code?: number, reason?: string): void
    on(event: 'message', listener: (data: unknown) => void): void
    on(event: 'close', listener: () => void): void
  }
  export class WebSocketServer {
    constructor(options: { port: number; host?: string }, callback?: () => void)
    on(event: 'connection', listener: (ws: WebSocket) => void): void
    address(): AddressInfo | string
    close(): void
  }
}
