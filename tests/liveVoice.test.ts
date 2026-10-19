import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import { classifyLiveError, LiveVoice } from '../src/main/voice/live'
import { currentTime, weatherForVoice } from '../src/main/voice/liveMainTools'
import { liveFunctionDeclarations, validateToolCall, type LiveEvent } from '../src/shared/liveTools'

describe('Voice Mode tools are validated', () => {
  it('only listed tools, only their own arguments, allowed values', () => {
    expect(validateToolCall('open_section', { section: 'articles' })).toEqual({ ok: true, name: 'open_section', args: { section: 'articles' } })
    expect(validateToolCall('run_command', { cmd: 'del *' })).toMatchObject({ ok: false })
    expect(validateToolCall('open_section', { section: 'C:/Windows' })).toMatchObject({ ok: false })
    expect(validateToolCall('open_section', {})).toMatchObject({ ok: false })
    expect(validateToolCall('save_selected_item', { kind: 'word', path: '/etc' })).toMatchObject({ ok: false })
    expect(validateToolCall('get_weather', { city: 42 })).toMatchObject({ ok: false })
    expect(validateToolCall('get_weather', {})).toEqual({ ok: true, name: 'get_weather', args: {} })
    // Nothing that deletes, runs code or opens files is even declared.
    expect(liveFunctionDeclarations().map((d) => d.name).join(' ')).not.toMatch(/delete|remove|exec|run|shell|file/)
  })

  it('time comes from the system clock, in the configured or asked zone', () => {
    const now = new Date('2026-10-19T08:05:00Z')
    expect(currentTime(undefined, 'Asia/Dhaka', now)).toMatchObject({ ok: true, time: '2:05 PM', timezone: 'Asia/Dhaka', source: "this computer's clock" })
    expect(currentTime('Europe/London', 'Asia/Dhaka', now)).toMatchObject({ ok: true, time: '9:05 AM' })
    expect(currentTime('Dhaka', '', now)).toMatchObject({ ok: false })
  })

  it('weather: live source, current vs forecast labelled; asks for a city when none is known', async () => {
    expect(await weatherForVoice(undefined, '', async () => Promise.reject(new Error('not called')))).toMatchObject({ ok: false, needs_location: true })
    const w = await weatherForVoice('Dhaka', '', async (city) => ({ place: `${city}, Bangladesh`, temperature: 29, feelsLike: 33, description: 'partly cloudy', high: 31, low: 25, rainChance: 40, wind: 9 }))
    expect(w).toMatchObject({ ok: true, place: 'Dhaka, Bangladesh', source: 'Open-Meteo live weather service', current_conditions: { temperature_c: 29 }, today_forecast: { high_c: 31 } })
    expect(JSON.stringify(w)).toMatch(/estimate/)
    expect(await weatherForVoice('Nowhere', '', async () => Promise.reject(new Error("I couldn't find a place called \"Nowhere\".")))).toMatchObject({ ok: false })
  })

  it('Live refusals are explained (quota, billing, model, key)', () => {
    expect(classifyLiveError('RESOURCE_EXHAUSTED: quota exceeded').reason).toBe('quota')
    expect(classifyLiveError('This model requires billing to be enabled').reason).toBe('billing')
    expect(classifyLiveError('models/gemini-3.8-live is not found for API version v1beta').reason).toBe('model')
    expect(classifyLiveError('API key not valid. Please pass a valid API key.').reason).toBe('auth')
  })
})

// ---- a fake Gemini Live server (local WebSocket), so the real session code is exercised
type Handler = (ws: WebSocket, msg: Record<string, unknown>, setup: Record<string, unknown>) => void
let server: WebSocketServer | null = null
afterEach(() => {
  server?.close()
  server = null
})

function fakeLive(onMessage: Handler, onSetup?: (ws: WebSocket, setup: Record<string, unknown>) => boolean): Promise<{ url: string; setups: Record<string, unknown>[]; received: Record<string, unknown>[] }> {
  const setups: Record<string, unknown>[] = []
  const received: Record<string, unknown>[] = []
  return new Promise((resolve) => {
    server = new WebSocketServer({ port: 0, host: '127.0.0.1' }, () => resolve({ url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, setups, received }))
    server.on('connection', (ws) => {
      let setup: Record<string, unknown> | null = null
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>
        if (!setup) {
          setup = msg.setup as Record<string, unknown>
          setups.push(setup)
          if (onSetup && !onSetup(ws, setup)) return
          ws.send(JSON.stringify({ setupComplete: {} }))
          return
        }
        received.push(msg)
        onMessage(ws, msg, setup)
      })
    })
  })
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!cond() && Date.now() < end) await wait(20)
}

describe('Voice Mode: the Live session', () => {
  it('streams audio, gets spoken audio + transcripts back, and runs only validated tools', async () => {
    const tools: { name: string; args: Record<string, string> }[] = []
    const live = await fakeLive((ws, msg) => {
      const audio = (msg.realtimeInput as { audio?: unknown } | undefined)?.audio
      if (audio) {
        ws.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'What time is it?' } } }))
        ws.send(JSON.stringify({ toolCall: { functionCalls: [{ id: 'c1', name: 'get_current_time', args: {} }, { id: 'c2', name: 'delete_everything', args: {} }] } }))
      }
      if (msg.toolResponse) {
        ws.send(JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAAA' } }] }, outputTranscription: { text: "It's two o'clock." } } }))
        ws.send(JSON.stringify({ serverContent: { turnComplete: true } }))
      }
    })
    const events: LiveEvent[] = []
    const v = new LiveVoice({
      getKey: () => 'test-key',
      emit: (e) => events.push(e),
      runTool: async (name, args) => (tools.push({ name, args }), { ok: true, time: '2:00 PM' }),
      baseUrl: live.url
    })
    expect(await v.start()).toEqual({ model: 'gemini-3.8-live' })
    // The session asks for spoken answers, transcripts, the app tools and longer conversations.
    const setup = live.setups[0] as { model: string; generationConfig?: { responseModalities?: string[] }; tools?: { functionDeclarations: { name: string }[] }[]; contextWindowCompression?: unknown }
    expect(setup.model).toBe('models/gemini-3.8-live')
    expect(JSON.stringify(setup)).toMatch(/AUDIO/)
    expect(setup.tools?.[0].functionDeclarations.map((d) => d.name)).toContain('open_section')
    expect(setup.contextWindowCompression).toBeTruthy()
    v.sendAudio('AAAAAAAA')
    await until(() => events.some((e) => e.type === 'turnComplete'))
    expect(events).toContainEqual({ type: 'transcript', role: 'user', text: 'What time is it?' })
    expect(events).toContainEqual({ type: 'audio', data: 'AAAA' })
    expect(events).toContainEqual({ type: 'transcript', role: 'model', text: "It's two o'clock." })
    // The unknown tool never ran; the model was told it is not allowed.
    expect(tools).toEqual([{ name: 'get_current_time', args: {} }])
    const resp = live.received.find((m) => m.toolResponse) as { toolResponse: { functionResponses: { id: string; response: { ok: boolean } }[] } }
    expect(resp.toolResponse.functionResponses.map((r) => [r.id, r.response.ok])).toEqual([
      ['c1', true],
      ['c2', false]
    ])
    await v.end()
    expect(events.at(-1)).toEqual({ type: 'state', state: 'closed', reason: 'ended' })
  })

  it('a model the key cannot use is skipped; a used-up quota is reported (no other model tried)', async () => {
    let live = await fakeLive(
      () => undefined,
      (ws, setup) => (setup.model === 'models/gemini-3.8-live' ? (ws.close(1008, 'models/gemini-3.8-live is not found for API version v1beta'), false) : true)
    )
    const v = new LiveVoice({ getKey: () => 'k', emit: () => undefined, runTool: async () => ({ ok: true }), baseUrl: live.url })
    expect(await v.start()).toEqual({ model: 'gemini-3.1-flash-live-preview' })
    await v.end()
    server?.close()

    live = await fakeLive(
      () => undefined,
      (ws) => (ws.close(1011, 'RESOURCE_EXHAUSTED: You exceeded your current quota'), false)
    )
    const events: LiveEvent[] = []
    const q = new LiveVoice({ getKey: () => 'k', emit: (e) => events.push(e), runTool: async () => ({ ok: true }), baseUrl: live.url })
    await expect(q.start()).rejects.toMatchObject({ reason: 'quota' })
    expect(live.setups).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'state', state: 'closed', reason: 'quota' })
  })

  it('interruptions are passed on; a connection about to close is resumed with the same conversation', async () => {
    const live = await fakeLive((ws, msg) => {
      if ((msg.realtimeInput as { audio?: unknown } | undefined)?.audio) {
        ws.send(JSON.stringify({ sessionResumptionUpdate: { newHandle: 'h-1', resumable: true } }))
        ws.send(JSON.stringify({ serverContent: { interrupted: true } }))
        ws.send(JSON.stringify({ goAway: { timeLeft: '5s' } }))
      }
    })
    const events: LiveEvent[] = []
    const v = new LiveVoice({ getKey: () => 'k', emit: (e) => events.push(e), runTool: async () => ({ ok: true }), baseUrl: live.url })
    await v.start()
    v.sendAudio('AAAA')
    await until(() => live.setups.length === 2 && events.filter((e) => e.type === 'state' && e.state === 'open').length === 2)
    expect(events).toContainEqual({ type: 'interrupted' })
    expect(events).toContainEqual({ type: 'state', state: 'reconnecting', model: 'gemini-3.8-live' })
    expect((live.setups[1] as { sessionResumption?: { handle?: string } }).sessionResumption?.handle).toBe('h-1')
    await v.end()
  })

  it('no key: explains instead of connecting', async () => {
    const v = new LiveVoice({ getKey: () => null, emit: () => undefined, runTool: async () => ({ ok: true }) })
    await expect(v.start()).rejects.toMatchObject({ reason: 'auth' })
  })
})
