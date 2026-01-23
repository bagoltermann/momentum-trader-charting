import React from 'react'
import { useValidationStore, ValidationResult, RankedCandidate } from '../../store/validationStore'

interface Top3ValidationPanelProps {
  onSelectSymbol: (symbol: string) => void
}

function getSignalClass(signal: string): string {
  switch (signal) {
    case 'buy': return 'signal-buy'
    case 'wait': return 'signal-wait'
    case 'no_trade': return 'signal-no-trade'
    default: return ''
  }
}

function getSignalLabel(signal: string): string {
  switch (signal) {
    case 'buy': return 'BUY'
    case 'wait': return 'WAIT'
    case 'no_trade': return 'NO'
    default: return '?'
  }
}

function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined) return '-'
  return `$${price.toFixed(2)}`
}

function ConfidenceMeter({ confidence }: { confidence: number }) {
  const getConfidenceClass = () => {
    if (confidence >= 70) return 'confidence-high'
    if (confidence >= 50) return 'confidence-medium'
    return 'confidence-low'
  }

  return (
    <div className="confidence-meter">
      <div
        className={`confidence-bar ${getConfidenceClass()}`}
        style={{ width: `${confidence}%` }}
      />
      <span className="confidence-value">{confidence}%</span>
    </div>
  )
}

interface CandidateRowProps {
  rank: number
  candidate: RankedCandidate
  validation: ValidationResult | undefined
  onSelect: () => void
}

function CandidateRow({ rank, candidate, validation, onSelect }: CandidateRowProps) {
  const hasValidation = !!validation

  return (
    <div className="top3-candidate-row" onClick={onSelect}>
      <div className="candidate-rank">{rank}</div>

      <div className="candidate-main">
        <div className="candidate-header">
          <span className="candidate-symbol">{candidate.symbol}</span>
          {hasValidation ? (
            <span className={`validation-signal-badge ${getSignalClass(validation.signal)}`}>
              {getSignalLabel(validation.signal)}
            </span>
          ) : (
            <span className="validation-signal-badge signal-pending">...</span>
          )}
        </div>

        <div className="candidate-details">
          <span className="candidate-price">${candidate.price.toFixed(2)}</span>
          <span className="candidate-gap">+{candidate.gapPercent.toFixed(0)}%</span>
          <span className="candidate-score">{candidate.pillarsScore.toFixed(1)}P</span>
        </div>
      </div>

      {hasValidation && (
        <div className="candidate-validation">
          <ConfidenceMeter confidence={validation.confidence} />
          {validation.entry_price && (
            <div className="candidate-prices">
              <span>E: {formatPrice(validation.entry_price)}</span>
              <span>S: {formatPrice(validation.stop_price)}</span>
              {validation.risk_reward_ratio && (
                <span>R/R: {validation.risk_reward_ratio.toFixed(1)}</span>
              )}
            </div>
          )}
        </div>
      )}

      <button className="candidate-view-btn" onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        View
      </button>
    </div>
  )
}

export function Top3ValidationPanel({ onSelectSymbol }: Top3ValidationPanelProps) {
  const {
    topCandidates,
    topValidations,
    isAutoValidating,
    autoValidationError,
    llmAvailable
  } = useValidationStore()

  if (!llmAvailable) {
    return (
      <div className="top3-validation-panel">
        <div className="top3-header">
          <h3>Top 3 Candidates</h3>
          <span className="llm-status offline">LLM Offline</span>
        </div>
        <div className="top3-empty">
          Ollama not available. Start Ollama to enable validation.
        </div>
      </div>
    )
  }

  if (topCandidates.length === 0) {
    return (
      <div className="top3-validation-panel">
        <div className="top3-header">
          <h3>Top 3 Candidates</h3>
        </div>
        <div className="top3-empty">
          No candidates meet criteria (5 Pillars ≥3.5)
        </div>
      </div>
    )
  }

  return (
    <div className="top3-validation-panel">
      <div className="top3-header">
        <h3>Top 3 Candidates</h3>
        <span className={`auto-refresh-indicator ${isAutoValidating ? 'active' : ''}`}>
          {isAutoValidating ? '⟳' : 'Auto'}
        </span>
      </div>

      {autoValidationError && (
        <div className="top3-error">{autoValidationError}</div>
      )}

      <div className="top3-candidates-list">
        {topCandidates.map((candidate, index) => (
          <CandidateRow
            key={candidate.symbol}
            rank={index + 1}
            candidate={candidate}
            validation={topValidations[candidate.symbol]}
            onSelect={() => onSelectSymbol(candidate.symbol)}
          />
        ))}
      </div>
    </div>
  )
}
