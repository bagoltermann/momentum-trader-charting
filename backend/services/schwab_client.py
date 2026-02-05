"""
Schwab client for charting app - READ ONLY

Shares tokens with main momentum trader app.
Never writes or refreshes tokens.

Architecture based on momentum-trader's robust patterns:
- httpx for async HTTP (better Windows compatibility than aiohttp)
- Circuit breaker for API protection
- Exponential backoff retry strategy
- Server-side caching to reduce API calls
"""
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import pytz
import json
import httpx
import logging
import asyncio
import time as time_module
from core.config import load_config

# Setup file logging for backend debug
_backend_log_path = Path(__file__).parent.parent.parent / 'logs' / 'backend.log'
_backend_log_path.parent.mkdir(exist_ok=True)

# Configure root logger for our modules only
logging.basicConfig(
    filename=str(_backend_log_path),
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
_logger = logging.getLogger('schwab_client')

# Fix #24: Redirect ALL third-party loggers to file only (no stdout/stderr)
# The websockets library logs "connection closed" via stream.write() to stdout,
# which can block indefinitely on Windows when console buffer is full/stalled.
# Stack trace from freeze showed MainThread stuck at:
#   File "...\websockets\legacy\server.py", line 263, in handler
#       self.logger.info("connection closed")
#   File "...\logging\__init__.py", line 1163, in emit
#       stream.write(msg + self.terminator)
#
# Solution: Remove StreamHandlers from third-party loggers, keep only FileHandler

def _configure_third_party_logging():
    """Configure third-party loggers to use file only, no stdout."""
    # Get the root logger's file handler
    root_handlers = logging.getLogger().handlers
    file_handler = None
    for h in root_handlers:
        if isinstance(h, logging.FileHandler):
            file_handler = h
            break

    # Third-party loggers that may write to stdout and block the event loop
    third_party_loggers = [
        'websockets',
        'websockets.client',
        'websockets.server',
        'websockets.protocol',
        'uvicorn',
        'uvicorn.error',
        'uvicorn.access',
        'httpx',
        'httpcore',
        'socketio',
        'engineio',
    ]

    for logger_name in third_party_loggers:
        logger = logging.getLogger(logger_name)
        # Remove all existing handlers (especially StreamHandler to stdout)
        logger.handlers = []
        # Don't propagate to root (which might have StreamHandler)
        logger.propagate = False
        # Add only the file handler if we have one
        if file_handler:
            logger.addHandler(file_handler)
        # Set appropriate level - websockets is very chatty
        if logger_name.startswith('websockets'):
            logger.setLevel(logging.WARNING)  # Only warnings and errors
        elif logger_name.startswith('http'):
            logger.setLevel(logging.WARNING)  # Suppress httpx noise
        else:
            logger.setLevel(logging.INFO)  # Keep INFO for uvicorn, socketio

_configure_third_party_logging()

# Server-side cache for candle data (reduces Schwab API calls)
# Cache key: "symbol:frequency_type:frequency" -> (timestamp, data)
_candle_cache: Dict[str, tuple[float, List[Dict]]] = {}
_CACHE_TTL_SECONDS = 60  # Cache for 60 seconds (matches frontend refresh interval)


def get_cached_candles(symbol: str, frequency_type: str = "minute", frequency: int = 1) -> Optional[List[Dict]]:
    """Return cached candle data if fresh, else None. Avoids redundant API calls."""
    cache_key = f"{symbol}:{frequency_type}:{frequency}"
    cached = _candle_cache.get(cache_key)
    if cached:
        cache_time, cache_data = cached
        if time_module.time() - cache_time < _CACHE_TTL_SECONDS:
            return cache_data
    return None


class CircuitBreaker:
    """
    Circuit breaker pattern for API protection (from momentum-trader)

    States:
    - CLOSED: Normal operation, calls pass through
    - OPEN: Too many failures, reject all calls for timeout period
    - HALF_OPEN: Testing if service recovered
    """

    def __init__(self, failure_threshold: int = 3, timeout_seconds: int = 60):
        self.failure_threshold = failure_threshold
        self.timeout_seconds = timeout_seconds
        self.failure_count = 0
        self.last_failure_time: Optional[float] = None
        self.state = 'CLOSED'

    def can_execute(self) -> bool:
        """Check if we can execute a request"""
        if self.state == 'CLOSED':
            return True

        if self.state == 'OPEN':
            # Check if timeout has passed
            if self.last_failure_time and (time_module.time() - self.last_failure_time > self.timeout_seconds):
                _logger.info("Circuit breaker: Attempting recovery (HALF_OPEN)")
                self.state = 'HALF_OPEN'
                return True
            return False

        # HALF_OPEN - allow one request to test
        return True

    def record_success(self):
        """Record a successful call"""
        if self.state == 'HALF_OPEN':
            _logger.info("Circuit breaker: Recovery successful (CLOSED)")
        self.state = 'CLOSED'
        self.failure_count = 0

    def record_failure(self):
        """Record a failed call"""
        self.failure_count += 1
        self.last_failure_time = time_module.time()

        if self.failure_count >= self.failure_threshold:
            if self.state != 'OPEN':
                _logger.warning(f"Circuit breaker: OPEN after {self.failure_count} failures (cooling down {self.timeout_seconds}s)")
            self.state = 'OPEN'

    def get_status(self) -> str:
        """Get current circuit breaker status"""
        if self.state == 'OPEN' and self.last_failure_time:
            remaining = self.timeout_seconds - (time_module.time() - self.last_failure_time)
            if remaining > 0:
                return f"OPEN (recovery in {int(remaining)}s)"
        return self.state


# Global circuit breaker instance
_circuit_breaker = CircuitBreaker(failure_threshold=3, timeout_seconds=60)

# Semaphore to limit concurrent API calls (prevents overwhelming the connection pool)
# NOTE: Semaphore must be created lazily to avoid "no running event loop" error at import time
_api_semaphore: Optional[asyncio.Semaphore] = None

def _get_semaphore() -> asyncio.Semaphore:
    """Get or create the API semaphore (lazy initialization)"""
    global _api_semaphore
    if _api_semaphore is None:
        _api_semaphore = asyncio.Semaphore(5)  # Max 5 concurrent (was 3 - caused chart starvation during validation)
    return _api_semaphore


# NOTE: Using fresh httpx client per request to avoid connection pool corruption
# Less efficient but more robust for long-running servers on Windows


from concurrent.futures import ThreadPoolExecutor as _TPE, Future

# Dedicated thread pool for Schwab API requests - separate from asyncio's default executor
# to avoid any interaction with WindowsSelectorEventLoop's thread notification mechanism
_api_thread_pool = _TPE(max_workers=10, thread_name_prefix="schwab_api")


def _sync_request(url: str, params: Dict, headers: Dict) -> Dict:
    """
    Synchronous request using httpx.Client - returns parsed dict, not Response.

    Run in a dedicated thread pool. Response is fully parsed inside the thread
    so only plain Python dicts cross the thread boundary.
    """
    with httpx.Client(
        timeout=httpx.Timeout(10.0, connect=5.0),
        http2=False
    ) as client:
        response = client.get(url, params=params, headers=headers)
        # Extract everything inside the thread - no socket objects cross back
        result = {
            'status_code': response.status_code,
            'json': response.json() if response.status_code == 200 else None,
            'text': response.text if response.status_code != 200 else None,
        }
        return result


async def make_api_request(url: str, params: Dict, headers: Dict) -> Optional[Dict]:
    """
    Make an API request using httpx in a dedicated thread pool.

    Returns a dict with 'status_code', 'json', 'text' keys.

    CRITICAL: Uses polling (asyncio.sleep + Future.done()) instead of
    asyncio.to_thread/run_in_executor to avoid WindowsSelectorEventLoop
    deadlock. The selector's call_soon_threadsafe() mechanism can deadlock
    when multiple threads signal completion simultaneously on Windows.
    By polling, the event loop never needs to be woken by a thread.
    """
    _logger.info(f"make_api_request: Starting request to {url}")

    # Submit to dedicated thread pool (not asyncio's executor)
    future: Future = _api_thread_pool.submit(_sync_request, url, params, headers)

    # Poll for completion instead of using asyncio's thread notification
    # This avoids call_soon_threadsafe() which can deadlock WindowsSelectorEventLoop
    start = time_module.time()
    timeout = 15.0
    poll_interval = 0.05  # 50ms polling - responsive enough for API calls

    while not future.done():
        elapsed = time_module.time() - start
        if elapsed > timeout:
            future.cancel()
            _logger.warning(f"make_api_request: Hard timeout after {timeout}s")
            raise asyncio.TimeoutError()
        await asyncio.sleep(poll_interval)

    # Future is done - get result (may raise if thread had an exception)
    try:
        result = future.result(timeout=0)  # Already done, just get it
        _logger.info(f"make_api_request: Got response status {result['status_code']}")
        return result
    except httpx.TimeoutException:
        _logger.warning(f"make_api_request: httpx timeout")
        raise asyncio.TimeoutError()
    except httpx.HTTPError as e:
        _logger.warning(f"httpx request failed: {e}")
        raise
    except Exception as e:
        _logger.warning(f"API request failed: {e}")
        raise


async def close_shared_client():
    """No-op - using fresh clients per request now"""
    pass


class ChartSchwabClient:
    """
    Dedicated Schwab client for charting app.
    Read-only access to price history and quotes.

    Uses httpx and circuit breaker pattern from momentum-trader.
    """

    BASE_URL = "https://api.schwabapi.com/marketdata/v1"

    def __init__(self):
        config = load_config()
        schwab_config = config.get('data_sources', {}).get('schwab', {})

        self._token_path = Path(schwab_config.get('tokens_path', ''))

        if not self._token_path.exists():
            raise FileNotFoundError(f"Tokens not found: {self._token_path}")

        # Token caching - avoid disk I/O on every API call
        self._cached_token: Optional[str] = None
        self._token_cache_time: float = 0
        self._TOKEN_CACHE_TTL = 60  # seconds (tokens refresh every 30 min)

        _logger.info(f"Schwab client configured (aiohttp + circuit breaker) using tokens from: {self._token_path}")

    async def close(self):
        """Close is handled globally via close_shared_client()"""
        pass

    def _get_access_token(self) -> str:
        """Read current access token from token file (cached for 60s)"""
        now = time_module.time()
        if self._cached_token and (now - self._token_cache_time < self._TOKEN_CACHE_TTL):
            return self._cached_token
        with open(self._token_path) as f:
            token_data = json.load(f)
        self._cached_token = token_data['token']['access_token']
        self._token_cache_time = now
        return self._cached_token

    async def get_price_history(
        self,
        symbol: str,
        frequency_type: str = "minute",
        frequency: int = 1,
        period_type: str = "day",
        period: int = 1,
        today_only: bool = True
    ) -> Optional[List[Dict]]:
        """
        Get historical price data with circuit breaker protection.

        Features (from momentum-trader patterns):
        - Server-side cache (60s TTL)
        - Circuit breaker (3 failures -> 60s cooldown)
        - aiohttp for stable Windows performance
        - Exponential backoff retry (1s, 2s, 4s)
        """
        start_time = time_module.time()

        # Check server-side cache first
        cache_key = f"{symbol}:{frequency_type}:{frequency}"
        cached = _candle_cache.get(cache_key)
        if cached:
            cache_time, cache_data = cached
            if time_module.time() - cache_time < _CACHE_TTL_SECONDS:
                _logger.info(f"get_price_history({symbol}) served from cache")
                return cache_data

        # Check circuit breaker before making request
        if not _circuit_breaker.can_execute():
            _logger.warning(f"get_price_history({symbol}) blocked by circuit breaker ({_circuit_breaker.get_status()})")
            return None

        _logger.info(f"get_price_history({symbol}) waiting for semaphore")

        # Limit concurrent API calls to prevent connection pool exhaustion
        # Timeout after 10s to prevent indefinite blocking (semaphore starvation)
        try:
            await asyncio.wait_for(_get_semaphore().acquire(), timeout=10.0)
        except asyncio.TimeoutError:
            _logger.warning(f"get_price_history({symbol}) semaphore timeout after 10s - all slots busy")
            return None

        try:
            _logger.info(f"get_price_history({symbol}) acquired semaphore, starting request")

            # Retry with exponential backoff (like momentum-trader)
            max_retries = 3
            base_delay = 1.0  # seconds

            for attempt in range(max_retries):
                try:
                    access_token = self._get_access_token()

                    params = {
                        'symbol': symbol,
                        'frequencyType': frequency_type,
                        'frequency': frequency,
                        'needExtendedHoursData': 'true',
                    }

                    if frequency_type == "minute" and today_only:
                        et = pytz.timezone('America/New_York')
                        now_et = datetime.now(et)
                        market_start = now_et.replace(hour=4, minute=0, second=0, microsecond=0)

                        if now_et.hour < 4:
                            market_start = market_start - timedelta(days=1)

                        params['startDate'] = int(market_start.timestamp() * 1000)
                        params['endDate'] = int(now_et.timestamp() * 1000)
                    else:
                        params['periodType'] = period_type
                        params['period'] = period

                    # Use httpx with hard timeout wrapper to prevent indefinite hangs
                    response = await asyncio.wait_for(
                        make_api_request(
                            f"{self.BASE_URL}/pricehistory",
                            params=params,
                            headers={
                                'Authorization': f'Bearer {access_token}',
                                'Accept': 'application/json'
                            }
                        ),
                        timeout=15.0  # Hard timeout - will raise asyncio.TimeoutError if exceeded
                    )

                    # make_api_request returns a dict: {status_code, json, text}
                    status_code = response['status_code']

                    # Handle rate limiting (429) with retry
                    if status_code == 429:
                        if attempt < max_retries - 1:
                            delay = base_delay * (2 ** attempt)
                            _logger.warning(f"get_price_history({symbol}) rate limited, retrying in {delay}s")
                            await asyncio.sleep(delay)
                            continue
                        _circuit_breaker.record_failure()
                        return None

                    # Handle server errors (500-504) with retry
                    if status_code >= 500:
                        if attempt < max_retries - 1:
                            delay = base_delay * (2 ** attempt)
                            _logger.warning(f"get_price_history({symbol}) server error {status_code}, retrying in {delay}s")
                            await asyncio.sleep(delay)
                            continue
                        _circuit_breaker.record_failure()
                        return None

                    if status_code != 200:
                        _logger.warning(f"get_price_history({symbol}) error: {status_code}")
                        return None

                    # Success - record it and parse response
                    _circuit_breaker.record_success()

                    elapsed = time_module.time() - start_time
                    _logger.info(f"get_price_history({symbol}) completed in {elapsed:.2f}s")

                    data = response['json']
                    candles = data.get('candles', [])

                    result = [
                        {
                            'timestamp': c['datetime'],
                            'open': c['open'],
                            'high': c['high'],
                            'low': c['low'],
                            'close': c['close'],
                            'volume': c['volume']
                        }
                        for c in candles
                    ]

                    # Cache the result
                    _candle_cache[cache_key] = (time_module.time(), result)

                    return result

                except asyncio.CancelledError:
                    _logger.info(f"get_price_history({symbol}) was cancelled")
                    raise  # Re-raise to properly handle cancellation
                except asyncio.TimeoutError:
                    _logger.warning(f"get_price_history({symbol}) timeout (attempt {attempt + 1}/{max_retries})")
                    _circuit_breaker.record_failure()
                    if attempt < max_retries - 1:
                        delay = base_delay * (2 ** attempt)
                        await asyncio.sleep(delay)
                        continue
                    return None
                except Exception as e:
                    elapsed = time_module.time() - start_time
                    _logger.error(f"get_price_history({symbol}) failed after {elapsed:.2f}s: {e}")
                    _circuit_breaker.record_failure()
                    return None

            # All retries exhausted
            return None
        finally:
            _get_semaphore().release()

    async def get_quote(self, symbol: str) -> Optional[Dict]:
        """Get real-time quote using aiohttp with circuit breaker"""
        # Check circuit breaker before making request
        if not _circuit_breaker.can_execute():
            _logger.warning(f"get_quote({symbol}) blocked by circuit breaker")
            return None

        try:
            access_token = self._get_access_token()

            # Use httpx with hard timeout wrapper to prevent indefinite hangs
            response = await asyncio.wait_for(
                make_api_request(
                    f"{self.BASE_URL}/{symbol}/quotes",
                    params={},
                    headers={
                        'Authorization': f'Bearer {access_token}',
                        'Accept': 'application/json'
                    }
                ),
                timeout=10.0  # Hard timeout for quotes
            )

            # make_api_request returns a dict: {status_code, json, text}
            status_code = response['status_code']
            if status_code != 200:
                _logger.warning(f"get_quote({symbol}) error: {status_code}")
                if status_code >= 500:
                    _circuit_breaker.record_failure()
                return None

            _circuit_breaker.record_success()
            data = response['json']
            return data.get(symbol, {}).get('quote', {})

        except asyncio.CancelledError:
            _logger.info(f"get_quote({symbol}) was cancelled")
            raise
        except asyncio.TimeoutError:
            _logger.warning(f"get_quote({symbol}) timeout")
            _circuit_breaker.record_failure()
            return None
        except Exception as e:
            _logger.error(f"get_quote({symbol}) failed: {e}")
            _circuit_breaker.record_failure()
            return None
