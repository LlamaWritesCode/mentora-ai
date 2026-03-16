const OFFSCREEN_URL  = chrome.runtime.getURL('src/offscreen/offscreen.html')
const PERMISSION_URL = chrome.runtime.getURL('src/permission/permission.html')

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id! })
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return

  switch (msg.type) {

    case 'START_SESSION':
      handleStartSession(msg.wsUrl, msg.config).then(sendResponse).catch((err) => {
        sendResponse({ error: String(err) })
      })
      return true

    case 'STOP_SESSION':
      sendToOffscreen({ type: 'STOP_CAPTURE' })
      closeOffscreen()
      break

    case 'SEND_TEXT':
      sendToOffscreen({ type: 'SEND_TEXT', text: msg.text })
      break

    case 'STOP_AUDIO':
      sendToOffscreen({ type: 'STOP_AUDIO' })
      break

    case 'WS_CONNECTED':
    case 'WS_ERROR':
    case 'WS_CLOSED':
    case 'AGENT_MESSAGE':
    case 'SPEECH_ENDED':
      broadcastToSidePanel(msg)
      break
  }
})

async function handleStartSession(wsUrl: string, config?: object): Promise<{ ok: boolean }> {
  if (!isValidWsUrl(wsUrl)) throw new Error('Invalid WebSocket URL')

  const granted = await requestMicPermission()
  if (!granted) throw new Error('Microphone permission denied')

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No active tab found')

  const streamId = await new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id! }, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
      else resolve(id)
    })
  })

  await ensureOffscreen()
  await sendToOffscreen({ type: 'START_CAPTURE', streamId, wsUrl, config })
  return { ok: true }
}

function isValidWsUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (u.protocol === 'ws:' || u.protocol === 'wss:') && u.hostname === 'localhost'
  } catch {
    return false
  }
}

function requestMicPermission(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.windows.create(
      { url: PERMISSION_URL, type: 'popup', width: 360, height: 200, focused: true },
      () => {
        const handler = (msg: any, sender: chrome.runtime.MessageSender) => {
          if (sender.id !== chrome.runtime.id) return
          if (msg.type === 'MIC_PERMISSION_RESULT') {
            chrome.runtime.onMessage.removeListener(handler)
            resolve(msg.granted === true)
          }
        }
        chrome.runtime.onMessage.addListener(handler)

        setTimeout(() => {
          chrome.runtime.onMessage.removeListener(handler)
          resolve(false)
        }, 60_000)
      }
    )
  })
}

async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument?.() ?? false
  if (!existing) {
    await chrome.offscreen.createDocument({
      url:           OFFSCREEN_URL,
      reasons:       [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.DISPLAY_MEDIA],
      justification: 'Capture tab video and mic for Gemini Live streaming',
    })
  }
}

async function closeOffscreen() {
  const existing = await chrome.offscreen.hasDocument?.() ?? false
  if (existing) await chrome.offscreen.closeDocument()
}

function sendToOffscreen(msg: object): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, () => {
      if (chrome.runtime.lastError) {
        console.warn('[sw] sendToOffscreen:', chrome.runtime.lastError.message)
      }
      resolve()
    })
  })
}

function broadcastToSidePanel(msg: object) {
  chrome.runtime.sendMessage({ ...msg, _sw: true }).catch(() => {})
}
