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

### 10. Thread Pool Exhaustion from LLM Validations (FIXED 2026-01-28)
- **Trigger:** Multiple concurrent LLM validation requests consuming all threads in the default executor pool
- **Impact:** Backend hangs. `asyncio.to_thread()` calls block waiting for a thread, but all threads are busy with 60-second LLM requests. Even simple operations like watchlist polling can't get a thread.
- **Observed:** Log shows watchlist polls stopping, but backend port is still listening. Different from #9 because the sync watchlist fix was applied, but hangs continued.
- **Root cause chain:**
  1. `asyncio.to_thread()` uses a shared default executor (ThreadPoolExecutor)
  2. Default pool size on Windows is `min(32, cpu_count + 4)` = 20 threads on 16-core machine
  3. LLM validation calls `requests.post()` with 60-second timeout, blocking a thread for up to 60s
  4. Top 3 validation (3 symbols × multiple `to_thread` calls each) can consume 9+ threads
  5. Retries on JSON failures multiply the thread usage
  6. Once pool exhausted, even `asyncio.to_thread(fetch_watchlist_from_trader)` blocks waiting for a thread
  7. All event loop activity appears to stop
- **Evidence in logs:** Last entries show successful watchlist fetches, then complete silence. No "Starting request" incomplete. Backend health endpoint still responds but slowly.
- **Files:**
  - `backend/main.py` - Thread pool configuration
  - `backend/services/llm_validator.py` - LLM calls using `asyncio.to_thread()`
  - `backend/services/file_watcher.py` - Watchlist fetch using `asyncio.to_thread()`
  - `backend/api/routes.py` - `/validate/status` using `asyncio.to_thread()`
- **Fix (multi-layer):**
  1. **Increased thread pool size** to 50 workers in `main.py`:
     ```python
     _thread_pool = ThreadPoolExecutor(max_workers=50, thread_name_prefix="asyncio_pool")
     loop.set_default_executor(_thread_pool)
     ```
  2. **Added timeout wrappers** around all `asyncio.to_thread()` calls to prevent indefinite blocking:
     - `file_watcher.py`: 10s timeout for watchlist fetch
     - `llm_validator.py`: 10s for context building, 5s for availability check, 75s for LLM call
     - `routes.py`: 5s for `/validate/status` LLM availability check
  3. **Graceful fallback** on timeout - returns cached/fallback data instead of blocking
- **Verification:** Backend should remain responsive even under heavy LLM validation load. Timeouts should trigger and log warnings instead of silent hangs.

### 11. Frontend Freeze / Blank Screen (FIXED 2026-01-28)
- **Trigger:** Clicking on stocks with sparse data (8-24 candles) during pre-market. Uncaught exceptions in chart operations crash the React component tree.
- **Impact:** Chart screen goes blank. Backend is still responding to requests, but frontend React tree is broken.
- **Observed:** Backend log shows candle requests continuing (30s refresh interval), but watchlist polls stop (should be every 5s). Backend health endpoint responds immediately.
- **Root cause:** Multiple crash points identified:
  1. Indicator calculations (VWAP, EMA) on sparse data without sufficient guards
  2. Chart library operations (setData, update, createPriceLine) throwing exceptions
  3. No error boundaries to catch and recover from React rendering errors
  4. **lightweight-charts "Cannot update oldest data" error** - incremental `update()` called with timestamp older than chart's last data point (happens when cache refreshes with reordered data)
- **Evidence:** Backend log shows candle requests continuing at 30s intervals for the last selected symbol, but no new symbol selections and no watchlist polls. Console shows `Error: Cannot update oldest data, last time=[object Object], new time=[object Object]`
- **Files:**
  - `src/renderer/components/charts/EnhancedChart.tsx` - Chart creation and data binding
  - `src/renderer/components/charts/MultiChartGrid.tsx` - Primary chart rendering
  - `src/renderer/components/ErrorBoundary.tsx` - New error boundary component
- **Fix (multi-layer):**
  1. **Defensive indicator calculations:** Added try-catch and minimum candle checks around VWAP, EMA9, EMA20, and pattern detection
  2. **Error handling in chart effects:** Wrapped all three useEffect hooks (chart creation, data updates, price lines) in try-catch blocks
  3. **React Error Boundary:** Added ErrorBoundary component wrapping EnhancedChart to catch and display errors without crashing the entire app
  4. **Graceful degradation:** On error, shows error message with "Try Again" button instead of blank screen
  5. **Timestamp tracking for incremental updates:** Track `lastTime` in addition to count/symbol. Only use `update()` when new candle time >= last known time; otherwise fall back to full `setData()`. Reset tracking on error to force clean reload.
- **Verification:** Click on stocks with sparse data (e.g., IMSRW with 24 candles) → should render chart or show error message, never crash to blank screen. Console should show "Full setData" instead of crashing on timestamp mismatch.

### 12. Sync httpx Client in file_watcher.py Causing Hangs (FIXED 2026-01-28)
- **Trigger:** Normal operation - watchlist refresh from trader app API (called every 5s by frontend)
- **Impact:** Backend becomes completely unresponsive. All HTTP endpoints and WebSocket connections stop responding.
- **Observed:** Backend port (8081) is still listening (PID active), but curl requests hang. Log file shows last entries ~5 minutes before hang, then silence.
- **Root cause:** Even after adding `asyncio.to_thread()` wrapper in `get_cached_watchlist_async()`, the underlying httpx.Client was **module-level and reused** across calls. The sync httpx.Client:
  1. Had no connection limits configured (could exhaust connections)
  2. The 5.0s timeout only applies to individual request operations, not connection establishment or SSL handshakes
  3. If trader app became slow or hung, the sync client could get stuck in a state where the connection pool is waiting
  4. Even wrapped in `asyncio.to_thread()`, this consumed thread pool threads indefinitely
- **Evidence in logs:** Last entries show normal operation, then complete silence. No incomplete "Starting request" entries. Different from #10 (thread pool exhaustion) because the hang persists even with 50-thread pool.
- **Files:**
  - `backend/services/file_watcher.py` - Sync httpx.Client replaced with httpx.AsyncClient
  - `backend/main.py` - Added cleanup for async client on shutdown
- **Fix:**
  1. **Converted to native async httpx.AsyncClient** with proper limits:
     ```python
     _async_httpx_client = httpx.AsyncClient(
         timeout=httpx.Timeout(5.0, connect=3.0),
         limits=httpx.Limits(max_connections=5, max_keepalive_connections=2)
     )
     ```
  2. **Native async fetch** in `fetch_watchlist_from_trader_async()` - no thread pool needed
  3. **Hard timeout wrapper** using `asyncio.wait_for()` around the request
  4. **Startup sync client** for initial load is now a one-off `with httpx.Client(...) as client:` context manager that closes after use
  5. **Proper cleanup** on shutdown via `close_async_client()` function
- **Why native async is better than to_thread():**
  - No thread pool consumption
  - No risk of thread pool exhaustion
  - Proper async timeout handling (asyncio.wait_for works correctly)
  - Connection pool managed by asyncio event loop, not blocking threads
- **Verification:** Backend should remain responsive even if trader app is slow or hung. Watchlist fetches will timeout after 5s and return cached data instead of hanging indefinitely.

### 13. Hung Backend Not Killed on App Exit (FIXED 2026-01-28)
- **Trigger:** Backend becomes unresponsive (hung), user closes app
- **Impact:** Old hung backend process persists, blocks port 8081. Next app launch either fails or connects to the zombie process.
- **Observed:** After restart, same PID still listening on 8081. Backend log shows no new entries. Health check hangs.
- **Root cause:** Launcher cleanup relied on `/api/shutdown` API call (times out if backend hung) and process PID kill (but uvicorn may have spawned a child with different PID).
- **Files:** `launcher.py` - cleanup() and _kill_port_holders()
- **Fix:**
  1. **Port-first cleanup:** Kill processes by port FIRST, before trying graceful shutdown or PID-based kill
  2. **Double-pass cleanup:** Run port cleanup at start and end of cleanup routine
  3. **Better logging:** Show which PIDs are being killed and success/failure
- **Verification:** When backend is hung and app is closed, the next launch should start fresh (new PID on 8081, responsive health check).

### 14. asyncio.Lock Deadlock in httpx Client Management (FIXED 2026-01-29)
- **Trigger:** Normal operation under load - multiple concurrent API requests
- **Impact:** Backend becomes completely unresponsive. Massive CLOSE_WAIT connection buildup (20+ connections). Event loop frozen (no heartbeat logged).
- **Observed:** Backend port still LISTENING, but curl hangs. Log stops mid-operation with no errors. `netstat` shows many CLOSE_WAIT connections from frontend.
- **Root cause:** Lazy `asyncio.Lock()` initialization combined with lock contention:
  1. `_get_lock()` created lock lazily on first access
  2. Lock created outside proper event loop context on Windows
  3. If one coroutine held lock while httpx had internal issues, all other coroutines queued up
  4. Potential deadlock if httpx internal state became corrupted while holding lock
- **Files:**
  - `backend/services/schwab_client.py` - Removed `_client_lock` and `_get_lock()`
  - `backend/services/file_watcher.py` - Removed `_async_client_lock` and `_get_async_lock()`
- **Fix:**
  1. **Remove asyncio.Lock entirely** from client management - not needed for single-assignment patterns
  2. **Disable HTTP/2** in httpx - HTTP/2 multiplexing can cause issues on Windows long-running connections
  3. **Lock-free pattern:** Simple check-then-set (worst case: create two clients, one gets GC'd)
  4. **Enhanced heartbeat:** Log pending task count to detect task buildup
- **Verification:** Backend should remain responsive under load. No CLOSE_WAIT buildup. Heartbeat continues logging every 30s.

### 15. httpx Connection Pool Corruption (FIXED 2026-01-29)
- **Trigger:** Normal operation over time - shared httpx client with connection pool
- **Impact:** Backend becomes completely unresponsive. Same symptoms as #14 (CLOSE_WAIT buildup, log stops, curl hangs).
- **Observed:** Despite removing asyncio.Lock (#14), backend still hangs after ~5-10 minutes of operation. Log shows normal activity then silence. ESTABLISHED connection to Schwab API (23.48.203.110:443) remains open.
- **Root cause hypothesis:** httpx's connection pool can get into a corrupted state on Windows:
  1. HTTP/1.1 keep-alive connections can become stale
  2. SSL/TLS handshake timeouts may not be properly handled
  3. Corrupted connection stays in pool, blocking future requests
  4. All coroutines waiting for healthy connection freeze the event loop
- **Files:**
  - `backend/services/schwab_client.py` - `make_api_request()` now uses fresh client per request
  - `backend/services/file_watcher.py` - `fetch_watchlist_from_trader_async()` now uses fresh client per request
- **Fix:**
  1. **Abandon shared httpx client entirely** - no more global `_shared_client` or `_async_httpx_client`
  2. **Fresh client per request:** `async with httpx.AsyncClient(...) as client:` context manager pattern
  3. **Automatic cleanup:** Client closes automatically when context manager exits
  4. **No connection pool = no pool corruption possible**
- **Trade-off:** ~50ms higher latency per request (TLS handshake overhead), but eliminates hang risk entirely.
- **Code pattern:**
  ```python
  # Before (shared client with pool - can corrupt):
  client = await _get_client()  # may return corrupted connection
  response = await client.get(url)

  # After (fresh client per request - no pool):
  async with httpx.AsyncClient(timeout=..., http2=False) as client:
      response = await client.get(url)
      # client closed automatically on exit
  ```
- **Verification:** Backend should remain responsive indefinitely. No connection pool state to corrupt. Each request is fully independent.

### 16. threading.Lock Blocking Async Event Loop (FIXED 2026-01-29)
- **Trigger:** Normal operation - file watcher thread and async routes both accessing cached data
- **Impact:** Backend becomes completely unresponsive. Event loop frozen (no heartbeat logged). Same symptoms as #14 and #15.
- **Observed:** Backend port still LISTENING, curl hangs. Log shows last activity then complete silence. Heartbeat stops. CLOSE_WAIT connection buildup. SYN_SENT to port 8080 (trader app) stuck.
- **Root cause:** `threading.Lock` (`_cache_lock`) used in async code paths:
  1. `_cache_lock = threading.Lock()` was a module-level threading lock
  2. File watcher thread (synchronous) acquired lock during `_reload_runners()`
  3. Async routes called `get_cached_watchlist_async()` or `get_cached_runners()` which tried to acquire the same lock
  4. **Critical:** `threading.Lock.acquire()` is a blocking call - blocks the **entire async event loop**, not just the current coroutine
  5. If file watcher held lock while doing I/O, all async operations froze
  6. Heartbeat coroutine also frozen, so no heartbeat logged
- **Why this is different from asyncio.Lock:**
  - `asyncio.Lock` is async-aware - it suspends the coroutine and lets other coroutines run
  - `threading.Lock` is thread-aware - it blocks the calling thread entirely
  - In async code, the calling thread IS the event loop thread - blocking it freezes everything
- **Files:**
  - `backend/services/file_watcher.py` - Removed `_cache_lock` from all async paths
- **Fix:**
  1. **Remove threading.Lock from all async code paths** - reads don't need locking
  2. **Python GIL guarantees atomic reads:** Simple variable reads like `return _cached_watchlist` are thread-safe due to GIL
  3. **Keep lock only for file watcher thread writes:** File watcher still uses lock internally for writes to prevent interleaved writes
  4. **Added heartbeat file logging:** Heartbeat now logs to `backend.log` in addition to console for post-mortem analysis
- **Key insight:** Never mix `threading.Lock` with async code. If you need locking in async code, use `asyncio.Lock`. If you need to share data between sync threads and async code, either:
  - Use lock-free patterns (atomic assignments)
  - Use `asyncio.run_coroutine_threadsafe()` to run async code from threads
  - Use `janus` library for thread-safe async queues
- **Code pattern:**
  ```python
  # WRONG - blocks event loop:
  _cache_lock = threading.Lock()
  async def get_data():
      with _cache_lock:  # <- BLOCKS ENTIRE EVENT LOOP
          return _cached_data

  # CORRECT - lock-free read (GIL makes this safe):
  async def get_data():
      return _cached_data  # Simple read is atomic in Python
  ```
- **Verification:** Backend should remain responsive. Heartbeat continues logging every 30s. No event loop blocking when file watcher is busy.

### 17. IPv6 Connection Hang on Windows (FIXED 2026-01-29)
- **Trigger:** Any connection to `localhost` when target only binds IPv4
- **Impact:** Backend becomes completely unresponsive. Same symptoms as all previous hangs.
- **Observed:** netstat shows `SYN_SENT` to `[::1]:8080` (IPv6) stuck. curl to `localhost:8080` works fine (uses IPv4). Backend log stops with no errors.
- **Root cause:** httpx/socket.io use `localhost` which resolves to both `127.0.0.1` (IPv4) and `::1` (IPv6):
  1. Python's socket implementation prefers IPv6 when available
  2. If target service only binds to `0.0.0.0` (IPv4), IPv6 connections hang
  3. SYN packet sent to `[::1]:port` never gets RST or SYN-ACK (no listener)
  4. TCP keeps retrying SYN for minutes before giving up
  5. httpx's connect timeout (3s) may not fire - it's measuring from connection start, but the socket is stuck in kernel-level TCP handshake
  6. Event loop blocks waiting for the connection to complete
- **Evidence in netstat:**
  ```
  TCP    [::1]:54022            [::1]:8080             SYN_SENT        <backend_pid>
  ```
  While `curl http://localhost:8080` works (because curl tries IPv4 first on Windows).
- **Files:**
  - `backend/services/file_watcher.py` - Trader API calls
  - `backend/services/quote_relay.py` - SocketIO connection
  - `backend/services/llm_validator.py` - Ollama API calls
- **Fix:** Replace all `localhost` with `127.0.0.1` to force IPv4:
  ```python
  api_url = _trader_api_url.replace("localhost", "127.0.0.1")
  ```
- **Why IPv4 is safer on Windows:**
  - Most local services bind to `0.0.0.0` (IPv4 only)
  - IPv6 localhost (`::1`) requires explicit dual-stack binding
  - Windows IPv6 stack can have inconsistent behavior
  - Forcing IPv4 eliminates the resolution race condition
- **Alternative fixes (not implemented):**
  - Bind all services to `::` (dual-stack) - requires changes to trader app, Ollama
  - Use `socket.setdefaulttimeout()` - affects all sockets globally
  - Use `socket.AF_INET` explicitly in httpx - not easily configurable
- **Verification:** Backend should remain responsive. No `SYN_SENT` connections in netstat. All localhost URLs should show `127.0.0.1` in logs.

### 18. print() Blocking Async Event Loop on Windows (FIXED 2026-01-30)
- **Trigger:** Normal operation - any `print()` call from async context

### 19. httpx.AsyncClient SSL/TLS Blocking Event Loop (FIXED 2026-02-02)
- **Trigger:** Any Schwab API request on Windows
- **Impact:** Backend becomes completely unresponsive. Event loop frozen despite `asyncio.wait_for()` timeout wrappers.
- **Observed:** Log shows "Starting request to https://api.schwabapi.com/..." then silence. The 15s timeout never fires. Heartbeat stops. Backend port still LISTENING.
- **Root cause:** httpx.AsyncClient can block the asyncio event loop during SSL/TLS handshake operations on Windows:
  1. SSL/TLS operations in httpx.AsyncClient on Windows can perform blocking I/O
  2. `asyncio.wait_for()` timeouts cannot fire if the event loop itself is blocked
  3. The timeout wrapper appears to work (code looks correct) but the coroutine never yields control
  4. This is a known issue with Windows + asyncio + SSL in certain scenarios
- **Why previous fixes didn't work:**
  - Fresh client per request (#15) - still uses AsyncClient with SSL blocking
  - asyncio.wait_for() wrapper (#8) - can't fire if event loop is blocked
  - Larger thread pool (#10) - doesn't help because blocking happens in main event loop, not thread pool
- **Files:**
  - `backend/services/schwab_client.py` - `make_api_request()` and `_sync_request()`
- **Fix (nuclear option):** Use synchronous `httpx.Client` inside `asyncio.to_thread()`:
  ```python
  def _sync_request(url: str, params: Dict, headers: Dict) -> httpx.Response:
      """Synchronous request - run in thread pool to prevent blocking event loop."""
      with httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0), http2=False) as client:
          response = client.get(url, params=params, headers=headers)
          return response

  async def make_api_request(url: str, params: Dict, headers: Dict):
      response = await asyncio.wait_for(
          asyncio.to_thread(_sync_request, url, params, headers),
          timeout=15.0  # Hard timeout on the thread
      )
      return response
  ```
- **Why this works:**
  - `asyncio.to_thread()` runs the sync code in the default thread pool executor
  - SSL/TLS operations happen in a worker thread, not the event loop thread
  - The event loop remains free to run other coroutines and process timeouts
  - `asyncio.wait_for()` can now actually fire because the event loop isn't blocked
  - Thread pool has 50 workers (configured in main.py), more than enough for our max 5 concurrent Schwab requests
- **Trade-off:** Uses thread pool threads for HTTP requests (less efficient than pure async), but guarantees the event loop can never be blocked by SSL operations.
- **Verification:** Backend should remain responsive under all conditions. Timeouts should fire correctly. Heartbeat continues logging every 30s.

### 20. Watchlist Request Pileup (FIXED 2026-02-02)
- **Trigger:** Backend slow or unresponsive, frontend polling every 5 seconds
- **Impact:** Hundreds of concurrent requests pile up. Console shows 251+ failed watchlist requests.
- **Observed:** `watchlistStore.ts:62 [Watchlist] Primary fetch failed: timeout of 10000ms exceeded` repeated 251+ times in quick succession.
- **Root cause:** No request deduplication in watchlist polling:
  1. Watchlist polls every 5 seconds with 10 second axios timeout
  2. When backend is slow, Request 1 starts at t=0
  3. Request 2 starts at t=5s while Request 1 still pending
  4. Request 3 starts at t=10s while 1 and 2 still pending
  5. Requests pile up exponentially
  6. Each timed-out request triggers a fallback request to port 8080, doubling the load
  7. Eventually hundreds of requests are in flight simultaneously
- **Files:**
  - `src/renderer/store/watchlistStore.ts` - Added CancelToken for request deduplication
- **Fix:** Cancel any pending request before starting a new one:
  ```typescript
  let pendingRequest: CancelTokenSource | null = null

  fetchWatchlist: async () => {
    // Cancel any pending request to prevent pileup
    if (pendingRequest) {
      pendingRequest.cancel('New request supersedes')
      pendingRequest = null
    }

    const cancelSource = axios.CancelToken.source()
    pendingRequest = cancelSource

    try {
      const response = await apiClient.get(url, { cancelToken: cancelSource.token })
      pendingRequest = null
      // ... handle response
    } catch (err) {
      pendingRequest = null
      if (axios.isCancel(err)) return  // Ignore cancelled requests
      // ... error handling
    }
  }
  ```
- **Why this helps:** Only one request can be in-flight at a time. When a new poll starts, it cancels any pending request. This prevents exponential request buildup.
- **Verification:** When backend is slow, console should show at most 1 timeout message per 5-second interval, not hundreds.

### 21. Duplicate HistoricalPatternMatch Analysis (FIXED 2026-02-02)
- **Trigger:** Normal operation - switching between stocks, watchlist/runner updates
- **Impact:** Every pattern analysis runs twice. Console shows duplicate log entries for each symbol.
- **Observed:**
  ```
  [HistoricalPatternMatch] Analyzing setup: PSIG against 28 trades
  [HistoricalPatternMatch] Analysis result: 3 similar trades found
  [HistoricalPatternMatch] Analyzing setup: PSIG against 28 trades  <-- duplicate
  [HistoricalPatternMatch] Analysis result: 3 similar trades found  <-- duplicate
  ```
- **Root cause:** useMemo dependency array included entire arrays instead of specific values:
  ```typescript
  // OLD - triggers on any array change
  const setupData = useMemo(() => { ... }, [selectedSymbol, runners, watchlist])
  ```
  When `runners` or `watchlist` arrays update (even if the selected symbol's data is unchanged), React creates new object references, triggering the downstream `analysis` useMemo to recompute.
- **Files:**
  - `src/renderer/components/panels/HistoricalPatternMatch.tsx` - useMemo dependencies
- **Fix:** Extract specific item first, then depend only on scalar field values:
  ```typescript
  const runner = runners.find(r => r.symbol === selectedSymbol)
  const watchItem = watchlist.find(w => w.symbol === selectedSymbol)

  const setupData = useMemo(() => { ... }, [
    selectedSymbol,
    runner?.symbol,
    runner?.current_price,
    runner?.original_gap_percent,
    runner?.original_catalyst,
    watchItem?.symbol,
    watchItem?.price,
    // ... other scalar values
  ])
  ```
- **Why this helps:** The useMemo only recomputes when the actual selected item's values change, not when unrelated items in the arrays change.
- **Verification:** Console should show exactly one analysis log entry per symbol selection, not duplicates.
- **Impact:** Backend becomes completely unresponsive. Event loop frozen (no heartbeat logged). Same symptoms as all previous hangs.
- **Observed:** Log shows last heartbeat, then silence. Backend port LISTENING, CLOSE_WAIT buildup. No errors.
- **Root cause:** `print()` to stdout can block the entire asyncio event loop on Windows:
  1. All `print()` calls go to stdout, which is line-buffered by default
  2. If console buffer is full, minimized, or in specific states, `print()` blocks waiting for buffer flush
  3. The heartbeat loop was calling `print(msg)` every 30 seconds
  4. When stdout blocked, the heartbeat task blocked the event loop
  5. All other async operations froze (no errors, just silence)
  6. Even `_logger.info()` in the same function couldn't execute because the event loop was stuck
- **Why this is subtle:**
  - `print()` normally returns immediately - you never expect it to block
  - On Linux, stdout buffering is more aggressive and rarely blocks
  - On Windows with Electron/console, the console can enter states where writes block
  - The hang is non-deterministic - depends on console state
- **Files:**
  - `backend/main.py` - Heartbeat loop, startup messages
  - `backend/services/file_watcher.py` - Status messages
  - `backend/services/quote_relay.py` - Connection status messages
  - `backend/services/schwab_client.py` - Configuration messages
- **Fix:** Replace ALL `print()` calls with `logging` module:
  ```python
  # Before (can block event loop):
  print(f"[HEARTBEAT] #{count} - Event loop alive, {pending} tasks")

  # After (writes to file, never blocks):
  _logger.info(f"[HEARTBEAT] #{count} - Event loop alive, {pending} tasks")
  ```
- **Why logging is safe:**
  - Logging to file is buffered differently than console stdout
  - File I/O with logging module handles blocking internally
  - Even if file write blocks, it's in a different path than console output
  - Can configure async logging handlers if needed (not necessary for our case)
- **Verification:** No `print()` calls remain in backend Python files (except comments). All output goes to `logs/backend.log`.

## Debugging Checklist (Quick Reference)

1. **Is backend port open?** `netstat -ano | findstr :8081 | findstr LISTENING`
2. **Is backend responsive?** `curl http://localhost:8081/api/candles/AAPL?timeframe=1m`
3. **What's in the log?** Check `logs/backend.log` tail for recent entries
4. **Frontend console?** Set `DEBUG_CHARTS = true` in `src/renderer/utils/debugLog.ts` and check browser DevTools
5. **Nuclear option:** Kill backend process, Ctrl+R the Electron window, restart app

## Files Referenced
- `launcher.py` - Cross-platform launcher with process cleanup
- `backend/services/schwab_client.py` - Schwab API client, semaphore, circuit breaker
- `backend/services/file_watcher.py` - Watchlist fetch from trader app, runners file watcher
- `backend/services/quote_relay.py` - SocketIO relay to trader app for streaming
- `backend/api/routes.py` - WebSocket endpoint `/ws/quotes`, REST endpoints
- `backend/main.py` - Uvicorn server config, thread pool configuration
- `backend/services/llm_validator.py` - LLM validation with timeout wrappers
- `src/main/main.ts` - Electron main process, shutdown handling
- `src/renderer/hooks/useStreamingQuotes.ts` - WebSocket client, candle builder, stale detection
- `src/renderer/store/candleDataStore.ts` - Frontend candle data management
- `src/renderer/store/watchlistStore.ts` - Watchlist polling with axios timeout
- `src/renderer/components/charts/MultiChartGrid.tsx` - Primary chart rendering, error boundary wrapper
- `src/renderer/components/charts/EnhancedChart.tsx` - Chart creation and data binding with error handling
- `src/renderer/components/ErrorBoundary.tsx` - React error boundary for crash recovery
- `src/renderer/utils/debugLog.ts` - Debug logging toggle (`DEBUG_CHARTS`)
- `logs/backend.log` - Backend runtime log
- `logs/launcher.log` - Launcher log (useful for debugging startup/shutdown)
