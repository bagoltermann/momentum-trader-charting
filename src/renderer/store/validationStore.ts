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
  // Runner/continuation play fields
  continuation_play?: boolean
  runner_quality_score?: number
  runner_pullback_pct?: number
  runner_day1_high?: number
  continuation_data?: {
    original_gap_percent?: number
    original_catalyst?: string
    day1_volume?: number
    status?: string
  }
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
// For runners (continuation plays), they already passed 5 Pillars on Day 1
// so we use their original gap/volume from the initial move
function calculate5Pillars(stock: WatchlistItem): { score: number; details: Record<string, boolean> } {
  const isRunner = stock.continuation_play === true

  // For runners, use original gap percent from Day 1; for fresh plays, use today's gap
  const gapValue = isRunner
    ? (stock.continuation_data?.original_gap_percent || 0)
    : (stock.gap_percent || 0)
  const gap = gapValue >= 10

  // For runners, they had confirmed volume on Day 1; for fresh plays, check current
  // Runners with quality_score >= 70 passed the volume test on Day 1
  const volume = isRunner
    ? (stock.runner_quality_score || 0) >= 70
    : (stock.volume_ratio || 0) >= 5

  const floatOk = (stock.float || Infinity) <= 20_000_000
  const price = (stock.price || 0) >= 2 && (stock.price || 0) <= 20

  // For runners, check original catalyst; for fresh plays, check current
  const catalyst = stock.has_definitive_catalyst ||
    (stock.llm_analysis?.catalyst_strength || 0) >= 7 ||
    (isRunner && stock.continuation_data?.original_catalyst !== 'UNKNOWN')

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
      const isRunner = stock.continuation_play === true || Boolean(runners[stock.symbol])

      // Filter out low-quality setups (must have at least 4 pillars)
      // Exception: runners with high quality scores are pre-qualified
      const minPillars = isRunner ? 3 : 4
      if (pillars.score < minPillars) return null

      // For runners, use runner_quality_score which is 0-100 scale
      // For fresh plays, quality_score is 0-5 scale
      const qualityScore = isRunner
        ? (stock.runner_quality_score || 0) / 20  // Convert 0-100 to 0-5 scale
        : (stock.quality_score || 0)

      // For runners, volume confirmation came on Day 1
      // Use continuation_data.day1_volume as a proxy (normalized)
      const volumeScore = isRunner
        ? Math.min((stock.runner_quality_score || 0) / 100, 1)  // High quality = confirmed volume
        : Math.min((stock.volume_ratio || 0) / 50, 1)

      // Runner status bonus: PULLING_BACK and CONSOLIDATING are ideal entry points
      const runnerStatusBonus = isRunner
        ? (stock.runner_status === 'PULLING_BACK' || stock.runner_status === 'CONSOLIDATING' ? 15 : 5)
        : 0

      // Gap bonus: for runners, use original gap; for fresh, use today's
      const effectiveGap = isRunner
        ? (stock.continuation_data?.original_gap_percent || 0)
        : (stock.gap_percent || 0)

      // Weighted scoring
      const score =
        (pillars.score / 5) * 35 +                              // 5 Pillars: 35%
        (qualityScore / 5) * 25 +                               // Quality: 25%
        volumeScore * 15 +                                       // Volume: 15%
        runnerStatusBonus +                                      // Runner status: up to 15%
        (effectiveGap > 20 ? 5 : 0) +                           // Strong gap bonus: 5%
        (effectiveGap > 40 ? 5 : 0)                             // Exceptional gap bonus: 5%

      return {
        symbol: stock.symbol,
        score,
        pillarsScore: pillars.score,
        qualityScore: isRunner ? (stock.runner_quality_score || 0) : (stock.quality_score || 0),
        volumeRatio: stock.volume_ratio || 0,
        isRunner,
        price: stock.price || 0,
        gapPercent: isRunner ? effectiveGap : (stock.gap_percent || 0),
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
