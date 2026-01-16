import React from 'react'
import { useWatchlistStore } from '../../store/watchlistStore'

export function Header() {
  const { connectionStatus, lastUpdate } = useWatchlistStore()

  const handleExit = () => {
    if (window.electronAPI?.exitApp) {
      window.electronAPI.exitApp()
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
