import React, { useMemo, useEffect } from 'react'
import { EnhancedChart, EntryZoneLevel, RiskRewardConfig } from './EnhancedChart'
import { useCandleData } from '../../hooks/useCandleData'
import { Runner } from '../../hooks/useRunners'
import { usePatternOverlayStore } from '../../store/patternOverlayStore'
import { useCandleDataStore, startCandleRefresh } from '../../store/candleDataStore'
import { detectSupportResistance, detectGaps, detectFlagPennant } from '../../utils/indicators'

interface MultiChartGridProps {
  primarySymbol: string | null
  secondarySymbols: string[]
  runners: Runner[]
}

// Convert runner data to entry zone levels for chart display
function getEntryZonesForSymbol(symbol: string | null, runners: Runner[]): EntryZoneLevel[] {
  if (!symbol) return []

  const runner = runners.find(r => r.symbol === symbol)
  if (!runner) return []

  const zones: EntryZoneLevel[] = []

  // Day 1 High - primary breakout level
  if (runner.day1_high) {
    zones.push({
      price: runner.day1_high,
      label: 'D1 High',
      type: 'entry'
    })
  }

  // Day 1 Close - support level
  if (runner.day1_close) {
    zones.push({
      price: runner.day1_close,
      label: 'D1 Close',
      type: 'entry'
    })
  }

  // Stop zone
  if (runner.stop_zone?.price) {
    zones.push({
      price: runner.stop_zone.price,
      label: 'Stop',
      type: 'stop'
    })
  }

  // Entry zones from runners data
  runner.entry_zones?.forEach(ez => {
    if (ez.type === 'prior_day_high') return // Already added as D1 High
    zones.push({
      price: ez.price,
      label: ez.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      type: 'entry'
    })
  })

  return zones
}

// Calculate R:R config from runner data
function getRiskRewardForSymbol(symbol: string | null, runners: Runner[]): RiskRewardConfig | undefined {
  if (!symbol) return undefined

  const runner = runners.find(r => r.symbol === symbol)
  if (!runner) return undefined

  // Use Day 1 High as entry and stop_zone as stop
  const entryPrice = runner.day1_high
  const stopPrice = runner.stop_zone?.price

  if (!entryPrice || !stopPrice) return undefined

  return {
    entryPrice,
    stopPrice,
    showTargets: true
  }
}

export function MultiChartGrid({ primarySymbol, secondarySymbols, runners }: MultiChartGridProps) {
  console.log(`[MultiChartGrid] Rendering: primarySymbol=${primarySymbol}, secondarySymbols=[${secondarySymbols.join(',')}]`)

  // Use shared store for primary candle data
  const {
    primaryCandles,
    primaryRaw,
    primaryLoading: loading,
    setPrimarySymbol
  } = useCandleDataStore()

  console.log(`[MultiChartGrid] Store state: candles=${primaryCandles.length}, raw=${primaryRaw.length}, loading=${loading}`)

  // Update store when symbol changes
  useEffect(() => {
    console.log(`[MultiChartGrid] useEffect: Setting primarySymbol to ${primarySymbol}`)
    setPrimarySymbol(primarySymbol)
    startCandleRefresh()
  }, [primarySymbol, setPrimarySymbol])

  // Get pattern overlay toggles from store
  const { showSupportResistance, showGaps, showFlagPennant } = usePatternOverlayStore()

  // Get entry zones for primary symbol
  const primaryEntryZones = useMemo(() =>
    getEntryZonesForSymbol(primarySymbol, runners),
    [primarySymbol, runners]
  )

  // Get R:R config for primary symbol
  const primaryRiskReward = useMemo(() =>
    getRiskRewardForSymbol(primarySymbol, runners),
    [primarySymbol, runners]
  )

  // Calculate pattern overlays for primary chart
  const supportResistanceLevels = useMemo(() => {
    if (!showSupportResistance || primaryRaw.length < 50) return []
    return detectSupportResistance(primaryRaw)
  }, [primaryRaw, showSupportResistance])

  const gapZones = useMemo(() => {
    if (!showGaps || primaryRaw.length < 2) return []
    return detectGaps(primaryRaw)
  }, [primaryRaw, showGaps])

  const flagPennantPattern = useMemo(() => {
    if (!showFlagPennant || primaryRaw.length < 15) return null
    return detectFlagPennant(primaryRaw)
  }, [primaryRaw, showFlagPennant])

  // Log right before render
  console.log(`[MultiChartGrid] About to render: primarySymbol=${primarySymbol}, candles=${primaryCandles.length}, will render EnhancedChart=${!!primarySymbol}`)

  return (
    <div className="multi-chart-grid">
      <div className="primary-chart">
        {primarySymbol ? (
          <>
            {loading && primaryCandles.length === 0 && (
              <div className="chart-loading-overlay">
                Loading {primarySymbol}...
              </div>
            )}
            {console.log(`[MultiChartGrid] Rendering EnhancedChart for ${primarySymbol} with ${primaryCandles.length} candles`)}
            <EnhancedChart
              key={primarySymbol}
              symbol={primarySymbol}
              timeframe="1m"
              candles={primaryCandles}
              rawCandles={primaryRaw}
              height={500}
              showVWAP={true}
              showVWAPBands={false}
              showVolume={true}
              showEMA9={true}
              showEMA20={true}
              entryZones={primaryEntryZones}
              riskReward={primaryRiskReward}
              supportResistanceLevels={supportResistanceLevels}
              gapZones={gapZones}
              flagPennantPattern={flagPennantPattern}
            />
          </>
        ) : (
          <div className="no-symbol-selected">
            Select a symbol from the watchlist
          </div>
        )}
      </div>
      <div className="secondary-charts">
        {secondarySymbols.slice(0, 4).map((symbol) => (
          <SecondaryChart key={symbol} symbol={symbol} runners={runners} />
        ))}
      </div>
    </div>
  )
}

function SecondaryChart({ symbol, runners }: { symbol: string; runners: Runner[] }) {
  console.log(`[SecondaryChart] Rendering: symbol=${symbol}`)
  const { candles, rawCandles } = useCandleData(symbol, '5m')
  console.log(`[SecondaryChart] Got data for ${symbol}: ${candles.length} candles`)

  const entryZones = useMemo(() =>
    getEntryZonesForSymbol(symbol, runners),
    [symbol, runners]
  )

  return (
    <div className="secondary-chart">
      <EnhancedChart
        symbol={symbol}
        timeframe="5m"
        candles={candles}
        rawCandles={rawCandles}
        height={200}
        showVWAP={true}
        showVWAPBands={false}
        showVolume={false}
        showEMA9={false}
        showEMA20={false}
        entryZones={entryZones}
      />
    </div>
  )
}
