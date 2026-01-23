"""
LLM Signal Validator Service

Validates stock setups using LLM analysis based on Warrior Trading methodology.
Reuses LLM infrastructure from momentum-trader app.

v1.0.0: Initial implementation
"""

import sys
import yaml
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, asdict
from datetime import datetime
import threading
import time

_logger = logging.getLogger('llm_validator')

# Try to import OllamaProvider from momentum-trader
# This is done lazily to avoid crashing the backend if momentum-trader is not available
OllamaProvider = None
_import_error = None

try:
    # Add momentum-trader root to path to reuse its LLM infrastructure
    # The code uses "from src.utils.logger" so we need the root, not src/
    _momentum_trader_root = Path(__file__).parent.parent.parent.parent / "momentum-trader"
    _momentum_trader_src = _momentum_trader_root / "src"

    # Add both root (for "from src.utils") and src (for "from llm.providers")
    # IMPORTANT: Append to end of path to avoid conflicts with charting backend modules
    if str(_momentum_trader_root) not in sys.path:
        sys.path.append(str(_momentum_trader_root))
    if str(_momentum_trader_src) not in sys.path:
        sys.path.append(str(_momentum_trader_src))

    from llm.providers.ollama_provider import OllamaProvider as _OllamaProvider
    OllamaProvider = _OllamaProvider
    _logger.info(f"Successfully imported OllamaProvider from {_momentum_trader_src}")
except ImportError as e:
    _import_error = str(e)
    _logger.warning(f"Could not import OllamaProvider: {e}. LLM validation will be disabled.")


@dataclass
class ValidationResult:
    """Result of LLM signal validation"""
    signal: str  # 'buy', 'wait', 'no_trade'
    entry_price: Optional[float]
    stop_price: Optional[float]
    target_price: Optional[float]
    confidence: int  # 0-100
    reasoning: List[str]
    risk_reward_ratio: Optional[float]
    key_concern: Optional[str]
    timestamp: str
    symbol: str
    cached: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class ValidationCache:
    """Simple in-memory cache with TTL"""

    def __init__(self, ttl_seconds: int = 60):
        self.ttl = ttl_seconds
        self._cache: Dict[str, tuple] = {}  # symbol -> (result, timestamp)
        self._lock = threading.Lock()

    def get(self, symbol: str) -> Optional[ValidationResult]:
        with self._lock:
            if symbol not in self._cache:
                return None
            result, cached_at = self._cache[symbol]
            if time.time() - cached_at > self.ttl:
                del self._cache[symbol]
                return None
            # Mark as cached
            result.cached = True
            return result

    def set(self, symbol: str, result: ValidationResult):
        with self._lock:
            self._cache[symbol] = (result, time.time())

    def clear(self, symbol: Optional[str] = None):
        with self._lock:
            if symbol:
                self._cache.pop(symbol, None)
            else:
                self._cache.clear()


class LLMValidator:
    """
    Validates stock setups using LLM analysis.

    Uses Ollama with qwen2.5:7b model (same as momentum-trader).
    Loads prompts from config/prompts/validation_prompt.yaml.
    """

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self._prompts: Optional[Dict] = None
        self._provider: Optional[OllamaProvider] = None
        self._cache = ValidationCache(ttl_seconds=60)

        # Load prompts
        self._load_prompts()

        # Initialize LLM provider
        self._init_provider()

    def _load_prompts(self):
        """Load validation prompts from YAML config"""
        prompt_file = Path(__file__).parent.parent.parent / "config" / "prompts" / "validation_prompt.yaml"

        try:
            if prompt_file.exists():
                with open(prompt_file, 'r', encoding='utf-8') as f:
                    self._prompts = yaml.safe_load(f)
                _logger.info(f"Loaded validation prompts from {prompt_file}")
            else:
                _logger.warning(f"Prompt file not found: {prompt_file}")
                self._prompts = {}
        except Exception as e:
            _logger.error(f"Failed to load prompts: {e}")
            self._prompts = {}

    def _init_provider(self):
        """Initialize Ollama provider"""
        # Check if OllamaProvider was imported successfully
        if OllamaProvider is None:
            _logger.warning(f"OllamaProvider not available: {_import_error}")
            self._provider = None
            return

        llm_config = self.config.get('llm', {})
        ollama_config = llm_config.get('ollama', {})

        self._provider_config = {
            'base_url': ollama_config.get('base_url', 'http://localhost:11434'),
            'model': ollama_config.get('model', 'qwen2.5:7b'),
            'max_tokens': ollama_config.get('max_tokens', 1000),
            'temperature': ollama_config.get('temperature', 0.3),
        }

        try:
            self._provider = OllamaProvider(self._provider_config)
            _logger.info(f"LLM validator initialized with {self._provider_config['model']}")
        except Exception as e:
            _logger.error(f"Failed to initialize Ollama: {e}")
            self._provider = None

    def is_available(self) -> bool:
        """Check if LLM validation is available (checks live status)"""
        # If provider wasn't created, try to create it now (lazy init)
        if self._provider is None and OllamaProvider is not None:
            try:
                if not hasattr(self, '_provider_config'):
                    self._provider_config = {
                        'base_url': 'http://localhost:11434',
                        'model': 'qwen2.5:7b',
                        'max_tokens': 1000,
                        'temperature': 0.3,
                    }
                self._provider = OllamaProvider(self._provider_config)
                _logger.info("Lazy-initialized OllamaProvider")
            except Exception as e:
                _logger.warning(f"Failed to lazy-init provider: {e}")
                return False

        if self._provider is None:
            return False

        # Always check live availability
        return self._provider.is_available()

    async def validate_signal(
        self,
        symbol: str,
        watchlist: List[Dict],
        runners: Dict,
        quote: Optional[Dict] = None,
        candles: Optional[List[Dict]] = None,
        use_cache: bool = True
    ) -> ValidationResult:
        """
        Validate a stock setup and return trading signal.

        Args:
            symbol: Stock symbol to validate
            watchlist: Current watchlist data
            runners: Multi-day runners data
            quote: Real-time quote (optional)
            candles: Recent candle data for indicators (optional)
            use_cache: Whether to use cached results

        Returns:
            ValidationResult with signal, prices, confidence, and reasoning
        """
        # Check cache first
        if use_cache:
            cached = self._cache.get(symbol)
            if cached:
                _logger.debug(f"Cache hit for {symbol}")
                return cached

        # Build context from all available data
        context = self._build_context(symbol, watchlist, runners, quote, candles)

        # Check if LLM is available
        if not self.is_available():
            _logger.warning(f"LLM not available, using fallback for {symbol}")
            return self._get_fallback_result(symbol, context)

        # Build prompt
        system_prompt = self._get_system_prompt()
        user_prompt = self._build_user_prompt(context)

        _logger.info(f"Validating {symbol} via LLM...")

        try:
            # Call LLM
            result = self._provider.complete_json(user_prompt, system_prompt)

            if result['success']:
                validation = self._parse_llm_response(symbol, result['content'])
                self._cache.set(symbol, validation)
                _logger.info(f"Validated {symbol}: {validation.signal} (confidence: {validation.confidence}%)")
                return validation
            else:
                _logger.error(f"LLM validation failed for {symbol}: {result.get('error')}")
                return self._get_fallback_result(symbol, context)

        except Exception as e:
            _logger.error(f"Validation error for {symbol}: {e}")
            return self._get_fallback_result(symbol, context)

    def _build_context(
        self,
        symbol: str,
        watchlist: List[Dict],
        runners: Dict,
        quote: Optional[Dict],
        candles: Optional[List[Dict]]
    ) -> Dict[str, Any]:
        """Build comprehensive context for LLM validation"""

        # Find stock in watchlist
        stock = next((s for s in watchlist if s.get('symbol') == symbol), {})

        # Get runner info if available
        # Runners structure: { "active_runners": [...], ... }
        active_runners = runners.get('active_runners', []) if isinstance(runners, dict) else []
        runner = next((r for r in active_runners if r.get('symbol') == symbol), {})
        is_runner = bool(runner)

        # Current time info
        now = datetime.now()
        market_open = now.replace(hour=9, minute=30, second=0, microsecond=0)
        minutes_since_open = max(0, int((now - market_open).total_seconds() / 60))

        # Basic stock data
        price = quote.get('lastPrice', stock.get('price', 0)) if quote else stock.get('price', 0)
        high = quote.get('highPrice', stock.get('high', 0)) if quote else stock.get('high', 0)
        gap_percent = stock.get('gap_percent', 0)
        volume_ratio = stock.get('volume_ratio', 0)
        float_shares = stock.get('float', 0)
        quality_score = stock.get('quality_score', 0)

        # LLM analysis from watchlist
        llm_analysis = stock.get('llm_analysis', {})
        catalyst_type = llm_analysis.get('catalyst_type', 'Unknown')
        catalyst_strength = llm_analysis.get('catalyst_strength', 5)
        has_definitive_catalyst = stock.get('has_definitive_catalyst', False)

        # Calculate 5 Pillars
        pillars = self._calculate_5_pillars(stock)

        # VWAP analysis (from candles if available)
        vwap_data = self._calculate_vwap(candles) if candles else {}

        # Technical indicators
        indicators = self._calculate_indicators(candles) if candles else {}

        # Signal freshness based on time of day
        signal_freshness = self._get_signal_freshness(minutes_since_open)

        # Time window name
        time_window = self._get_time_window(now)

        # Build context dict
        context = {
            # Basic
            'symbol': symbol,
            'price': price,
            'high': high,
            'gap_percent': gap_percent,
            'quality_score': quality_score,
            'volume_ratio': volume_ratio,
            'float': float_shares,
            'float_formatted': self._format_float(float_shares),

            # 5 Pillars
            'pillar_gap': 'PASS' if pillars['gap'] else 'FAIL',
            'pillar_volume': 'PASS' if pillars['volume'] else 'FAIL',
            'pillar_float': 'PASS' if pillars['float'] else 'FAIL',
            'pillar_price': 'PASS' if pillars['price'] else 'FAIL',
            'pillar_catalyst': 'PASS' if pillars['catalyst'] else 'PARTIAL',
            'pillars_score': pillars['score'],

            # Timing
            'current_time': now.strftime('%I:%M %p'),
            'minutes_since_open': minutes_since_open,
            'time_window': time_window,
            'signal_freshness': signal_freshness,
            'gap_age_days': runner.get('gap_age_days', 0) if is_runner else 0,

            # VWAP
            'vwap': vwap_data.get('vwap', 0),
            'vwap_distance_percent': vwap_data.get('distance_percent', 0),
            'vwap_zone': vwap_data.get('zone', 'UNKNOWN'),
            'chase_risk_assessment': vwap_data.get('chase_risk', 'Unknown'),

            # Technical
            'ema9': indicators.get('ema9', 0),
            'ema20': indicators.get('ema20', 0),
            'ema9_position': indicators.get('ema9_position', 'unknown'),
            'ema20_position': indicators.get('ema20_position', 'unknown'),
            'ema_trend': indicators.get('ema_trend', 'unknown'),

            # Support/Resistance
            'resistance_1': indicators.get('resistance_1', high),
            'resistance_1_strength': 'Day High',
            'support_1': indicators.get('support_1', price * 0.95),
            'support_1_strength': 'Estimated',

            # Volume
            'volume_trend': indicators.get('volume_trend', 'unknown'),
            'float_rotation_percent': min(100, (volume_ratio * 5)) if volume_ratio else 0,

            # Timeframe alignment (simplified - would need multi-timeframe data)
            'tf_1m_bias': 'Bullish' if gap_percent > 0 else 'Bearish',
            'tf_5m_bias': 'Bullish' if gap_percent > 5 else 'Neutral',
            'tf_15m_bias': 'Bullish' if gap_percent > 10 else 'Neutral',
            'tf_daily_bias': 'Bullish' if gap_percent > 0 else 'Neutral',
            'timeframe_alignment': 'Aligned' if gap_percent > 10 else 'Mixed',
            'aligned_count': 4 if gap_percent > 10 else (3 if gap_percent > 5 else 2),

            # Catalyst
            'catalyst_type': catalyst_type,
            'catalyst_strength': catalyst_strength,
            'has_definitive_catalyst': 'Yes' if has_definitive_catalyst else 'No',
            'catalyst_details': llm_analysis.get('recommendation', 'No details available'),

            # Runner info
            'is_runner': is_runner,
            'runner_section': self._build_runner_section(runner) if is_runner else 'Not a multi-day runner',

            # Patterns (simplified)
            'micro_pullback_detected': 'Unknown',
            'flag_pattern_detected': 'Unknown',
            'unfilled_gaps': 'Unknown',

            # Exit signals (simplified - would need real exit signal data)
            'exit_macd': 'OK',
            'exit_volume': 'OK' if volume_ratio >= 3 else 'CAUTION',
            'exit_jackknife': 'OK',
            'exit_overall': 'HOLD',

            # Risk/Reward
            'entry_zone_price': price,
            'stop_zone_price': price * 0.95,
            'risk_dollars': price * 0.05,
            'risk_percent': 5.0,
            'target_2r': price * 1.10,
            'target_3r': price * 1.15,
        }

        return context

    def _calculate_5_pillars(self, stock: Dict) -> Dict[str, Any]:
        """Calculate 5 Pillars score for Warrior Trading"""
        gap = stock.get('gap_percent', 0) >= 10
        volume = stock.get('volume_ratio', 0) >= 5
        float_ok = stock.get('float', float('inf')) <= 20_000_000
        price = 2 <= stock.get('price', 0) <= 20
        catalyst = stock.get('has_definitive_catalyst', False) or \
                   stock.get('llm_analysis', {}).get('catalyst_strength', 0) >= 7

        score = sum([gap, volume, float_ok, price, catalyst])

        return {
            'gap': gap,
            'volume': volume,
            'float': float_ok,
            'price': price,
            'catalyst': catalyst,
            'score': score,
        }

    def _calculate_vwap(self, candles: List[Dict]) -> Dict[str, Any]:
        """Calculate VWAP and related metrics"""
        if not candles or len(candles) < 2:
            return {}

        # Simple VWAP calculation
        total_volume = 0
        cumulative_vp = 0

        for candle in candles:
            typical_price = (candle.get('high', 0) + candle.get('low', 0) + candle.get('close', 0)) / 3
            volume = candle.get('volume', 0)
            cumulative_vp += typical_price * volume
            total_volume += volume

        vwap = cumulative_vp / total_volume if total_volume > 0 else 0

        # Current price vs VWAP
        current_price = candles[-1].get('close', 0)
        distance_percent = ((current_price - vwap) / vwap * 100) if vwap > 0 else 0

        # Determine zone
        abs_distance = abs(distance_percent)
        if abs_distance < 2.5:
            zone = 'GREEN'
            chase_risk = 'Low'
        elif abs_distance < 3.5:
            zone = 'YELLOW'
            chase_risk = 'Moderate'
        else:
            zone = 'RED'
            chase_risk = 'High - Extended'

        return {
            'vwap': round(vwap, 2),
            'distance_percent': round(distance_percent, 2),
            'zone': zone,
            'chase_risk': chase_risk,
        }

    def _calculate_indicators(self, candles: List[Dict]) -> Dict[str, Any]:
        """Calculate technical indicators from candles"""
        if not candles or len(candles) < 20:
            return {}

        closes = [c.get('close', 0) for c in candles]
        current_price = closes[-1]

        # Simple EMA calculation
        def ema(data, period):
            if len(data) < period:
                return sum(data) / len(data)
            multiplier = 2 / (period + 1)
            ema_val = sum(data[:period]) / period
            for price in data[period:]:
                ema_val = (price * multiplier) + (ema_val * (1 - multiplier))
            return ema_val

        ema9 = ema(closes, 9)
        ema20 = ema(closes, 20)

        # Determine positions
        ema9_position = 'above' if current_price > ema9 else 'below'
        ema20_position = 'above' if current_price > ema20 else 'below'
        ema_trend = 'bullish' if ema9 > ema20 else 'bearish'

        # Volume trend
        recent_volumes = [c.get('volume', 0) for c in candles[-5:]]
        earlier_volumes = [c.get('volume', 0) for c in candles[-10:-5]]
        avg_recent = sum(recent_volumes) / len(recent_volumes) if recent_volumes else 0
        avg_earlier = sum(earlier_volumes) / len(earlier_volumes) if earlier_volumes else 0
        volume_trend = 'increasing' if avg_recent > avg_earlier * 1.1 else \
                      ('declining' if avg_recent < avg_earlier * 0.9 else 'steady')

        # S/R from recent highs/lows
        highs = [c.get('high', 0) for c in candles[-20:]]
        lows = [c.get('low', 0) for c in candles[-20:]]

        return {
            'ema9': round(ema9, 2),
            'ema20': round(ema20, 2),
            'ema9_position': ema9_position,
            'ema20_position': ema20_position,
            'ema_trend': ema_trend,
            'volume_trend': volume_trend,
            'resistance_1': round(max(highs), 2),
            'support_1': round(min(lows), 2),
        }

    def _get_signal_freshness(self, minutes_since_open: int) -> str:
        """Determine signal freshness based on time"""
        if minutes_since_open < 60:
            return 'fresh'
        elif minutes_since_open < 120:
            return 'aging'
        elif minutes_since_open < 180:
            return 'stale'
        else:
            return 'expired'

    def _get_time_window(self, now: datetime) -> str:
        """Get current trading time window"""
        hour = now.hour
        minute = now.minute

        if hour < 9 or (hour == 9 and minute < 30):
            return 'PREMARKET'
        elif hour == 9 or (hour == 10 and minute < 30):
            return 'PRIME_TIME'
        elif hour == 10 or (hour == 11 and minute < 30):
            return 'MORNING'
        elif hour == 11 or (hour == 12) or (hour == 13 and minute < 0):
            return 'LUNCH'
        elif hour < 15:
            return 'AFTERNOON'
        else:
            return 'POWER_HOUR'

    def _format_float(self, float_shares: float) -> str:
        """Format float for display"""
        if float_shares >= 1_000_000_000:
            return f"{float_shares / 1_000_000_000:.1f}B"
        elif float_shares >= 1_000_000:
            return f"{float_shares / 1_000_000:.1f}M"
        elif float_shares >= 1_000:
            return f"{float_shares / 1_000:.0f}K"
        else:
            return str(int(float_shares))

    def _build_runner_section(self, runner: Dict) -> str:
        """Build runner section for prompt"""
        if not runner:
            return 'Not a multi-day runner'

        entry_zones = runner.get('entry_zones', [])
        stop_zone = runner.get('stop_zone', {})

        lines = [
            f"**Status:** {runner.get('status', 'Unknown')}",
            f"**Day:** {runner.get('gap_age_days', 1)}",
            f"**Pullback:** {runner.get('pullback_percent', 0):.1f}%",
            f"**Cumulative Move:** {runner.get('cumulative_move_percent', 0):.1f}%",
        ]

        if entry_zones:
            lines.append("\n**Entry Zones:**")
            for zone in entry_zones[:2]:  # Top 2 zones
                lines.append(f"- ${zone.get('price', 0):.2f} ({zone.get('trigger', 'N/A')})")

        if stop_zone:
            lines.append(f"\n**Stop Zone:** ${stop_zone.get('price', 0):.2f} ({stop_zone.get('reason', 'N/A')})")

        return '\n'.join(lines)

    def _get_system_prompt(self) -> str:
        """Get system prompt from config"""
        validation = self._prompts.get('validation', {})
        return validation.get('system_prompt', 'You are a trading validator. Output valid JSON only.')

    def _build_user_prompt(self, context: Dict[str, Any]) -> str:
        """Build user prompt with variable substitution"""
        validation = self._prompts.get('validation', {})

        # Get template
        template = self._prompts.get('user_prompt_template', '')

        # Get guidelines
        guidelines = '\n'.join([
            validation.get('signal_guidelines', ''),
            validation.get('timing_guidelines', ''),
            validation.get('risk_guidelines', ''),
            validation.get('confidence_guidelines', ''),
        ])

        # Get JSON schema
        json_schema = validation.get('json_schema', '{}')

        # Substitute variables in template
        try:
            user_prompt = template.format(**context)
        except KeyError as e:
            _logger.warning(f"Missing template variable: {e}")
            user_prompt = template

        # Combine with guidelines and schema
        full_prompt = f"{user_prompt}\n\n{guidelines}\n\nOutput JSON matching this schema:\n{json_schema}"

        return full_prompt

    def _parse_llm_response(self, symbol: str, content: Dict) -> ValidationResult:
        """Parse LLM JSON response into ValidationResult"""
        return ValidationResult(
            signal=content.get('signal', 'wait').lower(),
            entry_price=content.get('entry_price'),
            stop_price=content.get('stop_price'),
            target_price=content.get('target_price'),
            confidence=int(content.get('confidence', 0)),
            reasoning=content.get('reasoning', []),
            risk_reward_ratio=content.get('risk_reward_ratio'),
            key_concern=content.get('key_concern'),
            timestamp=datetime.now().isoformat(),
            symbol=symbol,
            cached=False,
        )

    def _get_fallback_result(self, symbol: str, context: Dict) -> ValidationResult:
        """Return fallback result when LLM is unavailable"""
        fallback = self._prompts.get('fallback', {})

        return ValidationResult(
            signal=fallback.get('signal', 'wait'),
            entry_price=None,
            stop_price=None,
            target_price=None,
            confidence=fallback.get('confidence', 0),
            reasoning=fallback.get('reasoning', ['LLM validation unavailable']),
            risk_reward_ratio=None,
            key_concern=fallback.get('key_concern', 'Manual review recommended'),
            timestamp=datetime.now().isoformat(),
            symbol=symbol,
            cached=False,
        )

    def clear_cache(self, symbol: Optional[str] = None):
        """Clear validation cache"""
        self._cache.clear(symbol)


# Module-level singleton
_validator: Optional[LLMValidator] = None


def get_validator(config: Dict[str, Any] = None) -> LLMValidator:
    """Get or create the validator singleton"""
    global _validator
    if _validator is None:
        if config is None:
            config = {}
        _validator = LLMValidator(config)
    return _validator
