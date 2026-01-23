import React, { useEffect, useMemo, useCallback } from 'react'
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
import { useValidationStore } from './store/validationStore'

function App() {
  const { watchlist, fetchWatchlist, connectionStatus } = useWatchlistStore()
  const { selectedSymbol, setSelectedSymbol } = useChartStore()
  const { runners } = useRunners()
  const {
    refreshTopCandidates,
    validateTop3,
    checkLlmStatus
  } = useValidationStore()

  // Get top 4 runners by quality score for secondary charts (excluding selected symbol)
  const secondaryRunnerSymbols = useMemo(() => {
    return runners
      .filter(r => r.symbol !== selectedSymbol)
      .sort((a, b) => b.quality_score - a.quality_score)
      .slice(0, 4)
      .map(r => r.symbol)
  }, [runners, selectedSymbol])

  // Convert runners array to map for validation store
  const runnersData = useMemo(() => {
    const data: Record<string, { day?: number; status?: string }> = {}
    for (const runner of runners) {
      data[runner.symbol] = {
        day: runner.gap_age_days,
        status: runner.status,
      }
    }
    return data
  }, [runners])

  // Memoize the refresh callback to avoid unnecessary re-renders
  const doRefreshAndValidate = useCallback(() => {
    if (watchlist.length > 0) {
      refreshTopCandidates(watchlist, runnersData)
      validateTop3()
    }
  }, [watchlist, runnersData, refreshTopCandidates, validateTop3])

  useEffect(() => {
    // Initial fetch
    fetchWatchlist()

    // Poll every 5 seconds
    const interval = setInterval(fetchWatchlist, 5000)
    return () => clearInterval(interval)
  }, [fetchWatchlist])

  // Check LLM status on mount
  useEffect(() => {
    checkLlmStatus()
    // Re-check every 30 seconds
    const interval = setInterval(checkLlmStatus, 30000)
    return () => clearInterval(interval)
  }, [checkLlmStatus])

  // Auto-validate top 3 every 60 seconds
  useEffect(() => {
    // Initial refresh when watchlist loads
    doRefreshAndValidate()

    // Re-evaluate top 3 every 60 seconds
    const interval = setInterval(doRefreshAndValidate, 60000)
    return () => clearInterval(interval)
  }, [doRefreshAndValidate])

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
