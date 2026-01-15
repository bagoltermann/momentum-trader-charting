import React from 'react'

interface WatchlistItem {
  symbol: string
  gap_percent?: number
}

interface SidebarProps {
  watchlist: WatchlistItem[]
  selectedSymbol: string | null
  onSelectSymbol: (symbol: string) => void
}

export function Sidebar({ watchlist, selectedSymbol, onSelectSymbol }: SidebarProps) {
  return (
    <aside className="sidebar">
      <h2>Watchlist</h2>
      <ul className="symbol-list">
        {watchlist.map((stock) => (
          <li
            key={stock.symbol}
            className={`symbol-item ${selectedSymbol === stock.symbol ? 'selected' : ''}`}
            onClick={() => onSelectSymbol(stock.symbol)}
          >
            <span className="symbol">{stock.symbol}</span>
            <span className={`gap ${(stock.gap_percent ?? 0) >= 0 ? 'positive' : 'negative'}`}>
              {stock.gap_percent?.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
