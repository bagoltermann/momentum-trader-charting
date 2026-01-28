import { useCandleDataStore } from '../../store/candleDataStore'

interface StatusBarProps {
  connectionStatus: 'connected' | 'disconnected' | 'error'
}

export function StatusBar({ connectionStatus }: StatusBarProps) {
  const streamingConnected = useCandleDataStore(s => s.streamingConnected)

  const dataMode = streamingConnected ? 'streaming' : connectionStatus === 'connected' ? 'polling' : 'disconnected'
  const dataModeClass = streamingConnected ? 'connected' : connectionStatus === 'connected' ? 'warning' : 'error'

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
    </footer>
  )
}
