import { create } from 'zustand'

interface PatternOverlayState {
  // Toggle states for each pattern type
  showSupportResistance: boolean
  showGaps: boolean
  showFlagPennant: boolean

  // Actions
  toggleSupportResistance: () => void
  toggleGaps: () => void
  toggleFlagPennant: () => void
  setAllPatterns: (show: boolean) => void
}

export const usePatternOverlayStore = create<PatternOverlayState>((set) => ({
  // Defaults: S/R and Gaps on, Flag/Pennant off (more complex)
  showSupportResistance: true,
  showGaps: true,
  showFlagPennant: false,

  toggleSupportResistance: () => set((s) => ({ showSupportResistance: !s.showSupportResistance })),
  toggleGaps: () => set((s) => ({ showGaps: !s.showGaps })),
  toggleFlagPennant: () => set((s) => ({ showFlagPennant: !s.showFlagPennant })),
  setAllPatterns: (show) => set({
    showSupportResistance: show,
    showGaps: show,
    showFlagPennant: show,
  }),
}))
