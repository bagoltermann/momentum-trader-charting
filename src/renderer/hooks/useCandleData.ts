import { useState, useEffect, useRef } from 'react'
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

// Simple cache to avoid refetching data we already have
// Cache entries expire after 60 seconds
interface CacheEntry {
  candles: CandleWithVolume[]
  rawCandles: Candle[]
  timestamp: number
}
const candleCache = new Map<string, CacheEntry>()
const CACHE_TTL = 60000 // 60 seconds

export function useCandleData(symbol: string | null, timeframe: string): UseCandleDataResult {
  const [candles, setCandles] = useState<CandleWithVolume[]>([])
  const [rawCandles, setRawCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  console.log(`[useCandleData] Hook called: symbol=${symbol}, timeframe=${timeframe}`)

  useEffect(() => {
    mountedRef.current = true
    console.log(`[useCandleData] useEffect TRIGGERED: symbol=${symbol}, timeframe=${timeframe}`)

    if (!symbol) {
      console.log(`[useCandleData] No symbol, clearing candles`)
      setCandles([])
      setRawCandles([])
      return
    }

    const fetchData = async (forceRefresh = false) => {
      const cacheKey = `${symbol}:${timeframe}`
      console.log(`[useCandleData] fetchData called: cacheKey=${cacheKey}, forceRefresh=${forceRefresh}`)

      // Check cache first (unless forcing refresh)
      if (!forceRefresh) {
        const cached = candleCache.get(cacheKey)
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          console.log(`[useCandleData] Cache HIT for ${cacheKey}, ${cached.candles.length} candles`)
          if (mountedRef.current) {
            setCandles(cached.candles)
            setRawCandles(cached.rawCandles)
          }
          return
        }
        console.log(`[useCandleData] Cache MISS for ${cacheKey}`)
      }

      // Cancel any pending request
      if (abortControllerRef.current) {
        console.log(`[useCandleData] Aborting previous request`)
        abortControllerRef.current.abort()
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController()
      const controller = abortControllerRef.current

      if (mountedRef.current) {
        setLoading(true)
        setError(null)
      }

      try {
        console.log(`[useCandleData] Fetching ${symbol} with timeframe=${timeframe}`)
        const response = await axios.get(`http://localhost:8081/api/candles/${symbol}`, {
          params: { timeframe },
          signal: controller.signal,
          timeout: 15000
        })

        // Check if still mounted and not aborted
        if (!mountedRef.current || controller.signal.aborted) {
          console.log(`[useCandleData] Request completed but component unmounted or aborted, ignoring`)
          return
        }

        console.log(`[useCandleData] Got ${response.data.length} candles for ${symbol}`)

        // Transform to Lightweight Charts format with volume
        const transformed: CandleWithVolume[] = response.data.map((c: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }) => ({
          time: Math.floor(c.timestamp / 1000) as number,
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

        // Cache the result
        candleCache.set(cacheKey, { candles: transformed, rawCandles: raw, timestamp: Date.now() })

        if (mountedRef.current) {
          setCandles(transformed)
          setRawCandles(raw)
        }
      } catch (err) {
        if (axios.isCancel(err) || (err instanceof Error && err.name === 'CanceledError')) {
          console.log(`[useCandleData] Request cancelled for ${symbol}`)
          return // Request was cancelled, ignore
        }
        console.error(`[useCandleData] Failed to fetch candles for ${symbol}:`, err)
        if (mountedRef.current) {
          setError('Failed to load chart data')
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false)
        }
      }
    }

    fetchData()

    // Refresh every 60 seconds for real-time updates (force refresh to bypass cache)
    const interval = setInterval(() => fetchData(true), 60000)

    return () => {
      console.log(`[useCandleData] useEffect CLEANUP: symbol=${symbol}, timeframe=${timeframe}`)
      mountedRef.current = false
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      clearInterval(interval)
    }
  }, [symbol, timeframe])

  return { candles, rawCandles, loading, error }
}
