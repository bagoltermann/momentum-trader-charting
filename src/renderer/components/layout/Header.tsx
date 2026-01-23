import React from 'react'
import { useWatchlistStore } from '../../store/watchlistStore'
import { useChartStore } from '../../store/chartStore'
import { useValidationStore } from '../../store/validationStore'

export function Header() {
  const { connectionStatus, lastUpdate } = useWatchlistStore()
  const { selectedSymbol } = useChartStore()
  const { validateManual, isManualValidating, llmAvailable } = useValidationStore()

  const handleExit = async () => {
    console.log('Exit button clicked')
    console.log('electronAPI available:', !!window.electronAPI)
    console.log('exitApp function:', !!window.electronAPI?.exitApp)

    if (window.electronAPI?.exitApp) {
      try {
        await window.electronAPI.exitApp()
      } catch (err) {
        console.error('Exit failed:', err)
      }
    } else {
      console.error('electronAPI.exitApp not available')
      // Fallback: try closing the window directly
      window.close()
    }
  }

  return (
    <header className="app-header">
      <div className="logo">
        <h1>Momentum Trader Charts</h1>
      </div>
      <div className="header-info">
        <span className={`status ${connectionStatus}`}>
          {connectionStatus === 'connected' ? 'Connected' : connectionStatus}
        </span>
        {lastUpdate && (
          <span className="last-update">
            Last update: {lastUpdate.toLocaleTimeString()}
          </span>
        )}
        <button
          className="validate-btn"
          onClick={() => selectedSymbol && validateManual(selectedSymbol)}
          disabled={!selectedSymbol || isManualValidating || !llmAvailable}
          title={!llmAvailable ? "LLM offline" : !selectedSymbol ? "Select a symbol first" : `Validate ${selectedSymbol}`}
        >
          {isManualValidating ? 'Validating...' : 'Validate'}
        </button>
        <button
          className="exit-btn"
          onClick={handleExit}
          title="Exit application"
        >
          Exit
        </button>
      </div>
    </header>
  )
}
