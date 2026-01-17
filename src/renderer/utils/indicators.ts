/**
 * Technical indicator calculations for charting
 */

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface VWAPData {
  time: number
  value: number
}

export interface VWAPBandData {
  time: number
  upper1: number
  lower1: number
  upper2: number
  lower2: number
  upper3: number
  lower3: number
}

/**
 * Calculate VWAP (Volume Weighted Average Price)
 * Resets at market open each day
 */
export function calculateVWAP(candles: Candle[]): VWAPData[] {
  if (candles.length === 0) return []

  const vwapData: VWAPData[] = []
  let cumulativeTPV = 0 // Typical Price * Volume
  let cumulativeVolume = 0
  let currentDay = -1

  for (const candle of candles) {
    // Check if new day (reset VWAP)
    const candleDate = new Date(candle.time * 1000)
    const day = candleDate.getDate()

    if (day !== currentDay) {
      // Reset for new day
      cumulativeTPV = 0
      cumulativeVolume = 0
      currentDay = day
    }

    // Typical price = (High + Low + Close) / 3
    const typicalPrice = (candle.high + candle.low + candle.close) / 3
    cumulativeTPV += typicalPrice * candle.volume
    cumulativeVolume += candle.volume

    const vwap = cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice

    vwapData.push({
      time: candle.time,
      value: vwap,
    })
  }

  return vwapData
}

/**
 * Calculate VWAP with standard deviation bands
 */
export function calculateVWAPBands(candles: Candle[]): { vwap: VWAPData[]; bands: VWAPBandData[] } {
  if (candles.length === 0) return { vwap: [], bands: [] }

  const vwapData: VWAPData[] = []
  const bandsData: VWAPBandData[] = []

  let cumulativeTPV = 0
  let cumulativeVolume = 0
  let cumulativeTPVSquared = 0
  let currentDay = -1

  for (const candle of candles) {
    const candleDate = new Date(candle.time * 1000)
    const day = candleDate.getDate()

    if (day !== currentDay) {
      cumulativeTPV = 0
      cumulativeVolume = 0
      cumulativeTPVSquared = 0
      currentDay = day
    }

    const typicalPrice = (candle.high + candle.low + candle.close) / 3
    cumulativeTPV += typicalPrice * candle.volume
    cumulativeTPVSquared += typicalPrice * typicalPrice * candle.volume
    cumulativeVolume += candle.volume

    const vwap = cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice

    // Calculate standard deviation
    const variance = cumulativeVolume > 0
      ? (cumulativeTPVSquared / cumulativeVolume) - (vwap * vwap)
      : 0
    const stdDev = Math.sqrt(Math.max(0, variance))

    vwapData.push({ time: candle.time, value: vwap })
    bandsData.push({
      time: candle.time,
      upper1: vwap + stdDev,
      lower1: vwap - stdDev,
      upper2: vwap + 2 * stdDev,
      lower2: vwap - 2 * stdDev,
      upper3: vwap + 3 * stdDev,
      lower3: vwap - 3 * stdDev,
    })
  }

  return { vwap: vwapData, bands: bandsData }
}

/**
 * Calculate EMA (Exponential Moving Average)
 */
export function calculateEMA(candles: Candle[], period: number): VWAPData[] {
  if (candles.length === 0 || period <= 0) return []

  const emaData: VWAPData[] = []
  const multiplier = 2 / (period + 1)

  // Start with SMA for first value
  let ema = candles.slice(0, period).reduce((sum, c) => sum + c.close, 0) / period

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      // Not enough data yet, skip
      continue
    }

    if (i === period - 1) {
      // First EMA value = SMA
      emaData.push({ time: candles[i].time, value: ema })
    } else {
      // EMA = (Close - Previous EMA) * multiplier + Previous EMA
      ema = (candles[i].close - ema) * multiplier + ema
      emaData.push({ time: candles[i].time, value: ema })
    }
  }

  return emaData
}

/**
 * Calculate SMA (Simple Moving Average)
 */
export function calculateSMA(candles: Candle[], period: number): VWAPData[] {
  if (candles.length < period || period <= 0) return []

  const smaData: VWAPData[] = []

  for (let i = period - 1; i < candles.length; i++) {
    const sum = candles.slice(i - period + 1, i + 1).reduce((acc, c) => acc + c.close, 0)
    smaData.push({
      time: candles[i].time,
      value: sum / period,
    })
  }

  return smaData
}

/**
 * Calculate VWAP distance percentage
 * Returns how far price is from VWAP as a percentage
 */
export function calculateVWAPDistance(price: number, vwap: number): number {
  if (vwap === 0) return 0
  return ((price - vwap) / vwap) * 100
}

/**
 * Get VWAP zone color based on distance
 * Green: within 2.5% (ideal entry)
 * Yellow: 2.5% - 3.5% (extended)
 * Red: > 3.5% (chase territory)
 */
export function getVWAPZoneColor(distancePercent: number): 'green' | 'yellow' | 'red' {
  const absDistance = Math.abs(distancePercent)
  if (absDistance <= 2.5) return 'green'
  if (absDistance <= 3.5) return 'yellow'
  return 'red'
}

// =============================================================================
// Pattern Overlay Types and Detection Functions
// =============================================================================

/**
 * Support/Resistance level detection result
 */
export interface SupportResistanceLevel {
  price: number
  type: 'support' | 'resistance'
  strength: 'weak' | 'moderate' | 'strong'
  touchCount: number
}

/**
 * Gap zone detection result
 */
export interface GapZone {
  topPrice: number
  bottomPrice: number
  type: 'up' | 'down'
  gapPercent: number
  startTime: number
  filled: boolean
}

/**
 * Flag/Pennant pattern detection result
 */
export interface FlagPennantPattern {
  detected: boolean
  type: 'bull_flag' | 'bear_flag' | 'pennant'
  poleStart: { time: number; price: number }
  poleEnd: { time: number; price: number }
  breakoutLevel: number
  targetPrice: number
  patternStrength: 'weak' | 'moderate' | 'strong'
}

/**
 * Detect Support and Resistance levels using pivot point clustering
 *
 * Algorithm:
 * 1. Find local highs/lows (pivot points) over lookback period
 * 2. Cluster prices within tolerance (0.5%)
 * 3. Count touches at each level (more touches = stronger)
 * 4. Return top 3 support + top 3 resistance levels by strength
 */
export function detectSupportResistance(
  candles: Candle[],
  lookbackBars: number = 50,
  tolerance: number = 0.005
): SupportResistanceLevel[] {
  if (candles.length < lookbackBars) return []

  const recentCandles = candles.slice(-lookbackBars)
  const pivotHighs: number[] = []
  const pivotLows: number[] = []

  // Find pivot highs and lows (local extrema)
  for (let i = 2; i < recentCandles.length - 2; i++) {
    const curr = recentCandles[i]
    const prev1 = recentCandles[i - 1]
    const prev2 = recentCandles[i - 2]
    const next1 = recentCandles[i + 1]
    const next2 = recentCandles[i + 2]

    // Pivot high: higher than 2 candles on each side
    if (curr.high > prev1.high && curr.high > prev2.high &&
        curr.high > next1.high && curr.high > next2.high) {
      pivotHighs.push(curr.high)
    }

    // Pivot low: lower than 2 candles on each side
    if (curr.low < prev1.low && curr.low < prev2.low &&
        curr.low < next1.low && curr.low < next2.low) {
      pivotLows.push(curr.low)
    }
  }

  // Also add recent highs/lows for better coverage
  const last5 = recentCandles.slice(-5)
  pivotHighs.push(Math.max(...last5.map(c => c.high)))
  pivotLows.push(Math.min(...last5.map(c => c.low)))

  // Cluster similar prices and count touches
  const clusterPrices = (prices: number[], type: 'support' | 'resistance'): SupportResistanceLevel[] => {
    if (prices.length === 0) return []

    const clusters: { price: number; count: number }[] = []

    for (const price of prices) {
      // Find existing cluster within tolerance
      const existingCluster = clusters.find(c =>
        Math.abs(c.price - price) / c.price < tolerance
      )

      if (existingCluster) {
        // Average the price and increment count
        existingCluster.price = (existingCluster.price * existingCluster.count + price) / (existingCluster.count + 1)
        existingCluster.count++
      } else {
        clusters.push({ price, count: 1 })
      }
    }

    // Sort by touch count (descending) and take top 3
    return clusters
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(c => ({
        price: c.price,
        type,
        strength: c.count >= 3 ? 'strong' : c.count >= 2 ? 'moderate' : 'weak',
        touchCount: c.count
      }))
  }

  const resistanceLevels = clusterPrices(pivotHighs, 'resistance')
  const supportLevels = clusterPrices(pivotLows, 'support')

  return [...resistanceLevels, ...supportLevels]
}

/**
 * Detect price gaps in the chart
 *
 * Algorithm:
 * 1. Compare each candle's open vs previous close
 * 2. If gap > threshold, create GapZone
 * 3. Track if price has filled the gap in subsequent candles
 * 4. Return unfilled gaps (most relevant for trading)
 */
export function detectGaps(
  candles: Candle[],
  minGapPercent: number = 1.0
): GapZone[] {
  if (candles.length < 2) return []

  const gaps: GapZone[] = []

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]
    const curr = candles[i]

    // Check for gap up
    if (curr.open > prev.close) {
      const gapPercent = ((curr.open - prev.close) / prev.close) * 100
      if (gapPercent >= minGapPercent) {
        gaps.push({
          topPrice: curr.open,
          bottomPrice: prev.close,
          type: 'up',
          gapPercent,
          startTime: curr.time,
          filled: false
        })
      }
    }

    // Check for gap down
    if (curr.open < prev.close) {
      const gapPercent = ((prev.close - curr.open) / prev.close) * 100
      if (gapPercent >= minGapPercent) {
        gaps.push({
          topPrice: prev.close,
          bottomPrice: curr.open,
          type: 'down',
          gapPercent,
          startTime: curr.time,
          filled: false
        })
      }
    }
  }

  // Check if gaps have been filled by subsequent price action
  for (const gap of gaps) {
    const gapIndex = candles.findIndex(c => c.time === gap.startTime)
    if (gapIndex === -1) continue

    for (let j = gapIndex; j < candles.length; j++) {
      const candle = candles[j]
      // Gap is filled if price trades through the entire gap zone
      if (gap.type === 'up') {
        if (candle.low <= gap.bottomPrice) {
          gap.filled = true
          break
        }
      } else {
        if (candle.high >= gap.topPrice) {
          gap.filled = true
          break
        }
      }
    }
  }

  // Return only unfilled gaps (limit to 5 most recent)
  return gaps
    .filter(g => !g.filled)
    .slice(-5)
}

/**
 * Detect Flag or Pennant consolidation patterns
 *
 * Algorithm:
 * 1. Find strong directional move (5%+ in short time = "pole")
 * 2. Look for subsequent tight consolidation (3-7 candles, <2% range)
 * 3. Classify as flag (parallel bounds) or pennant (converging)
 * 4. Calculate measured move target (pole length projected from breakout)
 */
export function detectFlagPennant(
  candles: Candle[],
  minPoleMove: number = 0.05,
  maxConsolidationRange: number = 0.02
): FlagPennantPattern | null {
  if (candles.length < 15) return null

  // Look for pole in the recent data (last 20 candles, pole in first 10)
  const lookback = Math.min(20, candles.length)
  const recentCandles = candles.slice(-lookback)

  // Find the strongest move (pole) in first half of lookback
  let bestPole: { start: number; end: number; move: number; direction: 'up' | 'down' } | null = null

  for (let poleLen = 3; poleLen <= 8; poleLen++) {
    for (let i = 0; i <= lookback - poleLen - 5; i++) {
      const poleStart = recentCandles[i]
      const poleEnd = recentCandles[i + poleLen - 1]

      // Bull pole: close > open significantly
      const bullMove = (poleEnd.close - poleStart.open) / poleStart.open
      if (bullMove >= minPoleMove) {
        if (!bestPole || bullMove > bestPole.move) {
          bestPole = { start: i, end: i + poleLen - 1, move: bullMove, direction: 'up' }
        }
      }

      // Bear pole: close < open significantly
      const bearMove = (poleStart.open - poleEnd.close) / poleStart.open
      if (bearMove >= minPoleMove) {
        if (!bestPole || bearMove > bestPole.move) {
          bestPole = { start: i, end: i + poleLen - 1, move: bearMove, direction: 'down' }
        }
      }
    }
  }

  if (!bestPole) return null

  // Look for consolidation after the pole
  const consolidationStart = bestPole.end + 1
  const consolidationCandles = recentCandles.slice(consolidationStart)

  if (consolidationCandles.length < 3 || consolidationCandles.length > 10) return null

  // Check consolidation range
  const consHighs = consolidationCandles.map(c => c.high)
  const consLows = consolidationCandles.map(c => c.low)
  const consMaxHigh = Math.max(...consHighs)
  const consMinLow = Math.min(...consLows)
  const consRange = (consMaxHigh - consMinLow) / consMaxHigh

  if (consRange > maxConsolidationRange) return null

  // Determine pattern type (flag vs pennant)
  // Pennant: range narrows over time; Flag: range stays parallel
  const firstHalfRange = Math.max(...consHighs.slice(0, Math.floor(consHighs.length / 2))) -
                          Math.min(...consLows.slice(0, Math.floor(consLows.length / 2)))
  const secondHalfRange = Math.max(...consHighs.slice(Math.floor(consHighs.length / 2))) -
                           Math.min(...consLows.slice(Math.floor(consLows.length / 2)))

  const isConverging = secondHalfRange < firstHalfRange * 0.7

  // Calculate breakout level and target
  const poleStartCandle = recentCandles[bestPole.start]
  const poleEndCandle = recentCandles[bestPole.end]
  const poleHeight = Math.abs(poleEndCandle.close - poleStartCandle.open)

  let breakoutLevel: number
  let targetPrice: number
  let patternType: 'bull_flag' | 'bear_flag' | 'pennant'

  if (bestPole.direction === 'up') {
    breakoutLevel = consMaxHigh
    targetPrice = breakoutLevel + poleHeight
    patternType = isConverging ? 'pennant' : 'bull_flag'
  } else {
    breakoutLevel = consMinLow
    targetPrice = breakoutLevel - poleHeight
    patternType = isConverging ? 'pennant' : 'bear_flag'
  }

  // Determine strength
  let strength: 'weak' | 'moderate' | 'strong' = 'weak'
  if (bestPole.move > 0.08) strength = 'moderate'
  if (bestPole.move > 0.12 && consRange < 0.015) strength = 'strong'
  if (isConverging && bestPole.move > 0.08) strength = 'strong'

  return {
    detected: true,
    type: patternType,
    poleStart: { time: poleStartCandle.time, price: poleStartCandle.open },
    poleEnd: { time: poleEndCandle.time, price: poleEndCandle.close },
    breakoutLevel,
    targetPrice,
    patternStrength: strength
  }
}

// =============================================================================
// Existing Pattern Detection
// =============================================================================

/**
 * Micro-pullback pattern detection result
 */
export interface MicroPullbackPattern {
  detected: boolean
  triggerPrice: number      // Breakout trigger (resistance level)
  stopPrice: number         // Stop at consolidation low
  consolidationStart: number // Time when consolidation started
  consolidationEnd: number   // Time of last candle in pattern
  patternStrength: 'weak' | 'moderate' | 'strong'
}

/**
 * Detect micro-pullback / flat-top consolidation pattern
 *
 * Pattern characteristics:
 * - 3-7 candles with relatively tight range (< 2% from high to low)
 * - Flat top (highs within 0.5% of each other)
 * - Price has pulled back slightly from a move up
 * - Volume typically declining during consolidation
 */
export function detectMicroPullback(
  candles: Candle[],
  lookbackBars: number = 7,
  flatTopTolerance: number = 0.005, // 0.5%
  rangeMaxPercent: number = 0.02    // 2% max range
): MicroPullbackPattern | null {
  if (candles.length < lookbackBars + 3) return null

  // Look at recent candles for consolidation
  const recentCandles = candles.slice(-lookbackBars)

  // Find the highest high and lowest low in the lookback period
  const highs = recentCandles.map(c => c.high)
  const lows = recentCandles.map(c => c.low)
  const maxHigh = Math.max(...highs)
  const minLow = Math.min(...lows)

  // Calculate range as percentage
  const rangePercent = (maxHigh - minLow) / maxHigh

  // Check if range is tight enough
  if (rangePercent > rangeMaxPercent) return null

  // Check for flat top - highs should be within tolerance
  const avgHigh = highs.reduce((a, b) => a + b, 0) / highs.length
  const flatTopDeviation = Math.max(...highs.map(h => Math.abs(h - avgHigh) / avgHigh))

  if (flatTopDeviation > flatTopTolerance) return null

  // Check for prior uptrend (last candle before consolidation should be higher than earlier)
  const priorCandles = candles.slice(-(lookbackBars + 5), -lookbackBars)
  if (priorCandles.length > 0) {
    const priorLow = Math.min(...priorCandles.map(c => c.low))
    const priorHigh = Math.max(...priorCandles.map(c => c.high))

    // Consolidation should be at upper part of prior range (pullback from high)
    if (minLow < priorLow) return null // Price broke down, not consolidating
  }

  // Check volume pattern - ideally declining
  let volumeDecreasing = true
  const volumes = recentCandles.map(c => c.volume)
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length
  const lastVolume = volumes[volumes.length - 1]

  // Pattern strength based on characteristics
  let strength: 'weak' | 'moderate' | 'strong' = 'weak'

  // Tight range is stronger
  if (rangePercent < 0.01) strength = 'moderate'

  // Volume declining adds strength
  if (lastVolume < avgVolume * 0.8) {
    strength = strength === 'moderate' ? 'strong' : 'moderate'
  }

  // Very flat top adds strength
  if (flatTopDeviation < 0.002) {
    strength = strength === 'moderate' ? 'strong' : 'moderate'
  }

  return {
    detected: true,
    triggerPrice: maxHigh,
    stopPrice: minLow,
    consolidationStart: recentCandles[0].time,
    consolidationEnd: recentCandles[recentCandles.length - 1].time,
    patternStrength: strength
  }
}
