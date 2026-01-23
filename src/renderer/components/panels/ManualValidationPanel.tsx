import React from 'react'
import { useValidationStore, ValidationResult } from '../../store/validationStore'

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
    case 'no_trade': return 'NO TRADE'
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
    <div className="confidence-meter large">
      <div
        className={`confidence-bar ${getConfidenceClass()}`}
        style={{ width: `${confidence}%` }}
      />
      <span className="confidence-value">{confidence}%</span>
    </div>
  )
}

interface ValidationDetailsProps {
  result: ValidationResult
}

function ValidationDetails({ result }: ValidationDetailsProps) {
  return (
    <div className="validation-details">
      <div className="validation-signal-section">
        <span className={`validation-signal-large ${getSignalClass(result.signal)}`}>
          {getSignalLabel(result.signal)}
        </span>
        <ConfidenceMeter confidence={result.confidence} />
      </div>

      <div className="validation-prices-section">
        <div className="price-row">
          <span className="price-label">Entry:</span>
          <span className="price-value entry">{formatPrice(result.entry_price)}</span>
        </div>
        <div className="price-row">
          <span className="price-label">Stop:</span>
          <span className="price-value stop">{formatPrice(result.stop_price)}</span>
        </div>
        <div className="price-row">
          <span className="price-label">Target:</span>
          <span className="price-value target">{formatPrice(result.target_price)}</span>
        </div>
        {result.risk_reward_ratio && (
          <div className="price-row">
            <span className="price-label">R/R:</span>
            <span className="price-value rr">{result.risk_reward_ratio.toFixed(1)}:1</span>
          </div>
        )}
      </div>

      <div className="validation-reasoning-section">
        <h4>Reasoning</h4>
        <ul className="reasoning-list">
          {result.reasoning.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      </div>

      {result.key_concern && (
        <div className="validation-concern">
          <span className="concern-label">Key Concern:</span>
          <span className="concern-text">{result.key_concern}</span>
        </div>
      )}

      <div className="validation-meta">
        <span className="validation-time">
          {new Date(result.timestamp).toLocaleTimeString()}
        </span>
        {result.cached && <span className="cached-badge">Cached</span>}
      </div>
    </div>
  )
}

export function ManualValidationPanel() {
  const {
    manualSymbol,
    manualResult,
    isManualValidating,
    manualValidationError,
    clearManualValidation
  } = useValidationStore()

  // Don't render if no manual validation requested
  if (!manualSymbol && !manualResult && !isManualValidating) {
    return null
  }

  if (isManualValidating) {
    return (
      <div className="manual-validation-panel">
        <div className="manual-validation-header">
          <h3>Validating {manualSymbol}...</h3>
        </div>
        <div className="manual-validation-loading">
          <div className="spinner" />
          <p>Analyzing with LLM...</p>
        </div>
      </div>
    )
  }

  if (manualValidationError) {
    return (
      <div className="manual-validation-panel">
        <div className="manual-validation-header">
          <h3>Validation Error</h3>
          <button className="close-btn" onClick={clearManualValidation}>×</button>
        </div>
        <div className="manual-validation-error">
          {manualValidationError}
        </div>
      </div>
    )
  }

  if (!manualResult) {
    return null
  }

  return (
    <div className="manual-validation-panel">
      <div className="manual-validation-header">
        <h3>{manualResult.symbol} Validation</h3>
        <button className="close-btn" onClick={clearManualValidation}>×</button>
      </div>
      <ValidationDetails result={manualResult} />
    </div>
  )
}
