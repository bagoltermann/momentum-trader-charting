import { useRunners, Runner } from '../../hooks/useRunners'
import { FivePillarsPanel } from './FivePillarsPanel'
import { TimePressureIndicator } from './TimePressureIndicator'
import { useWatchlistStore } from '../../store/watchlistStore'

interface RunnersPanelProps {
  onSelectSymbol: (symbol: string) => void
  selectedSymbol: string | null
}

export function RunnersPanel({ onSelectSymbol, selectedSymbol }: RunnersPanelProps) {
  const { runners, statistics, loading, error } = useRunners()
  const { watchlist } = useWatchlistStore()

  if (loading && runners.length === 0) {
    return (
      <div className="runners-panel">
        <div className="runners-header">
          <h2>Multi-Day Runners</h2>
        </div>
        <div className="runners-loading">Loading runners...</div>
      </div>
    )
  }

  if (error && runners.length === 0) {
    return (
      <div className="runners-panel">
        <div className="runners-header">
          <h2>Multi-Day Runners</h2>
        </div>
        <div className="runners-error">{error}</div>
      </div>
    )
  }

  // Sort runners by quality score descending
  const sortedRunners = [...runners].sort((a, b) => b.quality_score - a.quality_score)

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
        <h2>Multi-Day Runners</h2>
        {statistics && (
          <div className="runners-stats">
            <span className="stat">{statistics.total_runners} active</span>
            <span className="stat">{statistics.consolidating} consolidating</span>
          </div>
        )}
      </div>
      <div className="runners-list">
        {sortedRunners.map((runner, index) => (
          <RunnerCard
            key={runner.symbol}
            runner={runner}
            isSelected={runner.symbol === selectedSymbol}
            onClick={() => onSelectSymbol(runner.symbol)}
            rank={index + 1}
          />
        ))}
      </div>
    </div>
  )
}

interface RunnerCardProps {
  runner: Runner
  isSelected: boolean
  onClick: () => void
  rank: number // Position in sorted list (1-based)
}

function RunnerCard({ runner, isSelected, onClick, rank }: RunnerCardProps) {
  const statusClass = getStatusClass(runner.status)
  const qualityClass = getQualityClass(runner.quality_score)
  const isObvious = rank <= 3 // Top 3 are "obvious" stocks

  return (
    <div
      className={`runner-card ${isSelected ? 'selected' : ''} ${statusClass} ${isObvious ? 'obvious-stock' : ''}`}
      onClick={onClick}
    >
      {isObvious && (
        <div className={`obvious-badge rank-${rank}`}>
          #{rank}
        </div>
      )}
      <div className="runner-card-header">
        <span className="runner-symbol">{runner.symbol}</span>
        <span className={`runner-quality ${qualityClass}`}>{runner.quality_score}</span>
      </div>
      <div className="runner-card-body">
        <div className="runner-row">
          <span className="runner-label">Gap</span>
          <span className={`runner-value ${runner.original_gap_percent >= 0 ? 'positive' : 'negative'}`}>
            {runner.original_gap_percent.toFixed(1)}%
          </span>
        </div>
        <div className="runner-row">
          <span className="runner-label">Pullback</span>
          <span className={`runner-value ${getPullbackClass(runner.pullback_percent)}`}>
            {runner.pullback_percent.toFixed(1)}%
          </span>
        </div>
        <div className="runner-row">
          <span className="runner-label">Price</span>
          <span className="runner-value">${runner.current_price.toFixed(2)}</span>
        </div>
        <div className="runner-row">
          <span className="runner-label">Day 1 High</span>
          <span className="runner-value">${runner.day1_high.toFixed(2)}</span>
        </div>
      </div>
      <div className="runner-card-footer">
        <span className={`runner-status ${statusClass}`}>{formatStatus(runner.status)}</span>
        <span className="runner-catalyst">{formatCatalyst(runner.original_catalyst)}</span>
      </div>
    </div>
  )
}

function getStatusClass(status: string): string {
  switch (status) {
    case 'EXTENDED':
      return 'status-extended'
    case 'CONSOLIDATING':
      return 'status-consolidating'
    case 'PULLING_BACK':
      return 'status-pullback'
    case 'BROKEN_DOWN':
      return 'status-broken'
    default:
      return ''
  }
}

function getQualityClass(score: number): string {
  if (score >= 80) return 'quality-high'
  if (score >= 65) return 'quality-medium'
  return 'quality-low'
}

function getPullbackClass(pullback: number): string {
  if (pullback < 0) return 'extended' // Negative pullback means price is above high
  if (pullback <= 10) return 'shallow'
  if (pullback <= 20) return 'moderate'
  return 'deep'
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ')
}

function formatCatalyst(catalyst: string): string {
  const catalystMap: Record<string, string> = {
    'CLINICAL_TRIAL': 'Clinical',
    'SEC_8K_EARNINGS': 'Earnings',
    'SEC_8K_EXECUTIVE_CHANGE': 'Executive',
    'SEC_8K_OTHER': '8-K',
    'PRODUCT_LAUNCH': 'Product',
    'OTHER': 'Other',
    'UNKNOWN': 'Unknown',
  }
  return catalystMap[catalyst] || catalyst
}
