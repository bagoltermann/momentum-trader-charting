/**
 * useVolumeSpikeAlerts — Poll for volume spike events (v2.8.0)
 *
 * Fetches active volume spike alerts from the charting backend,
 * which captures them from the trader app's SocketIO volume_spike events.
 * Spikes auto-expire after 30s on the backend.
 *
 * Polls every 5s (spikes persist 30+ seconds, low urgency).
 * Same proven REST polling pattern as useRotationDiscovery and useStreamingVWAP.
 */
import { useState, useEffect, useRef } from 'react'
import { debugLogTimestamped as log } from '../utils/debugLog'

// Feature flag — set to false to disable volume spike alerts entirely
const VOLUME_SPIKE_ALERTS_ENABLED = true

const POLL_INTERVAL_MS = 5000
const SPIKE_API = 'http://localhost:8081/api/volume-spikes/active'

export interface VolumeSpikeEvent {
  symbol: string
  spike_ratio: number
  current_rate_per_min: number
  average_rate_per_min: number
  threshold: number
  first_hour: boolean
  timestamp: number
}

interface VolumeSpikeState {
  activeSpikes: Map<string, VolumeSpikeEvent>
  spikingSymbols: Set<string>
}

const EMPTY_STATE: VolumeSpikeState = {
  activeSpikes: new Map(),
  spikingSymbols: new Set(),
}

export function useVolumeSpikeAlerts(): VolumeSpikeState {
  const [data, setData] = useState<VolumeSpikeState>(EMPTY_STATE)
  const mountedRef = useRef(true)

  useEffect(() => {
    if (!VOLUME_SPIKE_ALERTS_ENABLED) return

    mountedRef.current = true
    const controller = new AbortController()

    const fetchSpikes = async () => {
      try {
        const response = await fetch(SPIKE_API, { signal: controller.signal })
        if (!mountedRef.current) return

        const json = await response.json()
        const spikes = json.spikes || {}
        const symbols = Object.keys(spikes)

        if (symbols.length > 0) {
          const spikeMap = new Map<string, VolumeSpikeEvent>()
          const symbolSet = new Set<string>()

          for (const sym of symbols) {
            const s = spikes[sym]
            spikeMap.set(sym, {
              symbol: s.symbol,
              spike_ratio: s.spike_ratio,
              current_rate_per_min: s.current_rate_per_min,
              average_rate_per_min: s.average_rate_per_min,
              threshold: s.threshold,
              first_hour: s.first_hour,
              timestamp: s.timestamp,
            })
            symbolSet.add(sym)
          }

          setData({ activeSpikes: spikeMap, spikingSymbols: symbolSet })
          log(`[VOLUME-SPIKE] ${symbols.length} active: ${symbols.join(', ')}`)
        } else {
          // Only update state if we previously had spikes (avoid unnecessary re-renders)
          setData(prev => prev.spikingSymbols.size > 0 ? EMPTY_STATE : prev)
        }
      } catch (err: unknown) {
        if (!mountedRef.current) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        // Silent fail — no UI impact when backend unavailable
      }
    }

    fetchSpikes()
    const interval = setInterval(fetchSpikes, POLL_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      controller.abort()
      clearInterval(interval)
    }
  }, [])

  return data
}
