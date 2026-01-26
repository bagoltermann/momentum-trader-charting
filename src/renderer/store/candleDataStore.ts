import { create } from 'zustand'
import axios from 'axios'
import { CandlestickData } from 'lightweight-charts'
import { debugLogTimestamped as log } from '../utils/debugLog'

// Reusable axios client (avoids creating new instance per request)
const apiClient = axios.create({ timeout: 15000 })

export interface CandleWithVolume extends CandlestickData<number> {
  volume: number
}

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface CandleDataState {
  // Primary symbol data (1m timeframe)
  primarySymbol: string | null
  primaryCandles: CandleWithVolume[]
  primaryRaw: Candle[]
  primaryLoading: boolean
  primaryError: string | null

  // Actions
  setPrimarySymbol: (symbol: string | null) => void
  fetchPrimaryCandles: (symbol: string, retryCount?: number) => Promise<void>
}

// Track pending request to cancel it when symbol changes
let pendingController: AbortController | null = null
let requestCount = 0
let debounceTimer: NodeJS.Timeout | null = null

export const useCandleDataStore = create<CandleDataState>((set, get) => ({
  primarySymbol: null,
  primaryCandles: [],
  primaryRaw: [],
  primaryLoading: false,
  primaryError: null,

  setPrimarySymbol: (symbol: string | null) => {
    const current = get().primarySymbol
    if (current === symbol) {
      log(`[CandleStore] setPrimarySymbol: SAME symbol ${symbol}, skipping`)
      return
    }

    log(`[CandleStore] setPrimarySymbol: ${current} -> ${symbol}`)

    // Clear any pending debounce
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }

    // Cancel any pending request
    if (pendingController) {
      log(`[CandleStore] Aborting pending request`)
      pendingController.abort()
      pendingController = null
    }

    // Clear candles immediately when symbol changes to prevent showing wrong data
    // The loading state will show while new data is fetched
    set({ primarySymbol: symbol, primaryCandles: [], primaryRaw: [], primaryLoading: true, primaryError: null })

    if (symbol) {
      // Debounce the fetch by 100ms - if user is clicking rapidly, only fetch the last one
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        // Double-check symbol hasn't changed during debounce
        if (get().primarySymbol === symbol) {
          get().fetchPrimaryCandles(symbol)
        }
      }, 100)
    } else {
      // Only clear candles if explicitly setting to null
      set({ primaryCandles: [], primaryRaw: [], primaryLoading: false })
    }
  },

  fetchPrimaryCandles: async (symbol: string, retryCount = 0) => {
    const reqId = ++requestCount
    const maxRetries = 2
    log(`[CandleStore] fetchPrimaryCandles #${reqId} for ${symbol}${retryCount > 0 ? ` (retry ${retryCount})` : ''}`)

    // Check if still the current symbol
    if (get().primarySymbol !== symbol) {
      log(`[CandleStore] #${reqId} Symbol changed before fetch, aborting`)
      return
    }

    // Cancel any pending request
    if (pendingController) {
      log(`[CandleStore] #${reqId} Aborting previous request`)
      pendingController.abort()
    }

    // Create new abort controller
    pendingController = new AbortController()
    const controller = pendingController

    set({ primaryLoading: true, primaryError: null })

    try {
      log(`[CandleStore] #${reqId} Making API call for ${symbol}`)

      const response = await apiClient.get(`http://localhost:8081/api/candles/${symbol}`, {
        params: { timeframe: '1m' },
        signal: controller.signal
      })

      // Check again after async operation
      if (get().primarySymbol !== symbol) {
        log(`[CandleStore] #${reqId} Symbol changed during fetch, discarding`)
        return
      }

      log(`[CandleStore] #${reqId} Got ${response.data.length} candles for ${symbol}`)

      if (!response.data || response.data.length === 0) {
        log(`[CandleStore] #${reqId} WARNING: Empty data received for ${symbol}`)
        set({ primaryCandles: [], primaryRaw: [], primaryLoading: false, primaryError: 'No data available' })
        return
      }

      // Single-pass transform: produce both arrays in one loop
      const transformed: CandleWithVolume[] = []
      const raw: Candle[] = []
      for (const c of response.data) {
        const time = Math.floor(c.timestamp / 1000)
        const vol = c.volume || 0
        transformed.push({ time: time as number, open: c.open, high: c.high, low: c.low, close: c.close, volume: vol })
        raw.push({ time, open: c.open, high: c.high, low: c.low, close: c.close, volume: vol })
      }

      log(`[CandleStore] #${reqId} Setting ${transformed.length} candles to store for ${symbol}`)
      set({ primaryCandles: transformed, primaryRaw: raw, primaryLoading: false })
      if (pendingController === controller) {
        pendingController = null
      }
      log(`[CandleStore] #${reqId} Store updated successfully for ${symbol}`)
    } catch (err) {
      if (axios.isCancel(err) || (err instanceof Error && err.name === 'CanceledError')) {
        log(`[CandleStore] #${reqId} Request cancelled`)
        // Don't retry cancelled requests - they were cancelled because symbol changed
        // The new symbol's request will handle fetching
        return
      }

      const errMsg = err instanceof Error ? err.message : String(err)
      log(`[CandleStore] #${reqId} Failed to fetch candles for ${symbol}: ${errMsg}`)

      // Retry on failure if symbol hasn't changed
      if (retryCount < maxRetries && get().primarySymbol === symbol) {
        const delay = Math.pow(2, retryCount) * 500 // 500ms, 1000ms
        log(`[CandleStore] #${reqId} Retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))

        // Check again before retry
        if (get().primarySymbol === symbol) {
          return get().fetchPrimaryCandles(symbol, retryCount + 1)
        }
      }

      if (get().primarySymbol === symbol) {
        set({ primaryError: 'Failed to load chart data', primaryLoading: false })
      }
    }
  },
}))

// Auto-refresh interval
let refreshInterval: NodeJS.Timeout | null = null

export function startCandleRefresh() {
  if (refreshInterval) return

  refreshInterval = setInterval(() => {
    const { primarySymbol, primaryLoading, fetchPrimaryCandles } = useCandleDataStore.getState()
    // Only refresh if we have a symbol and no request is currently in progress
    if (primarySymbol && !primaryLoading && !pendingController) {
      log(`[CandleStore] Auto-refresh for ${primarySymbol}`)
      fetchPrimaryCandles(primarySymbol)
    }
  }, 30000)
}

export function stopCandleRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
}
