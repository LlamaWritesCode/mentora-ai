import { memo, useState } from 'react'

interface Props { data: { term: string; definition: string; example?: string } }

const Flashcard = memo(function Flashcard({ data }: Props) {
  const [flipped, setFlipped] = useState(false)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFlipped(f => !f) }
  }

  return (
    <div
      className="bg-[#141414] rounded-xl px-3 py-3 cursor-pointer select-none min-h-[72px] flex flex-col justify-between border border-[#242424]"
      onClick={() => setFlipped(f => !f)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      aria-label={flipped ? `Flashcard definition: ${data.definition}` : `Flashcard term: ${data.term}. Press Enter to reveal definition.`}
    >
      {!flipped ? (
        <>
          <span className="text-[10px] text-[#666] uppercase tracking-wider" aria-hidden="true">Term — press Enter to reveal</span>
          <span className="text-sm font-semibold text-[#e8e5de] mt-1">{data.term}</span>
        </>
      ) : (
        <>
          <span className="text-[10px] text-[#666] uppercase tracking-wider" aria-hidden="true">Definition</span>
          <p className="text-xs text-[#ccc] leading-relaxed mt-1">{data.definition}</p>
          {data.example && (
            <p className="text-[11px] text-[#777] italic mt-1.5 border-t border-[#2a2a2a] pt-1.5">
              e.g. {data.example}
            </p>
          )}
        </>
      )}
    </div>
  )
})

export default Flashcard
