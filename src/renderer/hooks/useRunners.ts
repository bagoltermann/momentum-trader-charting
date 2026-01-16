import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

export interface EntryZone {
  type: string
  price: number
  trigger: string
  description: string
}

export interface StopZone {
  price: number
  reason: string
}

export interface Runner {
  symbol: string
  first_gap_date: string
  gap_age_days: number
  original_gap_percent: number
  original_catalyst: string
  original_catalyst_details: string
  day1_high: number
  day1_low: number
  day1_close: number
  day1_volume: number
  high_of_move: number
  cumulative_move_percent: number
  current_price: number
  premarket_gap_percent: number
  pullback_percent: number
  status: 'EXTENDED' | 'CONSOLIDATING' | 'PULLING_BACK' | 'BROKEN_DOWN'
  quality_score: number
  entry_zones: EntryZone[]
  stop_zone: StopZone
}

export interface RunnersData {
  version: string
  last_updated: string
  active_runners: Runner[]
  statistics: {
    total_runners: number
    consolidating: number
    continuation_trade_count: number
  }
}

interface UseRunnersResult {
  runners: Runner[]
  statistics: RunnersData['statistics'] | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useRunners(): UseRunnersResult {
  const [runners, setRunners] = useState<Runner[]>([])
  const [statistics, setStatistics] = useState<RunnersData['statistics'] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRunners = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await axios.get<RunnersData>('http://localhost:8081/api/runners')
      setRunners(response.data.active_runners || [])
      setStatistics(response.data.statistics || null)
    } catch (err) {
      console.error('Failed to fetch runners:', err)
      setError('Failed to load runners data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRunners()

    // Refresh every 30 seconds
    const interval = setInterval(fetchRunners, 30000)
    return () => clearInterval(interval)
  }, [fetchRunners])

  return { runners, statistics, loading, error, refetch: fetchRunners }
}
