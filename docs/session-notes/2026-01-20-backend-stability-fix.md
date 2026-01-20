# Session Notes: Backend Stability Fix (2026-01-20)

## Problem
Charts were going blank after clicking through approximately 25 stocks. The backend (uvicorn + FastAPI) would stop accepting new connections, causing frontend requests to timeout.

## Root Cause
Uvicorn on Windows has socket handling issues that cause it to stop accepting connections after ~25 requests when combined with certain async HTTP client configurations.

## Solution

### 1. Switched HTTP Client: aiohttp → httpx
- aiohttp with Hypercorn or uvicorn on Windows caused requests to hang
- httpx works reliably with uvicorn on Windows
- Using shared httpx client with connection pooling

**File:** `backend/services/schwab_client.py`
```python
_shared_client = httpx.AsyncClient(
    timeout=httpx.Timeout(10.0, connect=5.0),
    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10)
)
```

### 2. Tuned Uvicorn Settings
**File:** `backend/main.py`
```python
uvicorn.run(
    "main:app",
    host="0.0.0.0",
    port=8081,
    log_level="info",
    timeout_keep_alive=5,      # Short keep-alive releases connections quickly
    limit_concurrency=20,      # Lower limit prevents connection buildup
    limit_max_requests=500,    # Auto-restart after many requests
    access_log=False,          # Reduces logging overhead
)
```

### 3. Fixed Process Cleanup on Exit
- Added `taskkill /F /T /PID` on Windows to kill entire process tree
- Added shutdown signal on `window-all-closed` event (not just Exit button)

**File:** `launcher.py`
```python
subprocess.run(
    ['taskkill', '/F', '/T', '/PID', str(self.backend_process.pid)],
    capture_output=True,
    creationflags=subprocess.CREATE_NO_WINDOW
)
```

**File:** `src/main/main.ts`
```typescript
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Signal backend to shutdown before quitting
    const http = require('http')
    const req = http.request({
      hostname: 'localhost',
      port: 8081,
      path: '/api/shutdown',
      method: 'POST',
    })
    req.on('error', () => {})
    req.end()
    app.quit()
  }
})
```

## Testing Results
- Before fix: Backend stopped accepting connections after ~25 requests
- After fix: Successfully handled 95+ requests (5 cycles through 14 stocks)

## Files Modified
- `backend/main.py` - Uvicorn configuration
- `backend/services/schwab_client.py` - Switched to httpx, added connection pooling
- `backend/api/routes.py` - Removed `request.is_disconnected()` check
- `launcher.py` - Fixed process cleanup with taskkill
- `src/main/main.ts` - Added shutdown signal on window close

## Key Learnings
1. aiohttp requires ProactorEventLoop on Windows but has issues with uvicorn
2. httpx is more compatible with uvicorn on Windows
3. Short keep-alive timeout helps release connections quickly
4. Lower concurrency limits prevent connection pool exhaustion
5. Process tree killing is essential on Windows for clean shutdown
