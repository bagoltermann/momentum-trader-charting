import React, { useMemo } from 'react'
import { Candle, calculateVWAPBands } from '../../utils/indicators'
import { CandleWithVolume } from '../../store/candleDataStore'

interface TimeframeAlignmentProps {
  selectedSymbol: string | null
  candles: CandleWithVolume[]
  loading: boolean
  error: string | null
}

interface TimeframeSignal {
  timeframe: string
  direction: 'bullish' | 'bearish' | 'neutral'
  reason: string
}

interface AlignmentAnalysis {
  signals: TimeframeSignal[]
  bullishCount: number
  totalCount: number
  overallBias: 'bullish' | 'bearish' | 'neutral'
}

function analyze1mTimeframe(candles: Candle[]): TimeframeSignal {
  if (candles.length < 5) {
    return { timeframe: '1m', direction: 'neutral', reason: 'Insufficient data' }
  }

  const recent = candles.slice(-5)
  const higherHighs = recent.every((c, i) => i === 0 || c.high >= recent[i - 1].high)
  const higherLows = recent.every((c, i) => i === 0 || c.low >= recent[i - 1].low)
  const lowerHighs = recent.every((c, i) => i === 0 || c.high <= recent[i - 1].high)
  const lowerLows = recent.every((c, i) => i === 0 || c.low <= recent[i - 1].low)

  if (higherHighs && higherLows) {
    return { timeframe: '1m', direction: 'bullish', reason: 'Higher highs/lows' }
  }
  if (lowerHighs && lowerLows) {
    return { timeframe: '1m', direction: 'bearish', reason: 'Lower highs/lows' }
  }

  // Check last candle momentum
  const lastCandle = candles[candles.length - 1]
  const prevCandle = candles[candles.length - 2]

  if (lastCandle.close > lastCandle.open && lastCandle.close > prevCandle.close) {
    return { timeframe: '1m', direction: 'bullish', reason: 'Bullish momentum' }
  }
  if (lastCandle.close < lastCandle.open && lastCandle.close < prevCandle.close) {
    return { timeframe: '1m', direction: 'bearish', reason: 'Bearish momentum' }
  }

  return { timeframe: '1m', direction: 'neutral', reason: 'Consolidating' }
}

function analyze5mTimeframe(candles: Candle[]): TimeframeSignal {
  if (candles.length < 3) {
    return { timeframe: '5m', direction: 'neutral', reason: 'Insufficient data' }
  }

  const recent = candles.slice(-3)
  const higherLows = recent.every((c, i) => i === 0 || c.low >= recent[i - 1].low * 0.998)

  if (higherLows) {
    return { timeframe: '5m', direction: 'bullish', reason: 'Higher lows' }
  }

  const lowerHighs = recent.every((c, i) => i === 0 || c.high <= recent[i - 1].high * 1.002)
  if (lowerHighs) {
    return { timeframe: '5m', direction: 'bearish', reason: 'Lower highs' }
  }

  return { timeframe: '5m', direction: 'neutral', reason: 'Range-bound' }
}

function analyze15mTimeframe(candles: Candle[], vwap?: number): TimeframeSignal {
  if (candles.length < 2) {
    return { timeframe: '15m', direction: 'neutral', reason: 'Insufficient data' }
  }

  const lastCandle = candles[candles.length - 1]

  // Check if price is above or below VWAP
  if (vwap) {
    const priceVsVwap = ((lastCandle.close - vwap) / vwap) * 100

    if (priceVsVwap > 1) {
      return { timeframe: '15m', direction: 'bullish', reason: 'Above VWAP' }
    }
    if (priceVsVwap < -1) {
      return { timeframe: '15m', direction: 'bearish', reason: 'Below VWAP' }
    }
    return { timeframe: '15m', direction: 'neutral', reason: 'Near VWAP' }
  }

  // Fall back to price action
  const avgPrice = candles.slice(-3).reduce((sum, c) => sum + c.close, 0) / 3
  if (lastCandle.close > avgPrice * 1.005) {
    return { timeframe: '15m', direction: 'bullish', reason: 'Uptrend' }
  }
  if (lastCandle.close < avgPrice * 0.995) {
    return { timeframe: '15m', direction: 'bearish', reason: 'Downtrend' }
  }

  return { timeframe: '15m', direction: 'neutral', reason: 'Sideways' }
}

function analyzeDailyTimeframe(candles: Candle[]): TimeframeSignal {
  if (candles.length < 1) {
    return { timeframe: 'D', direction: 'neutral', reason: 'No data' }
  }

  // For intraday, use current session data to determine daily bias
  const firstCandle = candles[0]
  const lastCandle = candles[candles.length - 1]
  const sessionHigh = Math.max(...candles.map(c => c.high))
  const sessionLow = Math.min(...candles.map(c => c.low))
  const sessionRange = sessionHigh - sessionLow

  // Where is price within the day's range?
  const pricePosition = sessionRange > 0
    ? (lastCandle.close - sessionLow) / sessionRange
    : 0.5

  if (pricePosition > 0.66) {
    return { timeframe: 'D', direction: 'bullish', reason: 'Upper range' }
  }
  if (pricePosition < 0.33) {
    return { timeframe: 'D', direction: 'bearish', reason: 'Lower range' }
  }
  return { timeframe: 'D', direction: 'neutral', reason: 'Mid-range' }
}

function analyzeAlignment(
  candles1m: Candle[] | undefined,
  candles5m: Candle[] | undefined,
  vwap?: number
): AlignmentAnalysis {
  const signals: TimeframeSignal[] = []

  // Analyze each timeframe
  if (candles1m && candles1m.length > 0) {
    signals.push(analyze1mTimeframe(candles1m))

    // Derive 5m from 1m if not provided separately
    if (!candles5m) {
      // Group 1m candles into 5m
      const grouped5m: Candle[] = []
      for (let i = 0; i < candles1m.length; i += 5) {
        const group = candles1m.slice(i, i + 5)
        if (group.length === 5) {
          grouped5m.push({
            time: group[0].time,
            open: group[0].open,
            high: Math.max(...group.map(c => c.high)),
            low: Math.min(...group.map(c => c.low)),
            close: group[group.length - 1].close,
            volume: group.reduce((sum, c) => sum + c.volume, 0)
          })
        }
      }
      signals.push(analyze5mTimeframe(grouped5m))
    } else {
      signals.push(analyze5mTimeframe(candles5m))
    }

    signals.push(analyze15mTimeframe(candles1m, vwap))
    signals.push(analyzeDailyTimeframe(candles1m))
  }

  const bullishCount = signals.filter(s => s.direction === 'bullish').length
  const bearishCount = signals.filter(s => s.direction === 'bearish').length
  const totalCount = signals.length

  let overallBias: AlignmentAnalysis['overallBias']
  if (bullishCount > bearishCount && bullishCount >= 2) {
    overallBias = 'bullish'
  } else if (bearishCount > bullishCount && bearishCount >= 2) {
    overallBias = 'bearish'
  } else {
    overallBias = 'neutral'
  }

  return {
    signals,
    bullishCount,
    totalCount,
    overallBias
  }
}

function getDirectionIcon(direction: TimeframeSignal['direction']): string {
  switch (direction) {
    case 'bullish': return '^'
    case 'bearish': return 'v'
    case 'neutral': return 'o'
  }
}

function getDirectionClass(direction: TimeframeSignal['direction']): string {
  switch (direction) {
    case 'bullish': return 'direction-bullish'
    case 'bearish': return 'direction-bearish'
    case 'neutral': return 'direction-neutral'
  }
}

export function TimeframeAlignment({
  selectedSymbol,
  candles: candles1m,
  loading,
  error
}: TimeframeAlignmentProps) {

  // Calculate VWAP from candle data
  const vwapData = useMemo(() => {
    if (!candles1m || candles1m.length === 0) return null
    const { vwap } = calculateVWAPBands(candles1m)
    return vwap.length > 0 ? vwap[vwap.length - 1].value : null
  }, [candles1m])

  const analysis = useMemo(() => {
    if (!selectedSymbol || !candles1m || candles1m.length === 0) return null
    return analyzeAlignment(candles1m, undefined, vwapData ?? undefined)
  }, [selectedSymbol, candles1m, vwapData])

  if (!selectedSymbol) {
    return (
      <div className="timeframe-alignment-panel">
        <div className="alignment-header">
          <h3 title="Shows bullish/bearish/neutral signals across 1m, 5m, and 15m timeframes. Signals are based on price vs VWAP, EMA crossovers, and trend direction. Higher alignment = stronger conviction.">Timeframe Alignment</h3>
        </div>
        <div className="alignment-empty">Select a symbol</div>
      </div>
    )
  }

  if (!analysis || analysis.signals.length === 0) {
    return (
      <div className="timeframe-alignment-panel">
        <div className="alignment-header">
          <h3 title="Shows bullish/bearish/neutral signals across 1m, 5m, and 15m timeframes. Signals are based on price vs VWAP, EMA crossovers, and trend direction. Higher alignment = stronger conviction.">Timeframe Alignment</h3>
        </div>
        <div className="alignment-empty">Loading data...</div>
      </div>
    )
  }

  return (
    <div className="timeframe-alignment-panel">
      <div className="alignment-header">
        <h3 title="Shows bullish/bearish/neutral signals across 1m, 5m, and 15m timeframes. Signals are based on price vs VWAP, EMA crossovers, and trend direction. Higher alignment = stronger conviction.">Timeframe Alignment</h3>
      </div>

      <div className="alignment-signals">
        {analysis.signals.map((signal, index) => (
          <div key={index} className={`signal-row ${getDirectionClass(signal.direction)}`}>
            <span className="signal-icon">{getDirectionIcon(signal.direction)}</span>
            <span className="signal-timeframe">{signal.timeframe}:</span>
            <span className="signal-reason">{signal.reason}</span>
          </div>
        ))}
      </div>

      <div className="alignment-summary">
        <span className={`alignment-score ${analysis.overallBias}`}>
          ALIGNMENT: {analysis.bullishCount}/{analysis.totalCount} BULLISH
        </span>
      </div>
    </div>
  )
}
