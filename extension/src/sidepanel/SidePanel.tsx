import { useState, useEffect, useRef, useCallback, memo } from 'react'
import WidgetRenderer from './widgets/WidgetRenderer'

type MessageRole = 'user' | 'agent' | 'system'
type StatusState = 'idle' | 'listening' | 'thinking' | 'error'
type ActiveTab   = 'chat' | 'notes'

interface ChatMessage   { id: string; role: MessageRole; text: string }
interface WidgetMessage { id: string; role: 'widget'; widget_type: string; data: unknown }
type AnyMessage = ChatMessage | WidgetMessage

interface Note { id: string; topic: string; summary: string; timestamp: string }
interface AgentConfig {
  tone:              'casual' | 'academic' | 'formal' | 'socratic'
  level:             'beginner' | 'intermediate' | 'advanced' | 'expert'
  custom:            string
  voiceSource:       'mic' | 'mic_and_tab'
  a2uiEnabled:       boolean
  socraticAutopilot: boolean
}

const DEFAULT_WS_URL  = 'ws://localhost:8080/ws'
const DEFAULT_CONFIG: AgentConfig = {
  tone: 'academic', level: 'intermediate', custom: '', voiceSource: 'mic',
  a2uiEnabled: false, socraticAutopilot: false,
}

const SOCRATIC_IDLE_MS = 30_000

function uid() { return Math.random().toString(36).slice(2) }
function now()  { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }

function StatusDot({ status }: { status: StatusState }) {
  const colors: Record<StatusState, string> = {
    idle: 'bg-[#333]', listening: 'bg-green-400 animate-pulse',
    thinking: 'bg-yellow-400 animate-pulse', error: 'bg-red-400',
  }
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${colors[status]}`} aria-hidden="true" />
}

const statusLabels: Record<StatusState, string> = {
  idle: 'Idle', listening: 'Listening…', thinking: 'Thinking…', error: 'Error',
}

function Toggle({ label, checked, onChange, badge }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; badge?: string
}) {
  const id = `toggle-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-[11px] text-[#999] w-28 flex-shrink-0 cursor-pointer">{label}</label>
      <button
        id={id}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        aria-label={`${label} ${checked ? 'on' : 'off'}`}
        className={[
          'relative w-10 h-6 rounded-full transition-colors flex-shrink-0 border-none cursor-pointer overflow-hidden',
          checked ? 'bg-[#d6d3cc]' : 'bg-[#222]',
        ].join(' ')}
      >
        <span className={[
          'absolute top-1 left-1 w-4 h-4 rounded-full shadow transition-transform',
          checked ? 'bg-[#0a0a0a] translate-x-4' : 'bg-[#555] translate-x-0',
        ].join(' ')} aria-hidden="true" />
      </button>
      {badge && (
        <span className="text-[10px] bg-[#1e1e1e] text-[#999] px-1.5 py-0.5 rounded font-mono border border-[#2a2a2a]" aria-hidden="true">
          {badge}
        </span>
      )}
    </div>
  )
}

const Bubble = memo(function Bubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'system') {
    const isError = msg.text.startsWith('Error') || msg.text.startsWith('Failed')
    return (
      <p
        className="self-center text-xs text-[#777] italic px-2 text-center"
        role={isError ? 'alert' : undefined}
      >
        {msg.text}
      </p>
    )
  }
  const isUser = msg.role === 'user'
  return (
    <div
      className={[
        'max-w-[92%] px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap break-words',
        isUser ? 'self-end bg-[#1e1e1e] text-[#e8e5de] rounded-br-sm'
               : 'self-start bg-[#141414] text-[#e8e5de] rounded-bl-sm border border-[#242424]',
      ].join(' ')}
      aria-label={isUser ? 'You' : 'Mentora'}
    >
      {msg.text}
    </div>
  )
})

const NoteCard = memo(function NoteCard({ note, onDelete }: { note: Note; onDelete: () => void }) {
  return (
    <div className="bg-[#141414] rounded-xl px-3 py-2.5 flex flex-col gap-1 border border-[#242424]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-[#e8e5de]">{note.topic}</span>
        <button
          onClick={onDelete}
          aria-label={`Delete note: ${note.topic}`}
          className="text-[#777] hover:text-red-400 text-xs flex-shrink-0 bg-transparent border-none cursor-pointer"
        >✕</button>
      </div>
      <p className="text-xs text-[#aaa] leading-relaxed whitespace-pre-wrap">{note.summary}</p>
      <time className="text-[10px] text-[#666]">{note.timestamp}</time>
    </div>
  )
})

function SettingsDrawer({ config, wsUrl, onChange, onWsChange, onClose }: {
  config: AgentConfig; wsUrl: string
  onChange: (c: AgentConfig) => void; onWsChange: (u: string) => void
  onClose: () => void
}) {
  const firstFocusRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstFocusRef.current?.focus()
  }, [])

  const sel = (label: string, field: keyof AgentConfig, opts: string[]) => {
    const id = `setting-${field}`
    return (
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-[11px] text-[#999] w-28 flex-shrink-0">{label}</label>
        <select
          id={id}
          value={config[field] as string}
          onChange={e => onChange({ ...config, [field]: e.target.value })}
          className="flex-1 bg-[#0f0f0f] border border-[#282828] rounded px-2 py-1 text-xs text-[#ccc] outline-none focus:border-[#888] cursor-pointer"
        >
          {opts.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
        </select>
      </div>
    )
  }

  return (
    <div
      className="border-t border-[#1e1e1e] bg-[#080808] px-3 py-2 flex flex-col gap-2 flex-shrink-0"
      role="region"
      aria-label="Agent settings"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] text-[#777] uppercase tracking-wider font-semibold">Agent Settings</h2>
        <button
          ref={firstFocusRef}
          onClick={onClose}
          aria-label="Close settings"
          className="text-[#777] hover:text-[#e8e5de] text-xs bg-transparent border-none cursor-pointer"
        >✕ close</button>
      </div>

      {sel('Tone', 'tone', ['casual', 'academic', 'formal', 'socratic'])}
      {sel('Level', 'level', ['beginner', 'intermediate', 'advanced', 'expert'])}

      <div className="flex items-center gap-2">
        <label htmlFor="setting-voiceSource" className="text-[11px] text-[#999] w-28 flex-shrink-0">Voice Source</label>
        <select
          id="setting-voiceSource"
          value={config.voiceSource}
          onChange={e => onChange({ ...config, voiceSource: e.target.value as AgentConfig['voiceSource'] })}
          className="flex-1 bg-[#0f0f0f] border border-[#282828] rounded px-2 py-1 text-xs text-[#ccc] outline-none focus:border-[#888] cursor-pointer"
        >
          <option value="mic">My voice only</option>
          <option value="mic_and_tab">My voice + video audio</option>
        </select>
      </div>

      <div className="flex items-start gap-2">
        <label htmlFor="setting-custom" className="text-[11px] text-[#999] w-28 flex-shrink-0 pt-1">Custom</label>
        <textarea
          id="setting-custom"
          rows={2}
          placeholder="e.g. Focus on intuition."
          value={config.custom}
          onChange={e => onChange({ ...config, custom: e.target.value })}
          className="flex-1 bg-[#0f0f0f] border border-[#282828] rounded px-2 py-1 text-xs text-[#ccc] outline-none focus:border-[#888] resize-none placeholder-[#444]"
        />
      </div>

      <div className="border-t border-[#1e1e1e] pt-2 flex flex-col gap-2">
        <span className="text-[10px] text-[#666] uppercase tracking-wider">Advanced Features (apply on next Start)</span>
        <Toggle
          label="Generative UI"
          checked={config.a2uiEnabled}
          onChange={v => onChange({ ...config, a2uiEnabled: v })}
          badge="A2UI"
        />
        <Toggle
          label="Socratic Pilot"
          checked={config.socraticAutopilot}
          onChange={v => onChange({ ...config, socraticAutopilot: v })}
          badge="30s hint"
        />
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="setting-wsUrl" className="text-[11px] text-[#999] w-28 flex-shrink-0">Backend URL</label>
        <input
          id="setting-wsUrl"
          value={wsUrl}
          onChange={e => onWsChange(e.target.value)}
          className="flex-1 bg-[#0f0f0f] border border-[#282828] rounded px-2 py-1 text-xs font-mono text-[#ccc] outline-none focus:border-[#888]"
        />
      </div>
    </div>
  )
}

export default function SidePanel() {
  const [status, setStatus]             = useState<StatusState>('idle')
  const [messages, setMessages]         = useState<AnyMessage[]>([])
  const [notes, setNotes]               = useState<Note[]>([])
  const [input, setInput]               = useState('')
  const [sessionActive, setSession]     = useState(false)
  const [activeTab, setActiveTab]       = useState<ActiveTab>('chat')
  const [showSettings, setShowSettings] = useState(false)
  const [config, setConfig]             = useState<AgentConfig>(DEFAULT_CONFIG)
  const [wsUrl, setWsUrl]               = useState(DEFAULT_WS_URL)
  const [announcement, setAnnouncement] = useState('')
  const chatEnd     = useRef<HTMLDivElement>(null)
  const socraticRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const announce = useCallback((text: string) => {
    setAnnouncement(text)
    setTimeout(() => setAnnouncement(''), 1500)
  }, [])

  const addMessage = useCallback((role: MessageRole, text: string) => {
    setMessages(prev => [...prev, { id: uid(), role, text }])
  }, [])

  const addWidget = useCallback((widget_type: string, data: unknown) => {
    setMessages(prev => [...prev, { id: uid(), role: 'widget', widget_type, data }])
  }, [])

  const addNote = useCallback((topic: string, summary: string) => {
    setNotes(prev => [...prev, { id: uid(), topic, summary, timestamp: now() }])
    setActiveTab('notes')
    announce(`Note saved: ${topic}`)
  }, [announce])

  const resetSocraticTimer = useCallback((active: boolean, socratic: boolean) => {
    if (socraticRef.current) clearTimeout(socraticRef.current)
    socraticRef.current = null
    if (!active || !socratic) return
    socraticRef.current = setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'SEND_TEXT',
        text: '[autopilot] The user has been idle — proactively whisper a Socratic hint about what is on screen.',
      })
    }, SOCRATIC_IDLE_MS)
  }, [])

  useEffect(() => {
    chrome.storage.local.get(['wsUrl', 'agentConfig'], (data) => {
      if (data.wsUrl)       setWsUrl(data.wsUrl)
      if (data.agentConfig) setConfig(data.agentConfig)
    })
  }, [])

  useEffect(() => {
    chrome.storage.local.set({ wsUrl, agentConfig: config })
  }, [wsUrl, config])

  useEffect(() => {
    if (activeTab === 'chat') chatEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeTab])

  useEffect(() => {
    if (!sessionActive || !config.socraticAutopilot) {
      if (socraticRef.current) { clearTimeout(socraticRef.current); socraticRef.current = null }
    }
  }, [sessionActive, config.socraticAutopilot])

  useEffect(() => {
    const handler = (msg: any) => {
      if (!msg._sw) return

      switch (msg.type) {
        case 'WS_CONNECTED':
          setStatus('listening')
          addMessage('system', 'Session started — speak or type.')
          setShowSettings(false)
          resetSocraticTimer(true, config.socraticAutopilot)
          break
        case 'WS_ERROR':
          setStatus('error')
          addMessage('system', `Error: ${msg.error ?? 'WebSocket error'}`)
          setSession(false)
          break
        case 'WS_CLOSED':
          setStatus('idle')
          setSession(false)
          addMessage('system', 'Session ended.')
          break
        case 'AGENT_MESSAGE': {
          const p = msg.payload
          if (p?.type === 'agent_text') {
            setStatus('listening')
            addMessage('agent', p.text)
            resetSocraticTimer(true, config.socraticAutopilot)
          }
          else if (p?.type === 'user_transcript') {
            setMessages(prev => {
              const last = prev[prev.length - 1]
              if (last && 'role' in last && last.role === 'user') {
                return [...prev.slice(0, -1), { ...last as ChatMessage, text: p.text }]
              }
              return [...prev, { id: uid(), role: 'user' as MessageRole, text: p.text }]
            })
            resetSocraticTimer(true, config.socraticAutopilot)
          }
          else if (p?.type === 'thinking')      setStatus(p.value ? 'thinking' : 'listening')
          else if (p?.type === 'stop_audio')    chrome.runtime.sendMessage({ type: 'STOP_AUDIO' })
          else if (p?.type === 'add_note')      addNote(p.topic, p.summary)
          else if (p?.type === 'widget_render') {
            const validTypes = new Set(['ProbabilityTable', 'EquationSolver', 'Flashcard'])
            if (validTypes.has(p.widget_type)) addWidget(p.widget_type, p.data)
          }
          else if (p?.type === 'error')         { setStatus('error'); addMessage('system', `Error: ${p.message}`) }
          break
        }
        case 'SPEECH_ENDED':
          setStatus('thinking')
          break
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [addMessage, addNote, addWidget, resetSocraticTimer, config.socraticAutopilot])

  const handleToggleSession = useCallback(() => {
    if (sessionActive) {
      chrome.runtime.sendMessage({ type: 'STOP_SESSION' })
      setSession(false); setStatus('idle')
    } else {
      chrome.runtime.sendMessage({ type: 'START_SESSION', wsUrl, config }, (response) => {
        if (response?.error) { setStatus('error'); addMessage('system', `Failed: ${response.error}`); return }
        setSession(true); setStatus('thinking')
      })
    }
  }, [sessionActive, wsUrl, config, addMessage])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || !sessionActive) return
    addMessage('user', text)
    chrome.runtime.sendMessage({ type: 'SEND_TEXT', text })
    setInput(''); setStatus('thinking')
    resetSocraticTimer(true, config.socraticAutopilot)
  }, [input, sessionActive, addMessage, resetSocraticTimer, config.socraticAutopilot])

  return (
    <main className="flex flex-col h-screen bg-[#0a0a0a] text-[#e8e5de] text-sm">

      <div aria-live="polite" aria-atomic="true" className="sr-only">{statusLabels[status]}</div>
      <div aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>

      <header className="flex items-center gap-2 px-4 py-3 border-b border-[#1e1e1e] flex-shrink-0">
        <h1 className="text-[15px] font-semibold text-[#e8e5de] tracking-wide flex-1">Mentora</h1>
        {config.a2uiEnabled && (
          <span className="text-[10px] bg-[#1e1e1e] text-[#999] px-1.5 py-0.5 rounded font-mono border border-[#2a2a2a]" aria-label="Generative UI enabled">A2UI</span>
        )}
        {config.socraticAutopilot && (
          <span className="text-[10px] bg-[#1e1e1e] text-[#999] px-1.5 py-0.5 rounded font-mono border border-[#2a2a2a]" aria-label="Socratic Pilot enabled">Socratic</span>
        )}
        <StatusDot status={status} />
        <span className="text-xs text-[#777]" aria-hidden="true">{statusLabels[status]}</span>
      </header>

      <div className="flex border-b border-[#1e1e1e] flex-shrink-0" role="tablist" aria-label="Sections">
        {(['chat', 'notes'] as ActiveTab[]).map(tab => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`panel-${tab}`}
            id={`tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={[
              'flex-1 py-2 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer border-none',
              activeTab === tab
                ? 'text-[#e8e5de] border-b-2 border-[#e8e5de] bg-transparent'
                : 'text-[#555] hover:text-[#999] bg-transparent',
            ].join(' ')}
          >
            {tab}{tab === 'notes' && notes.length > 0 ? ` (${notes.length})` : ''}
          </button>
        ))}
      </div>

      <div
        id={`panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2.5 min-h-0"
      >
        {activeTab === 'chat' ? (
          <div role="log" aria-live="polite" aria-label="Conversation" className="flex flex-col gap-2.5">
            {messages.length === 0
              ? <p className="self-center text-xs text-[#555] italic mt-8">
                  Configure settings below, then press Start Sync.
                </p>
              : messages.map(msg =>
                  msg.role === 'widget'
                    ? <WidgetRenderer key={msg.id} widget_type={(msg as WidgetMessage).widget_type} data={(msg as WidgetMessage).data} />
                    : <Bubble key={msg.id} msg={msg as ChatMessage} />
                )
            }
            <div ref={chatEnd} />
          </div>
        ) : (
          notes.length === 0
            ? <p className="self-center text-xs text-[#555] italic mt-8">
                Say "add to notes" to save topics here.
              </p>
            : <>
                {notes.map(note => (
                  <NoteCard key={note.id} note={note}
                    onDelete={() => setNotes(prev => prev.filter(n => n.id !== note.id))} />
                ))}
                <button
                  onClick={() => setNotes([])}
                  aria-label="Clear all saved notes"
                  className="self-center text-xs text-[#555] hover:text-red-400 underline bg-transparent border-none cursor-pointer mt-1"
                >
                  Clear all notes
                </button>
              </>
        )}
      </div>

      {showSettings && (
        <SettingsDrawer
          config={config} wsUrl={wsUrl}
          onChange={c => { setConfig(c); chrome.storage.local.set({ agentConfig: c }) }}
          onWsChange={u => { setWsUrl(u); chrome.storage.local.set({ wsUrl: u }) }}
          onClose={() => setShowSettings(false)}
        />
      )}

      <div className="px-3 py-2.5 border-t border-[#1e1e1e] flex flex-col gap-2 flex-shrink-0">
        <div className="flex gap-2">
          <button
            onClick={handleToggleSession}
            aria-label={sessionActive ? 'Stop session' : 'Start session'}
            className={[
              'flex-1 py-2.5 rounded-lg font-semibold text-sm transition-colors cursor-pointer border-none',
              sessionActive ? 'bg-[#1e1e1e] hover:bg-[#2a2a2a] text-[#e8e5de]'
                           : 'bg-[#e8e5de] hover:bg-white text-[#0a0a0a]',
            ].join(' ')}
          >
            {sessionActive ? '■ Stop Sync' : '▶ Start Sync'}
          </button>
          <button
            onClick={() => setShowSettings(s => !s)}
            aria-label="Agent settings"
            aria-expanded={showSettings}
            aria-controls="settings-drawer"
            className={[
              'px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer border-none',
              showSettings ? 'bg-[#1e1e1e] text-[#e8e5de]' : 'bg-[#141414] hover:bg-[#1e1e1e] text-[#777]',
            ].join(' ')}
          >⚙</button>
        </div>

        {sessionActive && (
          <div className="flex gap-2">
            <input
              aria-label="Type a question"
              className="flex-1 bg-[#0f0f0f] border border-[#282828] rounded-lg px-3 py-2 text-sm text-[#e8e5de] outline-none focus:border-[#888] placeholder-[#444]"
              placeholder="Type a question…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              aria-label="Send message"
              className="bg-[#e8e5de] hover:bg-white disabled:bg-[#1e1e1e] disabled:text-[#555] disabled:cursor-not-allowed text-[#0a0a0a] px-3 py-2 rounded-lg text-sm cursor-pointer border-none"
            >
              Send
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
