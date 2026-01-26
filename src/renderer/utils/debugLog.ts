/**
 * Debug logging utility for chart-related modules.
 * Set DEBUG_CHARTS = true to enable verbose chart logging in DevTools console.
 * Keep false in production to reduce UI thread overhead.
 */
const DEBUG_CHARTS = false

export function debugLog(msg: string): void {
  if (DEBUG_CHARTS) {
    console.log(msg)
  }
}

export function debugLogTimestamped(msg: string): void {
  if (DEBUG_CHARTS) {
    const timestamp = new Date().toISOString()
    console.log(`${timestamp} ${msg}`)
  }
}
