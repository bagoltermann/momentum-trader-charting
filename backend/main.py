"""
Momentum Trader Charting App - Python Backend

Provides:
- Price history from Schwab API
- File watching for watchlist/runners
- WebSocket relay for real-time events
"""
import sys
import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from api.routes import router, get_schwab_client
from services.file_watcher import start_file_watchers, stop_file_watchers
from services.schwab_client import close_shared_client
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


@app.on_event("startup")
async def startup_event():
    """Initialize file watchers and connections"""
    config = load_config()
    start_file_watchers(config['data_sources']['momentum_trader']['data_dir'])
    print("[OK] Charting backend started on port 8081")


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up file watchers and Schwab client on shutdown"""
    stop_file_watchers()
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
        limit_max_requests=500,  # Restart after this many requests
        access_log=False,  # Reduce logging overhead
    )
