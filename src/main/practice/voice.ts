import { spawn } from 'node:child_process'

/**
 * "AI voice": reads text aloud with Windows' built-in voices (free, offline) and returns a WAV
 * as base64. Used when the original clip isn't available (the app's browser engine has no voices).
 * The text is passed through an environment variable, never pasted into the command.
 */
export function windowsVoiceWav(text: string): Promise<string> {
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like "en-*" } | Select-Object -First 1',
    'if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }',
    '$s.Rate = -1',
    '$ms = New-Object System.IO.MemoryStream',
    '$s.SetOutputToWaveStream($ms)',
    '$s.Speak($env:ELC_TTS_TEXT)',
    '[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))'
  ].join('; ')
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, ELC_TTS_TEXT: text.slice(0, 600) },
      windowsHide: true
    })
    let out = ''
    let err = ''
    ps.stdout.on('data', (d) => (out += d))
    ps.stderr.on('data', (d) => (err += d))
    ps.on('error', reject)
    ps.on('close', (code) => {
      if (code === 0 && out.length > 100) resolve(out.trim())
      else reject(new Error(`The Windows voice could not read this line.${err ? ' ' + err.split('\n')[0] : ''}`))
    })
  })
}
