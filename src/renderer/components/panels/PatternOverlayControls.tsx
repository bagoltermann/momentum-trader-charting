import React from 'react'
import { usePatternOverlayStore } from '../../store/patternOverlayStore'

interface PatternOverlayControlsProps {
  supportResistanceCount: number
  gapCount: number
  flagPennantDetected: boolean
}

export function PatternOverlayControls({
  supportResistanceCount,
  gapCount,
  flagPennantDetected
}: PatternOverlayControlsProps) {
  const {
    showSupportResistance,
    showGaps,
    showFlagPennant,
    toggleSupportResistance,
    toggleGaps,
    toggleFlagPennant
  } = usePatternOverlayStore()

  return (
    <div className="pattern-overlay-panel">
      <div className="panel-header">
        <span className="panel-title">Pattern Overlays</span>
      </div>
      <div className="pattern-controls">
        <button
          className={`pattern-toggle sr ${showSupportResistance ? 'active' : ''}`}
          onClick={toggleSupportResistance}
          title="Support/Resistance levels"
        >
          <span className="toggle-label">S/R</span>
          {supportResistanceCount > 0 && (
            <span className="count">({supportResistanceCount})</span>
          )}
        </button>

        <button
          className={`pattern-toggle gap ${showGaps ? 'active' : ''}`}
          onClick={toggleGaps}
          title="Price gaps"
        >
          <span className="toggle-label">Gaps</span>
          {gapCount > 0 && (
            <span className="count">({gapCount})</span>
          )}
        </button>

        <button
          className={`pattern-toggle flag ${showFlagPennant ? 'active' : ''}`}
          onClick={toggleFlagPennant}
          title="Flag/Pennant patterns"
        >
          <span className="toggle-label">Flag</span>
          {flagPennantDetected && (
            <span className="detected-indicator" title="Pattern detected"></span>
          )}
        </button>
      </div>
    </div>
  )
}
