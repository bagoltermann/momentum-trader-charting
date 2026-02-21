import { useEffect, useMemo, useRef } from 'react'
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
import { useRotationDiscovery } from './hooks/useRotationDiscovery'
import { DiscoveryPanel } from './components/panels/DiscoveryPanel'

function App() {
  const { watchlist, fetchWatchlist, connectionStatus } = useWatchlistStore()
  const { selectedSymbol, setSelectedSymbol } = useChartStore()
  const { runners } = useRunners()
  const {
    refreshTopCandidates,
    validateTop3,
    checkLlmStatus
  } = useValidationStore()
  const rotationStats = useRotationDiscovery()

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

  // Refs to hold latest values for the stable 60s timer (without triggering effect re-runs)
  const watchlistRef = useRef(watchlist)
  const runnersDataRef = useRef(runnersData)
  useEffect(() => { watchlistRef.current = watchlist }, [watchlist])
  useEffect(() => { runnersDataRef.current = runnersData }, [runnersData])

  // Ranking refresh -- runs when watchlist/runners change (cheap, local array sorting)
  useEffect(() => {
    if (watchlist.length > 0) {
      refreshTopCandidates(watchlist, runnersData)
    }
  }, [watchlist, runnersData, refreshTopCandidates])

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

  // LLM validation -- stable 60s timer, NOT tied to watchlist changes
  useEffect(() => {
    // Initial validation after short delay (let watchlist load first)
    const initialTimeout = setTimeout(() => {
      if (watchlistRef.current.length > 0) {
        refreshTopCandidates(watchlistRef.current, runnersDataRef.current)
        validateTop3()
      }
    }, 2000)

    // Stable 60s interval -- uses refs so the timer is never reset by watchlist changes
    const interval = setInterval(() => {
      if (watchlistRef.current.length > 0) {
        refreshTopCandidates(watchlistRef.current, runnersDataRef.current)
        validateTop3()
      }
    }, 60000)

    return () => {
      clearTimeout(initialTimeout)
      clearInterval(interval)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="app-container">
      <Header />
      <div className="main-content">
        <div className="left-column">
          <Sidebar
            watchlist={watchlist}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
          />
          <DiscoveryPanel
            rotationStats={rotationStats}
            onSelectSymbol={setSelectedSymbol}
          />
        </div>
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
      <StatusBar connectionStatus={connectionStatus} rotationStats={rotationStats} />
    </div>
  )
}

export default App
