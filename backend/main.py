"""
Momentum Trader Charting App - Python Backend

Provides:
- Price history from Schwab API
- File watching for watchlist/runners
- WebSocket relay for real-time events
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from api.routes import router
from services.file_watcher import start_file_watchers
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


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8081)
