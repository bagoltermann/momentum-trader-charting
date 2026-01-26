import { useState, useEffect, useRef } from 'react'
import { CandlestickData } from 'lightweight-charts'
import axios from 'axios'
import { Candle } from '../utils/indicators'
import { debugLog } from '../utils/debugLog'

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

  debugLog(`[useCandleData] Hook called: symbol=${symbol}, timeframe=${timeframe}`)

  useEffect(() => {
    mountedRef.current = true
    debugLog(`[useCandleData] useEffect TRIGGERED: symbol=${symbol}, timeframe=${timeframe}`)

    if (!symbol) {
      debugLog(`[useCandleData] No symbol, clearing candles`)
      setCandles([])
      setRawCandles([])
      return
    }

    const fetchData = async (forceRefresh = false) => {
      const cacheKey = `${symbol}:${timeframe}`
      debugLog(`[useCandleData] fetchData called: cacheKey=${cacheKey}, forceRefresh=${forceRefresh}`)

      // Check cache first (unless forcing refresh)
      if (!forceRefresh) {
        const cached = candleCache.get(cacheKey)
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          debugLog(`[useCandleData] Cache HIT for ${cacheKey}, ${cached.candles.length} candles`)
          if (mountedRef.current) {
            setCandles(cached.candles)
            setRawCandles(cached.rawCandles)
          }
          return
        }
        debugLog(`[useCandleData] Cache MISS for ${cacheKey}`)
      }

      // Cancel any pending request
      if (abortControllerRef.current) {
        debugLog(`[useCandleData] Aborting previous request`)
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
        debugLog(`[useCandleData] Fetching ${symbol} with timeframe=${timeframe}`)
        const response = await axios.get(`http://localhost:8081/api/candles/${symbol}`, {
          params: { timeframe },
          signal: controller.signal,
          timeout: 15000
        })

        // Check if still mounted and not aborted
        if (!mountedRef.current || controller.signal.aborted) {
          debugLog(`[useCandleData] Request completed but component unmounted or aborted, ignoring`)
          return
        }

        debugLog(`[useCandleData] Got ${response.data.length} candles for ${symbol}`)

        // Single-pass transform: produce both arrays in one loop
        const transformed: CandleWithVolume[] = []
        const raw: Candle[] = []
        for (const c of response.data) {
          const time = Math.floor(c.timestamp / 1000)
          const vol = c.volume || 0
          transformed.push({ time: time as number, open: c.open, high: c.high, low: c.low, close: c.close, volume: vol })
          raw.push({ time, open: c.open, high: c.high, low: c.low, close: c.close, volume: vol })
        }

        // Cache the result
        candleCache.set(cacheKey, { candles: transformed, rawCandles: raw, timestamp: Date.now() })

        if (mountedRef.current) {
          setCandles(transformed)
          setRawCandles(raw)
        }
      } catch (err) {
        if (axios.isCancel(err) || (err instanceof Error && err.name === 'CanceledError')) {
          debugLog(`[useCandleData] Request cancelled for ${symbol}`)
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
      debugLog(`[useCandleData] useEffect CLEANUP: symbol=${symbol}, timeframe=${timeframe}`)
      mountedRef.current = false
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      clearInterval(interval)
    }
  }, [symbol, timeframe])

  return { candles, rawCandles, loading, error }
}
