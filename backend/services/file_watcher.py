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
import asyncio
import logging
from typing import Optional, Dict, List

_logger = logging.getLogger('file_watcher')

# Cached data
_cached_watchlist: Optional[List[Dict]] = None
_cached_runners: Optional[Dict] = None
_cache_lock = threading.Lock()
_observer: Optional[Observer] = None
_trader_api_url: str = "http://localhost:8080"

# Watchlist TTL cache - avoid redundant trader API calls
_watchlist_cache_time: float = 0
_WATCHLIST_CACHE_TTL = 5.0  # seconds - fast enough for live trading

# NOTE: Using fresh httpx client per request to avoid connection pool corruption
# Less efficient but more robust for long-running servers on Windows


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
                # Read file OUTSIDE the lock to avoid blocking async code
                with open(runners_path) as f:
                    data = json.load(f)
                # Only hold lock for quick assignment
                with _cache_lock:
                    _cached_runners = data
                _logger.info("Runners reloaded")
        except Exception as e:
            _logger.error(f"Failed to reload runners: {e}")


async def fetch_watchlist_from_trader_async() -> Optional[List[Dict]]:
    """
    Fetch watchlist directly from trader app API (async version).

    Uses fresh client per request to avoid connection pool corruption.
    """
    global _cached_watchlist, _watchlist_cache_time
    try:
        # Force IPv4 to avoid IPv6 connection hangs on Windows
        # localhost can resolve to ::1 (IPv6) which may hang if server only binds IPv4
        api_url = _trader_api_url.replace("localhost", "127.0.0.1")
        _logger.info(f"fetch_watchlist_from_trader_async: starting request to {api_url}")

        # Create fresh client for each request to avoid connection pool issues
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(5.0, connect=2.0),  # Shorter connect timeout
            http2=False
        ) as client:
            _logger.info("fetch_watchlist_from_trader_async: client created, making request")
            response = await asyncio.wait_for(
                client.get(f"{api_url}/api/watchlist"),
                timeout=5.0
            )
            _logger.info(f"fetch_watchlist_from_trader_async: got response {response.status_code}")
            response.raise_for_status()
            watchlist = response.json()
            _logger.info(f"fetch_watchlist_from_trader_async: parsed {len(watchlist)} stocks")

        _logger.info("fetch_watchlist_from_trader_async: exited async with block")
        # NOTE: Simple assignment is atomic in Python (GIL), no lock needed for writes
        # The lock was causing event loop blocking when held by file watcher thread
        _cached_watchlist = watchlist
        _watchlist_cache_time = time_module.time()

        _logger.info(f"fetch_watchlist_from_trader_async: completed successfully with {len(watchlist)} stocks")
        return watchlist
    except httpx.ConnectError:
        _logger.warning("Trader app not available - using cached watchlist")
        return None
    except asyncio.TimeoutError:
        _logger.warning("Watchlist fetch timed out after 5s - using cached watchlist")
        return None
    except Exception as e:
        _logger.error(f"Failed to fetch watchlist from trader API: {e}")
        return None


def fetch_watchlist_from_trader() -> Optional[List[Dict]]:
    """
    Fetch watchlist directly from trader app API (sync version - for startup only).

    WARNING: This is synchronous and will block. Use fetch_watchlist_from_trader_async() from async routes.
    """
    global _cached_watchlist, _watchlist_cache_time
    try:
        # Force IPv4 to avoid IPv6 connection hangs on Windows
        api_url = _trader_api_url.replace("localhost", "127.0.0.1")

        # Create a one-off sync client with strict timeout
        with httpx.Client(timeout=httpx.Timeout(5.0, connect=2.0)) as client:
            response = client.get(f"{api_url}/api/watchlist")
            response.raise_for_status()
            watchlist = response.json()

        # Simple assignment is atomic in Python (GIL)
        _cached_watchlist = watchlist
        _watchlist_cache_time = time_module.time()

        _logger.info(f"fetch_watchlist_from_trader (sync): completed with {len(watchlist)} stocks")
        return watchlist
    except httpx.ConnectError:
        _logger.warning("fetch_watchlist_from_trader (sync): Trader app not available")
        return None
    except httpx.TimeoutException:
        _logger.warning("fetch_watchlist_from_trader (sync): Timeout")
        return None
    except Exception as e:
        _logger.error(f"fetch_watchlist_from_trader (sync): Failed - {e}")
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
    _logger.info(f"File watcher started for: {data_dir}")
    _logger.info(f"Watchlist source: {trader_api_url}/api/watchlist")


def stop_file_watchers():
    """Stop the file watcher"""
    global _observer
    if _observer:
        _observer.stop()
        _observer.join(timeout=5)
        _observer = None
        _logger.info("File watcher stopped")


async def close_async_client():
    """No-op - using fresh clients per request now"""
    pass


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

    # Simple read is atomic in Python (GIL)
    return _cached_watchlist


async def get_cached_watchlist_async(refresh: bool = False) -> Optional[List[Dict]]:
    """
    Get watchlist, optionally refreshing from trader API (ASYNC version - use from routes).

    Uses native async httpx client - no thread pool needed, no blocking.
    """
    if refresh:
        # Only actually fetch if cache is stale (older than TTL)
        cache_age = time_module.time() - _watchlist_cache_time
        if cache_age > _WATCHLIST_CACHE_TTL:
            _logger.info(f"get_cached_watchlist_async: cache stale ({cache_age:.1f}s), fetching fresh")
            # Use native async fetch - no thread pool, no blocking
            await fetch_watchlist_from_trader_async()
            _logger.info("get_cached_watchlist_async: fetch completed")

    # NOTE: Simple read is atomic in Python (GIL), no lock needed
    # Avoid threading.Lock in async code - blocks entire event loop
    return _cached_watchlist


def get_cached_runners() -> Optional[Dict]:
    # Simple read is atomic in Python (GIL)
    return _cached_runners
