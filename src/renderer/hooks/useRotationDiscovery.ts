/**
 * useRotationDiscovery — Poll trader app rotation scanner status (v2.7.0)
 *
 * Fetches streaming rotation stats from the charting backend proxy,
 * which relays data from the trader app's StreamingRotationManager.
 * Shows which symbols have been promoted to priority tier via
 * anomaly detection during universe discovery scanning.
 *
 * Polls every 10s (scanner data is less time-sensitive than VWAP).
 */
import { useState, useEffect, useRef } from 'react'
import { debugLogTimestamped as log } from '../utils/debugLog'

// Feature flag — set to false to disable rotation display entirely
const ROTATION_DISPLAY_ENABLED = true

const POLL_INTERVAL_MS = 10000
const ROTATION_API = 'http://localhost:8081/api/streaming/rotation'

export interface PrioritySymbol {
  symbol: string
  reason: string
  secondsInPriority: number
  stats: {
    tickCount: number
    volumeSum: number
    priceRangePct: number
  }
}

export interface RotationStats {
  enabled: boolean
  priorityCount: number
  prioritySymbols: PrioritySymbol[]
  discoverySlots: number
  universeSize: number
  totalPromotions: number
  chunkProgress: string
  loading: boolean
  error: boolean
}

const DISABLED_STATE: RotationStats = {
  enabled: false,
  priorityCount: 0,
  prioritySymbols: [],
  discoverySlots: 0,
  universeSize: 0,
  totalPromotions: 0,
  chunkProgress: '0/0',
  loading: false,
  error: false,
}

export function useRotationDiscovery(): RotationStats {
  const [data, setData] = useState<RotationStats>({
    ...DISABLED_STATE,
    loading: ROTATION_DISPLAY_ENABLED,
  })

  const mountedRef = useRef(true)

  useEffect(() => {
    if (!ROTATION_DISPLAY_ENABLED) return

    mountedRef.current = true
    const controller = new AbortController()

    const fetchRotation = async () => {
      try {
        const response = await fetch(ROTATION_API, { signal: controller.signal })
        if (!mountedRef.current) return

        const json = await response.json()

        if (json.enabled) {
          const prioritySymbols: PrioritySymbol[] = (json.priority_symbols || []).map(
            (ps: Record<string, unknown>) => ({
              symbol: ps.symbol as string,
              reason: ps.reason as string || 'unknown',
              secondsInPriority: ps.seconds_in_priority as number || 0,
              stats: {
                tickCount: (ps.stats_at_promotion as Record<string, unknown>)?.tick_count as number || 0,
                volumeSum: (ps.stats_at_promotion as Record<string, unknown>)?.volume_sum as number || 0,
                priceRangePct: (ps.stats_at_promotion as Record<string, unknown>)?.price_range_pct as number || 0,
              },
            })
          )

          setData({
            enabled: true,
            priorityCount: json.priority_count || 0,
            prioritySymbols,
            discoverySlots: json.discovery_slots || 0,
            universeSize: json.universe_size || 0,
            totalPromotions: json.total_promotions || 0,
            chunkProgress: `${json.current_chunk_idx || 0}/${json.chunk_count || 0}`,
            loading: false,
            error: false,
          })
          log(`[ROTATION] enabled, ${json.priority_count || 0} promoted, chunk ${json.current_chunk_idx}/${json.chunk_count}`)
        } else {
          setData({ ...DISABLED_STATE })
          log('[ROTATION] disabled or unavailable')
        }
      } catch (err: unknown) {
        if (!mountedRef.current) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setData({ ...DISABLED_STATE, error: true })
        log('[ROTATION] fetch error, scanner status unknown')
      }
    }

    fetchRotation()
    const interval = setInterval(fetchRotation, POLL_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      controller.abort()
      clearInterval(interval)
    }
  }, [])

  return data
}
