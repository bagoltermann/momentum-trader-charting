import React, { useEffect, useRef, useMemo } from 'react'
import { createChart, IChartApi, ISeriesApi, CandlestickData, LineData, HistogramData } from 'lightweight-charts'
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
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  // Calculate indicators
  const { vwap, bands } = useMemo(() => calculateVWAPBands(rawCandles), [rawCandles])
  const ema9 = useMemo(() => calculateEMA(rawCandles, 9), [rawCandles])
  const ema20 = useMemo(() => calculateEMA(rawCandles, 20), [rawCandles])

  // Detect micro-pullback pattern
  const microPullback = useMemo(() => {
    if (!detectPatterns || rawCandles.length < 10) return null
    return detectMicroPullback(rawCandles)
  }, [rawCandles, detectPatterns])

  // Prepare volume data with colors
  const volumeData = useMemo(() => {
    return candles.map((c, i) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(0, 200, 83, 0.5)' : 'rgba(255, 23, 68, 0.5)',
    }))
  }, [candles])

  useEffect(() => {
    if (!chartContainerRef.current) return

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
          // Convert UTC to Eastern Time (UTC-5)
          const date = new Date(time * 1000)
          // Use Intl to format in ET timezone
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
          // Convert UTC to Eastern Time
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

    if (candles.length > 0) {
      candlestickSeries.setData(candles as CandlestickData<number>[])
    }

    // Add entry zone price lines
    if (entryZones.length > 0) {
      entryZones.forEach(zone => {
        const color = zone.type === 'entry' ? '#00E676' :  // Green for entry
                      zone.type === 'stop' ? '#FF5252' :   // Red for stop
                      '#FFD600'                             // Yellow for target

        candlestickSeries.createPriceLine({
          price: zone.price,
          color: color,
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: zone.label,
        })
      })
    }

    // Add Risk:Reward overlay with target zones
    if (riskReward) {
      const { entryPrice, stopPrice, showTargets = true } = riskReward
      const risk = Math.abs(entryPrice - stopPrice)
      const riskPercent = (risk / entryPrice) * 100

      // Entry line (solid blue)
      candlestickSeries.createPriceLine({
        price: entryPrice,
        color: '#2196F3',
        lineWidth: 2,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: `Entry $${entryPrice.toFixed(2)}`,
      })

      // Stop line (solid red with risk label)
      candlestickSeries.createPriceLine({
        price: stopPrice,
        color: '#FF1744',
        lineWidth: 2,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: `Stop -$${risk.toFixed(2)} (${riskPercent.toFixed(1)}%)`,
      })

      if (showTargets) {
        // 2R Target (green)
        const target2R = entryPrice + (2 * risk)
        candlestickSeries.createPriceLine({
          price: target2R,
          color: '#00E676',
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `2R +$${(2 * risk).toFixed(2)}`,
        })

        // 3R Target (light green)
        const target3R = entryPrice + (3 * risk)
        candlestickSeries.createPriceLine({
          price: target3R,
          color: '#69F0AE',
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `3R +$${(3 * risk).toFixed(2)}`,
        })
      }
    }

    // Add micro-pullback pattern visualization
    if (microPullback && microPullback.detected) {
      const strengthColors = {
        weak: '#FFEB3B',      // Yellow
        moderate: '#FF9800',  // Orange
        strong: '#4CAF50',    // Green
      }
      const color = strengthColors[microPullback.patternStrength]

      // Breakout trigger line
      candlestickSeries.createPriceLine({
        price: microPullback.triggerPrice,
        color: color,
        lineWidth: 2,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: `BREAKOUT $${microPullback.triggerPrice.toFixed(2)}`,
      })

      // Pattern stop line
      candlestickSeries.createPriceLine({
        price: microPullback.stopPrice,
        color: '#FF5252',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: `Pattern Stop $${microPullback.stopPrice.toFixed(2)}`,
      })
    }

    // Add Support/Resistance levels
    if (supportResistanceLevels.length > 0) {
      const strengthWidths = { weak: 1, moderate: 2, strong: 3 }

      supportResistanceLevels.forEach(level => {
        const color = level.type === 'resistance' ? '#FF5252' : '#00E676'
        const lineWidth = strengthWidths[level.strength]

        candlestickSeries.createPriceLine({
          price: level.price,
          color: color,
          lineWidth: lineWidth,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `${level.type === 'resistance' ? 'R' : 'S'} $${level.price.toFixed(2)}`,
        })
      })
    }

    // Add Gap zones
    if (gapZones.length > 0) {
      gapZones.forEach(gap => {
        const color = gap.type === 'up' ? '#00E676' : '#FF5252'
        const opacity = gap.filled ? 0.1 : 0.25

        // Draw gap zone as two price lines
        candlestickSeries.createPriceLine({
          price: gap.topPrice,
          color: color,
          lineWidth: 1,
          lineStyle: 3, // Dotted
          axisLabelVisible: false,
          title: '',
        })

        candlestickSeries.createPriceLine({
          price: gap.bottomPrice,
          color: color,
          lineWidth: 1,
          lineStyle: 3, // Dotted
          axisLabelVisible: true,
          title: `Gap ${gap.gapPercent.toFixed(1)}%`,
        })
      })
    }

    // Add Flag/Pennant pattern visualization
    if (flagPennantPattern && flagPennantPattern.detected) {
      const strengthColors = {
        weak: '#FFEB3B',      // Yellow
        moderate: '#FF9800',  // Orange
        strong: '#4CAF50',    // Green
      }
      const color = strengthColors[flagPennantPattern.patternStrength]

      // Breakout level
      candlestickSeries.createPriceLine({
        price: flagPennantPattern.breakoutLevel,
        color: color,
        lineWidth: 2,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: `${flagPennantPattern.type.replace('_', ' ').toUpperCase()} BREAKOUT`,
      })

      // Target price
      candlestickSeries.createPriceLine({
        price: flagPennantPattern.targetPrice,
        color: '#69F0AE',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: `Target $${flagPennantPattern.targetPrice.toFixed(2)}`,
      })
    }

    // Add VWAP line
    if (showVWAP && vwap.length > 0) {
      const vwapSeries = chart.addLineSeries({
        color: '#2196F3',
        lineWidth: 2,
        title: 'VWAP',
        priceLineVisible: false,
      })
      vwapSeries.setData(vwap as LineData<number>[])
    }

    // Add VWAP bands
    if (showVWAPBands && bands.length > 0) {
      // Upper bands
      const upper1Series = chart.addLineSeries({
        color: 'rgba(33, 150, 243, 0.3)',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
      })
      upper1Series.setData(bands.map(b => ({ time: b.time, value: b.upper1 })) as LineData<number>[])

      const upper2Series = chart.addLineSeries({
        color: 'rgba(33, 150, 243, 0.2)',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
      })
      upper2Series.setData(bands.map(b => ({ time: b.time, value: b.upper2 })) as LineData<number>[])

      // Lower bands
      const lower1Series = chart.addLineSeries({
        color: 'rgba(33, 150, 243, 0.3)',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
      })
      lower1Series.setData(bands.map(b => ({ time: b.time, value: b.lower1 })) as LineData<number>[])

      const lower2Series = chart.addLineSeries({
        color: 'rgba(33, 150, 243, 0.2)',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
      })
      lower2Series.setData(bands.map(b => ({ time: b.time, value: b.lower2 })) as LineData<number>[])
    }

    // Add 9 EMA
    if (showEMA9 && ema9.length > 0) {
      const ema9Series = chart.addLineSeries({
        color: '#FFD600',
        lineWidth: 1,
        title: 'EMA 9',
        priceLineVisible: false,
      })
      ema9Series.setData(ema9 as LineData<number>[])
    }

    // Add 20 EMA
    if (showEMA20 && ema20.length > 0) {
      const ema20Series = chart.addLineSeries({
        color: '#FF9100',
        lineWidth: 1,
        title: 'EMA 20',
        priceLineVisible: false,
      })
      ema20Series.setData(ema20 as LineData<number>[])
    }

    // Add volume histogram
    if (showVolume && volumeData.length > 0) {
      const volumeSeries = chart.addHistogramSeries({
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: 'volume',
      })

      chart.priceScale('volume').applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      })

      volumeSeries.setData(volumeData as HistogramData<number>[])
    }

    // Fit content
    chart.timeScale().fitContent()

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        const containerHeight = chartContainerRef.current.clientHeight
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: containerHeight > 50 ? containerHeight : height
        })
      }
    }
    window.addEventListener('resize', handleResize)

    // Use ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver(handleResize)
    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current)
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      chart.remove()
    }
  }, [candles, rawCandles, height, timeframe, showVWAP, showVWAPBands, showVolume, showEMA9, showEMA20, vwap, bands, ema9, ema20, volumeData, entryZones, riskReward, microPullback, supportResistanceLevels, gapZones, flagPennantPattern])

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
