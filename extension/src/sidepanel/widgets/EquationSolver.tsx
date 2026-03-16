import { memo, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

interface Step { expression: string; explanation: string }
interface Props { data: { title?: string; steps: Step[] } }

function renderMath(tex: string): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode: true, output: 'html' })
  } catch {
    return tex
  }
}

const EquationSolver = memo(function EquationSolver({ data }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null)

  const toggle = (i: number) => setExpanded(prev => prev === i ? null : i)
  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(i) }
  }

  return (
    <div className="bg-[#141414] rounded-xl px-3 py-2.5 flex flex-col gap-2 border border-[#242424]">
      {data.title && (
        <h3 className="text-xs font-semibold text-[#e8e5de]">{data.title}</h3>
      )}
      <div className="flex flex-col gap-1">
        {data.steps.map((step, i) => (
          <div
            key={i}
            className="rounded-lg bg-[#1a1a1a] px-2.5 py-1.5 cursor-pointer select-none border border-[#242424]"
            onClick={() => toggle(i)}
            onKeyDown={e => handleKeyDown(i, e)}
            role="button"
            tabIndex={0}
            aria-expanded={expanded === i}
            aria-label={`Step ${i + 1}: ${step.expression}. ${expanded === i ? 'Collapse' : 'Expand'} explanation.`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-[#666] flex-shrink-0">Step {i + 1}</span>
              <div
                className="flex-1 text-center overflow-x-auto katex-display-override"
                dangerouslySetInnerHTML={{ __html: renderMath(step.expression) }}
                aria-label={step.expression}
                role="img"
              />
              <span className="text-[#555] text-xs flex-shrink-0" aria-hidden="true">{expanded === i ? '▲' : '▼'}</span>
            </div>
            {expanded === i && (
              <p className="mt-1.5 text-[11px] text-[#aaa] leading-relaxed border-t border-[#2a2a2a] pt-1.5">
                {step.explanation}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})

export default EquationSolver
