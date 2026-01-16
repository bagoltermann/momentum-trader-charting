import React, { useMemo } from 'react'
import { useCandleData } from '../../hooks/useCandleData'
import { Candle } from '../../utils/indicators'

interface ExitSignalDashboardProps {
  selectedSymbol: string | null
  entryPrice?: number
  stopPrice?: number
}

interface ExitSignal {
  name: string
  status: 'ok' | 'warning' | 'exit'
  description: string
}

interface ExitAnalysis {
  signals: ExitSignal[]
  overallStatus: 'hold' | 'caution' | 'exit'
  statusMessage: string
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 */
function calculateMACD(candles: Candle[]): { macd: number; signal: number; histogram: number } | null {
  if (candles.length < 26) return null

  // EMA calculation helper
  const calculateEMA = (data: number[], period: number): number[] => {
    const ema: number[] = []
    const multiplier = 2 / (period + 1)

    // Start with SMA
    let sum = 0
    for (let i = 0; i < period; i++) {
      sum += data[i]
    }
    ema.push(sum / period)

    // Calculate EMA for remaining data
    for (let i = period; i < data.length; i++) {
      ema.push((data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1])
    }

    return ema
  }

  const closes = candles.map(c => c.close)

  // Calculate 12-period EMA
  const ema12 = calculateEMA(closes, 12)
  // Calculate 26-period EMA
  const ema26 = calculateEMA(closes, 26)

  // MACD line = EMA12 - EMA26
  // We need to align the arrays - ema26 starts 14 elements later than ema12
  const macdLine: number[] = []
  for (let i = 0; i < ema26.length; i++) {
    const ema12Index = i + (26 - 12)
    macdLine.push(ema12[ema12Index] - ema26[i])
  }

  if (macdLine.length < 9) return null

  // Signal line = 9-period EMA of MACD
  const signalLine = calculateEMA(macdLine, 9)

  const currentMACD = macdLine[macdLine.length - 1]
  const currentSignal = signalLine[signalLine.length - 1]
  const histogram = currentMACD - currentSignal

  return { macd: currentMACD, signal: currentSignal, histogram }
}

/**
 * Detect MACD crossover status
 */
function checkMACDCrossover(candles: Candle[]): ExitSignal {
  const macd = calculateMACD(candles)

  if (!macd) {
    return { name: 'MACD Crossover', status: 'ok', description: 'Insufficient data' }
  }

  // Check recent histogram trend
  const prevCandles = candles.slice(0, -1)
  const prevMACD = calculateMACD(prevCandles)

  if (prevMACD) {
    // Check for bearish crossover (MACD crossing below signal)
    if (prevMACD.histogram > 0 && macd.histogram < 0) {
      return { name: 'MACD Crossover', status: 'exit', description: 'Bearish crossover!' }
    }
    // Check for weakening momentum
    if (macd.histogram > 0 && macd.histogram < prevMACD.histogram) {
      return { name: 'MACD Crossover', status: 'warning', description: 'Momentum weakening' }
    }
  }

  if (macd.histogram > 0) {
    return { name: 'MACD Crossover', status: 'ok', description: 'Bullish momentum' }
  }

  return { name: 'MACD Crossover', status: 'warning', description: 'Below signal line' }
}

/**
 * Check for volume decline pattern
 */
function checkVolumeDecline(candles: Candle[]): ExitSignal {
  if (candles.length < 10) {
    return { name: 'Volume Decline', status: 'ok', description: 'Insufficient data' }
  }

  const recent = candles.slice(-5)
  const prior = candles.slice(-10, -5)

  const recentAvgVol = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length
  const priorAvgVol = prior.reduce((sum, c) => sum + c.volume, 0) / prior.length

  const volumeRatio = recentAvgVol / priorAvgVol

  if (volumeRatio < 0.5) {
    return { name: 'Volume Decline', status: 'exit', description: 'Volume collapsed -50%' }
  }
  if (volumeRatio < 0.7) {
    return { name: 'Volume Decline', status: 'warning', description: `Volume down ${((1 - volumeRatio) * 100).toFixed(0)}%` }
  }

  return { name: 'Volume Decline', status: 'ok', description: 'Volume healthy' }
}

/**
 * Detect jackknife rejection pattern (sharp reversal after spike)
 */
function checkJackknifeReject(candles: Candle[]): ExitSignal {
  if (candles.length < 5) {
    return { name: 'Jackknife Reject', status: 'ok', description: 'Insufficient data' }
  }

  const recent = candles.slice(-5)

  // Find if there was a spike followed by rejection
  let maxHigh = 0
  let maxHighIndex = 0

  for (let i = 0; i < recent.length; i++) {
    if (recent[i].high > maxHigh) {
      maxHigh = recent[i].high
      maxHighIndex = i
    }
  }

  const lastCandle = recent[recent.length - 1]
  const priceFromHigh = ((maxHigh - lastCandle.close) / maxHigh) * 100

  // If we spiked and are now more than 2% below the high with a bearish candle
  if (maxHighIndex < recent.length - 1 && priceFromHigh > 2) {
    // Check if last candle is bearish
    if (lastCandle.close < lastCandle.open) {
      if (priceFromHigh > 3) {
        return { name: 'Jackknife Reject', status: 'exit', description: `Rejected ${priceFromHigh.toFixed(1)}% from high` }
      }
      return { name: 'Jackknife Reject', status: 'warning', description: 'Possible rejection forming' }
    }
  }

  return { name: 'Jackknife Reject', status: 'ok', description: 'No rejection' }
}

/**
 * Check price vs stop level
 */
function checkPriceVsStop(candles: Candle[], entryPrice?: number, stopPrice?: number): ExitSignal {
  if (candles.length === 0) {
    return { name: 'Price vs Stop', status: 'ok', description: 'No data' }
  }

  const lastCandle = candles[candles.length - 1]
  const currentPrice = lastCandle.close

  if (!stopPrice || !entryPrice) {
    // Use session low as implied stop
    const sessionLow = Math.min(...candles.map(c => c.low))
    const distanceFromLow = ((currentPrice - sessionLow) / sessionLow) * 100

    if (distanceFromLow < 0.5) {
      return { name: 'Price vs Stop', status: 'exit', description: 'At session low!' }
    }
    if (distanceFromLow < 1) {
      return { name: 'Price vs Stop', status: 'warning', description: 'Near session low' }
    }

    return { name: 'Price vs Stop', status: 'ok', description: `${distanceFromLow.toFixed(1)}% above low` }
  }

  // With explicit stop price
  const distanceToStop = ((currentPrice - stopPrice) / stopPrice) * 100

  if (currentPrice <= stopPrice) {
    return { name: 'Price vs Stop', status: 'exit', description: 'Stop hit!' }
  }
  if (distanceToStop < 0.5) {
    return { name: 'Price vs Stop', status: 'exit', description: 'Within 0.5% of stop' }
  }
  if (distanceToStop < 1) {
    return { name: 'Price vs Stop', status: 'warning', description: 'Near stop level' }
  }

  return { name: 'Price vs Stop', status: 'ok', description: `${distanceToStop.toFixed(1)}% above stop` }
}

/**
 * Analyze all exit signals
 */
function analyzeExitSignals(
  candles: Candle[],
  entryPrice?: number,
  stopPrice?: number
): ExitAnalysis {
  const signals: ExitSignal[] = [
    checkMACDCrossover(candles),
    checkVolumeDecline(candles),
    checkJackknifeReject(candles),
    checkPriceVsStop(candles, entryPrice, stopPrice)
  ]

  const exitCount = signals.filter(s => s.status === 'exit').length
  const warningCount = signals.filter(s => s.status === 'warning').length

  let overallStatus: ExitAnalysis['overallStatus']
  let statusMessage: string

  if (exitCount > 0) {
    overallStatus = 'exit'
    statusMessage = 'EXIT POSITION'
  } else if (warningCount >= 2) {
    overallStatus = 'caution'
    statusMessage = 'TIGHTEN STOP'
  } else if (warningCount === 1) {
    overallStatus = 'caution'
    statusMessage = 'MONITOR CLOSELY'
  } else {
    overallStatus = 'hold'
    statusMessage = 'HOLD POSITION'
  }

  return { signals, overallStatus, statusMessage }
}

function getStatusIcon(status: ExitSignal['status']): string {
  switch (status) {
    case 'ok': return '[OK]'
    case 'warning': return '[!]'
    case 'exit': return '[X]'
  }
}

function getStatusClass(status: ExitSignal['status']): string {
  switch (status) {
    case 'ok': return 'signal-ok'
    case 'warning': return 'signal-warning'
    case 'exit': return 'signal-exit'
  }
}

function getOverallClass(status: ExitAnalysis['overallStatus']): string {
  switch (status) {
    case 'hold': return 'status-hold'
    case 'caution': return 'status-caution'
    case 'exit': return 'status-exit'
  }
}

export function ExitSignalDashboard({
  selectedSymbol,
  entryPrice,
  stopPrice
}: ExitSignalDashboardProps) {
  const { candles, loading, error } = useCandleData(selectedSymbol, '1m')

  const analysis = useMemo(() => {
    if (!selectedSymbol || !candles || candles.length === 0) return null
    return analyzeExitSignals(candles, entryPrice, stopPrice)
  }, [selectedSymbol, candles, entryPrice, stopPrice])

  if (!selectedSymbol) {
    return (
      <div className="exit-signal-panel">
        <div className="exit-signal-header">
          <h3 title="'Looking For Shorts' exit system monitors MACD crossovers, VWAP breaks, volume exhaustion, new lows, and R-multiple targets. Helps identify when momentum is fading and it's time to exit.">Exit Signals (LFS)</h3>
        </div>
        <div className="exit-signal-empty">Select a symbol</div>
      </div>
    )
  }

  if (loading && (!candles || candles.length === 0)) {
    return (
      <div className="exit-signal-panel">
        <div className="exit-signal-header">
          <h3 title="'Looking For Shorts' exit system monitors MACD crossovers, VWAP breaks, volume exhaustion, new lows, and R-multiple targets. Helps identify when momentum is fading and it's time to exit.">Exit Signals (LFS)</h3>
        </div>
        <div className="exit-signal-empty">Loading...</div>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="exit-signal-panel">
        <div className="exit-signal-header">
          <h3 title="'Looking For Shorts' exit system monitors MACD crossovers, VWAP breaks, volume exhaustion, new lows, and R-multiple targets. Helps identify when momentum is fading and it's time to exit.">Exit Signals (LFS)</h3>
        </div>
        <div className="exit-signal-empty">No data available</div>
      </div>
    )
  }

  return (
    <div className="exit-signal-panel">
      <div className="exit-signal-header">
        <h3 title="'Looking For Shorts' exit system monitors MACD crossovers, VWAP breaks, volume exhaustion, new lows, and R-multiple targets. Helps identify when momentum is fading and it's time to exit.">Exit Signals (LFS)</h3>
      </div>

      <div className="exit-signals-list">
        {analysis.signals.map((signal, index) => (
          <div key={index} className={`exit-signal-row ${getStatusClass(signal.status)}`}>
            <span className="exit-signal-name">{signal.name}:</span>
            <span className="exit-signal-icon">{getStatusIcon(signal.status)}</span>
            <span className="exit-signal-desc">{signal.description}</span>
          </div>
        ))}
      </div>

      <div className={`exit-signal-status ${getOverallClass(analysis.overallStatus)}`}>
        STATUS: {analysis.statusMessage}
      </div>
    </div>
  )
}
