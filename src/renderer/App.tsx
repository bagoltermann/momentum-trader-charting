import React, { useEffect, useMemo } from 'react'
import { Header } from './components/layout/Header'
import { Sidebar } from './components/layout/Sidebar'
import { MultiChartGrid } from './components/charts/MultiChartGrid'
import { WatchlistHeatmap } from './components/panels/WatchlistHeatmap'
import { RunnersPanel } from './components/panels/RunnersPanel'
import { AnalysisPanels } from './components/panels/AnalysisPanels'
import { StatusBar } from './components/layout/StatusBar'
import { useWatchlistStore } from './store/watchlistStore'
import { useChartStore } from './store/chartStore'
import { useRunners } from './hooks/useRunners'

function App() {
  const { watchlist, fetchWatchlist, connectionStatus } = useWatchlistStore()
  const { selectedSymbol, setSelectedSymbol } = useChartStore()
  const { runners } = useRunners()

  // Get top 4 runners by quality score for secondary charts (excluding selected symbol)
  const secondaryRunnerSymbols = useMemo(() => {
    return runners
      .filter(r => r.symbol !== selectedSymbol)
      .sort((a, b) => b.quality_score - a.quality_score)
      .slice(0, 4)
      .map(r => r.symbol)
  }, [runners, selectedSymbol])

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
        <div className="center-content">
          <MultiChartGrid
            primarySymbol={selectedSymbol}
            secondarySymbols={secondaryRunnerSymbols}
            runners={runners}
          />
          <AnalysisPanels
            selectedSymbol={selectedSymbol}
            watchlist={watchlist}
            runners={runners}
          />
        </div>
        <RunnersPanel
          selectedSymbol={selectedSymbol}
          onSelectSymbol={setSelectedSymbol}
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
