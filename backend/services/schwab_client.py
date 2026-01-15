"""
Schwab client for charting app - READ ONLY

Shares tokens with main momentum trader app.
Never writes or refreshes tokens.
"""
from pathlib import Path
from typing import Optional, List, Dict
import yaml
from schwab import auth


class ChartSchwabClient:
    """
    Dedicated Schwab client for charting app.
    Read-only access to price history and quotes.
    """

    def __init__(self):
        self.client = None
        self._authenticate()

    def _authenticate(self):
        """Initialize Schwab client using shared tokens"""
        # Load credentials from main app
        creds_path = Path(__file__).parent.parent.parent.parent / "momentum-trader" / "config" / "credentials.yaml"
        token_path = Path(__file__).parent.parent.parent.parent / "momentum-trader" / "data" / "tokens" / "schwab_tokens.json"

        if not creds_path.exists():
            raise FileNotFoundError(f"Credentials not found: {creds_path}")
        if not token_path.exists():
            raise FileNotFoundError(f"Tokens not found: {token_path}")

        with open(creds_path) as f:
            creds = yaml.safe_load(f)

        schwab_creds = creds.get('schwab', {})

        self.client = auth.easy_client(
            api_key=schwab_creds['app_key'],
            app_secret=schwab_creds['app_secret'],
            callback_url="https://127.0.0.1:8182",
            token_path=str(token_path)
        )
        print("[OK] Schwab client initialized (read-only)")

    def get_price_history(
        self,
        symbol: str,
        frequency_type: str = "minute",
        frequency: int = 1,
        period_type: str = "day",
        period: int = 1
    ) -> Optional[List[Dict]]:
        """
        Get historical price data (candles)

        Returns list of candles: [{timestamp, open, high, low, close, volume}]
        """
        try:
            from schwab.client import Client

            # Map to enums
            freq_type_enum = Client.PriceHistory.FrequencyType[frequency_type.upper()]
            period_type_enum = Client.PriceHistory.PeriodType[period_type.upper()]

            # Frequency enum
            if frequency_type == "minute":
                freq_map = {
                    1: Client.PriceHistory.Frequency.EVERY_MINUTE,
                    5: Client.PriceHistory.Frequency.EVERY_FIVE_MINUTES,
                    15: Client.PriceHistory.Frequency.EVERY_FIFTEEN_MINUTES,
                    30: Client.PriceHistory.Frequency.EVERY_THIRTY_MINUTES,
                }
                freq_enum = freq_map.get(frequency, Client.PriceHistory.Frequency.EVERY_MINUTE)
            else:
                freq_enum = Client.PriceHistory.Frequency.DAILY

            # Period enum
            if period_type == "day":
                period_map = {
                    1: Client.PriceHistory.Period.ONE_DAY,
                    5: Client.PriceHistory.Period.FIVE_DAYS,
                    10: Client.PriceHistory.Period.TEN_DAYS,
                }
                period_enum = period_map.get(period, Client.PriceHistory.Period.ONE_DAY)
            else:
                period_enum = Client.PriceHistory.Period.ONE_MONTH

            response = self.client.get_price_history(
                symbol,
                period_type=period_type_enum,
                period=period_enum,
                frequency_type=freq_type_enum,
                frequency=freq_enum
            )

            if response.status_code != 200:
                print(f"[WARN] Price history error for {symbol}: {response.status_code}")
                return None

            data = response.json()
            candles = data.get('candles', [])

            # Transform to standard format
            return [
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

        except Exception as e:
            print(f"[ERROR] get_price_history({symbol}): {e}")
            return None

    def get_quote(self, symbol: str) -> Optional[Dict]:
        """Get real-time quote for a symbol"""
        try:
            response = self.client.get_quote(symbol)
            if response.status_code != 200:
                return None
            data = response.json()
            return data.get(symbol, {}).get('quote', {})
        except Exception as e:
            print(f"[ERROR] get_quote({symbol}): {e}")
            return None
