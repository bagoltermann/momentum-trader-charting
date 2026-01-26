
interface WatchlistItem {
  symbol: string
  gap_percent?: number
}

interface WatchlistHeatmapProps {
  watchlist: WatchlistItem[]
  onSelectSymbol: (symbol: string) => void
}

export function WatchlistHeatmap({ watchlist, onSelectSymbol }: WatchlistHeatmapProps) {
  const getHeatClass = (gapPercent: number | undefined): string => {
    const gap = gapPercent ?? 0
    if (gap >= 20) return 'hot'
    if (gap >= 10) return 'warm'
    return 'cool'
  }

  return (
    <div className="watchlist-heatmap">
      {watchlist.map((stock) => (
        <button
          key={stock.symbol}
          className={`heatmap-tile ${getHeatClass(stock.gap_percent)}`}
          onClick={() => onSelectSymbol(stock.symbol)}
        >
          <span className="symbol">{stock.symbol}</span>
          <span className="gap">+{stock.gap_percent?.toFixed(0) ?? 0}%</span>
        </button>
      ))}
    </div>
  )
}
