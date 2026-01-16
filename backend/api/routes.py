"""API routes for charting app backend"""
from fastapi import APIRouter, HTTPException
from typing import Optional
from pathlib import Path
import json
from services.schwab_client import ChartSchwabClient
from services.file_watcher import get_cached_watchlist, get_cached_runners
from core.config import load_config

router = APIRouter()

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
    """Get current watchlist from cached file"""
    watchlist = get_cached_watchlist()
    if watchlist is None:
        raise HTTPException(status_code=503, detail="Watchlist not available")
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
    candles = client.get_price_history(
        symbol,
        frequency_type=params["frequency_type"],
        frequency=params["frequency"],
        period_type="day" if timeframe != "D" else "month",
        period=params["period"]
    )

    if candles is None:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")

    return candles


@router.get("/quote/{symbol}")
async def get_quote(symbol: str):
    """Get real-time quote for a symbol"""
    client = get_schwab_client()
    quote = client.get_quote(symbol)
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
