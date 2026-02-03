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
import threading
import time as time_module
from concurrent.futures import ThreadPoolExecutor

# Fix for Windows asyncio ProactorEventLoop crash (AssertionError: _sockets is not None)
# SelectorEventLoop is more stable for long-running HTTP servers on Windows
# See: https://github.com/python/cpython/issues/78014
if platform.system() == 'Windows':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# Increase default thread pool size to prevent exhaustion from concurrent LLM validations
# Default is min(32, cpu_count + 4) = 20 on 16-core machine
# LLM calls can block for up to 60s, so we need more headroom
# See: https://docs.python.org/3/library/asyncio-eventloop.html#asyncio.loop.set_default_executor
_thread_pool = ThreadPoolExecutor(max_workers=50, thread_name_prefix="asyncio_pool")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import logging
from api.routes import router, get_schwab_client, set_quote_relay
from services.file_watcher import start_file_watchers, stop_file_watchers, close_async_client
from services.schwab_client import close_shared_client
from services.quote_relay import QuoteRelay
from core.config import load_config

_logger = logging.getLogger('main')

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
_heartbeat_count = 0
_last_heartbeat_time = 0.0  # Updated by async heartbeat, checked by watchdog thread


def _watchdog_thread():
    """
    Independent thread that detects event loop freezes.

    The async heartbeat runs ON the event loop, so it can't detect when the
    event loop itself is frozen. This thread runs independently and logs a
    warning if the heartbeat hasn't fired within the expected interval.
    """
    import time
    _wd_logger = logging.getLogger('watchdog')
    global _last_heartbeat_time
    _last_heartbeat_time = time.time()  # Initialize

    while True:
        time.sleep(45)  # Check every 45s (heartbeat is 30s)
        elapsed = time.time() - _last_heartbeat_time
        if elapsed > 90:  # 3 missed heartbeats = definitely frozen
            _wd_logger.error(
                f"[WATCHDOG] Event loop appears FROZEN - no heartbeat for {elapsed:.0f}s. "
                f"Last heartbeat was {elapsed:.0f}s ago."
            )
        elif elapsed > 60:  # 2 missed heartbeats = warning
            _wd_logger.warning(
                f"[WATCHDOG] Event loop may be stalled - no heartbeat for {elapsed:.0f}s"
            )


async def _heartbeat_loop():
    """Log heartbeat every 30s to detect event loop blocking"""
    global _heartbeat_count, _last_heartbeat_time
    _hb_logger = logging.getLogger('heartbeat')
    while True:
        await asyncio.sleep(30)
        _heartbeat_count += 1
        _last_heartbeat_time = time_module.time()
        # Count pending tasks to detect task buildup
        all_tasks = asyncio.all_tasks()
        pending = len([t for t in all_tasks if not t.done()])
        # NOTE: Using logger only, not print() - print can block event loop on Windows
        _hb_logger.info(f"[HEARTBEAT] #{_heartbeat_count} - Event loop alive, {pending} tasks")


@app.on_event("startup")
async def startup_event():
    """Initialize file watchers, connections, and quote relay"""
    global quote_relay

    _logger.info("[STARTUP] Beginning startup sequence...")

    # Set larger thread pool as default executor to prevent exhaustion
    # LLM validations use asyncio.to_thread() with 60s timeouts - can saturate default pool
    loop = asyncio.get_event_loop()
    loop.set_default_executor(_thread_pool)
    _logger.info("[OK] Thread pool configured: 50 workers")
    _logger.info(f"[STARTUP] Event loop: {type(loop).__name__}")

    _logger.info("[STARTUP] Loading config...")
    config = load_config()
    data_dir = config['data_sources']['momentum_trader']['data_dir']
    trader_api_url = config['data_sources']['momentum_trader'].get('api_url', 'http://localhost:8080')
    _logger.info(f"[STARTUP] Config loaded: data_dir={data_dir}, trader_api_url={trader_api_url}")

    _logger.info("[STARTUP] Starting file watchers...")
    start_file_watchers(data_dir, trader_api_url)
    _logger.info("[STARTUP] File watchers started")

    # Start quote relay to trader app for real-time streaming
    streaming_config = config.get('streaming', {})
    _logger.info(f"[STARTUP] Starting quote relay (enabled={streaming_config.get('enabled', True)})...")
    if streaming_config.get('enabled', True):
        quote_relay = QuoteRelay(trader_api_url)
        set_quote_relay(quote_relay)
        quote_relay.start()
        _logger.info("[OK] Quote relay started")

    _logger.info("[OK] Charting backend started on port 8081")
    _logger.info("[STARTUP] Startup sequence complete")

    # Start heartbeat task to detect event loop blocking
    asyncio.create_task(_heartbeat_loop())

    # Start watchdog thread - independent of event loop, detects freezes
    wd_thread = threading.Thread(target=_watchdog_thread, daemon=True, name="Watchdog")
    wd_thread.start()
    _logger.info("[OK] Watchdog thread started")


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up file watchers, Schwab client, and quote relay on shutdown"""
    stop_file_watchers()
    if quote_relay:
        quote_relay.stop()
    # Close httpx clients
    await close_shared_client()
    await close_async_client()
    # Shutdown thread pool gracefully
    _thread_pool.shutdown(wait=False)
    _logger.info("[OK] Charting backend shutdown complete")


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
