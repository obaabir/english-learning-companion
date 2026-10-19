// Sends text you select in Chrome to the English Learning Companion app running on this computer.
// It only talks to 127.0.0.1 (your own computer); nothing goes to the internet.
const APP = 'http://127.0.0.1:47821'

async function sendToApp(payload) {
  try {
    const res = await fetch(`${APP}/selection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-elc-bridge': '1' },
      body: JSON.stringify(payload)
    })
    const body = await res.json().catch(() => ({}))
    return res.ok && body.ok ? { ok: true } : { ok: false, error: body.error || `The app answered ${res.status}.` }
  } catch {
    return { ok: false, error: 'English Learning Companion is not open. Start the app and try again.' }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'elc-explain', title: 'Explain in English Companion', contexts: ['selection'] })
})

// The content script asks us to send (pages can't reach the app directly).
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'elc-send') {
    sendToApp(msg.payload).then(reply)
    return true
  }
  if (msg?.type === 'elc-ping') {
    fetch(`${APP}/ping`)
      .then((r) => r.json())
      .then((b) => reply({ ok: !!b.ok }))
      .catch(() => reply({ ok: false }))
    return true
  }
  return false
})

/** Asks the page for the full selection (sentence, paragraph, article); falls back to the plain text. */
async function sendFromTab(tab, fallbackText) {
  if (!tab?.id) return
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'elc-collect-and-send' })
  } catch {
    if (fallbackText && /^https?:/.test(tab.url || '')) {
      await sendToApp({ text: fallbackText, sentence: null, paragraph: null, url: tab.url, title: tab.title || tab.url })
    }
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'elc-explain') sendFromTab(tab, info.selectionText)
})

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'send-selection') return
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  sendFromTab(tab, null)
})
