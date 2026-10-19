import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Free, offline speech recognition with the recognizer built into Windows (System.Speech, en-US).
 * Nothing is sent over the internet. Known commands are matched with a grammar (accurate); anything
 * else falls back to Windows dictation (less accurate). Phrases and tails are passed in environment
 * variables, never pasted into the script.
 */
const ENGINE = `
Add-Type -AssemblyName System.Speech
$culture = [System.Globalization.CultureInfo]::GetCultureInfo('en-US')
$info = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'en-US' } | Select-Object -First 1
if (-not $info) { [Console]::Out.WriteLine('{"error":"no-recognizer"}'); exit 2 }
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
$phrases = $env:ELC_VOICE_PHRASES -split "\`n" | Where-Object { $_ }
if ($phrases.Count) {
  $choices = New-Object System.Speech.Recognition.Choices
  $choices.Add([string[]]$phrases)
  $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
  $gb.Culture = $culture
  $g = New-Object System.Speech.Recognition.Grammar($gb); $g.Name = 'command'; $engine.LoadGrammar($g)
}
foreach ($tail in ($env:ELC_VOICE_TAILS -split "\`n" | Where-Object { $_ })) {
  $gb = New-Object System.Speech.Recognition.GrammarBuilder($tail)
  $gb.Culture = $culture
  $gb.AppendDictation()
  $g = New-Object System.Speech.Recognition.Grammar($gb); $g.Name = 'tail'; $engine.LoadGrammar($g)
}
if ($env:ELC_VOICE_DICTATION -eq '1') { $d = New-Object System.Speech.Recognition.DictationGrammar; $d.Name = 'dictation'; $engine.LoadGrammar($d) }
function Emit($r) {
  if ($r) { [Console]::Out.WriteLine((@{ text = $r.Text; confidence = [math]::Round($r.Confidence, 3); grammar = $r.Grammar.Name } | ConvertTo-Json -Compress)) }
  else { [Console]::Out.WriteLine('{"text":""}') }
  [Console]::Out.Flush()
}
`

const ONE_SHOT = `${ENGINE}
$engine.SetInputToWaveFile($env:ELC_VOICE_FILE)
Emit ($engine.Recognize())
`

/** Listens on the microphone for the wake phrase only ("hey jarvis"), until stopped. */
const WAKE = `${ENGINE}
$engine.SetInputToDefaultAudioDevice()
[Console]::Out.WriteLine('{"ready":true}'); [Console]::Out.Flush()
while ($true) {
  $r = $engine.Recognize([TimeSpan]::FromSeconds(30))
  if ($r -and $r.Confidence -ge [double]$env:ELC_VOICE_MIN) { Emit $r }
}
`

export interface Heard {
  text: string
  confidence: number
  /** 'command' = a known phrase; 'tail' = known start + free words; 'dictation' = free text. */
  grammar: 'command' | 'tail' | 'dictation' | ''
}

function run(script: string, env: Record<string, string>, onLine?: (line: string) => void): ChildProcess {
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  }).on('spawn', function (this: ChildProcess) {
    if (!onLine) return
    let buf = ''
    this.stdout?.on('data', (d: Buffer) => {
      buf += d.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line) onLine(line)
      }
    })
  })
}

/** Recognizes a recorded clip (16-bit PCM WAV, base64) against the command phrases. */
export function recognizeWav(wavBase64: string, opts: { phrases: string[]; tails: string[]; dictation: boolean }): Promise<Heard> {
  const dir = mkdtempSync(join(tmpdir(), 'elc-voice-'))
  const file = join(dir, 'clip.wav')
  writeFileSync(file, Buffer.from(wavBase64, 'base64'))
  return new Promise((resolve, reject) => {
    let out = ''
    let err = ''
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ONE_SHOT], {
      env: { ...process.env, ELC_VOICE_FILE: file, ELC_VOICE_PHRASES: opts.phrases.join('\n'), ELC_VOICE_TAILS: opts.tails.join('\n'), ELC_VOICE_DICTATION: opts.dictation ? '1' : '0' },
      windowsHide: true
    })
    const timer = setTimeout(() => ps.kill(), 20_000)
    ps.stdout.on('data', (d) => (out += d))
    ps.stderr.on('data', (d) => (err += d))
    ps.on('error', reject)
    ps.on('close', () => {
      clearTimeout(timer)
      rmSync(dir, { recursive: true, force: true })
      const line = out.trim().split('\n').pop() ?? ''
      try {
        const r = JSON.parse(line) as Partial<Heard> & { error?: string }
        if (r.error === 'no-recognizer') return reject(new Error('Windows speech recognition (English US) is not installed. Add it in Windows Settings → Time & language → Speech.'))
        resolve({ text: r.text ?? '', confidence: r.confidence ?? 0, grammar: (r.grammar as Heard['grammar']) ?? '' })
      } catch {
        reject(new Error(`Windows speech recognition failed.${err ? ' ' + err.split('\n')[0] : ''}`))
      }
    })
  })
}

/**
 * "Hey Jarvis" mode: only while switched on, the Windows recognizer listens (offline, on this
 * computer) for the wake phrase or "hey jarvis + command". Stop() ends it and releases the mic.
 */
export class WakeListener {
  private ps: ChildProcess | null = null

  get running(): boolean {
    return !!this.ps
  }

  start(phrases: string[], onHeard: (h: Heard) => void, onState: (s: 'ready' | 'stopped' | 'error', msg?: string) => void): void {
    this.stop()
    let ready = false
    const ps = run(WAKE, { ELC_VOICE_PHRASES: phrases.join('\n'), ELC_VOICE_TAILS: '', ELC_VOICE_DICTATION: '0', ELC_VOICE_MIN: '0.55' }, (line) => {
      try {
        const r = JSON.parse(line) as Partial<Heard> & { ready?: boolean; error?: string }
        if (r.ready) {
          ready = true
          onState('ready')
        } else if (r.error) onState('error', r.error === 'no-recognizer' ? 'Windows speech recognition (English US) is not installed.' : r.error)
        else if (r.text) onHeard({ text: r.text, confidence: r.confidence ?? 0, grammar: (r.grammar as Heard['grammar']) ?? 'command' })
      } catch {
        // ignore partial lines
      }
    })
    ps.on('exit', () => {
      if (this.ps === ps) this.ps = null
      onState(ready ? 'stopped' : 'error', ready ? undefined : 'The microphone could not be opened for "Hey Jarvis".')
    })
    this.ps = ps
  }

  stop(): void {
    const ps = this.ps
    this.ps = null
    ps?.kill()
  }
}
