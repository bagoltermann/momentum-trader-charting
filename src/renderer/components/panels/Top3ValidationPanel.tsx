import React, { useState } from 'react'
import { useValidationStore, ValidationResult, RankedCandidate } from '../../store/validationStore'

interface Top3ValidationPanelProps {
  onSelectSymbol: (symbol: string) => void
}

interface TooltipProps {
  candidate: RankedCandidate
  validation: ValidationResult | undefined
  visible: boolean
  position: { x: number; y: number }
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

function CandidateTooltip({ candidate, validation, visible, position }: TooltipProps) {
  if (!visible) return null

  const playType = candidate.isRunner ? 'RUNNER (Day 2+)' : 'FRESH GAP'
  const qualityLabel = candidate.isRunner ? 'Runner Quality' : 'Setup Quality'

  return (
    <div
      className="candidate-tooltip"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <div className="tooltip-header">
        <span className="tooltip-symbol">{candidate.symbol}</span>
        <span className={`tooltip-play-type ${candidate.isRunner ? 'runner' : 'fresh'}`}>
          {playType}
        </span>
      </div>

      <div className="tooltip-section">
        <div className="tooltip-row">
          <span className="tooltip-label">5 Pillars:</span>
          <span className="tooltip-value">{candidate.pillarsScore.toFixed(1)} / 5</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">{qualityLabel}:</span>
          <span className="tooltip-value">{candidate.qualityScore.toFixed(0)}</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">Volume:</span>
          <span className="tooltip-value">{candidate.volumeRatio.toFixed(1)}x</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">Gap:</span>
          <span className="tooltip-value">+{candidate.gapPercent.toFixed(0)}%</span>
        </div>
      </div>

      {validation && validation.confidence > 0 && (
        <>
          <div className="tooltip-divider" />
          <div className="tooltip-section">
            <div className="tooltip-row">
              <span className="tooltip-label">LLM Signal:</span>
              <span className={`tooltip-signal ${getSignalClass(validation.signal)}`}>
                {getSignalLabel(validation.signal)}
              </span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-label">Confidence:</span>
              <span className="tooltip-value">{validation.confidence}%</span>
            </div>
            {validation.risk_reward_ratio && (
              <div className="tooltip-row">
                <span className="tooltip-label">Risk/Reward:</span>
                <span className="tooltip-value">{validation.risk_reward_ratio.toFixed(1)}:1</span>
              </div>
            )}
          </div>

          {validation.key_concern && (
            <>
              <div className="tooltip-divider" />
              <div className="tooltip-concern">
                <span className="concern-label">⚠ Key Concern:</span>
                <span className="concern-text">{validation.key_concern}</span>
              </div>
            </>
          )}

          {validation.reasoning && validation.reasoning.length > 0 && (
            <>
              <div className="tooltip-divider" />
              <div className="tooltip-reasoning">
                <span className="reasoning-label">Analysis:</span>
                <ul className="reasoning-list">
                  {validation.reasoning.slice(0, 3).map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </>
      )}

      {validation && validation.confidence === 0 && (
        <>
          <div className="tooltip-divider" />
          <div className="tooltip-pending">
            LLM validation pending, will retry...
          </div>
        </>
      )}

      {!validation && (
        <>
          <div className="tooltip-divider" />
          <div className="tooltip-pending">
            Awaiting LLM validation...
          </div>
        </>
      )}
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
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  const handleMouseEnter = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    // Position tooltip to the right of the row, anchored at bottom (grows upward)
    setTooltipPos({
      x: rect.right + 10,
      y: rect.bottom
    })
    setShowTooltip(true)
  }

  const handleMouseLeave = () => {
    setShowTooltip(false)
  }

  return (
    <div
      className="top3-candidate-row"
      onClick={onSelect}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="candidate-rank">{rank}</div>

      <div className="candidate-main">
        <div className="candidate-header">
          <span className="candidate-symbol">
            {candidate.symbol}
            {candidate.isRunner && <span className="runner-badge">R</span>}
          </span>
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

      <CandidateTooltip
        candidate={candidate}
        validation={validation}
        visible={showTooltip}
        position={tooltipPos}
      />
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
