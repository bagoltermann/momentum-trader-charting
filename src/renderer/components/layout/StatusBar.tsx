import React from 'react'

interface StatusBarProps {
  connectionStatus: 'connected' | 'disconnected' | 'error'
}

export function StatusBar({ connectionStatus }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <div className="status-item">
        <span className={`indicator ${connectionStatus}`} />
        <span>Backend: {connectionStatus}</span>
      </div>
      <div className="status-item">
        <span>Phase 1 - Foundation</span>
      </div>
    </footer>
  )
}
