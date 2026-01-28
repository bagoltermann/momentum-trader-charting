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

  // Streaming state
  streamingConnected: boolean
  currentStreamCandle: CandleWithVolume | null

  // Actions
  setPrimarySymbol: (symbol: string | null) => void
  fetchPrimaryCandles: (symbol: string, retryCount?: number) => Promise<void>
  setStreamingConnected: (connected: boolean) => void
  updateStreamCandle: (candle: CandleWithVolume) => void
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
  streamingConnected: false,
  currentStreamCandle: null,

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
      // Filter out invalid candles (all zeros - common in pre-market placeholder data)
      const transformed: CandleWithVolume[] = []
      const raw: Candle[] = []
      for (const c of response.data) {
        // Skip candles where OHLC are all zero (invalid/placeholder data)
        if (c.open === 0 && c.high === 0 && c.low === 0 && c.close === 0) {
          log(`[CandleStore] Skipping zero candle at ${c.timestamp}`)
          continue
        }
        const time = Math.floor(c.timestamp / 1000)
        const vol = c.volume || 0
        transformed.push({ time: time as number, open: c.open, high: c.high, low: c.low, close: c.close, volume: vol })
        raw.push({ time, open: c.open, high: c.high, low: c.low, close: c.close, volume: vol })
      }

      // Handle case where all candles were filtered out (all zeros)
      // This happens when a stock has no pre-market trades yet
      if (transformed.length === 0) {
        log(`[CandleStore] #${reqId} WARNING: All candles filtered (zeros) for ${symbol}`)
        set({ primaryCandles: [], primaryRaw: [], primaryLoading: false, primaryError: 'No trades yet' })
        return
      }

      log(`[CandleStore] #${reqId} Setting ${transformed.length} candles to store for ${symbol}`)
      set({ primaryCandles: transformed, primaryRaw: raw, primaryLoading: false, primaryError: null })
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

  setStreamingConnected: (connected: boolean) => {
    set({ streamingConnected: connected })
  },

  updateStreamCandle: (candle: CandleWithVolume) => {
    const { primaryCandles, primaryRaw } = get()
    if (primaryCandles.length === 0) return

    const lastCandle = primaryCandles[primaryCandles.length - 1]

    if (lastCandle.time === candle.time) {
      // Same minute — update last candle in place
      const updatedCandles = [...primaryCandles]
      updatedCandles[updatedCandles.length - 1] = candle
      const updatedRaw = [...primaryRaw]
      updatedRaw[updatedRaw.length - 1] = {
        time: candle.time as number,
        open: candle.open as number,
        high: candle.high as number,
        low: candle.low as number,
        close: candle.close as number,
        volume: candle.volume
      }
      set({ primaryCandles: updatedCandles, primaryRaw: updatedRaw, currentStreamCandle: candle })
    } else if ((candle.time as number) > (lastCandle.time as number)) {
      // New minute — append candle
      const rawCandle: Candle = {
        time: candle.time as number,
        open: candle.open as number,
        high: candle.high as number,
        low: candle.low as number,
        close: candle.close as number,
        volume: candle.volume
      }
      set({
        primaryCandles: [...primaryCandles, candle],
        primaryRaw: [...primaryRaw, rawCandle],
        currentStreamCandle: candle
      })
    }
  },
}))

// Auto-refresh interval
let refreshInterval: NodeJS.Timeout | null = null

export function startCandleRefresh() {
  if (refreshInterval) return

  refreshInterval = setInterval(() => {
    const { primarySymbol, primaryLoading, streamingConnected, fetchPrimaryCandles } = useCandleDataStore.getState()
    // Skip REST polling when streaming is providing real-time data
    if (streamingConnected) return
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
