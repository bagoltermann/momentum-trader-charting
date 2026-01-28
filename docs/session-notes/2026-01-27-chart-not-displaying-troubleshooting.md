# Session Notes: Chart Not Displaying - Troubleshooting Guide (2026-01-27)

## Symptom
Primary chart shows blank or "Failed to load chart data" error. Secondary charts may also fail. The app appears running but charts never populate.

## Diagnosis Flowchart

### Step 1: Is the backend responding?
```
curl http://localhost:8081/api/candles/AAPL?timeframe=1m
```
- **Gets JSON response** -> Backend is alive, go to Step 3
- **Hangs or connection refused** -> Backend is dead/hung, go to Step 2

### Step 2: Backend is hung - Semaphore Starvation
**Root cause found 2026-01-27:** The Schwab API semaphore (5 slots in `schwab_client.py`) can be fully consumed by concurrent validation requests (`POST /validate/{symbol}`), leaving zero slots for candle fetches. The backend process stays alive but stops responding to candle requests.

**Evidence in logs (`logs/backend.log`):**
- Log entries stop appearing (no new timestamps)
- Last entries show validation requests or quote fetches
- Zero `GET /candles/` entries despite frontend auto-refresh running

**Fix applied:** Added 10s timeout to semaphore acquire in `schwab_client.py:268-272`:
```python
try:
    await asyncio.wait_for(_get_semaphore().acquire(), timeout=10.0)
except asyncio.TimeoutError:
    _logger.warning(f"get_price_history({symbol}) semaphore timeout after 10s")
    return None
```

**If it happens again despite the fix:**
1. Check `logs/backend.log` tail - is anything being logged?
2. Kill the backend process: `taskkill /F /PID <pid>` (find PID with `netstat -ano | findstr :8081 | findstr LISTENING`)
3. Restart the charting app
4. If recurring, the semaphore timeout may need to be shorter (currently 10s), or the semaphore size (currently 5) may need to increase

### Step 3: Backend alive but frontend shows no data
**Check the frontend candle store state** by opening DevTools console (Ctrl+Shift+I) and running:
```javascript
// Check store state
const state = window.__ZUSTAND_STORE__ // May not be exposed
// Or look for console output with [CandleStore] prefix (requires DEBUG_CHARTS=true in debugLog.ts)
```

**Known stuck states:**
- `primaryLoading: false, primaryError: set, primaryCandles: []` -> Store exhausted retries. The 30s auto-refresh timer (`candleDataStore.ts:185-192`) should retry, but it checks `!primaryLoading && !pendingController`. If `pendingController` is stale (not null but the request is done), auto-refresh never fires.
- `primaryLoading: true` stuck indefinitely -> A request is in flight but the backend never responded. The 15s axios timeout (`candleDataStore.ts:7`) should catch this, but if the backend hangs mid-response it may not trigger.

**Quick fix:** Ctrl+R to reload the Electron window. This reinitializes all module-level state (`pendingController`, `refreshInterval`, `debounceTimer`).

### Step 4: Backend alive, frontend fetching, but empty data
**Check backend logs for the symbol:**
```
# Look for candle fetch entries
grep "GET /candles/SYMBOL" logs/backend.log | tail -5
```
- If no entries: frontend isn't making requests (see Step 3)
- If entries show `0 candles`: Schwab API returned empty data (pre-market, wrong symbol, API issue)
- If entries show errors: Check Schwab token/auth status

## Known Failure Modes

### 1. Semaphore Starvation (FIXED 2026-01-27)
- **Trigger:** High-frequency validation requests consuming all 5 semaphore slots
- **Impact:** All candle fetches block indefinitely
- **File:** `backend/services/schwab_client.py` lines 264-272
- **Fix:** 10s timeout on semaphore acquire, returns None on timeout

### 2. Backend Connection Exhaustion (FIXED 2026-01-20)
- **Trigger:** Clicking through ~25 stocks rapidly
- **Impact:** Uvicorn stops accepting new connections
- **File:** `backend/main.py` (uvicorn config), `backend/services/schwab_client.py` (httpx client)
- **Fix:** Switched to httpx, tuned uvicorn limits, short keep-alive
- **Session notes:** `docs/session-notes/2026-01-20-backend-stability-fix.md`

### 3. Validation Spam (KNOWN ISSUE - NOT YET FIXED)
- **Trigger:** Auto-validation in `App.tsx` may fire more frequently than intended (observed every 2-4s instead of 60s)
- **Impact:** Consumes semaphore slots and Schwab API rate limits
- **Evidence:** Backend log shows rapid `POST /validate/` entries
- **Potential causes:** Multiple component mounts triggering validation, HMR causing duplicate timers
- **Workaround:** The semaphore timeout fix prevents this from hanging the backend, but it wastes API calls

### 4. Frontend Store Stuck State (KNOWN ISSUE - PARTIALLY FIXED)
- **Trigger:** Backend was hung when fetch was attempted, all retries exhausted
- **Impact:** Store stuck in error state, auto-refresh may not recover if `pendingController` is stale
- **File:** `src/renderer/store/candleDataStore.ts` lines 145-147 (pendingController cleanup), lines 185-192 (auto-refresh guard)
- **Partial fix:** Error now displayed in UI (`MultiChartGrid.tsx` error overlay)
- **Remaining:** No click-to-retry, no forced reset of stale pendingController

### 5. Schwab API Token Expiry
- **Trigger:** Token expires during market session
- **Impact:** All API calls return 401, candles empty
- **Evidence:** Backend log shows `401` responses or "token" errors
- **Fix:** Restart backend (triggers token refresh), or check token file manually

### 6. Streaming Relay Disconnect Without Fallback (FIXED 2026-01-28)
- **Trigger:** Trader app crashes or is stopped while charting app is running with streaming enabled
- **Impact:** Chart goes blank. Frontend WebSocket to charting backend stays open (no error), but no data flows because backend's SocketIO connection to trader app is dead. Frontend still thinks `streamingConnected = true`, so REST polling stays paused.
- **Observed:** Left charting app running overnight, trader app crashed at 06:53, chart was completely blank in the morning.
- **Root cause chain:**
  1. Trader app crashes → backend QuoteRelay disconnects (sets `_connected = false`)
  2. Frontend WebSocket to charting backend stays open (just no data)
  3. Frontend `streamingConnected` remains `true`
  4. REST polling guard (`if (streamingConnected) return`) skips all fetches
  5. No new candles → chart stays frozen, then blanks when all data goes stale
- **Files:** `backend/services/quote_relay.py`, `backend/api/routes.py`, `src/renderer/hooks/useStreamingQuotes.ts`
- **Fix (two-layer):**
  1. **Backend relay status notifications:** QuoteRelay now sends `{type: 'status', connected: bool}` messages to all WebSocket clients when trader app connects/disconnects
  2. **Frontend stale timeout:** If no quotes received for 60s, sets `streamingConnected = false` to trigger REST polling (handles market closed, missed status messages)
- **Verification:** Stop trader app while charting app is streaming → StatusBar should change from "Streaming" to "Polling 30s" within 60s, chart data continues via REST

### 7. Zero Candle Data Crash (FIXED 2026-01-28)
- **Trigger:** Clicking on symbols during pre-market hours when Schwab API returns placeholder candles with OHLC = 0
- **Impact:** Chart goes blank or crashes. Lightweight-charts may not handle candles where all values are zero.
- **Evidence:** API returns `[{"timestamp":...,"open":0.0,"high":0.0,"low":0.0,"close":0.0,"volume":0}]`
- **File:** `src/renderer/store/candleDataStore.ts` lines 145-155
- **Fix:** Filter out candles where OHLC are all zero during transform. Show "No valid data (pre-market)" message instead of crashing.
- **Verification:** Click on symbols during pre-market → should show "No valid data (pre-market)" message instead of blank/crash

### 8. httpx Request Hang (BAND-AID FIX 2026-01-28)
- **Trigger:** Rapid clicking through watchlist stocks during pre-market
- **Impact:** Backend becomes unresponsive. Schwab API request starts but never completes or times out.
- **Observed:** Log shows "make_api_request: Starting request to https://api.schwabapi.com/..." but no follow-up response or timeout
- **Evidence in logs:** Last entry shows "Starting request" with no completion, backend port still listening but not responding
- **File:** `backend/services/schwab_client.py` lines 305-318, 400-412
- **Fix applied:** Added `asyncio.wait_for()` wrapper around all `make_api_request()` calls with a hard 15s timeout (price history) or 10s timeout (quotes). This guarantees the coroutine will be cancelled if it exceeds the timeout, regardless of httpx's internal state.
- **Verification:** Rapid click through stocks → requests should timeout and log warnings instead of hanging indefinitely

**⚠️ ROOT CAUSE UNKNOWN - This is a defensive band-aid fix**

The `asyncio.wait_for()` wrapper is production-grade defensive coding, but it masks the underlying issue rather than fixing it. httpx has its own 10s timeout configured, but it wasn't firing.

**Possible root causes to investigate later:**
1. **Connection pool exhaustion:** httpx maintains a connection pool. Rapid requests might exhaust available connections, causing new requests to queue indefinitely waiting for a free connection.
2. **SSL handshake hang:** The timeout might not cover the SSL/TLS handshake phase. If the handshake gets stuck (server not responding, certificate validation issue), the request might hang before the timeout clock starts.
3. **DNS resolution hang:** Similar to SSL - DNS resolution happens before the HTTP timeout starts. A slow/stuck DNS lookup wouldn't be covered by httpx's timeout.
4. **httpx Windows-specific bug:** There could be an asyncio/httpx interaction issue specific to Windows event loop implementation.
5. **Schwab API rate limiting:** Schwab might be silently dropping connections without responding when rate limited, causing requests to hang.

**What would be needed to properly diagnose:**
- Add granular logging at connection pool level (httpx connection acquire/release)
- Monitor connection pool state before each request
- Test with `aiohttp` instead of `httpx` to see if issue is library-specific
- Add logging around SSL handshake and DNS resolution phases
- Test on Linux to rule out Windows-specific issues

**Why the band-aid is acceptable for now:**
- It prevents the backend from becoming completely unresponsive
- The 15s/10s hard timeout is generous enough to not cause false positives
- Failed requests return None, which the frontend handles gracefully
- The real fix requires significant investigation time that's better spent during market hours when the issue is reproducible

### 9. Sync Watchlist Fetch Blocking Event Loop (FIXED 2026-01-28)
- **Trigger:** Normal operation - `/api/watchlist` route called every 5s by frontend
- **Impact:** Backend becomes unresponsive. Log shows watchlist polls stopping, no more entries logged.
- **Observed:** Log shows successful watchlist fetches (e.g., `HTTP Request: GET http://localhost:8080/api/watchlist "HTTP/1.1 200 OK"`) then stops completely, with no "Starting request" left incomplete.
- **Root cause:** `file_watcher.py` used **synchronous httpx** (`httpx.Client`) to fetch watchlist from trader app. Even with a 5s timeout, this blocked the entire async event loop while waiting for the response. If the trader app became slow (busy processing, high load), the blocking call would freeze all other requests.
- **Evidence in logs:** Last entries show successful watchlist fetches at 10s intervals, then nothing - no incomplete requests, just silence.
- **Files:** `backend/services/file_watcher.py` (sync httpx client), `backend/api/routes.py` (async route calling sync function)
- **Fix:**
  1. Created `get_cached_watchlist_async()` that wraps `fetch_watchlist_from_trader()` in `asyncio.to_thread()`
  2. Updated `/api/watchlist` route to use the async version
  3. Original sync version kept for startup initialization
- **Verification:** Backend should remain responsive even if trader app is slow. Watchlist fetches run in thread pool, not blocking the event loop.

## Debugging Checklist (Quick Reference)

1. **Is backend port open?** `netstat -ano | findstr :8081 | findstr LISTENING`
2. **Is backend responsive?** `curl http://localhost:8081/api/candles/AAPL?timeframe=1m`
3. **What's in the log?** Check `logs/backend.log` tail for recent entries
4. **Frontend console?** Set `DEBUG_CHARTS = true` in `src/renderer/utils/debugLog.ts` and check browser DevTools
5. **Nuclear option:** Kill backend process, Ctrl+R the Electron window, restart app

## Files Referenced
- `backend/services/schwab_client.py` - Schwab API client, semaphore, circuit breaker
- `backend/services/file_watcher.py` - Watchlist fetch from trader app, runners file watcher
- `backend/services/quote_relay.py` - SocketIO relay to trader app for streaming
- `backend/api/routes.py` - WebSocket endpoint `/ws/quotes`, REST endpoints
- `backend/main.py` - Uvicorn server config
- `src/renderer/hooks/useStreamingQuotes.ts` - WebSocket client, candle builder, stale detection
- `src/renderer/store/candleDataStore.ts` - Frontend candle data management
- `src/renderer/components/charts/MultiChartGrid.tsx` - Primary chart rendering, error display
- `src/renderer/components/charts/EnhancedChart.tsx` - Chart creation and data binding
- `src/renderer/utils/debugLog.ts` - Debug logging toggle (`DEBUG_CHARTS`)
- `logs/backend.log` - Backend runtime log
