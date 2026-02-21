import { useState } from 'react'
import type { RotationStats, PrioritySymbol } from '../../hooks/useRotationDiscovery'

interface DiscoveryPanelProps {
  rotationStats: RotationStats
  onSelectSymbol: (symbol: string) => void
}

function formatTimeAgo(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}

function abbreviateReason(reason: string): string {
  const parts = reason.split('+')
  return parts.map(p => {
    if (p.includes('volume')) return 'vol'
    if (p.includes('tick')) return 'ticks'
    if (p.includes('price_range')) return 'range'
    return p
  }).join('+')
}

export function DiscoveryPanel({ rotationStats, onSelectSymbol }: DiscoveryPanelProps) {
  const [collapsed, setCollapsed] = useState(true)

  if (!rotationStats.enabled && !rotationStats.loading) {
    return (
      <div className="discovery-panel">
        <div className="discovery-header" onClick={() => setCollapsed(!collapsed)}>
          <span className="discovery-toggle">{collapsed ? '\u25B6' : '\u25BC'}</span>
          <span>Discovery</span>
          <span className="discovery-badge inactive">off</span>
        </div>
        {!collapsed && (
          <div className="discovery-body">
            <div className="discovery-empty">Scanner inactive</div>
          </div>
        )}
      </div>
    )
  }

  const sorted = [...rotationStats.prioritySymbols].sort(
    (a: PrioritySymbol, b: PrioritySymbol) => a.secondsInPriority - b.secondsInPriority
  )

  const count = rotationStats.priorityCount

  return (
    <div className="discovery-panel">
      <div className="discovery-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="discovery-toggle">{collapsed ? '\u25B6' : '\u25BC'}</span>
        <span>Discovery</span>
        {count > 0 ? (
          <span className="discovery-badge found">{count} found</span>
        ) : (
          <span className="discovery-badge scanning">scanning</span>
        )}
      </div>
      {!collapsed && (
        <div className="discovery-body">
          {sorted.length === 0 ? (
            <div className="discovery-empty">No anomalies detected</div>
          ) : (
            sorted.map((ps: PrioritySymbol) => (
              <div
                key={ps.symbol}
                className="discovery-row"
                onClick={() => onSelectSymbol(ps.symbol)}
                title={`Ticks: ${ps.stats.tickCount} | Vol: ${ps.stats.volumeSum.toLocaleString()} | Range: ${ps.stats.priceRangePct.toFixed(1)}%`}
              >
                <span className="discovery-symbol">{ps.symbol}</span>
                <span className="discovery-reason">{abbreviateReason(ps.reason)}</span>
                <span className="discovery-time">{formatTimeAgo(ps.secondsInPriority)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
