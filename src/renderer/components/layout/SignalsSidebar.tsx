import type { Signal } from '../../hooks/useSignalsPositions'

interface SignalsSidebarProps {
  signals: Signal[]
  selectedSymbol: string | null
  onSelectSymbol: (symbol: string) => void
}

function formatPattern(pattern: string | undefined): string {
  if (!pattern) return '—'
  const map: Record<string, string> = {
    'micro_pullback_breakout': 'MPB',
    'first_pullback': '1st PB',
    'vwap_bounce': 'VWAP',
    'opening_range_breakout': 'ORB',
    'flat_top_breakout': 'Flat',
  }
  return map[pattern] || pattern.replace(/_/g, ' ').slice(0, 10)
}

function timeRemaining(expiresAt: string | undefined): string {
  if (!expiresAt) return '—'
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return 'exp'
  const mins = Math.floor(diff / 60000)
  if (mins >= 60) return `${Math.floor(mins / 60)}h`
  return `${mins}m`
}

export function SignalsSidebar({ signals, selectedSymbol, onSelectSymbol }: SignalsSidebarProps) {
  return (
    <aside className="sidebar">
      <h2>Active Signals ({signals.length})</h2>
      <ul className="symbol-list">
        {signals.length === 0 && (
          <li className="signal-empty">No active signals</li>
        )}
        {signals.map((sig) => (
          <li
            key={`${sig.symbol}-${sig.timestamp}`}
            className={`symbol-item signal-item ${selectedSymbol === sig.symbol ? 'selected' : ''}`}
            onClick={() => onSelectSymbol(sig.symbol)}
          >
            <span className="symbol">{sig.symbol}</span>
            <span className="signal-pattern">{formatPattern(sig.pattern)}</span>
            <span className="signal-entry">${sig.entry_price?.toFixed(2) ?? '—'}</span>
            <span className={`signal-rr ${(sig.risk_reward_ratio ?? 0) >= 2 ? 'high' : 'low'}`}>
              {sig.risk_reward_ratio?.toFixed(1) ?? '—'}R
            </span>
            <span className="signal-expiry">{timeRemaining(sig.expires_at)}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
