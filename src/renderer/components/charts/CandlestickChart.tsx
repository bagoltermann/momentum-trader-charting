import { useEffect, useRef } from 'react'
import { createChart, IChartApi, CandlestickData } from 'lightweight-charts'

interface CandlestickChartProps {
  symbol: string
  timeframe: '1m' | '5m' | '15m' | 'D'
  data: CandlestickData<number>[]
  height?: number
}

export function CandlestickChart({ symbol, timeframe, data, height = 400 }: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height,
      layout: {
        background: { color: '#1a1a2e' },
        textColor: '#eee',
      },
      grid: {
        vertLines: { color: '#333' },
        horzLines: { color: '#333' },
      },
      crosshair: {
        mode: 1, // Normal
      },
      rightPriceScale: {
        borderColor: '#333',
      },
      timeScale: {
        borderColor: '#333',
        timeVisible: true,
        secondsVisible: timeframe === '1m',
      },
    })

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#00C853',
      downColor: '#FF1744',
      borderUpColor: '#00C853',
      borderDownColor: '#FF1744',
      wickUpColor: '#00C853',
      wickDownColor: '#FF1744',
    })

    if (data.length > 0) {
      candlestickSeries.setData(data)
    }
    chartRef.current = chart

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [data, height, timeframe])

  return (
    <div className="chart-container">
      <div className="chart-header">
        <span className="symbol">{symbol}</span>
        <span className="timeframe">{timeframe}</span>
      </div>
      <div ref={chartContainerRef} className="chart-canvas" />
    </div>
  )
}
