"""
File watcher for momentum trader data files

Watches:
- data/runners.json (file-based - stable source)

Fetches from API:
- Watchlist from trader app API (http://localhost:8080/api/watchlist)
  This ensures charting app shows exactly what trader app shows.
"""
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import json
import threading
import time as time_module
import httpx
from typing import Optional, Dict, List

# Cached data
_cached_watchlist: Optional[List[Dict]] = None
_cached_runners: Optional[Dict] = None
_cache_lock = threading.Lock()
_observer: Optional[Observer] = None
_trader_api_url: str = "http://localhost:8080"

# Watchlist TTL cache - avoid redundant trader API calls
_watchlist_cache_time: float = 0
_WATCHLIST_CACHE_TTL = 5.0  # seconds - fast enough for live trading

# Reusable httpx client (avoids creating new client per request)
_httpx_client: Optional[httpx.Client] = None


def _get_httpx_client() -> httpx.Client:
    """Get or create the reusable httpx client"""
    global _httpx_client
    if _httpx_client is None:
        _httpx_client = httpx.Client(timeout=5.0)
    return _httpx_client


class DataFileHandler(FileSystemEventHandler):
    """Handle file change events for runners.json"""

    def __init__(self, data_dir: str):
        self.data_dir = Path(data_dir)

    def on_modified(self, event):
        if event.is_directory:
            return

        filename = Path(event.src_path).name

        # Only watch runners.json - watchlist comes from trader API
        if filename == 'runners.json':
            self._reload_runners()

    def _reload_runners(self):
        global _cached_runners
        try:
            runners_path = self.data_dir / 'runners.json'
            if runners_path.exists():
                with open(runners_path) as f:
                    data = json.load(f)
                with _cache_lock:
                    _cached_runners = data
                print("[OK] Runners reloaded")
        except Exception as e:
            print(f"[ERROR] Failed to reload runners: {e}")


def fetch_watchlist_from_trader() -> Optional[List[Dict]]:
    """
    Fetch watchlist directly from trader app API.

    This ensures charting app shows exactly what trader app shows,
    avoiding sync issues with watchlist_state.json (which contains
    all historical stocks, not just currently active ones).
    """
    global _cached_watchlist, _watchlist_cache_time
    try:
        client = _get_httpx_client()
        response = client.get(f"{_trader_api_url}/api/watchlist")
        response.raise_for_status()
        watchlist = response.json()

        with _cache_lock:
            _cached_watchlist = watchlist
            _watchlist_cache_time = time_module.time()

        print(f"[OK] Watchlist fetched from trader API: {len(watchlist)} stocks")
        return watchlist
    except httpx.ConnectError:
        print("[WARNING] Trader app not available - using cached watchlist")
        return None
    except Exception as e:
        print(f"[ERROR] Failed to fetch watchlist from trader API: {e}")
        return None


def start_file_watchers(data_dir: str, trader_api_url: str = "http://localhost:8080"):
    """Start watching data files and set up trader API connection"""
    global _observer, _trader_api_url

    _trader_api_url = trader_api_url

    handler = DataFileHandler(data_dir)

    # Initial load - watchlist from API, runners from file
    fetch_watchlist_from_trader()
    handler._reload_runners()

    # Start observer for runners.json only
    _observer = Observer()
    _observer.schedule(handler, data_dir, recursive=False)
    _observer.start()
    print(f"[OK] File watcher started for: {data_dir}")
    print(f"[OK] Watchlist source: {trader_api_url}/api/watchlist")


def stop_file_watchers():
    """Stop the file watcher"""
    global _observer
    if _observer:
        _observer.stop()
        _observer.join(timeout=5)
        _observer = None
        print("[OK] File watcher stopped")


def get_cached_watchlist(refresh: bool = False) -> Optional[List[Dict]]:
    """
    Get watchlist, optionally refreshing from trader API (SYNC version - for startup only).

    Args:
        refresh: If True, fetch fresh data from trader API (but only if cache is stale)

    WARNING: This is synchronous and will block. Use get_cached_watchlist_async() from async routes.
    """
    if refresh:
        # Only actually fetch if cache is stale (older than TTL)
        if time_module.time() - _watchlist_cache_time > _WATCHLIST_CACHE_TTL:
            fetch_watchlist_from_trader()

    with _cache_lock:
        return _cached_watchlist


async def get_cached_watchlist_async(refresh: bool = False) -> Optional[List[Dict]]:
    """
    Get watchlist, optionally refreshing from trader API (ASYNC version - use from routes).

    Wraps the sync httpx call in asyncio.to_thread() to avoid blocking the event loop.
    Uses wait_for timeout to prevent indefinite blocking if thread pool is saturated.
    """
    import asyncio

    if refresh:
        # Only actually fetch if cache is stale (older than TTL)
        if time_module.time() - _watchlist_cache_time > _WATCHLIST_CACHE_TTL:
            # Run sync httpx call in thread pool to avoid blocking event loop
            # Wrap in wait_for with 10s timeout (5s httpx + 5s buffer for thread acquisition)
            try:
                await asyncio.wait_for(
                    asyncio.to_thread(fetch_watchlist_from_trader),
                    timeout=10.0
                )
            except asyncio.TimeoutError:
                print("[WARNING] Watchlist fetch timed out after 10s - using cached data")

    with _cache_lock:
        return _cached_watchlist


def get_cached_runners() -> Optional[Dict]:
    with _cache_lock:
        return _cached_runners
