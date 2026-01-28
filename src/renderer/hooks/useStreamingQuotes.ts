/**
 * useStreamingQuotes — WebSocket client for real-time quote streaming
 *
 * Connects to charting backend WebSocket (/api/ws/quotes) which relays
 * Schwab LEVELONE_EQUITIES quotes from the trader app. Builds 1-minute
 * candles client-side from tick data and pushes them to candleDataStore.
 *
 * When connected, the 30s REST polling is automatically paused via
 * streamingConnected state in the store.
 */
import { useEffect, useRef, useState } from 'react'
import { useCandleDataStore, CandleWithVolume } from '../store/candleDataStore'
import { debugLogTimestamped as log } from '../utils/debugLog'

interface StreamingQuote {
  type: 'quote'
  symbol: string
  last_price: number
  bid_price: number
  ask_price: number
  total_volume: number
  last_size: number
  high_price: number
  low_price: number
  open_price: number
  net_change: number
  quote_time_ms: number
  trade_time_ms: number
}

interface StreamingStatus {
  type: 'status'
  connected: boolean
}

/**
 * Build a 1-minute candle from a streaming tick.
 *
 * - Same minute as current candle: update high/low/close/volume
 * - New minute: finalize previous candle, start new one
 * - Volume: TOTAL_VOLUME is cumulative day volume. Per-candle volume
 *   is the delta from the volume at the start of the minute.
 */
function buildCandle(
  quote: StreamingQuote,
  current: CandleWithVolume | null,
  prevVolRef: React.MutableRefObject<number>
): CandleWithVolume {
  // Floor to minute boundary (Unix seconds)
  const minuteTimestamp = Math.floor(quote.trade_time_ms / 60000) * 60

  if (current && current.time === minuteTimestamp) {
    // Same minute — update existing candle
    return {
      time: minuteTimestamp,
      open: current.open,
      high: Math.max(current.high as number, quote.last_price),
      low: Math.min(current.low as number, quote.last_price),
      close: quote.last_price,
      volume: Math.max(0, quote.total_volume - prevVolRef.current)
    }
  } else {
    // New minute — snapshot volume baseline
    prevVolRef.current = quote.total_volume
    return {
      time: minuteTimestamp,
      open: quote.last_price,
      high: quote.last_price,
      low: quote.last_price,
      close: quote.last_price,
      volume: 0
    }
  }
}

// If no quotes received for this duration, assume streaming is stale and trigger REST polling
const STALE_TIMEOUT_MS = 60000 // 60 seconds

export function useStreamingQuotes(symbol: string | null) {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const currentCandleRef = useRef<CandleWithVolume | null>(null)
  const prevTotalVolumeRef = useRef<number>(0)
  const symbolRef = useRef<string | null>(symbol)
  const lastQuoteTimeRef = useRef<number>(0)
  const staleTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Get store actions once (stable references)
  const updateStreamCandle = useCandleDataStore(s => s.updateStreamCandle)
  const setStreamingConnected = useCandleDataStore(s => s.setStreamingConnected)

  // Keep symbol ref current for use in callbacks
  useEffect(() => {
    symbolRef.current = symbol
  }, [symbol])

  useEffect(() => {
    if (!symbol) {
      setConnected(false)
      setStreamingConnected(false)
      return
    }

    log(`[Streaming] Connecting WebSocket for ${symbol}`)

    const ws = new WebSocket('ws://localhost:8081/api/ws/quotes')

    ws.onopen = () => {
      log(`[Streaming] WebSocket connected, subscribing to ${symbol}`)
      setConnected(true)
      setStreamingConnected(true)
      ws.send(JSON.stringify({ action: 'subscribe', symbols: [symbol] }))
      // Reset candle state for new symbol
      currentCandleRef.current = null
      prevTotalVolumeRef.current = 0
      lastQuoteTimeRef.current = Date.now()

      // Start stale detection timer
      staleTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - lastQuoteTimeRef.current
        if (elapsed > STALE_TIMEOUT_MS) {
          log(`[Streaming] No quotes for ${Math.round(elapsed / 1000)}s, falling back to REST polling`)
          setStreamingConnected(false)
        }
      }, 30000) // Check every 30s
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)

        // Handle connection status messages from backend
        if (msg.type === 'status') {
          const status = msg as StreamingStatus
          log(`[Streaming] Relay status: connected=${status.connected}`)
          if (!status.connected) {
            // Trader app disconnected - fall back to REST polling
            setConnected(false)
            setStreamingConnected(false)
          } else {
            // Trader app reconnected
            setConnected(true)
            setStreamingConnected(true)
          }
          return
        }

        // Handle quote messages
        const quote = msg as StreamingQuote
        // Ignore stale quotes from previous symbol subscription
        if (quote.symbol !== symbolRef.current) return
        // Skip quotes with no trade time (pre-market snapshot with zeros)
        if (!quote.trade_time_ms || !quote.last_price) return

        // Update last quote time for stale detection
        lastQuoteTimeRef.current = Date.now()

        const candle = buildCandle(quote, currentCandleRef.current, prevTotalVolumeRef)
        currentCandleRef.current = candle
        updateStreamCandle(candle)
      } catch (e) {
        log(`[Streaming] Parse error: ${e}`)
      }
    }

    ws.onclose = (event) => {
      log(`[Streaming] WebSocket closed: code=${event.code}, reason=${event.reason}`)
      setConnected(false)
      setStreamingConnected(false)
    }

    ws.onerror = (event) => {
      log(`[Streaming] WebSocket error`)
      // onclose will also fire after onerror
    }

    wsRef.current = ws

    return () => {
      log(`[Streaming] Closing WebSocket for ${symbol}`)
      if (staleTimerRef.current) {
        clearInterval(staleTimerRef.current)
        staleTimerRef.current = null
      }
      ws.close()
      wsRef.current = null
    }
  }, [symbol, updateStreamCandle, setStreamingConnected])

  return { connected }
}
