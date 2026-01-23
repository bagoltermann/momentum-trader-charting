import React, { useMemo } from 'react'
import { Runner } from '../../hooks/useRunners'
import { CandleWithVolume } from '../../store/candleDataStore'
import { calculateVWAPBands } from '../../utils/indicators'

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

interface SignalStrengthGaugeProps {
  selectedSymbol: string | null
  watchlist: WatchlistItem[]
  runners: Runner[]
  candles: CandleWithVolume[]
}

interface SignalFactor {
  name: string
  impact: 'positive' | 'negative' | 'neutral'
  description: string
  weight: number // 0-20 points each
}

interface SignalAnalysis {
  score: number // 0-100
  factors: SignalFactor[]
  recommendation: 'strong_buy' | 'buy' | 'neutral' | 'caution' | 'avoid'
}

function analyzeSignalStrength(
  symbol: string,
  watchlist: WatchlistItem[],
  runners: Runner[],
  currentPrice?: number,
  vwapPrice?: number
): SignalAnalysis {
  const watchItem = watchlist.find(w => w.symbol === symbol)
  const runner = runners.find(r => r.symbol === symbol)

  const factors: SignalFactor[] = []
  let totalScore = 0

  // Factor 1: Catalyst strength (0-20 points)
  // Check both runner catalyst and watchlist llm_analysis
  const runnerCatalyst = runner?.original_catalyst
  const watchlistCatalyst = watchItem?.llm_analysis?.catalyst_type
  const catalyst = runnerCatalyst ?? watchlistCatalyst ?? 'UNKNOWN'
  const catalystStrength = watchItem?.llm_analysis?.catalyst_strength ?? 0
  const hasDefinitiveCatalyst = watchItem?.has_definitive_catalyst ?? false

  const strongCatalysts = ['CLINICAL_TRIAL', 'FDA_APPROVAL', 'SEC_8K_EARNINGS', 'CONTRACT', 'EARNINGS', 'FDA']
  const moderateCatalysts = ['PRODUCT_LAUNCH', 'SEC_8K_OTHER', 'PARTNERSHIP', 'ACQUISITION', 'MERGER']

  // Use catalyst strength from LLM if available (1-10 scale)
  if (catalystStrength >= 8 || strongCatalysts.includes(catalyst.toUpperCase()) || hasDefinitiveCatalyst) {
    factors.push({
      name: 'Strong catalyst',
      impact: 'positive',
      description: formatCatalyst(catalyst),
      weight: 20
    })
    totalScore += 20
  } else if (catalystStrength >= 5 || moderateCatalysts.includes(catalyst.toUpperCase())) {
    factors.push({
      name: 'Moderate catalyst',
      impact: 'neutral',
      description: formatCatalyst(catalyst),
      weight: 12
    })
    totalScore += 12
  } else if (catalyst && catalyst !== 'UNKNOWN') {
    factors.push({
      name: 'Weak catalyst',
      impact: 'negative',
      description: formatCatalyst(catalyst),
      weight: 8
    })
    totalScore += 8
  } else {
    factors.push({
      name: 'No catalyst',
      impact: 'negative',
      description: 'Unknown',
      weight: 3
    })
    totalScore += 3
  }

  // Factor 2: Volume ratio (0-20 points)
  const volumeRatio = watchItem?.volume_ratio ?? 0
  if (volumeRatio >= 10) {
    factors.push({
      name: 'Exceptional volume',
      impact: 'positive',
      description: `${volumeRatio.toFixed(1)}x relative volume`,
      weight: 20
    })
    totalScore += 20
  } else if (volumeRatio >= 5) {
    factors.push({
      name: 'High volume',
      impact: 'positive',
      description: `${volumeRatio.toFixed(1)}x relative volume`,
      weight: 15
    })
    totalScore += 15
  } else if (volumeRatio >= 3) {
    factors.push({
      name: 'Moderate volume',
      impact: 'neutral',
      description: `${volumeRatio.toFixed(1)}x relative volume`,
      weight: 10
    })
    totalScore += 10
  } else {
    factors.push({
      name: 'Low volume',
      impact: 'negative',
      description: `${volumeRatio.toFixed(1)}x relative volume`,
      weight: 3
    })
    totalScore += 3
  }

  // Factor 3: VWAP proximity (0-20 points)
  if (currentPrice && vwapPrice && vwapPrice > 0) {
    const vwapDistance = ((currentPrice - vwapPrice) / vwapPrice) * 100
    const absDistance = Math.abs(vwapDistance)

    if (absDistance <= 1.5) {
      factors.push({
        name: 'Near VWAP',
        impact: 'positive',
        description: `${vwapDistance >= 0 ? '+' : ''}${vwapDistance.toFixed(1)}% from VWAP`,
        weight: 20
      })
      totalScore += 20
    } else if (absDistance <= 2.5) {
      factors.push({
        name: 'Close to VWAP',
        impact: 'positive',
        description: `${vwapDistance >= 0 ? '+' : ''}${vwapDistance.toFixed(1)}% from VWAP`,
        weight: 15
      })
      totalScore += 15
    } else if (absDistance <= 3.5) {
      factors.push({
        name: 'Extended from VWAP',
        impact: 'neutral',
        description: `${vwapDistance >= 0 ? '+' : ''}${vwapDistance.toFixed(1)}% from VWAP`,
        weight: 8
      })
      totalScore += 8
    } else {
      factors.push({
        name: 'Chase territory',
        impact: 'negative',
        description: `${vwapDistance >= 0 ? '+' : ''}${vwapDistance.toFixed(1)}% from VWAP`,
        weight: 2
      })
      totalScore += 2
    }
  } else {
    factors.push({
      name: 'VWAP unavailable',
      impact: 'neutral',
      description: 'No VWAP data',
      weight: 10
    })
    totalScore += 10
  }

  // Factor 4: Float size (0-20 points)
  const floatValue = watchItem?.float ?? 0
  const floatInMillions = floatValue / 1_000_000

  if (floatInMillions > 0 && floatInMillions < 10) {
    factors.push({
      name: 'Tiny float',
      impact: 'positive',
      description: `${floatInMillions.toFixed(1)}M shares`,
      weight: 20
    })
    totalScore += 20
  } else if (floatInMillions >= 10 && floatInMillions < 20) {
    factors.push({
      name: 'Small float',
      impact: 'positive',
      description: `${floatInMillions.toFixed(1)}M shares`,
      weight: 15
    })
    totalScore += 15
  } else if (floatInMillions >= 20 && floatInMillions < 50) {
    factors.push({
      name: 'Medium float',
      impact: 'neutral',
      description: `${floatInMillions.toFixed(1)}M shares`,
      weight: 8
    })
    totalScore += 8
  } else if (floatInMillions >= 50) {
    factors.push({
      name: 'Large float',
      impact: 'negative',
      description: `${floatInMillions.toFixed(1)}M shares`,
      weight: 3
    })
    totalScore += 3
  } else {
    factors.push({
      name: 'Float unknown',
      impact: 'neutral',
      description: 'N/A',
      weight: 10
    })
    totalScore += 10
  }

  // Factor 5: Time of day / Session timing (0-20 points)
  const now = new Date()
  const hour = now.getHours()
  const minute = now.getMinutes()
  const marketMinutes = (hour - 9) * 60 + (minute - 30) // Minutes since 9:30 AM

  if (marketMinutes >= 0 && marketMinutes <= 60) {
    factors.push({
      name: 'Power hour (open)',
      impact: 'positive',
      description: 'First hour of trading',
      weight: 20
    })
    totalScore += 20
  } else if (marketMinutes > 60 && marketMinutes <= 120) {
    factors.push({
      name: 'Good timing',
      impact: 'positive',
      description: 'Morning session',
      weight: 15
    })
    totalScore += 15
  } else if (marketMinutes > 120 && marketMinutes <= 240) {
    factors.push({
      name: 'Mid-day',
      impact: 'neutral',
      description: 'Lunch/afternoon',
      weight: 10
    })
    totalScore += 10
  } else if (marketMinutes > 240 && marketMinutes <= 330) {
    factors.push({
      name: 'Late session',
      impact: 'negative',
      description: 'Afternoon fade risk',
      weight: 5
    })
    totalScore += 5
  } else {
    factors.push({
      name: 'Outside hours',
      impact: 'neutral',
      description: 'Pre/post market',
      weight: 10
    })
    totalScore += 10
  }

  // Calculate recommendation
  let recommendation: SignalAnalysis['recommendation']
  if (totalScore >= 80) {
    recommendation = 'strong_buy'
  } else if (totalScore >= 65) {
    recommendation = 'buy'
  } else if (totalScore >= 45) {
    recommendation = 'neutral'
  } else if (totalScore >= 30) {
    recommendation = 'caution'
  } else {
    recommendation = 'avoid'
  }

  return {
    score: totalScore,
    factors,
    recommendation
  }
}

function formatCatalyst(catalyst: string): string {
  const catalystMap: Record<string, string> = {
    'CLINICAL_TRIAL': 'Clinical Trial',
    'SEC_8K_EARNINGS': 'Earnings',
    'SEC_8K_EXECUTIVE_CHANGE': 'Executive Change',
    'SEC_8K_OTHER': 'Other 8-K',
    'PRODUCT_LAUNCH': 'Product Launch',
    'CONTRACT': 'Contract/Partnership',
    'FDA_APPROVAL': 'FDA Approval',
    'PARTNERSHIP': 'Partnership',
    'ACQUISITION': 'Acquisition',
    'MERGER': 'Merger',
    'EARNINGS': 'Earnings',
    'FDA': 'FDA',
    'OTHER': 'Other',
    'UNKNOWN': 'Unknown',
  }
  // Handle case-insensitive lookup
  const upperCatalyst = catalyst.toUpperCase()
  return catalystMap[upperCatalyst] || catalyst.replace(/_/g, ' ')
}

function getRecommendationText(rec: SignalAnalysis['recommendation']): string {
  switch (rec) {
    case 'strong_buy': return 'STRONG SETUP'
    case 'buy': return 'GOOD SETUP'
    case 'neutral': return 'NEUTRAL'
    case 'caution': return 'CAUTION'
    case 'avoid': return 'AVOID'
  }
}

function getRecommendationClass(rec: SignalAnalysis['recommendation']): string {
  switch (rec) {
    case 'strong_buy': return 'rec-strong'
    case 'buy': return 'rec-good'
    case 'neutral': return 'rec-neutral'
    case 'caution': return 'rec-caution'
    case 'avoid': return 'rec-avoid'
  }
}

function getImpactIcon(impact: SignalFactor['impact']): string {
  switch (impact) {
    case 'positive': return '+'
    case 'negative': return '-'
    case 'neutral': return 'o'
  }
}

export function SignalStrengthGauge({
  selectedSymbol,
  watchlist,
  runners,
  candles
}: SignalStrengthGaugeProps) {

  // Calculate current price and VWAP from candle data
  const { currentPrice, vwapPrice } = useMemo(() => {
    if (!candles || candles.length === 0) {
      return { currentPrice: undefined, vwapPrice: undefined }
    }

    // Get current price from last candle
    const lastCandle = candles[candles.length - 1]
    const price = lastCandle.close

    // Calculate VWAP
    const { vwap } = calculateVWAPBands(candles)
    const vwapValue = vwap.length > 0 ? vwap[vwap.length - 1].value : undefined

    return { currentPrice: price, vwapPrice: vwapValue }
  }, [candles])

  const analysis = useMemo(() => {
    if (!selectedSymbol) return null
    return analyzeSignalStrength(selectedSymbol, watchlist, runners, currentPrice, vwapPrice)
  }, [selectedSymbol, watchlist, runners, currentPrice, vwapPrice])

  if (!selectedSymbol) {
    return (
      <div className="signal-gauge-panel">
        <div className="signal-gauge-header">
          <h3>Signal Strength</h3>
        </div>
        <div className="signal-gauge-empty">
          Select a symbol to analyze
        </div>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="signal-gauge-panel">
        <div className="signal-gauge-header">
          <h3>Signal Strength</h3>
        </div>
        <div className="signal-gauge-empty">
          No data available
        </div>
      </div>
    )
  }

  // Calculate gauge fill percentage
  const fillPercent = Math.min(100, Math.max(0, analysis.score))
  const gaugeColor = analysis.score >= 65 ? '#00C853' :
                     analysis.score >= 45 ? '#FFD600' :
                     '#FF1744'

  return (
    <div className="signal-gauge-panel">
      <div className="signal-gauge-header">
        <h3 title="Composite 0-100% score combining catalyst quality, volume, VWAP proximity, float size, and session timing. Helps quickly assess overall setup quality at a glance.">Signal Strength</h3>
        <span className={`signal-recommendation ${getRecommendationClass(analysis.recommendation)}`}>
          {getRecommendationText(analysis.recommendation)}
        </span>
      </div>

      <div className="signal-gauge-meter">
        <div className="gauge-track">
          <div
            className="gauge-fill"
            style={{
              width: `${fillPercent}%`,
              backgroundColor: gaugeColor
            }}
          />
        </div>
        <span className="gauge-value">{analysis.score}%</span>
      </div>

      <div className="signal-factors">
        <div className="factors-title">Contributing Factors:</div>
        {analysis.factors.map((factor, index) => (
          <div key={index} className={`factor-row factor-${factor.impact}`}>
            <span className="factor-icon">{getImpactIcon(factor.impact)}</span>
            <span className="factor-name">{factor.name}</span>
            <span className="factor-desc">{factor.description}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
