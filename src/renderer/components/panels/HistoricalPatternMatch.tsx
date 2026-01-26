import { useState, useEffect, useMemo } from 'react'
import { Runner } from '../../hooks/useRunners'

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
  llm_analysis?: LLMAnalysis
  has_definitive_catalyst?: boolean
}

interface HistoricalPatternMatchProps {
  selectedSymbol: string | null
  runners: Runner[]
  watchlist: WatchlistItem[]
}

// Unified setup data for comparison (from either runner or watchlist)
interface SetupData {
  symbol: string
  currentPrice: number
  gapPercent: number
  catalyst?: string
  float?: number
  volumeRatio?: number
}

// Trade outcome record from trade_outcomes.jsonl
interface TradeOutcomeRecord {
  timestamp: string
  symbol: string
  timeframe: number
  pattern: string
  ai_analysis?: {
    quality_score: number
    assessment: string
    confidence: number
    context: string
  }
  market_context: {
    gap_percent: number
    relative_volume: number
    float: number
    catalyst_type: string
    sentiment: string
    news_count: number
  }
  entry: {
    price: number
    time: string
    reason: string
    stop_loss: number
    profit_target: number
    risk_reward_ratio: number
    quantity: number
    risk_amount: number
    potential_profit: number
  }
  exit: {
    price: number
    time: string
    reason: 'stop_loss' | 'profit_target' | 'eod_exit' | 'manual'
    hold_time_seconds: number
  }
  outcome: {
    realized_pnl: number
    realized_pnl_percent: number
    actual_risk_reward: number
    winner: boolean
    met_ai_expectations: boolean
  }
  metadata?: {
    account_balance_before: number
    account_balance_after: number
    position_size_percent: number
    trade_number: number
  }
}

// Completed trade (parsed from trade outcomes)
interface CompletedTrade {
  symbol: string
  entryPrice: number
  exitPrice: number
  shares: number
  pnl: number
  rMultiple: number
  outcome: 'win' | 'loss'
  reason: 'stop_loss' | 'profit_target' | 'eod_exit' | 'manual'
  timestamp: string
  // Setup characteristics from market_context
  gapPercent?: number
  catalyst?: string
  relativeVolume?: number
  float?: number
  pattern?: string
}

interface SimilarSetup {
  trade: CompletedTrade
  similarity: number // 0-100
  matchReasons: string[]
}

interface PatternAnalysis {
  similarTrades: SimilarSetup[]
  winCount: number
  lossCount: number
  winRate: number
  avgR: number
  totalTrades: number
}

/**
 * Parse trade outcome records into completed trades
 */
function parseTradeOutcomes(records: TradeOutcomeRecord[]): CompletedTrade[] {
  return records.map(record => ({
    symbol: record.symbol,
    entryPrice: record.entry.price,
    exitPrice: record.exit.price,
    shares: record.entry.quantity,
    pnl: record.outcome.realized_pnl,
    rMultiple: record.outcome.actual_risk_reward,
    outcome: record.outcome.winner ? 'win' : 'loss',
    reason: record.exit.reason,
    timestamp: record.timestamp,
    // Include setup characteristics for similarity matching
    gapPercent: record.market_context.gap_percent,
    catalyst: record.market_context.catalyst_type,
    relativeVolume: record.market_context.relative_volume,
    float: record.market_context.float,
    pattern: record.pattern
  }))
}

/**
 * Calculate similarity between current setup and historical trade
 * Focuses on same-symbol matching and catalyst type since those are most reliable
 */
function calculateSimilarity(
  setup: SetupData,
  trade: CompletedTrade
): { similarity: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0
  let maxScore = 0

  // Same symbol bonus (max 40 points) - most important for showing your own trades
  maxScore += 40
  if (trade.symbol === setup.symbol) {
    score += 40
    reasons.push(`Same: ${trade.symbol}`)
  }

  // Catalyst match (max 30 points)
  maxScore += 30
  if (trade.catalyst && trade.catalyst !== 'Unknown' && trade.catalyst !== 'UNKNOWN') {
    const setupCatalyst = setup.catalyst?.toUpperCase() || ''
    const tradeCatalyst = trade.catalyst.toUpperCase()
    if (tradeCatalyst === setupCatalyst && setupCatalyst !== '') {
      score += 30
      reasons.push('Same catalyst')
    } else if (setupCatalyst && (tradeCatalyst.includes(setupCatalyst) || setupCatalyst.includes(tradeCatalyst))) {
      score += 20
      reasons.push('Similar catalyst')
    } else if (tradeCatalyst !== 'UNKNOWN') {
      // Give some points for having a known catalyst
      score += 5
    }
  }

  // Price range similarity (max 30 points) - important for position sizing context
  maxScore += 30
  const priceDiff = Math.abs(setup.currentPrice - trade.entryPrice) / trade.entryPrice
  if (priceDiff <= 0.15) {
    score += 30
    reasons.push(`$${trade.entryPrice.toFixed(2)} entry`)
  } else if (priceDiff <= 0.3) {
    score += 20
    reasons.push('Similar price')
  } else if (priceDiff <= 0.5) {
    score += 10
  }

  // Gap percent similarity (if available)
  if (trade.gapPercent !== undefined && trade.gapPercent > 0 && setup.gapPercent > 0) {
    // Don't add to maxScore if data missing - only count when both have data
    const gapRatio = Math.min(setup.gapPercent, trade.gapPercent) / Math.max(setup.gapPercent, trade.gapPercent)
    if (gapRatio >= 0.7) {
      score += 10 // Bonus points
      reasons.push(`Gap ${trade.gapPercent.toFixed(0)}%`)
    }
  }

  // Ensure we don't divide by zero
  if (maxScore === 0) maxScore = 100

  return {
    similarity: Math.round((score / maxScore) * 100),
    reasons
  }
}

/**
 * Find similar historical setups
 */
function findSimilarSetups(
  setup: SetupData,
  completedTrades: CompletedTrade[],
  limit: number = 5
): PatternAnalysis {
  const similarTrades: SimilarSetup[] = []

  for (const trade of completedTrades) {
    const { similarity, reasons } = calculateSimilarity(setup, trade)

    // Only include trades with reasonable similarity (20% allows same-symbol to always show)
    if (similarity >= 20) {
      similarTrades.push({
        trade,
        similarity,
        matchReasons: reasons
      })
    }
  }

  // Sort by similarity descending
  similarTrades.sort((a, b) => b.similarity - a.similarity)

  // Take top matches
  const topMatches = similarTrades.slice(0, limit)

  // Calculate statistics
  const wins = topMatches.filter(s => s.trade.outcome === 'win')
  const losses = topMatches.filter(s => s.trade.outcome === 'loss')
  const avgR = topMatches.length > 0
    ? topMatches.reduce((sum, s) => sum + s.trade.rMultiple, 0) / topMatches.length
    : 0

  return {
    similarTrades: topMatches,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: topMatches.length > 0 ? (wins.length / topMatches.length) * 100 : 0,
    avgR,
    totalTrades: topMatches.length
  }
}

function getOutcomeClass(outcome: CompletedTrade['outcome']): string {
  return outcome === 'win' ? 'outcome-win' : 'outcome-loss'
}

function getRMultipleClass(r: number): string {
  if (r >= 2) return 'r-excellent'
  if (r >= 1) return 'r-good'
  if (r >= 0) return 'r-neutral'
  return 'r-loss'
}

export function HistoricalPatternMatch({
  selectedSymbol,
  runners,
  watchlist
}: HistoricalPatternMatchProps) {
  const [tradeHistory, setTradeHistory] = useState<CompletedTrade[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load trade history on mount
  useEffect(() => {
    async function loadTradeHistory() {
      setLoading(true)
      try {
        // Fetch from the momentum-trader API (reads trade_outcomes.jsonl)
        const response = await fetch('http://localhost:8081/api/trade-history')
        if (response.ok) {
          const records: TradeOutcomeRecord[] = await response.json()
          console.log('[HistoricalPatternMatch] Loaded trade records:', records.length, records.map(r => r.symbol))
          const completed = parseTradeOutcomes(records)
          console.log('[HistoricalPatternMatch] Parsed completed trades:', completed.length)
          setTradeHistory(completed)
        } else {
          console.warn('[HistoricalPatternMatch] API returned non-OK status:', response.status)
          // API not available - show empty state
          setTradeHistory([])
        }
      } catch (err) {
        console.error('[HistoricalPatternMatch] Failed to load trade history:', err)
        // Don't show error - just show empty state
        setTradeHistory([])
      } finally {
        setLoading(false)
      }
    }

    loadTradeHistory()
  }, [])

  // Build setup data from either runner or watchlist
  const setupData = useMemo((): SetupData | null => {
    if (!selectedSymbol) return null

    // Try runner first
    const runner = runners.find(r => r.symbol === selectedSymbol)
    if (runner) {
      return {
        symbol: runner.symbol,
        currentPrice: runner.current_price,
        gapPercent: runner.original_gap_percent,
        catalyst: runner.original_catalyst,
        float: undefined, // Runner doesn't have float
        volumeRatio: undefined
      }
    }

    // Fall back to watchlist
    const watchItem = watchlist.find(w => w.symbol === selectedSymbol)
    if (watchItem) {
      return {
        symbol: watchItem.symbol,
        currentPrice: watchItem.price,
        gapPercent: watchItem.gap_percent,
        catalyst: watchItem.llm_analysis?.catalyst_type,
        float: watchItem.float,
        volumeRatio: watchItem.volume_ratio
      }
    }

    return null
  }, [selectedSymbol, runners, watchlist])

  const analysis = useMemo(() => {
    if (!setupData || tradeHistory.length === 0) {
      console.log('[HistoricalPatternMatch] No analysis:', { hasSetupData: !!setupData, tradeHistoryLength: tradeHistory.length })
      return null
    }
    console.log('[HistoricalPatternMatch] Analyzing setup:', setupData.symbol, 'against', tradeHistory.length, 'trades')
    const result = findSimilarSetups(setupData, tradeHistory)
    console.log('[HistoricalPatternMatch] Analysis result:', result.totalTrades, 'similar trades found')
    return result
  }, [setupData, tradeHistory])

  if (!selectedSymbol) {
    return (
      <div className="historical-pattern-panel">
        <div className="historical-pattern-header">
          <h3 title="Matches current setup against your trade history to find similar patterns. Shows win rate and average R-multiple for comparable setups based on catalyst type, gap %, and price range.">Similar Past Setups</h3>
        </div>
        <div className="historical-pattern-empty">Select a symbol</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="historical-pattern-panel">
        <div className="historical-pattern-header">
          <h3 title="Matches current setup against your trade history to find similar patterns. Shows win rate and average R-multiple for comparable setups based on catalyst type, gap %, and price range.">Similar Past Setups</h3>
        </div>
        <div className="historical-pattern-empty">Loading history...</div>
      </div>
    )
  }

  if (tradeHistory.length === 0) {
    return (
      <div className="historical-pattern-panel">
        <div className="historical-pattern-header">
          <h3 title="Matches current setup against your trade history to find similar patterns. Shows win rate and average R-multiple for comparable setups based on catalyst type, gap %, and price range.">Similar Past Setups</h3>
        </div>
        <div className="historical-pattern-empty">
          No trade history available
          <span className="empty-hint">Complete trades to build pattern data</span>
        </div>
      </div>
    )
  }

  if (!analysis || analysis.totalTrades === 0) {
    return (
      <div className="historical-pattern-panel">
        <div className="historical-pattern-header">
          <h3 title="Matches current setup against your trade history to find similar patterns. Shows win rate and average R-multiple for comparable setups based on catalyst type, gap %, and price range.">Similar Past Setups</h3>
        </div>
        <div className="historical-pattern-empty">
          No similar patterns found
        </div>
      </div>
    )
  }

  return (
    <div className="historical-pattern-panel">
      <div className="historical-pattern-header">
        <h3 title="Matches current setup against your trade history to find similar patterns. Shows win rate and average R-multiple for comparable setups based on catalyst type, gap %, and price range.">Similar Past Setups</h3>
        <span className="pattern-stats">
          Win Rate: {analysis.winRate.toFixed(0)}% | Avg R: {analysis.avgR >= 0 ? '+' : ''}{analysis.avgR.toFixed(1)}
        </span>
      </div>

      <div className="historical-trades-list">
        {analysis.similarTrades.map((setup, index) => (
          <div key={index} className={`historical-trade-card ${getOutcomeClass(setup.trade.outcome)}`}>
            <div className="trade-card-header">
              <span className="trade-outcome">
                {setup.trade.outcome === 'win' ? 'Win' : 'Loss'}
              </span>
              <span className={`trade-r ${getRMultipleClass(setup.trade.rMultiple)}`}>
                {setup.trade.rMultiple >= 0 ? '+' : ''}{setup.trade.rMultiple.toFixed(1)}R
              </span>
            </div>
            <div className="trade-card-body">
              <span className="trade-symbol">{setup.trade.symbol}</span>
              <span className="trade-similarity">{setup.similarity}% match</span>
            </div>
            {setup.matchReasons.length > 0 && (
              <div className="trade-reasons">
                {setup.matchReasons.join(' | ')}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="historical-pattern-summary">
        <span className="summary-stat">
          {analysis.winCount}W / {analysis.lossCount}L
        </span>
        <span className={`summary-verdict ${analysis.winRate >= 50 ? 'verdict-positive' : 'verdict-negative'}`}>
          {analysis.winRate >= 60 ? 'PATTERN WORKS' : analysis.winRate >= 50 ? 'MIXED RESULTS' : 'CAUTION'}
        </span>
      </div>
    </div>
  )
}
