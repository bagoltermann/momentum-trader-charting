import React, { useEffect, useRef, useMemo, useCallback } from 'react'
import { createChart, IChartApi, ISeriesApi, CandlestickData, LineData, HistogramData, IPriceLine } from 'lightweight-charts'
import {
  Candle,
  calculateVWAPBands,
  calculateEMA,
  detectMicroPullback,
  MicroPullbackPattern,
  SupportResistanceLevel,
  GapZone,
  FlagPennantPattern
} from '../../utils/indicators'
import { CandleWithVolume } from '../../hooks/useCandleData'
import { debugLog } from '../../utils/debugLog'

export interface EntryZoneLevel {
  price: number
  label: string
  type: 'entry' | 'stop' | 'target'
}

export interface RiskRewardConfig {
  entryPrice: number
  stopPrice: number
  showTargets?: boolean // Show 2R and 3R target lines
}

interface EnhancedChartProps {
  symbol: string
  timeframe: '1m' | '5m' | '15m' | 'D'
  candles: CandleWithVolume[]
  rawCandles: Candle[]
  height?: number
  showVWAP?: boolean
  showVWAPBands?: boolean
  showVolume?: boolean
  showEMA9?: boolean
  showEMA20?: boolean
  entryZones?: EntryZoneLevel[]
  riskReward?: RiskRewardConfig
  detectPatterns?: boolean // Enable micro-pullback pattern detection
  // Pattern overlays
  supportResistanceLevels?: SupportResistanceLevel[]
  gapZones?: GapZone[]
  flagPennantPattern?: FlagPennantPattern | null
}

// Store series references for data updates
interface SeriesRefs {
  candlestick: ISeriesApi<'Candlestick'> | null
  vwap: ISeriesApi<'Line'> | null
  ema9: ISeriesApi<'Line'> | null
  ema20: ISeriesApi<'Line'> | null
  volume: ISeriesApi<'Histogram'> | null
  upper1: ISeriesApi<'Line'> | null
  upper2: ISeriesApi<'Line'> | null
  lower1: ISeriesApi<'Line'> | null
  lower2: ISeriesApi<'Line'> | null
  priceLines: IPriceLine[]
}

export function EnhancedChart({
  symbol,
  timeframe,
  candles,
  rawCandles,
  height = 400,
  showVWAP = true,
  showVWAPBands = false,
  showVolume = true,
  showEMA9 = true,
  showEMA20 = true,
  entryZones = [],
  riskReward,
  detectPatterns = true,
  supportResistanceLevels = [],
  gapZones = [],
  flagPennantPattern,
}: EnhancedChartProps) {
  debugLog(`[EnhancedChart] RENDER: symbol=${symbol}, candles=${candles.length}, rawCandles=${rawCandles.length}`)

  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  // Track previous data for incremental updates
  const prevDataRef = useRef<{ count: number; lastTime: number; symbol: string }>({ count: 0, lastTime: 0, symbol: '' })
  const seriesRef = useRef<SeriesRefs>({
    candlestick: null,
    vwap: null,
    ema9: null,
    ema20: null,
    volume: null,
    upper1: null,
    upper2: null,
    lower1: null,
    lower2: null,
    priceLines: [],
  })

  // Calculate indicators
  const { vwap, bands } = useMemo(() => calculateVWAPBands(rawCandles), [rawCandles])
  const ema9 = useMemo(() => calculateEMA(rawCandles, 9), [rawCandles])
  const ema20 = useMemo(() => calculateEMA(rawCandles, 20), [rawCandles])

  // Detect micro-pullback pattern
  const microPullback = useMemo(() => {
    if (!detectPatterns || rawCandles.length < 10) return null
    return detectMicroPullback(rawCandles)
  }, [rawCandles, detectPatterns])

  // Pre-compute VWAP band arrays in a single pass (avoids 4 separate .map() calls)
  const { bandUpper1, bandUpper2, bandLower1, bandLower2 } = useMemo(() => {
    if (bands.length === 0) return { bandUpper1: [], bandUpper2: [], bandLower1: [], bandLower2: [] }
    const u1: LineData<number>[] = []
    const u2: LineData<number>[] = []
    const l1: LineData<number>[] = []
    const l2: LineData<number>[] = []
    for (const b of bands) {
      u1.push({ time: b.time, value: b.upper1 } as LineData<number>)
      u2.push({ time: b.time, value: b.upper2 } as LineData<number>)
      l1.push({ time: b.time, value: b.lower1 } as LineData<number>)
      l2.push({ time: b.time, value: b.lower2 } as LineData<number>)
    }
    return { bandUpper1: u1, bandUpper2: u2, bandLower1: l1, bandLower2: l2 }
  }, [bands])

  // Prepare volume data with colors
  const volumeData = useMemo(() => {
    return candles.map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(0, 200, 83, 0.5)' : 'rgba(255, 23, 68, 0.5)',
    }))
  }, [candles])

  // Effect 1: Create chart (only on mount or symbol change)
  useEffect(() => {
    debugLog(`[EnhancedChart] ${symbol} Effect1: Creating chart, container=${!!chartContainerRef.current}`)

    if (!chartContainerRef.current) {
      debugLog(`[EnhancedChart] ${symbol} Effect1: No container ref, aborting`)
      return
    }

    // Clean up existing chart
    if (chartRef.current) {
      debugLog(`[EnhancedChart] ${symbol} Effect1: Removing existing chart`)
      chartRef.current.remove()
      chartRef.current = null
    }

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height,
      layout: {
        background: { color: '#1a1a2e' },
        textColor: '#eee',
      },
      grid: {
        vertLines: { color: '#2a2a4e' },
        horzLines: { color: '#2a2a4e' },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#758696',
          width: 1,
          style: 2,
          labelBackgroundColor: '#2196F3',
        },
        horzLine: {
          color: '#758696',
          width: 1,
          style: 2,
          labelBackgroundColor: '#2196F3',
        },
      },
      rightPriceScale: {
        borderColor: '#333',
        scaleMargins: {
          top: 0.1,
          bottom: showVolume ? 0.25 : 0.1,
        },
      },
      timeScale: {
        borderColor: '#333',
        timeVisible: true,
        secondsVisible: timeframe === '1m',
        tickMarkFormatter: (time: number) => {
          const date = new Date(time * 1000)
          return date.toLocaleTimeString('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })
        },
      },
      localization: {
        timeFormatter: (time: number) => {
          const date = new Date(time * 1000)
          return date.toLocaleTimeString('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })
        },
      },
    })

    chartRef.current = chart

    // Add candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#00C853',
      downColor: '#FF1744',
      borderUpColor: '#00C853',
      borderDownColor: '#FF1744',
      wickUpColor: '#00C853',
      wickDownColor: '#FF1744',
    })

    // Add VWAP series
    const vwapSeries = chart.addLineSeries({
      color: '#2196F3',
      lineWidth: 2,
      title: 'VWAP',
      priceLineVisible: false,
      visible: showVWAP,
    })

    // Add EMA series
    const ema9Series = chart.addLineSeries({
      color: '#FFD600',
      lineWidth: 1,
      title: 'EMA 9',
      priceLineVisible: false,
      visible: showEMA9,
    })

    const ema20Series = chart.addLineSeries({
      color: '#FF9100',
      lineWidth: 1,
      title: 'EMA 20',
      priceLineVisible: false,
      visible: showEMA20,
    })

    // Add VWAP bands
    const upper1Series = chart.addLineSeries({
      color: 'rgba(33, 150, 243, 0.3)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      visible: showVWAPBands,
    })
    const upper2Series = chart.addLineSeries({
      color: 'rgba(33, 150, 243, 0.2)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      visible: showVWAPBands,
    })
    const lower1Series = chart.addLineSeries({
      color: 'rgba(33, 150, 243, 0.3)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      visible: showVWAPBands,
    })
    const lower2Series = chart.addLineSeries({
      color: 'rgba(33, 150, 243, 0.2)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      visible: showVWAPBands,
    })

    // Add volume histogram
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      visible: showVolume,
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })

    // Store series references
    seriesRef.current = {
      candlestick: candlestickSeries,
      vwap: vwapSeries,
      ema9: ema9Series,
      ema20: ema20Series,
      volume: volumeSeries,
      upper1: upper1Series,
      upper2: upper2Series,
      lower1: lower1Series,
      lower2: lower2Series,
      priceLines: [],
    }
    debugLog(`[EnhancedChart] ${symbol} Effect1: Chart and series created successfully`)

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        const containerHeight = chartContainerRef.current.clientHeight
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: containerHeight > 50 ? containerHeight : height
        })
      }
    }
    window.addEventListener('resize', handleResize)

    const resizeObserver = new ResizeObserver(handleResize)
    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current)
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [symbol, height, timeframe, showVolume, showVWAP, showVWAPBands, showEMA9, showEMA20])

  // Effect 2: Update data (when candles or indicators change)
  // Uses incremental updates when possible to avoid resetting zoom/scroll
  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current

    debugLog(`[EnhancedChart] ${symbol} Effect2: chart=${!!chart}, candlestick=${!!series.candlestick}, candles=${candles.length}`)

    if (!chart || !series.candlestick) {
      debugLog(`[EnhancedChart] ${symbol} Effect2: Skipping - chart or series not ready`)
      return
    }

    if (candles.length === 0) {
      debugLog(`[EnhancedChart] ${symbol} Effect2: No candles to set`)
      return
    }

    const prev = prevDataRef.current
    const lastCandle = candles[candles.length - 1]
    const lastTime = lastCandle.time as number

    // Determine if this is an incremental update:
    // Same symbol, count difference <= 1, and we had data before
    const isIncremental = prev.symbol === symbol &&
      prev.count > 0 &&
      candles.length >= prev.count &&
      candles.length <= prev.count + 1

    if (isIncremental) {
      // Incremental: update just the last candle (and +1 new candle if appended)
      debugLog(`[EnhancedChart] ${symbol} Effect2: Incremental update (${prev.count} -> ${candles.length})`)
      series.candlestick.update(lastCandle as CandlestickData<number>)

      // Update indicators incrementally too
      if (series.vwap && vwap.length > 0) {
        series.vwap.update(vwap[vwap.length - 1] as LineData<number>)
      }
      if (series.ema9 && ema9.length > 0) {
        series.ema9.update(ema9[ema9.length - 1] as LineData<number>)
      }
      if (series.ema20 && ema20.length > 0) {
        series.ema20.update(ema20[ema20.length - 1] as LineData<number>)
      }
      if (series.volume && volumeData.length > 0) {
        series.volume.update(volumeData[volumeData.length - 1] as HistogramData<number>)
      }
      // VWAP bands: update last point
      if (bands.length > 0) {
        const lastBand = bands[bands.length - 1]
        if (series.upper1) series.upper1.update({ time: lastBand.time, value: lastBand.upper1 } as LineData<number>)
        if (series.upper2) series.upper2.update({ time: lastBand.time, value: lastBand.upper2 } as LineData<number>)
        if (series.lower1) series.lower1.update({ time: lastBand.time, value: lastBand.lower1 } as LineData<number>)
        if (series.lower2) series.lower2.update({ time: lastBand.time, value: lastBand.lower2 } as LineData<number>)
      }
    } else {
      // Full reload: symbol change or substantial data difference
      debugLog(`[EnhancedChart] ${symbol} Effect2: Full setData (${candles.length} candles)`)
      series.candlestick.setData(candles as CandlestickData<number>[])

      if (series.vwap && vwap.length > 0) {
        series.vwap.setData(vwap as LineData<number>[])
      }
      if (series.ema9 && ema9.length > 0) {
        series.ema9.setData(ema9 as LineData<number>[])
      }
      if (series.ema20 && ema20.length > 0) {
        series.ema20.setData(ema20 as LineData<number>[])
      }
      if (series.upper1 && bandUpper1.length > 0) {
        series.upper1.setData(bandUpper1)
      }
      if (series.upper2 && bandUpper2.length > 0) {
        series.upper2.setData(bandUpper2)
      }
      if (series.lower1 && bandLower1.length > 0) {
        series.lower1.setData(bandLower1)
      }
      if (series.lower2 && bandLower2.length > 0) {
        series.lower2.setData(bandLower2)
      }
      if (series.volume && volumeData.length > 0) {
        series.volume.setData(volumeData as HistogramData<number>[])
      }
      chart.timeScale().fitContent()
    }

    // Track current state for next comparison
    prevDataRef.current = { count: candles.length, lastTime, symbol }
  }, [candles, vwap, ema9, ema20, bands, bandUpper1, bandUpper2, bandLower1, bandLower2, volumeData])

  // Effect 3: Update price lines (entry zones, patterns, etc.)
  useEffect(() => {
    const series = seriesRef.current
    if (!series.candlestick) return

    // Remove old price lines
    series.priceLines.forEach(line => {
      try {
        series.candlestick?.removePriceLine(line)
      } catch (e) {
        // Line may already be removed
      }
    })
    series.priceLines = []

    // Add entry zone price lines
    entryZones.forEach(zone => {
      const color = zone.type === 'entry' ? '#00E676' :
                    zone.type === 'stop' ? '#FF5252' : '#FFD600'
      const line = series.candlestick!.createPriceLine({
        price: zone.price,
        color: color,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: zone.label,
      })
      series.priceLines.push(line)
    })

    // Add Risk:Reward overlay
    if (riskReward) {
      const { entryPrice, stopPrice, showTargets = true } = riskReward
      const risk = Math.abs(entryPrice - stopPrice)
      const riskPercent = (risk / entryPrice) * 100

      series.priceLines.push(series.candlestick!.createPriceLine({
        price: entryPrice,
        color: '#2196F3',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `Entry $${entryPrice.toFixed(2)}`,
      }))

      series.priceLines.push(series.candlestick!.createPriceLine({
        price: stopPrice,
        color: '#FF1744',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `Stop -$${risk.toFixed(2)} (${riskPercent.toFixed(1)}%)`,
      }))

      if (showTargets) {
        const target2R = entryPrice + (2 * risk)
        const target3R = entryPrice + (3 * risk)
        series.priceLines.push(series.candlestick!.createPriceLine({
          price: target2R,
          color: '#00E676',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `2R +$${(2 * risk).toFixed(2)}`,
        }))
        series.priceLines.push(series.candlestick!.createPriceLine({
          price: target3R,
          color: '#69F0AE',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `3R +$${(3 * risk).toFixed(2)}`,
        }))
      }
    }

    // Add micro-pullback pattern
    if (microPullback && microPullback.detected) {
      const strengthColors = { weak: '#FFEB3B', moderate: '#FF9800', strong: '#4CAF50' }
      const color = strengthColors[microPullback.patternStrength]

      series.priceLines.push(series.candlestick!.createPriceLine({
        price: microPullback.triggerPrice,
        color: color,
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `BREAKOUT $${microPullback.triggerPrice.toFixed(2)}`,
      }))
      series.priceLines.push(series.candlestick!.createPriceLine({
        price: microPullback.stopPrice,
        color: '#FF5252',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `Pattern Stop $${microPullback.stopPrice.toFixed(2)}`,
      }))
    }

    // Add Support/Resistance levels
    const strengthWidths = { weak: 1, moderate: 2, strong: 3 }
    supportResistanceLevels.forEach(level => {
      const color = level.type === 'resistance' ? '#FF5252' : '#00E676'
      series.priceLines.push(series.candlestick!.createPriceLine({
        price: level.price,
        color: color,
        lineWidth: strengthWidths[level.strength],
        lineStyle: 2,
        axisLabelVisible: true,
        title: `${level.type === 'resistance' ? 'R' : 'S'} $${level.price.toFixed(2)}`,
      }))
    })

    // Add Gap zones
    gapZones.forEach(gap => {
      const color = gap.type === 'up' ? '#00E676' : '#FF5252'
      series.priceLines.push(series.candlestick!.createPriceLine({
        price: gap.topPrice,
        color: color,
        lineWidth: 1,
        lineStyle: 3,
        axisLabelVisible: false,
        title: '',
      }))
      series.priceLines.push(series.candlestick!.createPriceLine({
        price: gap.bottomPrice,
        color: color,
        lineWidth: 1,
        lineStyle: 3,
        axisLabelVisible: true,
        title: `Gap ${gap.gapPercent.toFixed(1)}%`,
      }))
    })

    // Add Flag/Pennant pattern
    if (flagPennantPattern && flagPennantPattern.detected) {
      const strengthColors = { weak: '#FFEB3B', moderate: '#FF9800', strong: '#4CAF50' }
      const color = strengthColors[flagPennantPattern.patternStrength]

      series.priceLines.push(series.candlestick!.createPriceLine({
        price: flagPennantPattern.breakoutLevel,
        color: color,
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `${flagPennantPattern.type.replace('_', ' ').toUpperCase()} BREAKOUT`,
      }))
      series.priceLines.push(series.candlestick!.createPriceLine({
        price: flagPennantPattern.targetPrice,
        color: '#69F0AE',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `Target $${flagPennantPattern.targetPrice.toFixed(2)}`,
      }))
    }
  }, [entryZones, riskReward, microPullback, supportResistanceLevels, gapZones, flagPennantPattern])

  // Calculate current VWAP distance for display
  const vwapDistance = useMemo(() => {
    if (candles.length === 0 || vwap.length === 0) return null
    const lastPrice = candles[candles.length - 1].close
    const lastVWAP = vwap[vwap.length - 1].value
    const distance = ((lastPrice - lastVWAP) / lastVWAP) * 100
    return {
      percent: distance,
      zone: Math.abs(distance) <= 2.5 ? 'green' : Math.abs(distance) <= 3.5 ? 'yellow' : 'red',
    }
  }, [candles, vwap])

  // Calculate current R multiple for display
  const currentRMultiple = useMemo(() => {
    if (!riskReward || candles.length === 0) return null
    const { entryPrice, stopPrice } = riskReward
    const lastPrice = candles[candles.length - 1].close
    const risk = Math.abs(entryPrice - stopPrice)
    if (risk === 0) return null
    const profitLoss = lastPrice - entryPrice
    const rMultiple = profitLoss / risk
    return {
      value: rMultiple,
      zone: rMultiple >= 2 ? 'green' : rMultiple >= 0 ? 'yellow' : 'red',
    }
  }, [candles, riskReward])

  return (
    <div className="chart-container">
      <div className="chart-header">
        <div className="chart-header-left">
          <span className="symbol">{symbol}</span>
          <span className="timeframe">{timeframe}</span>
        </div>
        <div className="chart-header-right">
          {microPullback && microPullback.detected && (
            <span className={`pattern-badge pattern-${microPullback.patternStrength}`}>
              SETUP
            </span>
          )}
          {flagPennantPattern && flagPennantPattern.detected && (
            <span className={`pattern-badge pattern-${flagPennantPattern.patternStrength}`}>
              {flagPennantPattern.type === 'pennant' ? 'PENNANT' : flagPennantPattern.type === 'bull_flag' ? 'BULL FLAG' : 'BEAR FLAG'}
            </span>
          )}
          {supportResistanceLevels.length > 0 && (
            <span className="pattern-badge pattern-sr">
              S/R ({supportResistanceLevels.length})
            </span>
          )}
          {gapZones.length > 0 && (
            <span className="pattern-badge pattern-gap">
              GAP ({gapZones.length})
            </span>
          )}
          {currentRMultiple && (
            <span className={`r-multiple ${currentRMultiple.zone}`}>
              R: {currentRMultiple.value >= 0 ? '+' : ''}{currentRMultiple.value.toFixed(2)}
            </span>
          )}
          {showVWAP && vwapDistance && (
            <span className={`vwap-distance ${vwapDistance.zone}`}>
              VWAP: {vwapDistance.percent >= 0 ? '+' : ''}{vwapDistance.percent.toFixed(2)}%
            </span>
          )}
          <div className="indicator-legend">
            {showVWAP && <span className="legend-item vwap">VWAP</span>}
            {showEMA9 && <span className="legend-item ema9">9</span>}
            {showEMA20 && <span className="legend-item ema20">20</span>}
          </div>
        </div>
      </div>
      <div ref={chartContainerRef} className="chart-canvas" />
    </div>
  )
}
