import { Runner } from '../../hooks/useRunners'
import { SignalStrengthGauge } from './SignalStrengthGauge'
import { TimeframeAlignment } from './TimeframeAlignment'
import { ExitSignalDashboard } from './ExitSignalDashboard'
import { HistoricalPatternMatch } from './HistoricalPatternMatch'
import { PatternOverlayControls } from './PatternOverlayControls'
import { Top3ValidationPanel } from './Top3ValidationPanel'
import { ManualValidationPanel } from './ManualValidationPanel'
import { useCandleDataStore } from '../../store/candleDataStore'
import { useChartStore } from '../../store/chartStore'

interface LLMAnalysis {
  catalyst_type?: string
  sentiment?: string
  catalyst_strength?: number
  recommendation?: string
}

interface WatchlistItem {
  symbol: string
  price: number
  gap_percent: number
  volume_ratio: number
  float: number
  llm_analysis?: LLMAnalysis
  has_definitive_catalyst?: boolean
}

interface AnalysisPanelsProps {
  selectedSymbol: string | null
  watchlist: WatchlistItem[]
  runners: Runner[]
}

export function AnalysisPanels({
  selectedSymbol,
  watchlist,
  runners,
}: AnalysisPanelsProps) {
  // Get candle data from shared store (fetched by MultiChartGrid)
  const { primaryCandles, primaryLoading, primaryError } = useCandleDataStore()
  const { setSelectedSymbol } = useChartStore()

  return (
    <div className="analysis-panels">
      <Top3ValidationPanel onSelectSymbol={setSelectedSymbol} />
      <ManualValidationPanel />
      <SignalStrengthGauge
        selectedSymbol={selectedSymbol}
        watchlist={watchlist}
        runners={runners}
        candles={primaryCandles}
      />
      <TimeframeAlignment
        selectedSymbol={selectedSymbol}
        candles={primaryCandles}
        loading={primaryLoading}
        error={primaryError}
      />
      <ExitSignalDashboard
        selectedSymbol={selectedSymbol}
        candles={primaryCandles}
        loading={primaryLoading}
        error={primaryError}
      />
      <HistoricalPatternMatch
        selectedSymbol={selectedSymbol}
        runners={runners}
        watchlist={watchlist}
      />
      <PatternOverlayControls />
    </div>
  )
}
