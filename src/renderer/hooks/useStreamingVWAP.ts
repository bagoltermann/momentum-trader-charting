/**
 * useStreamingVWAP — Fetch real-time VWAP from trader app (v2.6.0)
 *
 * Polls the charting backend's VWAP proxy endpoint which relays data
 * from the trader app's VwapCache. This ensures the charting app displays
 * the same VWAP values used for Gate 4 decisions in the trader app.
 *
 * Fallback: When trader app is unavailable, returns null so the chart
 * component can fall back to locally-calculated VWAP from candle data.
 */
import { useState, useEffect, useRef } from 'react'
import { debugLogTimestamped as log } from '../utils/debugLog'

export type VWAPSource = 'stream' | 'rest' | 'local' | 'unavailable' | 'loading' | 'timeout' | 'error'

export interface StreamingVWAPData {
  vwap: number | null
  source: VWAPSource
  stale: boolean
  loading: boolean
}

// Poll every 2 seconds for scalping responsiveness
const POLL_INTERVAL_MS = 2000

// Backend proxy URL
const VWAP_API_BASE = 'http://localhost:8081/api'

export function useStreamingVWAP(symbol: string | null, localVWAP: number | null): StreamingVWAPData {
  const [data, setData] = useState<StreamingVWAPData>({
    vwap: null,
    source: 'loading',
    stale: false,
    loading: true,
  })

  const mountedRef = useRef(true)
  const symbolRef = useRef(symbol)

  // Keep symbol ref current
  useEffect(() => {
    symbolRef.current = symbol
  }, [symbol])

  useEffect(() => {
    if (!symbol) {
      setData({
        vwap: localVWAP,
        source: 'local',
        stale: true,
        loading: false,
      })
      return
    }

    mountedRef.current = true

    const fetchVWAP = async () => {
      try {
        const response = await fetch(`${VWAP_API_BASE}/vwap/${symbol}`)
        if (!mountedRef.current || symbolRef.current !== symbol) return

        const json = await response.json()

        // Check if we got valid streaming VWAP
        if (json.vwap && json.vwap > 0 && !json.stale) {
          setData({
            vwap: json.vwap,
            source: json.source as VWAPSource, // 'stream' or 'rest'
            stale: false,
            loading: false,
          })
          log(`[VWAP] ${symbol}: $${json.vwap.toFixed(2)} (${json.source})`)
        } else if (json.vwap && json.vwap > 0 && json.stale) {
          // Stale streaming data - still show it but mark as stale
          setData({
            vwap: json.vwap,
            source: json.source as VWAPSource,
            stale: true,
            loading: false,
          })
          log(`[VWAP] ${symbol}: $${json.vwap.toFixed(2)} (${json.source}, stale)`)
        } else {
          // No valid streaming VWAP - fallback to local
          setData({
            vwap: localVWAP,
            source: 'local',
            stale: true,
            loading: false,
          })
          log(`[VWAP] ${symbol}: fallback to local VWAP`)
        }
      } catch (error) {
        if (!mountedRef.current || symbolRef.current !== symbol) return
        // Fetch failed - fallback to local calculation
        setData({
          vwap: localVWAP,
          source: 'local',
          stale: true,
          loading: false,
        })
        log(`[VWAP] ${symbol}: fetch error, using local`)
      }
    }

    // Initial fetch
    fetchVWAP()

    // Set up polling interval
    const interval = setInterval(fetchVWAP, POLL_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [symbol, localVWAP])

  return data
}
