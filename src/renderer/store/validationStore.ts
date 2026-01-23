import { create } from 'zustand'
import axios from 'axios'

// Types matching backend ValidationResult
export interface ValidationResult {
  signal: 'buy' | 'wait' | 'no_trade'
  entry_price: number | null
  stop_price: number | null
  target_price: number | null
  confidence: number
  reasoning: string[]
  risk_reward_ratio: number | null
  key_concern: string | null
  timestamp: string
  symbol: string
  cached: boolean
}

export interface RankedCandidate {
  symbol: string
  score: number
  pillarsScore: number
  qualityScore: number
  volumeRatio: number
  isRunner: boolean
  price: number
  gapPercent: number
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
  llm_analysis?: {
    catalyst_type?: string
    catalyst_strength?: number
  }
  has_definitive_catalyst?: boolean
}

interface RunnersData {
  [symbol: string]: {
    day?: number
    status?: string
    entry_zones?: Array<{ price: number; trigger: string }>
    stop_zone?: { price: number; reason: string }
  }
}

interface ValidationState {
  // Top 3 auto-validated candidates
  topCandidates: RankedCandidate[]
  topValidations: Record<string, ValidationResult>

  // Manual validation for selected stock
  manualSymbol: string | null
  manualResult: ValidationResult | null

  // Loading states
  isAutoValidating: boolean
  isManualValidating: boolean
  autoValidationError: string | null
  manualValidationError: string | null

  // LLM availability
  llmAvailable: boolean

  // Actions
  refreshTopCandidates: (watchlist: WatchlistItem[], runners: RunnersData) => void
  validateTop3: () => Promise<void>
  validateManual: (symbol: string) => Promise<void>
  clearManualValidation: () => void
  checkLlmStatus: () => Promise<void>
}

// Calculate 5 Pillars score
function calculate5Pillars(stock: WatchlistItem): { score: number; details: Record<string, boolean> } {
  const gap = (stock.gap_percent || 0) >= 10
  const volume = (stock.volume_ratio || 0) >= 5
  const floatOk = (stock.float || Infinity) <= 20_000_000
  const price = (stock.price || 0) >= 2 && (stock.price || 0) <= 20
  const catalyst = stock.has_definitive_catalyst ||
    (stock.llm_analysis?.catalyst_strength || 0) >= 7

  return {
    score: [gap, volume, floatOk, price, catalyst].filter(Boolean).length,
    details: { gap, volume, float: floatOk, price, catalyst }
  }
}

// Rank candidates based on Warrior Trading criteria
function rankCandidates(watchlist: WatchlistItem[], runners: RunnersData): RankedCandidate[] {
  return watchlist
    .map(stock => {
      const pillars = calculate5Pillars(stock)

      // Filter out low-quality setups
      if (pillars.score < 3.5) return null

      const isRunner = Boolean(runners[stock.symbol])

      // Weighted scoring
      const score =
        (pillars.score / 5) * 40 +                              // 5 Pillars: 40%
        ((stock.quality_score || 0) / 5) * 25 +                 // Quality: 25%
        Math.min((stock.volume_ratio || 0) / 50, 1) * 20 +      // Volume: 20% (capped at 50x)
        (isRunner ? 10 : 0) +                                    // Runner bonus: 10%
        ((stock.gap_percent || 0) > 20 ? 5 : 0)                 // Fresh gap bonus: 5%

      return {
        symbol: stock.symbol,
        score,
        pillarsScore: pillars.score,
        qualityScore: stock.quality_score || 0,
        volumeRatio: stock.volume_ratio || 0,
        isRunner,
        price: stock.price || 0,
        gapPercent: stock.gap_percent || 0,
      }
    })
    .filter((c): c is RankedCandidate => c !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}

export const useValidationStore = create<ValidationState>((set, get) => ({
  topCandidates: [],
  topValidations: {},
  manualSymbol: null,
  manualResult: null,
  isAutoValidating: false,
  isManualValidating: false,
  autoValidationError: null,
  manualValidationError: null,
  llmAvailable: false,

  checkLlmStatus: async () => {
    try {
      const response = await axios.get('http://localhost:8081/api/validate/status')
      set({ llmAvailable: response.data.available })
    } catch {
      set({ llmAvailable: false })
    }
  },

  refreshTopCandidates: (watchlist, runners) => {
    const candidates = rankCandidates(watchlist, runners)
    set({ topCandidates: candidates })
  },

  validateTop3: async () => {
    const { topCandidates, topValidations } = get()

    if (topCandidates.length === 0) return

    set({ isAutoValidating: true, autoValidationError: null })

    const newValidations = { ...topValidations }
    const now = Date.now()

    try {
      // Validate each candidate (in sequence to avoid overwhelming the LLM)
      for (const candidate of topCandidates) {
        // Check if we have a recent cached result
        const existing = newValidations[candidate.symbol]
        if (existing) {
          const cachedAt = new Date(existing.timestamp).getTime()
          if (now - cachedAt < 60000) {
            // Cache is fresh, skip
            continue
          }
        }

        try {
          const response = await axios.post<ValidationResult>(
            `http://localhost:8081/api/validate/${candidate.symbol}`
          )
          newValidations[candidate.symbol] = response.data
        } catch (err) {
          console.error(`Failed to validate ${candidate.symbol}:`, err)
          // Continue with other candidates even if one fails
        }
      }

      set({ topValidations: newValidations, isAutoValidating: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation failed'
      set({ autoValidationError: message, isAutoValidating: false })
    }
  },

  validateManual: async (symbol) => {
    set({
      isManualValidating: true,
      manualValidationError: null,
      manualSymbol: symbol,
      manualResult: null,
    })

    try {
      const response = await axios.post<ValidationResult>(
        `http://localhost:8081/api/validate/${symbol}`
      )
      set({
        manualResult: response.data,
        isManualValidating: false,
      })
    } catch (err) {
      let message = 'Validation failed'
      if (axios.isAxiosError(err)) {
        message = err.response?.data?.detail || err.message
      } else if (err instanceof Error) {
        message = err.message
      }
      set({
        manualValidationError: message,
        isManualValidating: false,
      })
    }
  },

  clearManualValidation: () => {
    set({
      manualSymbol: null,
      manualResult: null,
      manualValidationError: null,
    })
  },
}))
