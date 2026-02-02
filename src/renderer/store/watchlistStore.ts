import { create } from 'zustand'
import axios, { CancelTokenSource } from 'axios'

// Reusable axios client with timeout to prevent indefinite hangs
const apiClient = axios.create({ timeout: 10000 })

// Track in-flight request to prevent pileup when backend is slow
let pendingRequest: CancelTokenSource | null = null

interface LLMAnalysis {
  catalyst_type?: string
  sentiment?: string
  catalyst_strength?: number
  recommendation?: string
}

interface WatchlistItem {
  symbol: string
  price: number
  high?: number
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

// Check if watchlist data actually changed (avoids unnecessary re-renders on every 5s poll)
function watchlistChanged(current: WatchlistItem[], incoming: WatchlistItem[]): boolean {
  if (current.length !== incoming.length) return true
  for (let i = 0; i < incoming.length; i++) {
    if (incoming[i].symbol !== current[i]?.symbol || incoming[i].price !== current[i]?.price) {
      return true
    }
  }
  return false
}

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
  watchlist: [],
  connectionStatus: 'disconnected',
  lastUpdate: null,

  fetchWatchlist: async () => {
    // Cancel any pending request to prevent pileup when backend is slow
    // This ensures only one request is in-flight at a time
    if (pendingRequest) {
      pendingRequest.cancel('New request supersedes')
      pendingRequest = null
    }

    const cancelSource = axios.CancelToken.source()
    pendingRequest = cancelSource

    try {
      // Try backend first (file watcher) - use client with timeout
      const response = await apiClient.get('http://localhost:8081/api/watchlist', {
        cancelToken: cancelSource.token
      })
      pendingRequest = null
      const incoming = response.data as WatchlistItem[]
      if (watchlistChanged(get().watchlist, incoming)) {
        set({ watchlist: incoming, connectionStatus: 'connected', lastUpdate: new Date() })
      } else {
        set({ connectionStatus: 'connected', lastUpdate: new Date() })
      }
    } catch (err) {
      pendingRequest = null
      // Ignore cancelled requests - they're intentional
      if (axios.isCancel(err)) {
        return
      }
      // Log the error for debugging
      console.warn('[Watchlist] Primary fetch failed:', err instanceof Error ? err.message : err)
      // Fallback to main app API
      try {
        const response = await apiClient.get('http://localhost:8080/api/watchlist')
        const incoming = response.data as WatchlistItem[]
        if (watchlistChanged(get().watchlist, incoming)) {
          set({ watchlist: incoming, connectionStatus: 'connected', lastUpdate: new Date() })
        } else {
          set({ connectionStatus: 'connected', lastUpdate: new Date() })
        }
      } catch (fallbackErr) {
        // Ignore cancelled requests
        if (axios.isCancel(fallbackErr)) {
          return
        }
        console.warn('[Watchlist] Fallback fetch failed:', fallbackErr instanceof Error ? fallbackErr.message : fallbackErr)
        set({ connectionStatus: 'error' })
      }
    }
  },
}))
