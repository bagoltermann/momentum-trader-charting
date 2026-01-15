import { create } from 'zustand'

interface ChartState {
  selectedSymbol: string | null
  timeframe: '1m' | '5m' | '15m' | 'D'
  setSelectedSymbol: (symbol: string) => void
  setTimeframe: (tf: '1m' | '5m' | '15m' | 'D') => void
}

export const useChartStore = create<ChartState>((set) => ({
  selectedSymbol: null,
  timeframe: '1m',
  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  setTimeframe: (timeframe) => set({ timeframe }),
}))
