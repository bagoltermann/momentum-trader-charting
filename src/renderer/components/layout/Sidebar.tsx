import React from 'react'

interface WatchlistItem {
  symbol: string
  price?: number
  high?: number
  gap_percent?: number
}

interface SidebarProps {
  watchlist: WatchlistItem[]
  selectedSymbol: string | null
  onSelectSymbol: (symbol: string) => void
}

// Format price compactly: 12.50 -> 12.5, 3.00 -> 3
function formatPrice(price: number | undefined): string {
  if (price === undefined) return '-'
  if (price >= 100) return price.toFixed(0)
  if (price >= 10) return price.toFixed(1)
  return price.toFixed(2)
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
            <span className="price-info">
              <span className="current-price">{formatPrice(stock.price)}</span>
              <span className="day-high">H:{formatPrice(stock.high)}</span>
            </span>
            <span className={`gap ${(stock.gap_percent ?? 0) >= 0 ? 'positive' : 'negative'}`}>
              {stock.gap_percent?.toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
