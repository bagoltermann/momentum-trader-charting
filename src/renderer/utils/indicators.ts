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
