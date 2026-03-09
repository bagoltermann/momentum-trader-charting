/**
 * useSignalsPositions — Poll trader app for active signals and open positions
 *
 * Provides data for the Signals & Positions dashboard mode.
 * Polls every 5s (signals can appear/expire quickly).
 * Only polls when the dashboard mode is active.
 */
import { useState, useEffect, useRef } from 'react'
import { debugLogTimestamped as log } from '../utils/debugLog'

const POLL_INTERVAL_MS = 5000
const SIGNALS_API = 'http://localhost:8081/api/signals'
const POSITIONS_API = 'http://localhost:8081/api/positions'

export interface Signal {
  symbol: string
  pattern: string
  signal_type: string
  entry_price: number
  stop_loss: number
  profit_target: number
  risk_reward_ratio: number
  gap_percent: number
  relative_volume: number
  timestamp: string
  expires_at: string
  quantity: number
  risk_amount: number
}

export interface Position {
  symbol: string
  shares: number
  avg_price: number
  current_price: number
  entry_price: number
  stop_loss: number
  profit_target: number
  unrealized_pnl: number
  unrealized_pnl_percent: number
  market_value: number
  warning_level: string
  entry_time: string
}

interface SignalsPositionsState {
  signals: Signal[]
  positions: Position[]
  loading: boolean
  error: boolean
}

export function useSignalsPositions(enabled: boolean): SignalsPositionsState {
  const [data, setData] = useState<SignalsPositionsState>({
    signals: [],
    positions: [],
    loading: false,
    error: false,
  })

  const mountedRef = useRef(true)

  useEffect(() => {
    if (!enabled) return

    mountedRef.current = true
    const controller = new AbortController()

    const fetchData = async () => {
      try {
        const [signalsRes, positionsRes] = await Promise.all([
          fetch(SIGNALS_API, { signal: controller.signal }),
          fetch(POSITIONS_API, { signal: controller.signal }),
        ])
        if (!mountedRef.current) return

        const signals: Signal[] = signalsRes.ok ? await signalsRes.json() : []
        const positions: Position[] = positionsRes.ok ? await positionsRes.json() : []

        setData({ signals, positions, loading: false, error: false })
        log(`[SIGNALS] ${signals.length} signals, ${positions.length} positions`)
      } catch (err: unknown) {
        if (!mountedRef.current) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setData(prev => ({ ...prev, loading: false, error: true }))
        log('[SIGNALS] fetch error')
      }
    }

    setData(prev => ({ ...prev, loading: true }))
    fetchData()
    const interval = setInterval(fetchData, POLL_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      controller.abort()
      clearInterval(interval)
    }
  }, [enabled])

  return data
}
