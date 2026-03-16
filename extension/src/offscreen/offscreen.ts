let ws: WebSocket | null = null
let audioCtx: AudioContext | null = null
let tabPlaybackCtx: AudioContext | null = null
let micCtx: AudioContext | null = null
let tabStream: MediaStream | null = null
let micStream: MediaStream | null = null
let frameInterval: ReturnType<typeof setInterval> | null = null
let isPlayingAudio  = false
let bargeInActive   = false
let bargeInTimeout: ReturnType<typeof setTimeout> | null = null
let muteMicUntil  = 0
let nextPlayTime  = 0
let wasSpeaking       = false
let speechEndTimer: ReturnType<typeof setTimeout> | null = null
let activityActive    = false

let sessionConfig: { tone: string; level: string; custom: string; voiceSource: string } = {
  tone: 'academic', level: 'intermediate', custom: '', voiceSource: 'mic',
}

function isValidWsUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const allowedHosts = ['localhost', 'mentora-backend-703396951656.us-central1.run.app']
    return (u.protocol === 'ws:' || u.protocol === 'wss:') && allowedHosts.includes(u.hostname)
  } catch {
    return false
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id) return

  switch (msg.type) {
    case 'START_CAPTURE':
      if (msg.config) sessionConfig = msg.config
      startCapture(msg.streamId, msg.wsUrl)
      break
    case 'STOP_CAPTURE':
      stopCapture()
      break
    case 'STOP_AUDIO':
      stopAudioPlayback()
      break
    case 'SEND_TEXT':
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'user_text', text: msg.text }))
      }
      break
  }
})

async function startCapture(streamId: string, wsUrl: string) {
  if (!isValidWsUrl(wsUrl)) {
    chrome.runtime.sendMessage({ type: 'WS_ERROR', error: 'Invalid WebSocket URL' })
    return
  }

  try {
    tabStream = await navigator.mediaDevices.getUserMedia({
      video: {
        // @ts-ignore
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
      },
      audio: {
        // @ts-ignore
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
      },
    })

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      video: false,
    })

    tabPlaybackCtx = new AudioContext()
    tabPlaybackCtx.createMediaStreamSource(tabStream).connect(tabPlaybackCtx.destination)

    ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      console.log('[offscreen] WS connected')
      ws!.send(JSON.stringify({ type: 'session_config', ...sessionConfig }))
      chrome.runtime.sendMessage({ type: 'WS_CONNECTED' })
      startVideoFrameLoop()
      startMicCapture()
    }

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data)
          if (!msg || typeof msg.type !== 'string') return
          if (msg.type === 'stop_audio') {
            bargeInActive = false
            if (bargeInTimeout) { clearTimeout(bargeInTimeout); bargeInTimeout = null }
            stopAudioPlayback()
          }
          chrome.runtime.sendMessage({ type: 'AGENT_MESSAGE', payload: msg })
        } catch (e) {
          console.warn('[offscreen] Failed to parse WS message:', e)
        }
      } else {
        queueAudioChunk(event.data as ArrayBuffer)
      }
    }

    ws.onerror = () => {
      chrome.runtime.sendMessage({ type: 'WS_ERROR', error: 'WebSocket error' })
    }

    ws.onclose = () => {
      chrome.runtime.sendMessage({ type: 'WS_CLOSED' })
    }

  } catch (err) {
    console.error('[offscreen] startCapture failed', err)
    chrome.runtime.sendMessage({ type: 'WS_ERROR', error: String(err) })
  }
}

function startVideoFrameLoop() {
  if (!tabStream) return

  const video = document.createElement('video')
  video.srcObject = tabStream
  video.muted = true
  video.play()

  const canvas  = document.createElement('canvas')
  const ctx     = canvas.getContext('2d')!
  const diffCanvas = document.createElement('canvas')
  const diffCtx    = diffCanvas.getContext('2d')!
  diffCanvas.width  = 64
  diffCanvas.height = 36
  let lastDiffData: Uint8ClampedArray | null = null

  video.onloadedmetadata = () => {
    canvas.width  = Math.min(video.videoWidth,  1280)
    canvas.height = Math.min(video.videoHeight,  720)
  }

  frameInterval = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !video.videoWidth) return

    diffCtx.drawImage(video, 0, 0, 64, 36)
    const diffData = diffCtx.getImageData(0, 0, 64, 36).data
    if (lastDiffData) {
      let diff = 0
      for (let i = 0; i < diffData.length; i += 4) diff += Math.abs(diffData[i] - lastDiffData[i])
      const avgDiff = diff / (diffData.length / 4)
      if (avgDiff < 4) return
    }
    lastDiffData = new Uint8ClampedArray(diffData)

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) return
      blob.arrayBuffer().then((buf) => {
        if (ws?.readyState !== WebSocket.OPEN) return
        const tagged = new Uint8Array(buf.byteLength + 1)
        tagged[0] = 0x01
        tagged.set(new Uint8Array(buf), 1)
        ws.send(tagged.buffer)
      })
    }, 'image/jpeg', 0.6)
  }, 4000)
}

const SILENCE_THRESHOLD      = 0.005
const BARGE_IN_RMS_THRESHOLD = 0.06
const BARGE_IN_FRAMES_NEEDED = 4
let   bargeInFrames          = 0

function rms(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

function startMicCapture() {
  if (!micStream) return

  micCtx = new AudioContext({ sampleRate: 16000 })
  micCtx.resume()

  const micSource = micCtx.createMediaStreamSource(micStream)
  const processor = micCtx.createScriptProcessor(512, 1, 1)

  if (sessionConfig.voiceSource === 'mic_and_tab' && tabStream) {
    micCtx.createMediaStreamSource(tabStream).connect(processor)
  }

  processor.onaudioprocess = (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    const float32     = e.inputBuffer.getChannelData(0)
    const energyLevel = rms(float32)

    if (isPlayingAudio) {
      if (energyLevel >= BARGE_IN_RMS_THRESHOLD) {
        bargeInFrames++
        if (bargeInFrames >= BARGE_IN_FRAMES_NEEDED) {
          bargeInFrames = 0
          bargeInActive = true
          stopAudioPlayback()
          if (bargeInTimeout) clearTimeout(bargeInTimeout)
          bargeInTimeout = setTimeout(() => { bargeInActive = false; bargeInTimeout = null }, 1000)
        }
      } else {
        bargeInFrames = 0
      }
      return
    }

    bargeInFrames = 0

    if (energyLevel < SILENCE_THRESHOLD) {
      if (wasSpeaking && !speechEndTimer) {
        speechEndTimer = setTimeout(() => {
          wasSpeaking    = false
          speechEndTimer = null
          activityActive = false
          chrome.runtime.sendMessage({ type: 'SPEECH_ENDED' })
        }, 150)
      }
    } else {
      if (speechEndTimer) { clearTimeout(speechEndTimer); speechEndTimer = null }
      if (!wasSpeaking) activityActive = true
      wasSpeaking = true
    }

    if (Date.now() < muteMicUntil) return

    const pcm16  = float32ToPcm16(float32)
    const tagged = new Uint8Array(pcm16.byteLength + 1)
    tagged[0] = 0x02
    tagged.set(new Uint8Array(pcm16), 1)
    ws.send(tagged.buffer)
  }

  micSource.connect(processor)
  processor.connect(micCtx.destination)
}

function stopCapture() {
  if (frameInterval)   { clearInterval(frameInterval); frameInterval = null }
  if (speechEndTimer)  { clearTimeout(speechEndTimer); speechEndTimer = null }
  wasSpeaking = false
  activityActive = false
  bargeInActive = false
  if (bargeInTimeout) { clearTimeout(bargeInTimeout); bargeInTimeout = null }
  tabStream?.getTracks().forEach(t => t.stop())
  micStream?.getTracks().forEach(t => t.stop())
  micCtx?.close()
  audioCtx?.close()
  tabPlaybackCtx?.close()
  ws?.close()
  ws = null; tabStream = null; micStream = null
  micCtx = null; audioCtx = null; tabPlaybackCtx = null
}

function pcm16ToAudioBuffer(raw: ArrayBuffer, ctx: AudioContext): AudioBuffer {
  const pcm16   = new Int16Array(raw)
  const float32 = new Float32Array(pcm16.length)
  for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0
  const buffer = ctx.createBuffer(1, float32.length, 24000)
  buffer.copyToChannel(float32, 0)
  return buffer
}

async function queueAudioChunk(raw: ArrayBuffer) {
  if (bargeInActive) return

  if (!audioCtx) {
    audioCtx  = new AudioContext({ sampleRate: 24000 })
    nextPlayTime = 0
  }

  if (audioCtx.state !== 'running') await audioCtx.resume()

  const buffer = pcm16ToAudioBuffer(raw, audioCtx)

  const startAt = Math.max(audioCtx.currentTime, nextPlayTime)
  nextPlayTime  = startAt + buffer.duration

  const source = audioCtx.createBufferSource()
  source.buffer = buffer
  source.connect(audioCtx.destination)
  source.start(startAt)

  isPlayingAudio = true

  source.onended = () => {
    if (audioCtx && audioCtx.currentTime >= nextPlayTime - 0.01) {
      isPlayingAudio = false
      muteMicUntil   = Date.now() + 200
      audioCtx.close()
      audioCtx     = null
      nextPlayTime = 0
    }
  }
}

function stopAudioPlayback() {
  isPlayingAudio = false
  muteMicUntil   = 0
  nextPlayTime   = 0
  if (audioCtx) { audioCtx.close(); audioCtx = null }
}

function float32ToPcm16(float32: Float32Array): ArrayBuffer {
  const buf  = new ArrayBuffer(float32.length * 2)
  const view = new DataView(buf)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}
