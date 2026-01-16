import { useState, useEffect } from 'react'
import { CandlestickData } from 'lightweight-charts'
import axios from 'axios'
import { Candle } from '../utils/indicators'

export interface CandleWithVolume extends CandlestickData<number> {
  volume: number
}

interface UseCandleDataResult {
  candles: CandleWithVolume[]
  rawCandles: Candle[]
  loading: boolean
  error: string | null
}

export function useCandleData(symbol: string | null, timeframe: string): UseCandleDataResult {
  const [candles, setCandles] = useState<CandleWithVolume[]>([])
  const [rawCandles, setRawCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!symbol) {
      setCandles([])
      setRawCandles([])
      return
    }

    const fetchData = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await axios.get(`http://localhost:8081/api/candles/${symbol}`, {
          params: { timeframe }
        })

        // Transform to Lightweight Charts format with volume
        const transformed: CandleWithVolume[] = response.data.map((c: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }) => ({
          time: Math.floor(c.timestamp / 1000) as number, // Convert ms to seconds
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0,
        }))

        // Also store raw candles for indicator calculations
        const raw: Candle[] = response.data.map((c: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }) => ({
          time: Math.floor(c.timestamp / 1000),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0,
        }))

        setCandles(transformed)
        setRawCandles(raw)
      } catch (err) {
        console.error('Failed to fetch candles:', err)
        setError('Failed to load chart data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()

    // Refresh every 30 seconds for real-time updates
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [symbol, timeframe])

  return { candles, rawCandles, loading, error }
}
