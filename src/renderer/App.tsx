import React, { useEffect } from 'react'
import { Header } from './components/layout/Header'
import { Sidebar } from './components/layout/Sidebar'
import { MultiChartGrid } from './components/charts/MultiChartGrid'
import { WatchlistHeatmap } from './components/panels/WatchlistHeatmap'
import { StatusBar } from './components/layout/StatusBar'
import { useWatchlistStore } from './store/watchlistStore'
import { useChartStore } from './store/chartStore'

function App() {
  const { watchlist, fetchWatchlist, connectionStatus } = useWatchlistStore()
  const { selectedSymbol, setSelectedSymbol } = useChartStore()

  useEffect(() => {
    // Initial fetch
    fetchWatchlist()

    // Poll every 5 seconds
    const interval = setInterval(fetchWatchlist, 5000)
    return () => clearInterval(interval)
  }, [fetchWatchlist])

  return (
    <div className="app-container">
      <Header />
      <div className="main-content">
        <Sidebar
          watchlist={watchlist}
          selectedSymbol={selectedSymbol}
          onSelectSymbol={setSelectedSymbol}
        />
        <MultiChartGrid
          primarySymbol={selectedSymbol}
          secondarySymbols={watchlist.slice(0, 4).map(s => s.symbol).filter(s => s !== selectedSymbol)}
        />
      </div>
      <WatchlistHeatmap
        watchlist={watchlist}
        onSelectSymbol={setSelectedSymbol}
      />
      <StatusBar connectionStatus={connectionStatus} />
    </div>
  )
}

export default App
