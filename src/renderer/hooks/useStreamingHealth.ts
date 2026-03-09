/**
 * useStreamingHealth — Poll trader app streaming data flow health (v1.94.0)
 *
 * Detects silent WebSocket death: connected but no data flowing.
 * Polls the trader app's watchdog endpoint via charting backend proxy.
 * Returns feed status: live/delayed/stale/disconnected.
 */
import { useState, useEffect, useRef } from 'react'
import { debugLogTimestamped as log } from '../utils/debugLog'

// Feature flag — set to false to disable streaming health monitoring
const STREAMING_HEALTH_ENABLED = true

const POLL_INTERVAL_MS = 10000
const HEALTH_API = 'http://localhost:8081/api/streaming/health'

export type FeedStatus = 'live' | 'delayed' | 'stale' | 'disconnected' | 'unknown'

export interface StreamingHealth {
  connected: boolean
  lastMessageSecondsAgo: number | null
  watchdogKills: number
  quoteCount: number
  status: FeedStatus
}

const UNKNOWN_STATE: StreamingHealth = {
  connected: false,
  lastMessageSecondsAgo: null,
  watchdogKills: 0,
  quoteCount: 0,
  status: 'unknown',
}

function deriveStatus(connected: boolean, elapsed: number | null): FeedStatus {
  if (!connected) return 'disconnected'
  if (elapsed === null) return 'unknown'
  if (elapsed < 5) return 'live'
  if (elapsed <= 30) return 'delayed'
  return 'stale'
}

function formatQuoteCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
  if (count >= 1000) return `${(count / 1000).toFixed(0)}K`
  return String(count)
}

export function useStreamingHealth(): StreamingHealth & { formattedQuotes: string } {
  const [data, setData] = useState<StreamingHealth>(UNKNOWN_STATE)
  const mountedRef = useRef(true)

  useEffect(() => {
    if (!STREAMING_HEALTH_ENABLED) return

    mountedRef.current = true
    const controller = new AbortController()

    const fetchHealth = async () => {
      try {
        const response = await fetch(HEALTH_API, { signal: controller.signal })
        if (!mountedRef.current) return

        const json = await response.json()
        const elapsed = json.last_message_seconds_ago ?? null
        const connected = json.connected ?? false
        const quoteCount = json.stats?.quotes ?? 0

        setData({
          connected,
          lastMessageSecondsAgo: elapsed,
          watchdogKills: json.watchdog_kills ?? 0,
          quoteCount,
          status: deriveStatus(connected, elapsed),
        })
      } catch (err: unknown) {
        if (!mountedRef.current) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setData(UNKNOWN_STATE)
      }
    }

    fetchHealth()
    const interval = setInterval(fetchHealth, POLL_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      controller.abort()
      clearInterval(interval)
    }
  }, [])

  return { ...data, formattedQuotes: formatQuoteCount(data.quoteCount) }
}
