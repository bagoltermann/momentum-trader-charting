import React, { useMemo } from 'react'
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

interface FivePillarsPanelProps {
  selectedSymbol: string | null
  watchlist: WatchlistItem[]
  runners: Runner[]
}

interface PillarCheck {
  name: string
  passed: boolean | 'partial'
  value: string
  threshold: string
}

interface PillarAssessment {
  pillars: PillarCheck[]
  score: number
  maxScore: number
  obviousRank: number | null
}

function assessFivePillars(
  symbol: string,
  watchlist: WatchlistItem[],
  runners: Runner[]
): PillarAssessment {
  const watchItem = watchlist.find(w => w.symbol === symbol)
  const runner = runners.find(r => r.symbol === symbol)

  // Get values from either source
  const gapPercent = runner?.original_gap_percent ?? watchItem?.gap_percent ?? 0
  const volumeRatio = watchItem?.volume_ratio ?? 0
  const floatValue = watchItem?.float ?? 0
  const price = runner?.current_price ?? watchItem?.price ?? 0
  // Check both runner catalyst and watchlist llm_analysis
  const runnerCatalyst = runner?.original_catalyst
  const watchlistCatalyst = watchItem?.llm_analysis?.catalyst_type
  const catalyst = runnerCatalyst ?? watchlistCatalyst ?? 'UNKNOWN'
  const catalystStrength = watchItem?.llm_analysis?.catalyst_strength ?? 0
  const hasDefinitiveCatalyst = watchItem?.has_definitive_catalyst ?? false

  const pillars: PillarCheck[] = []
  let score = 0

  // Pillar 1: Gap 10%+
  const gapPassed = gapPercent >= 10
  pillars.push({
    name: 'Gap 10%+',
    passed: gapPassed,
    value: `${gapPercent.toFixed(1)}%`,
    threshold: '10%+'
  })
  if (gapPassed) score += 1

  // Pillar 2: Relative Volume 5x+
  const volPassed = volumeRatio >= 5
  const volPartial = volumeRatio >= 3 && volumeRatio < 5
  pillars.push({
    name: 'Rel Volume 5x+',
    passed: volPassed ? true : volPartial ? 'partial' : false,
    value: `${volumeRatio.toFixed(1)}x`,
    threshold: '5x+'
  })
  if (volPassed) score += 1
  else if (volPartial) score += 0.5

  // Pillar 3: Float <20M
  const floatInMillions = floatValue / 1_000_000
  const floatPassed = floatInMillions > 0 && floatInMillions < 20
  const floatPartial = floatInMillions >= 20 && floatInMillions < 50
  pillars.push({
    name: 'Float <20M',
    passed: floatPassed ? true : floatPartial ? 'partial' : false,
    value: floatValue > 0 ? `${floatInMillions.toFixed(1)}M` : 'N/A',
    threshold: '<20M'
  })
  if (floatPassed) score += 1
  else if (floatPartial) score += 0.5

  // Pillar 4: Price $2-$20
  const pricePassed = price >= 2 && price <= 20
  const pricePartial = (price > 1 && price < 2) || (price > 20 && price <= 30)
  pillars.push({
    name: 'Price $2-$20',
    passed: pricePassed ? true : pricePartial ? 'partial' : false,
    value: `$${price.toFixed(2)}`,
    threshold: '$2-$20'
  })
  if (pricePassed) score += 1
  else if (pricePartial) score += 0.5

  // Pillar 5: Catalyst - check known types, strength, and definitive flag
  const knownCatalysts = ['CLINICAL_TRIAL', 'SEC_8K_EARNINGS', 'PRODUCT_LAUNCH', 'CONTRACT', 'FDA_APPROVAL', 'FDA', 'EARNINGS', 'PARTNERSHIP', 'ACQUISITION', 'MERGER']
  const upperCatalyst = catalyst.toUpperCase()
  const catalystPassed = knownCatalysts.includes(upperCatalyst) || catalystStrength >= 7 || hasDefinitiveCatalyst
  const catalystPartial = upperCatalyst === 'SEC_8K_OTHER' || upperCatalyst === 'OTHER' || (catalystStrength >= 4 && catalystStrength < 7)
  pillars.push({
    name: 'Catalyst',
    passed: catalystPassed ? true : catalystPartial ? 'partial' : false,
    value: formatCatalystName(catalyst),
    threshold: 'Known type'
  })
  if (catalystPassed) score += 1
  else if (catalystPartial) score += 0.5

  // Calculate obvious rank based on quality scores
  const sortedRunners = [...runners].sort((a, b) => b.quality_score - a.quality_score)
  const rankIndex = sortedRunners.findIndex(r => r.symbol === symbol)
  const obviousRank = rankIndex >= 0 ? rankIndex + 1 : null

  return {
    pillars,
    score,
    maxScore: 5,
    obviousRank
  }
}

function formatCatalystName(catalyst: string): string {
  const catalystMap: Record<string, string> = {
    'CLINICAL_TRIAL': 'Clinical Trial',
    'SEC_8K_EARNINGS': 'Earnings',
    'SEC_8K_EXECUTIVE_CHANGE': 'Executive',
    'SEC_8K_OTHER': 'Other 8-K',
    'PRODUCT_LAUNCH': 'Product',
    'CONTRACT': 'Contract',
    'FDA_APPROVAL': 'FDA Approval',
    'FDA': 'FDA',
    'EARNINGS': 'Earnings',
    'PARTNERSHIP': 'Partnership',
    'ACQUISITION': 'Acquisition',
    'MERGER': 'Merger',
    'OTHER': 'Other',
    'UNKNOWN': 'Unknown',
  }
  const upperCatalyst = catalyst.toUpperCase()
  return catalystMap[upperCatalyst] || catalyst.replace(/_/g, ' ')
}

function getPillarIcon(passed: boolean | 'partial'): string {
  if (passed === true) return '\u2713' // checkmark
  if (passed === 'partial') return '?'
  return '\u2717' // x mark
}

function getPillarClass(passed: boolean | 'partial'): string {
  if (passed === true) return 'pillar-pass'
  if (passed === 'partial') return 'pillar-partial'
  return 'pillar-fail'
}

function getScoreClass(score: number): string {
  if (score >= 4) return 'score-excellent'
  if (score >= 3) return 'score-good'
  if (score >= 2) return 'score-fair'
  return 'score-poor'
}

export function FivePillarsPanel({ selectedSymbol, watchlist, runners }: FivePillarsPanelProps) {
  const assessment = useMemo(() => {
    if (!selectedSymbol) return null
    return assessFivePillars(selectedSymbol, watchlist, runners)
  }, [selectedSymbol, watchlist, runners])

  if (!selectedSymbol) {
    return (
      <div className="five-pillars-panel">
        <div className="five-pillars-header">
          <h3 title="Validates setup against 5 key criteria: Gap 10%+, Volume 5x+, Float <20M, Price $2-$20, and Known Catalyst. Score of 4-5 indicates high-quality momentum setup.">5 Pillars Check</h3>
        </div>
        <div className="five-pillars-empty">
          Select a symbol to view assessment
        </div>
      </div>
    )
  }

  if (!assessment) {
    return (
      <div className="five-pillars-panel">
        <div className="five-pillars-header">
          <h3 title="Validates setup against 5 key criteria: Gap 10%+, Volume 5x+, Float <20M, Price $2-$20, and Known Catalyst. Score of 4-5 indicates high-quality momentum setup.">5 Pillars Check</h3>
        </div>
        <div className="five-pillars-empty">
          No data available for {selectedSymbol}
        </div>
      </div>
    )
  }

  return (
    <div className="five-pillars-panel">
      <div className="five-pillars-header">
        <h3 title="Validates setup against 5 key criteria: Gap 10%+, Volume 5x+, Float <20M, Price $2-$20, and Known Catalyst. Score of 4-5 indicates high-quality momentum setup.">{selectedSymbol} - 5 Pillars</h3>
      </div>
      <div className="five-pillars-list">
        {assessment.pillars.map((pillar, index) => (
          <div key={index} className={`pillar-row ${getPillarClass(pillar.passed)}`}>
            <span className="pillar-icon">{getPillarIcon(pillar.passed)}</span>
            <span className="pillar-name">{pillar.name}</span>
            <span className="pillar-value">{pillar.value}</span>
          </div>
        ))}
      </div>
      <div className="five-pillars-footer">
        <div className={`pillar-score ${getScoreClass(assessment.score)}`}>
          Score: {assessment.score}/{assessment.maxScore}
        </div>
        {assessment.obviousRank && assessment.obviousRank <= 5 && (
          <div className="pillar-rank">
            Obvious Rank: #{assessment.obviousRank}
          </div>
        )}
      </div>
    </div>
  )
}
