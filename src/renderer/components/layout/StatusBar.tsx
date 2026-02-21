import { useCandleDataStore } from '../../store/candleDataStore'
import type { RotationStats } from '../../hooks/useRotationDiscovery'

interface StatusBarProps {
  connectionStatus: 'connected' | 'disconnected' | 'error'
  rotationStats?: RotationStats
}

export function StatusBar({ connectionStatus, rotationStats }: StatusBarProps) {
  const streamingConnected = useCandleDataStore(s => s.streamingConnected)

  const dataMode = streamingConnected ? 'streaming' : connectionStatus === 'connected' ? 'polling' : 'disconnected'
  const dataModeClass = streamingConnected ? 'connected' : connectionStatus === 'connected' ? 'warning' : 'error'

  // Scanner status
  const scannerLabel = !rotationStats || !rotationStats.enabled
    ? 'Scanner: off'
    : rotationStats.priorityCount > 0
    ? `Scanner: ${rotationStats.priorityCount} found (${rotationStats.discoverySlots} slots)`
    : 'Scanner: rotating'
  const scannerClass = !rotationStats || !rotationStats.enabled
    ? 'error'
    : rotationStats.priorityCount > 0
    ? 'connected'
    : 'warning'

  return (
    <footer className="status-bar">
      <div className="status-item">
        <span className={`indicator ${connectionStatus}`} />
        <span>Backend: {connectionStatus}</span>
      </div>
      <div className="status-item">
        <span className={`indicator ${dataModeClass}`} />
        <span>Data: {dataMode === 'streaming' ? 'Streaming' : dataMode === 'polling' ? 'Polling 30s' : 'Disconnected'}</span>
      </div>
      <div className="status-item">
        <span className={`indicator ${scannerClass}`} />
        <span>{scannerLabel}</span>
      </div>
    </footer>
  )
}
