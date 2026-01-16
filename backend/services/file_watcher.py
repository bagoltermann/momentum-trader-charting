"""
File watcher for momentum trader data files

Watches:
- data/watchlist_state.json
- data/runners.json
- data/paper_trading_state.json
"""
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import json
import threading
from typing import Optional, Dict, List

# Cached data
_cached_watchlist: Optional[List[Dict]] = None
_cached_runners: Optional[Dict] = None
_cache_lock = threading.Lock()
_observer: Optional[Observer] = None


class DataFileHandler(FileSystemEventHandler):
    """Handle file change events"""

    def __init__(self, data_dir: str):
        self.data_dir = Path(data_dir)

    def on_modified(self, event):
        if event.is_directory:
            return

        filename = Path(event.src_path).name

        if filename == 'watchlist_state.json':
            self._reload_watchlist()
        elif filename == 'runners.json':
            self._reload_runners()

    def _reload_watchlist(self):
        global _cached_watchlist
        try:
            watchlist_path = self.data_dir / 'watchlist_state.json'
            if watchlist_path.exists():
                with open(watchlist_path) as f:
                    data = json.load(f)
                with _cache_lock:
                    _cached_watchlist = data.get('stocks', []) if isinstance(data, dict) else data
                print(f"[OK] Watchlist reloaded: {len(_cached_watchlist)} stocks")
        except Exception as e:
            print(f"[ERROR] Failed to reload watchlist: {e}")

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


def start_file_watchers(data_dir: str):
    """Start watching data files"""
    global _observer

    handler = DataFileHandler(data_dir)

    # Initial load
    handler._reload_watchlist()
    handler._reload_runners()

    # Start observer
    _observer = Observer()
    _observer.schedule(handler, data_dir, recursive=False)
    _observer.start()
    print(f"[OK] File watcher started for: {data_dir}")


def stop_file_watchers():
    """Stop the file watcher"""
    global _observer
    if _observer:
        _observer.stop()
        _observer.join(timeout=5)
        _observer = None
        print("[OK] File watcher stopped")


def get_cached_watchlist() -> Optional[List[Dict]]:
    with _cache_lock:
        return _cached_watchlist


def get_cached_runners() -> Optional[Dict]:
    with _cache_lock:
        return _cached_runners
