"""
Momentum Trader Charting App - Python Backend

Provides:
- Price history from Schwab API
- File watching for watchlist/runners
- WebSocket relay for real-time events
"""
import sys
import asyncio
import platform

# Fix for Windows asyncio ProactorEventLoop crash (AssertionError: _sockets is not None)
# SelectorEventLoop is more stable for long-running HTTP servers on Windows
# See: https://github.com/python/cpython/issues/78014
if platform.system() == 'Windows':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from api.routes import router, get_schwab_client, set_quote_relay
from services.file_watcher import start_file_watchers, stop_file_watchers
from services.schwab_client import close_shared_client
from services.quote_relay import QuoteRelay
from core.config import load_config

app = FastAPI(title="Momentum Trader Charts Backend")

# CORS for Electron frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


quote_relay = None


@app.on_event("startup")
async def startup_event():
    """Initialize file watchers, connections, and quote relay"""
    global quote_relay
    config = load_config()
    data_dir = config['data_sources']['momentum_trader']['data_dir']
    trader_api_url = config['data_sources']['momentum_trader'].get('api_url', 'http://localhost:8080')

    start_file_watchers(data_dir, trader_api_url)

    # Start quote relay to trader app for real-time streaming
    streaming_config = config.get('streaming', {})
    if streaming_config.get('enabled', True):
        quote_relay = QuoteRelay(trader_api_url)
        set_quote_relay(quote_relay)
        quote_relay.start()
        print("[OK] Quote relay started")

    print("[OK] Charting backend started on port 8081")


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up file watchers, Schwab client, and quote relay on shutdown"""
    stop_file_watchers()
    if quote_relay:
        quote_relay.stop()
    # Close the shared httpx client
    await close_shared_client()
    print("[OK] Charting backend shutdown complete")


@app.get("/api/health")
async def health_check():
    """Health check endpoint for launcher"""
    return {"status": "ok"}


@app.post("/api/shutdown")
async def shutdown():
    """Graceful shutdown endpoint"""
    import sys

    async def do_shutdown():
        await asyncio.sleep(0.5)
        # Use sys.exit instead of signal on Windows for cleaner shutdown
        sys.exit(0)

    # Schedule shutdown as async task
    asyncio.create_task(do_shutdown())
    return {"status": "shutting_down"}


if __name__ == "__main__":
    # Run uvicorn with specific Windows-compatible settings
    # Using the string form ("main:app") allows better process management
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8081,
        log_level="info",
        timeout_keep_alive=5,  # Short keep-alive to release connections quickly
        limit_concurrency=20,  # Lower limit to prevent connection buildup
        access_log=False,  # Reduce logging overhead
        # Note: limit_max_requests removed - causes race condition on Windows with ProactorEventLoop
        # Note: Using WindowsSelectorEventLoopPolicy set at module level for stability
    )
