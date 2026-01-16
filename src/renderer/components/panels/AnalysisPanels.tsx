import React from 'react'
import { Runner } from '../../hooks/useRunners'
import { SignalStrengthGauge } from './SignalStrengthGauge'
import { TimeframeAlignment } from './TimeframeAlignment'
import { ExitSignalDashboard } from './ExitSignalDashboard'
import { HistoricalPatternMatch } from './HistoricalPatternMatch'

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
  runners
}: AnalysisPanelsProps) {
  return (
    <div className="analysis-panels">
      <SignalStrengthGauge
        selectedSymbol={selectedSymbol}
        watchlist={watchlist}
        runners={runners}
      />
      <TimeframeAlignment
        selectedSymbol={selectedSymbol}
      />
      <ExitSignalDashboard
        selectedSymbol={selectedSymbol}
      />
      <HistoricalPatternMatch
        selectedSymbol={selectedSymbol}
        runners={runners}
        watchlist={watchlist}
      />
    </div>
  )
}
