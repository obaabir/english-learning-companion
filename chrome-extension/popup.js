const status = document.getElementById('status')
const text = document.getElementById('text')
chrome.runtime.sendMessage({ type: 'elc-ping' }, (res) => {
  const ok = !!(res && res.ok)
  status.className = `s ${ok ? 'ok' : 'bad'}`
  text.textContent = ok ? 'Connected to the app' : 'App not open — start English Learning Companion'
})

const show = document.getElementById('show')
chrome.storage.local.get({ showButton: true }, (v) => (show.checked = v.showButton !== false))
show.addEventListener('change', () => chrome.storage.local.set({ showButton: show.checked }))
