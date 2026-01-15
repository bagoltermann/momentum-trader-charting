import { useState, useEffect } from 'react'
import { CandlestickData } from 'lightweight-charts'
import axios from 'axios'

export function useCandleData(symbol: string | null, timeframe: string): CandlestickData<number>[] {
  const [data, setData] = useState<CandlestickData<number>[]>([])

  useEffect(() => {
    if (!symbol) {
      setData([])
      return
    }

    const fetchData = async () => {
      try {
        const response = await axios.get(`http://localhost:8081/api/candles/${symbol}`, {
          params: { timeframe }
        })

        // Transform to Lightweight Charts format
        const candles = response.data.map((c: { timestamp: number; open: number; high: number; low: number; close: number }) => ({
          time: Math.floor(c.timestamp / 1000) as number, // Convert ms to seconds
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))

        setData(candles)
      } catch (error) {
        console.error('Failed to fetch candles:', error)
      }
    }

    fetchData()

    // Refresh every 30 seconds for real-time updates
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [symbol, timeframe])

  return data
}
