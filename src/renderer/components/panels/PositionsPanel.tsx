import type { Position } from '../../hooks/useSignalsPositions'
import { useRunners } from '../../hooks/useRunners'
import { useWatchlistStore } from '../../store/watchlistStore'
import { FivePillarsPanel } from './FivePillarsPanel'
import { TimePressureIndicator } from './TimePressureIndicator'

interface PositionsPanelProps {
  positions: Position[]
  selectedSymbol: string | null
  onSelectSymbol: (symbol: string) => void
}

export function PositionsPanel({ positions, selectedSymbol, onSelectSymbol }: PositionsPanelProps) {
  const { runners } = useRunners()
  const { watchlist } = useWatchlistStore()
  return (
    <div className="runners-panel">
      <TimePressureIndicator
        selectedSymbol={selectedSymbol}
        runners={runners}
      />
      <FivePillarsPanel
        selectedSymbol={selectedSymbol}
        watchlist={watchlist}
        runners={runners}
      />
      <div className="runners-header">
        <h2>Open Positions</h2>
        {positions.length > 0 && (
          <div className="runners-stats">
            <span className="stat">{positions.length} open</span>
          </div>
        )}
      </div>
      <div className="runners-list">
        {positions.length === 0 && (
          <div className="position-empty">No open positions</div>
        )}
        {positions.map((pos) => (
          <PositionCard
            key={pos.symbol}
            position={pos}
            isSelected={pos.symbol === selectedSymbol}
            onClick={() => onSelectSymbol(pos.symbol)}
          />
        ))}
      </div>
    </div>
  )
}

interface PositionCardProps {
  position: Position
  isSelected: boolean
  onClick: () => void
}

function PositionCard({ position: pos, isSelected, onClick }: PositionCardProps) {
  const pnlPositive = pos.unrealized_pnl >= 0

  return (
    <div
      className={`runner-card position-card ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <div className="runner-card-header">
        <span className="runner-symbol">{pos.symbol}</span>
        <span className="position-shares">{pos.shares} shr</span>
      </div>
      <div className="runner-card-body">
        <div className="runner-row">
          <span className="runner-label">Entry</span>
          <span className="runner-value">${pos.avg_price.toFixed(2)}</span>
        </div>
        <div className="runner-row">
          <span className="runner-label">Current</span>
          <span className="runner-value">${pos.current_price.toFixed(2)}</span>
        </div>
        <div className="runner-row">
          <span className="runner-label">P&L</span>
          <span className={`runner-value pnl ${pnlPositive ? 'positive' : 'negative'}`}>
            {pnlPositive ? '+' : ''}{pos.unrealized_pnl.toFixed(2)} ({pnlPositive ? '+' : ''}{pos.unrealized_pnl_percent.toFixed(1)}%)
          </span>
        </div>
        <div className="runner-row">
          <span className="runner-label">Stop</span>
          <span className="runner-value">${pos.stop_loss.toFixed(2)}</span>
        </div>
        <div className="runner-row">
          <span className="runner-label">Target</span>
          <span className="runner-value">${pos.profit_target.toFixed(2)}</span>
        </div>
      </div>
      {pos.warning_level && pos.warning_level !== 'healthy' && (
        <div className="runner-card-footer">
          <span className="position-warning">{pos.warning_level}</span>
        </div>
      )}
    </div>
  )
}
