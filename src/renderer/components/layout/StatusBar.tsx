import { useCandleDataStore } from '../../store/candleDataStore'
import type { RotationStats } from '../../hooks/useRotationDiscovery'
import type { StreamingHealth } from '../../hooks/useStreamingHealth'

interface StatusBarProps {
  connectionStatus: 'connected' | 'disconnected' | 'error'
  rotationStats?: RotationStats
  streamingHealth?: StreamingHealth & { formattedQuotes: string }
}

export function StatusBar({ connectionStatus, rotationStats, streamingHealth }: StatusBarProps) {
  const streamingConnected = useCandleDataStore(s => s.streamingConnected)

  // Feed status — use streaming health when available, fall back to basic mode
  let feedLabel: string
  let feedClass: string
  if (streamingHealth && streamingHealth.status !== 'unknown') {
    const h = streamingHealth
    switch (h.status) {
      case 'live':
        feedLabel = `Feed: LIVE (${h.formattedQuotes})`
        feedClass = 'connected'
        break
      case 'delayed':
        feedLabel = `Feed: DELAYED ${Math.round(h.lastMessageSecondsAgo || 0)}s`
        feedClass = 'warning'
        break
      case 'stale':
        feedLabel = `Feed: STALE ${Math.round(h.lastMessageSecondsAgo || 0)}s!`
        feedClass = 'error'
        break
      case 'disconnected':
        feedLabel = 'Feed: disconnected'
        feedClass = 'error'
        break
      default:
        feedLabel = 'Feed: unknown'
        feedClass = 'error'
    }
  } else {
    // Fallback to basic streaming/polling indicator
    const dataMode = streamingConnected ? 'streaming' : connectionStatus === 'connected' ? 'polling' : 'disconnected'
    feedLabel = dataMode === 'streaming' ? 'Data: Streaming' : dataMode === 'polling' ? 'Data: Polling 30s' : 'Data: Disconnected'
    feedClass = streamingConnected ? 'connected' : connectionStatus === 'connected' ? 'warning' : 'error'
  }

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
        <span className={`indicator ${feedClass}`} />
        <span>{feedLabel}</span>
      </div>
      <div className="status-item">
        <span className={`indicator ${scannerClass}`} />
        <span>{scannerLabel}</span>
      </div>
    </footer>
  )
}
