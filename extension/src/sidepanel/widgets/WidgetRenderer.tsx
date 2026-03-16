import { memo } from 'react'
import ProbabilityTable from './ProbabilityTable'
import EquationSolver   from './EquationSolver'
import Flashcard        from './Flashcard'

interface Props { widget_type: string; data: unknown }

const REGISTRY: Record<string, React.ComponentType<{ data: any }>> = {
  ProbabilityTable,
  EquationSolver,
  Flashcard,
}

const WidgetRenderer = memo(function WidgetRenderer({ widget_type, data }: Props) {
  const Component = REGISTRY[widget_type]
  if (!Component) {
    return (
      <div className="bg-[#141414] rounded-xl px-3 py-2 text-xs text-[#666] italic border border-[#242424]" role="status">
        Unknown widget: {widget_type}
      </div>
    )
  }
  return (
    <section aria-label={widget_type} className="w-full">
      <Component data={data} />
    </section>
  )
})

export default WidgetRenderer
