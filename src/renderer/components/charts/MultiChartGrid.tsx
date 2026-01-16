import React, { useMemo } from 'react'
import { EnhancedChart, EntryZoneLevel, RiskRewardConfig } from './EnhancedChart'
import { useCandleData } from '../../hooks/useCandleData'
import { Runner } from '../../hooks/useRunners'

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
  const { candles: primaryCandles, rawCandles: primaryRaw, loading } = useCandleData(primarySymbol, '1m')

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

  return (
    <div className="multi-chart-grid">
      <div className="primary-chart">
        {primarySymbol ? (
          <EnhancedChart
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
          />
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
  const { candles, rawCandles } = useCandleData(symbol, '5m')

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
