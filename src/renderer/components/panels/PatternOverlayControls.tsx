import { usePatternOverlayStore } from '../../store/patternOverlayStore'

export function PatternOverlayControls() {
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
        </button>

        <button
          className={`pattern-toggle gap ${showGaps ? 'active' : ''}`}
          onClick={toggleGaps}
          title="Price gaps"
        >
          <span className="toggle-label">Gaps</span>
        </button>

        <button
          className={`pattern-toggle flag ${showFlagPennant ? 'active' : ''}`}
          onClick={toggleFlagPennant}
          title="Flag/Pennant patterns"
        >
          <span className="toggle-label">Flag</span>
        </button>
      </div>
    </div>
  )
}
