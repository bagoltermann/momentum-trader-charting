import React, { useMemo } from 'react'
import { Runner } from '../../hooks/useRunners'
import { SignalStrengthGauge } from './SignalStrengthGauge'
import { TimeframeAlignment } from './TimeframeAlignment'
import { ExitSignalDashboard } from './ExitSignalDashboard'
import { HistoricalPatternMatch } from './HistoricalPatternMatch'
import { PatternOverlayControls } from './PatternOverlayControls'
import { detectSupportResistance, detectGaps, detectFlagPennant, Candle } from '../../utils/indicators'

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
  rawCandles?: Candle[]
}

export function AnalysisPanels({
  selectedSymbol,
  watchlist,
  runners,
  rawCandles = []
}: AnalysisPanelsProps) {
  // Calculate pattern counts for the controls panel
  const supportResistanceCount = useMemo(() => {
    if (rawCandles.length < 50) return 0
    return detectSupportResistance(rawCandles).length
  }, [rawCandles])

  const gapCount = useMemo(() => {
    if (rawCandles.length < 2) return 0
    return detectGaps(rawCandles).length
  }, [rawCandles])

  const flagPennantDetected = useMemo(() => {
    if (rawCandles.length < 15) return false
    const pattern = detectFlagPennant(rawCandles)
    return pattern !== null && pattern.detected
  }, [rawCandles])

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
      <PatternOverlayControls
        supportResistanceCount={supportResistanceCount}
        gapCount={gapCount}
        flagPennantDetected={flagPennantDetected}
      />
    </div>
  )
}
