/**
 * permission.ts
 *
 * Opened as a popup window by the service worker to request microphone
 * permission. getUserMedia works reliably in real browser windows.
 * Sends the result back via chrome.runtime.sendMessage then closes itself.
 */

;(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    stream.getTracks().forEach(t => t.stop())
    chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_RESULT', granted: true })
  } catch (err) {
    chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_RESULT', granted: false, error: String(err) })
  }
  window.close()
})()
