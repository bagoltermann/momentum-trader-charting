"""API routes for charting app backend"""
from fastapi import APIRouter, HTTPException
from typing import Optional
from pathlib import Path
import json
import logging
import asyncio
from services.schwab_client import ChartSchwabClient
from services.file_watcher import get_cached_watchlist, get_cached_runners
from services.llm_validator import get_validator, ValidationResult
from core.config import load_config

# Setup logger (uses same file as schwab_client)
_logger = logging.getLogger('routes')

router = APIRouter()

# Request counter for debugging
_request_count = 0

# Lazy-initialized Schwab client
_schwab_client: Optional[ChartSchwabClient] = None


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
    # Always refresh from trader API to stay in sync
    watchlist = get_cached_watchlist(refresh=True)
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

    trades = []
    try:
        with open(outcomes_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        trade = json.loads(line)
                        trades.append(trade)
                    except json.JSONDecodeError:
                        continue
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

    # Get context data
    watchlist = get_cached_watchlist()
    if watchlist is None:
        raise HTTPException(status_code=503, detail="Watchlist not available")

    # Check if symbol is in watchlist
    if not any(s.get('symbol') == symbol for s in watchlist):
        raise HTTPException(status_code=400, detail=f"Symbol {symbol} not in watchlist")

    runners = get_cached_runners() or {}

    # Get real-time quote
    client = get_schwab_client()
    try:
        quote = await client.get_quote(symbol)
    except Exception as e:
        _logger.warning(f"Failed to get quote for {symbol}: {e}")
        quote = None

    # Get candles for technical indicators
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

    # Get validator and validate
    config = load_config()
    validator = get_validator(config)

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
    return {
        "available": validator.is_available(),
        "cache_ttl_seconds": 60
    }
