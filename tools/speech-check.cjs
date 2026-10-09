// Speech capability check for the "Practice" feature. Separate from the app; changes nothing.
// Run:  npx electron tools/speech-check.cjs
// Opens a small window with three tests: microphone, speech recognition, and voices.
const { app, BrowserWindow } = require('electron')

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Speech check</title>
<style>
  body { font: 14px 'Segoe UI', sans-serif; background: #f7f6f3; color: #24232a; margin: 0; padding: 20px; }
  h1 { font-size: 18px; margin: 0 0 4px; } p.sub { color: #777681; margin: 0 0 16px; }
  .card { background: #fff; border: 1px solid #e7e2e3; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
  button { background: #781b36; color: #fff; border: 0; border-radius: 8px; padding: 8px 14px; font-weight: 600; cursor: pointer; }
  .out { margin-top: 8px; white-space: pre-wrap; } .ok { color: #1f7a3a; } .bad { color: #b3261e; }
</style></head><body>
<h1>Speech check</h1><p class="sub">Each test runs only when you press its button. Nothing is uploaded or saved.</p>
<div class="card"><b>1. Microphone</b> — records 3 seconds, then plays it back.<br><br>
  <button id="mic">Test microphone</button><div class="out" id="micOut"></div></div>
<div class="card"><b>2. Speech recognition</b> — say "I should have told you earlier".<br><br>
  <button id="sr">Test speech recognition</button><div class="out" id="srOut"></div></div>
<div class="card"><b>3. Voices (text-to-speech)</b><br><br>
  <button id="tts">Test voices</button><div class="out" id="ttsOut"></div></div>
<script>
  const $ = (id) => document.getElementById(id)
  const show = (id, text, good) => { $(id).textContent = text; $(id).className = 'out ' + (good === undefined ? '' : good ? 'ok' : 'bad') }

  $('mic').onclick = async () => {
    try {
      show('micOut', 'Recording… speak now (3 seconds)')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream); const parts = []
      rec.ondataavailable = (e) => parts.push(e.data)
      rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); new Audio(URL.createObjectURL(new Blob(parts))).play(); show('micOut', '✓ Microphone works. Playing your recording back now.', true) }
      rec.start(); setTimeout(() => rec.stop(), 3000)
    } catch (e) { show('micOut', '✗ Microphone not available: ' + e.message, false) }
  }

  $('sr').onclick = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return show('srOut', '✗ Speech recognition does not exist here.', false)
    const r = new SR(); r.lang = 'en-US'; r.interimResults = true
    let heard = ''
    r.onresult = (e) => { heard = [...e.results].map((x) => x[0].transcript).join(' '); show('srOut', 'Heard: ' + heard) }
    r.onerror = (e) => show('srOut', '✗ Speech recognition failed: ' + e.error + (e.error === 'network' ? '\\n(This is the usual result in desktop apps: it needs Google servers only Chrome itself can use.)' : ''), false)
    r.onend = () => { if (heard) show('srOut', '✓ Speech recognition works. Heard: ' + heard, true) }
    show('srOut', 'Listening… speak now'); r.start()
  }

  $('tts').onclick = async () => {
    let v = speechSynthesis.getVoices()
    if (!v.length) await new Promise((res) => { speechSynthesis.onvoiceschanged = res; setTimeout(res, 3000) })
    v = speechSynthesis.getVoices().filter((x) => /^en/i.test(x.lang))
    if (!v.length) return show('ttsOut', '✗ No English voices are available to this app.', false)
    const u = new SpeechSynthesisUtterance('I should have told you earlier.'); u.voice = v[0]; speechSynthesis.speak(u)
    show('ttsOut', '✓ Voices: ' + v.map((x) => x.name).join(', '), true)
  }
</script></body></html>`

app.whenReady().then(() => {
  // A file page is a secure context, so the microphone is available (a data: URL is not).
  const file = require('path').join(app.getPath('temp'), 'elc-speech-check.html')
  require('fs').writeFileSync(file, page)
  const win = new BrowserWindow({ width: 560, height: 560, title: 'Speech check', autoHideMenuBar: true })
  win.loadFile(file)
})
app.on('window-all-closed', () => app.quit())
