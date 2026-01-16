import { create } from 'zustand'
import axios from 'axios'

interface LLMAnalysis {
  catalyst_type?: string
  sentiment?: string
  catalyst_strength?: number
  recommendation?: string
}

interface WatchlistItem {
  symbol: string
  price: number
  gap_percent: number
  volume_ratio: number
  float: number
  runner_status?: string
  quality_score?: number
  llm_analysis?: LLMAnalysis
  has_definitive_catalyst?: boolean
}

interface WatchlistState {
  watchlist: WatchlistItem[]
  connectionStatus: 'connected' | 'disconnected' | 'error'
  lastUpdate: Date | null
  fetchWatchlist: () => Promise<void>
}

export const useWatchlistStore = create<WatchlistState>((set) => ({
  watchlist: [],
  connectionStatus: 'disconnected',
  lastUpdate: null,

  fetchWatchlist: async () => {
    try {
      // Try backend first (file watcher)
      const response = await axios.get('http://localhost:8081/api/watchlist')
      set({
        watchlist: response.data,
        connectionStatus: 'connected',
        lastUpdate: new Date(),
      })
    } catch {
      // Fallback to main app API
      try {
        const response = await axios.get('http://localhost:8080/api/watchlist')
        set({
          watchlist: response.data,
          connectionStatus: 'connected',
          lastUpdate: new Date(),
        })
      } catch {
        set({ connectionStatus: 'error' })
      }
    }
  },
}))
