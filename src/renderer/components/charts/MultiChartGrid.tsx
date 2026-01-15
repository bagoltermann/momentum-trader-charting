import React from 'react'
import { CandlestickChart } from './CandlestickChart'
import { useCandleData } from '../../hooks/useCandleData'

interface MultiChartGridProps {
  primarySymbol: string | null
  secondarySymbols: string[]
}

export function MultiChartGrid({ primarySymbol, secondarySymbols }: MultiChartGridProps) {
  const primaryData = useCandleData(primarySymbol, '1m')

  return (
    <div className="multi-chart-grid">
      <div className="primary-chart">
        {primarySymbol ? (
          <CandlestickChart
            symbol={primarySymbol}
            timeframe="1m"
            data={primaryData}
            height={500}
          />
        ) : (
          <div className="no-symbol-selected">
            Select a symbol from the watchlist
          </div>
        )}
      </div>
      <div className="secondary-charts">
        {secondarySymbols.slice(0, 4).map((symbol) => (
          <SecondaryChart key={symbol} symbol={symbol} />
        ))}
      </div>
    </div>
  )
}

function SecondaryChart({ symbol }: { symbol: string }) {
  const data = useCandleData(symbol, '5m')
  return (
    <div className="secondary-chart">
      <CandlestickChart
        symbol={symbol}
        timeframe="5m"
        data={data}
        height={200}
      />
    </div>
  )
}
