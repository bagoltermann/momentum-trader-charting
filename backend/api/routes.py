"""API routes for charting app backend"""
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from typing import Optional
from pathlib import Path
import json
import logging
import asyncio
from services.schwab_client import ChartSchwabClient, get_cached_candles
from services.file_watcher import get_cached_watchlist_async, get_cached_runners
from services.llm_validator import get_validator, ValidationResult
from core.config import load_config

# Setup logger (uses same file as schwab_client)
_logger = logging.getLogger('routes')

router = APIRouter()

# Request counter for debugging
_request_count = 0

# Lazy-initialized Schwab client
_schwab_client: Optional[ChartSchwabClient] = None

# Quote relay reference (set by main.py)
_quote_relay = None


def set_quote_relay(relay):
    """Set the quote relay instance (called from main.py)"""
    global _quote_relay
    _quote_relay = relay


def get_schwab_client() -> ChartSchwabClient:
    global _schwab_client
    if _schwab_client is None:
        _schwab_client = ChartSchwabClient()
    return _schwab_client


@router.get("/health")
async def health_check():
    return {"status": "ok", "service": "charting-backend"}


@router.get("/watchlist")
async def get_watchlist():
    """
    Get current watchlist from trader app API.

    Fetches fresh data from trader app (http://localhost:8080/api/watchlist)
    to ensure charting app shows exactly what trader app shows.
    """
    # Always refresh from trader API to stay in sync (async to avoid blocking event loop)
    watchlist = await get_cached_watchlist_async(refresh=True)
    if watchlist is None:
        raise HTTPException(status_code=503, detail="Watchlist not available - trader app may not be running")

    return watchlist


@router.get("/runners")
async def get_runners():
    """Get multi-day runners from cached file"""
    runners = get_cached_runners()
    if runners is None:
        raise HTTPException(status_code=503, detail="Runners not available")
    return runners


@router.get("/candles/{symbol}")
async def get_candles(symbol: str, timeframe: str = "1m"):
    """
    Get candlestick data from Schwab API

    Timeframes: 1m, 5m, 15m, D
    """
    global _request_count
    _request_count += 1
    req_id = _request_count
    _logger.info(f"[Route #{req_id}] GET /candles/{symbol}?timeframe={timeframe} started")

    # Note: Removed request.is_disconnected() check - it can cause issues on Windows
    # Server-side caching means we want to complete requests anyway

    client = get_schwab_client()

    # Map timeframe to Schwab parameters
    tf_map = {
        "1m": {"frequency_type": "minute", "frequency": 1, "period": 1},
        "5m": {"frequency_type": "minute", "frequency": 5, "period": 1},
        "15m": {"frequency_type": "minute", "frequency": 15, "period": 1},
        "D": {"frequency_type": "daily", "frequency": 1, "period": 30},
    }

    if timeframe not in tf_map:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}")

    params = tf_map[timeframe]

    try:
        candles = await client.get_price_history(
            symbol,
            frequency_type=params["frequency_type"],
            frequency=params["frequency"],
            period_type="day" if timeframe != "D" else "month",
            period=params["period"]
        )

        # Note: We no longer check for client disconnect after fetching.
        # The data is already cached server-side, so returning it is fine
        # even if the client may not receive it - it prevents unnecessary
        # API calls on the next request.

        if candles is None:
            _logger.warning(f"[Route #{req_id}] No data for {symbol}")
            raise HTTPException(status_code=404, detail=f"No data for {symbol}")

        _logger.info(f"[Route #{req_id}] GET /candles/{symbol} completed with {len(candles)} candles")
        return candles

    except asyncio.CancelledError:
        _logger.info(f"[Route #{req_id}] Request cancelled")
        raise HTTPException(status_code=499, detail="Request cancelled")
    except HTTPException:
        raise
    except Exception as e:
        _logger.error(f"[Route #{req_id}] GET /candles/{symbol} failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/quote/{symbol}")
async def get_quote(symbol: str):
    """Get real-time quote for a symbol"""
    client = get_schwab_client()
    quote = await client.get_quote(symbol)
    if quote is None:
        raise HTTPException(status_code=404, detail=f"No quote for {symbol}")
    return quote


@router.get("/trade-history")
async def get_trade_history():
    """Get trade history from momentum-trader's trade_outcomes.jsonl"""
    config = load_config()
    data_dir = Path(config['data_sources']['momentum_trader']['data_dir'])
    outcomes_path = data_dir / 'paper_trading' / 'trade_outcomes.jsonl'

    if not outcomes_path.exists():
        return []

    def _read_trades():
        trades = []
        with open(outcomes_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        trade = json.loads(line)
                        trades.append(trade)
                    except json.JSONDecodeError:
                        continue
        return trades

    try:
        trades = await asyncio.to_thread(_read_trades)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load trade history: {e}")

    return trades


@router.post("/validate/{symbol}")
async def validate_signal(symbol: str):
    """
    Validate a stock setup using LLM analysis.

    Returns signal (buy/wait/no_trade), price levels, confidence, and reasoning.
    Results are cached for 60 seconds.
    """
    _logger.info(f"POST /validate/{symbol} started")

    # Get context data (use async version to avoid blocking event loop)
    watchlist = await get_cached_watchlist_async()
    if watchlist is None:
        raise HTTPException(status_code=503, detail="Watchlist not available")

    # Check if symbol is in watchlist
    if not any(s.get('symbol') == symbol for s in watchlist):
        raise HTTPException(status_code=400, detail=f"Symbol {symbol} not in watchlist")

    # Check LLM cache BEFORE fetching Schwab quote -- avoids unnecessary API calls
    config = load_config()
    validator = get_validator(config)
    cached_result = validator.get_cached_result(symbol)
    if cached_result is not None:
        _logger.info(f"POST /validate/{symbol} served from cache")
        return cached_result.to_dict()

    runners = get_cached_runners() or {}

    # Get real-time quote (only when cache missed and we need to run LLM)
    client = get_schwab_client()
    try:
        quote = await client.get_quote(symbol)
    except Exception as e:
        _logger.warning(f"Failed to get quote for {symbol}: {e}")
        quote = None

    # Get candles for technical indicators (use cache first to avoid semaphore contention)
    candles = get_cached_candles(symbol, "minute", 1)
    if candles is not None:
        _logger.info(f"Validation for {symbol}: using cached 1m candles ({len(candles)} bars)")
    else:
        try:
            candles = await client.get_price_history(
                symbol,
                frequency_type="minute",
                frequency=1,
                period_type="day",
                period=1
            )
        except Exception as e:
            _logger.warning(f"Failed to get candles for {symbol}: {e}")
            candles = None

    try:
        result = await validator.validate_signal(
            symbol=symbol,
            watchlist=watchlist,
            runners=runners,
            quote=quote,
            candles=candles
        )

        _logger.info(f"POST /validate/{symbol} completed: {result.signal}")
        return result.to_dict()

    except Exception as e:
        _logger.error(f"Validation failed for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=f"Validation failed: {str(e)}")


@router.get("/validate/status")
async def validation_status():
    """Check if LLM validation is available"""
    config = load_config()
    validator = get_validator(config)
    # Wrap in wait_for with 5s timeout to prevent blocking if thread pool saturated
    try:
        available = await asyncio.wait_for(
            asyncio.to_thread(validator.is_available),
            timeout=5.0
        )
    except asyncio.TimeoutError:
        _logger.warning("LLM status check timed out")
        available = False
    return {
        "available": available,
        "cache_ttl_seconds": 60
    }


# ==================== Real-Time Streaming ====================


@router.websocket("/ws/quotes")
async def ws_quotes(websocket: WebSocket):
    """
    WebSocket endpoint for real-time quote streaming.

    Relays quote_update events from trader app (via QuoteRelay)
    to the Electron frontend. Frontend sends subscribe/unsubscribe
    messages to control which symbols are streamed.

    Also relays connection status changes so frontend can fall back
    to REST polling when trader app disconnects.
    """
    await websocket.accept()

    if not _quote_relay:
        await websocket.close(code=1013, reason="Quote relay not available")
        return

    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def on_quote(data):
        # Called from QuoteRelay's SocketIO thread — must use call_soon_threadsafe
        # because asyncio.Queue is NOT thread-safe (corrupts internal deque)
        loop.call_soon_threadsafe(queue.put_nowait, data)

    def on_status(data):
        loop.call_soon_threadsafe(queue.put_nowait, data)

    _quote_relay.add_callback(on_quote)
    _quote_relay.add_status_callback(on_status)
    try:
        receive_task = asyncio.create_task(_ws_receive_loop(websocket))
        send_task = asyncio.create_task(_ws_send_loop(websocket, queue))
        done, pending = await asyncio.wait(
            [receive_task, send_task], return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        _logger.error(f"[WS-QUOTES] Error: {e}")
    finally:
        _quote_relay.remove_callback(on_quote)
        _quote_relay.remove_status_callback(on_status)


async def _ws_receive_loop(websocket: WebSocket):
    """Handle frontend → backend messages (subscribe/unsubscribe)"""
    try:
        while True:
            msg = await websocket.receive_json()
            action = msg.get('action')
            if action == 'subscribe' and 'symbols' in msg:
                _quote_relay.subscribe(msg['symbols'])
                _logger.info(f"[WS-QUOTES] Subscribe: {msg['symbols']}")
            elif action == 'unsubscribe' and 'symbols' in msg:
                _quote_relay.unsubscribe(msg['symbols'])
                _logger.info(f"[WS-QUOTES] Unsubscribe: {msg['symbols']}")
    except WebSocketDisconnect:
        # Normal disconnect when frontend changes symbol or closes
        pass


async def _ws_send_loop(websocket: WebSocket, queue: asyncio.Queue):
    """Send quote updates from QuoteRelay to frontend"""
    while True:
        data = await queue.get()
        await websocket.send_json(data)


@router.get("/streaming/status")
async def streaming_status():
    """Get quote streaming relay status"""
    if _quote_relay:
        return _quote_relay.get_stats()
    return {"connected": False, "message": "Quote relay not initialized"}
