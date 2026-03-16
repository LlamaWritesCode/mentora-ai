import { memo } from 'react'

interface Row { label: string; value: number }
interface Props { data: { title?: string; rows: Row[] } }

const ProbabilityTable = memo(function ProbabilityTable({ data }: Props) {
  const max = Math.max(...data.rows.map(r => r.value), 0.001)
  return (
    <div className="bg-[#141414] rounded-xl px-3 py-2.5 flex flex-col gap-2 border border-[#242424]">
      {data.title && (
        <h3 className="text-xs font-semibold text-[#e8e5de]">{data.title}</h3>
      )}
      <table className="w-full" aria-label={data.title ?? 'Probability distribution'}>
        <thead className="sr-only">
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Distribution</th>
            <th scope="col">Probability</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i} className="flex items-center gap-2 mb-1.5 last:mb-0">
              <td className="text-[11px] text-[#aaa] w-28 flex-shrink-0 truncate">{row.label}</td>
              <td className="flex-1">
                <div className="bg-[#222] rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 rounded-full bg-[#d6d3cc] transition-all duration-500"
                    style={{ width: `${(row.value / max) * 100}%` }}
                    role="progressbar"
                    aria-valuenow={Math.round(row.value * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${row.label}: ${(row.value * 100).toFixed(1)}%`}
                  />
                </div>
              </td>
              <td className="text-[11px] text-[#777] w-10 text-right flex-shrink-0">
                {(row.value * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})

export default ProbabilityTable
