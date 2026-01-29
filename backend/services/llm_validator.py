"""
LLM Signal Validator Service

Validates stock setups using LLM analysis based on Warrior Trading methodology.
Reuses LLM infrastructure from momentum-trader app.

v1.0.0: Initial implementation
"""

import sys
import yaml
import logging
import json
import re
import asyncio
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

        llm_config = self.config.get('llm') or {}
        ollama_config = llm_config.get('ollama') or {}

        # Force IPv4 to avoid IPv6 connection hangs on Windows
        base_url = ollama_config.get('base_url', 'http://localhost:11434')
        base_url = base_url.replace("localhost", "127.0.0.1")
        self._provider_config = {
            'base_url': base_url,
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
                        'base_url': 'http://127.0.0.1:11434',  # Force IPv4
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

        # Build context from all available data (CPU-intensive, run in thread to avoid blocking event loop)
        # Wrap in wait_for to prevent indefinite blocking if thread pool is saturated
        try:
            context = await asyncio.wait_for(
                asyncio.to_thread(self._build_context, symbol, watchlist, runners, quote, candles),
                timeout=10.0  # Context building should be fast
            )
        except asyncio.TimeoutError:
            _logger.warning(f"[{symbol}] Context building timed out after 10s")
            return self._get_fallback_result(symbol, {})

        # Check if LLM is available (calls requests.get() with 2s timeout, run in thread)
        # Wrap in wait_for with 5s timeout (2s request + 3s buffer for thread acquisition)
        try:
            available = await asyncio.wait_for(
                asyncio.to_thread(self.is_available),
                timeout=5.0
            )
        except asyncio.TimeoutError:
            _logger.warning(f"[{symbol}] LLM availability check timed out")
            available = False

        if not available:
            _logger.warning(f"LLM not available, using fallback for {symbol}")
            return self._get_fallback_result(symbol, context)

        # Build prompt
        system_prompt = self._get_system_prompt()
        user_prompt = self._build_user_prompt(context)

        _logger.info(f"Validating {symbol} via LLM...")

        # Retry logic for JSON parsing failures (LLM sometimes returns malformed JSON)
        max_retries = 2
        last_error = None
        last_raw_response = None

        for attempt in range(max_retries + 1):
            try:
                # Call LLM with enhanced JSON extraction (sync requests.post with 60s timeout, run in thread)
                # Wrap in wait_for with 75s timeout (60s LLM + 15s buffer) to prevent indefinite blocking
                result = await asyncio.wait_for(
                    asyncio.to_thread(self._call_llm_with_json_extraction, symbol, user_prompt, system_prompt),
                    timeout=75.0
                )

                if result['success']:
                    validation = self._parse_llm_response(symbol, result['content'])
                    self._cache.set(symbol, validation)
                    if attempt > 0:
                        _logger.info(f"Validated {symbol} on retry {attempt}: {validation.signal} (confidence: {validation.confidence}%)")
                    else:
                        _logger.info(f"Validated {symbol}: {validation.signal} (confidence: {validation.confidence}%)")
                    return validation
                else:
                    last_error = result.get('error', 'Unknown error')
                    last_raw_response = result.get('raw_response', '')

                    # Check if it's a JSON parse failure worth retrying
                    is_json_error = 'JSON' in last_error or 'parse' in last_error.lower()
                    if is_json_error and attempt < max_retries:
                        _logger.warning(f"[{symbol}] JSON extraction failed (attempt {attempt + 1}/{max_retries + 1}), retrying...")
                        continue

                    _logger.error(f"[{symbol}] LLM validation failed after {attempt + 1} attempts: {last_error}")
                    return self._get_fallback_result(symbol, context)

            except Exception as e:
                last_error = str(e)
                if attempt < max_retries:
                    _logger.warning(f"[{symbol}] Validation error (attempt {attempt + 1}/{max_retries + 1}): {e}")
                    continue
                _logger.error(f"[{symbol}] Validation error after {max_retries + 1} attempts: {e}")
                return self._get_fallback_result(symbol, context)

        # Should not reach here, but fallback just in case
        _logger.error(f"[{symbol}] Validation exhausted all retries. Last error: {last_error}")
        if last_raw_response:
            _logger.error(f"[{symbol}] Last raw response: {last_raw_response[:500]}...")
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

        # Health status from watchlist (CRITICAL for DEAD stock detection)
        health_status = stock.get('health_status', 'UNKNOWN') or 'UNKNOWN'
        health_metrics = stock.get('health_metrics') or {}

        # Price trend calculation
        price_change_from_high = 0
        if high > 0 and price > 0:
            price_change_from_high = round(((price - high) / high) * 100, 1)

        # Gap fade calculation
        gap_fade = health_metrics.get('gap_fade_pct', 0)

        # Chase detection
        in_entry_zone = health_metrics.get('in_entry_zone', False)
        is_chasing = health_metrics.get('is_chasing', False)

        # Health warning message
        if health_status == 'DEAD':
            health_warning = "CRITICAL: This stock is DEAD - gap has faded significantly and price is declining. DO NOT recommend entry."
        elif health_status == 'COOLING':
            health_warning = "CAUTION: This stock is COOLING - momentum is slowing. Only consider entry if VWAP zone is GREEN and price is stable."
        elif is_chasing:
            health_warning = "WARNING: Price is extended - DO NOT CHASE. Wait for pullback to entry zone."
        else:
            health_warning = ""

        # Price trend description
        if price_change_from_high <= -10:
            price_trend = "FADING HARD - down significantly from day high"
        elif price_change_from_high <= -5:
            price_trend = "FADING - down from day high"
        elif price_change_from_high <= -2:
            price_trend = "Pulling back slightly from high"
        elif price_change_from_high >= 0:
            price_trend = "At or near day high"
        else:
            price_trend = "Stable"

        # LLM analysis from watchlist
        llm_analysis = stock.get('llm_analysis') or {}
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

        # Risk/Reward - use runner zones if available, else calculate
        if is_runner and runner:
            entry_zone = runner.get('entry_zone') or {}
            stop_zone = runner.get('stop_loss') or {}
            entry_zone_price = entry_zone.get('low', price) if entry_zone else price
            stop_zone_price = stop_zone.get('price', price * 0.95) if stop_zone else price * 0.95
        else:
            # For non-runners, estimate based on VWAP and recent support
            entry_zone_price = vwap_data.get('vwap', price) if vwap_data else price
            stop_zone_price = min(
                indicators.get('support_1', price * 0.95) if indicators else price * 0.95,
                price * 0.95
            )

        risk_dollars = max(0.01, entry_zone_price - stop_zone_price)  # Avoid zero/negative
        risk_percent = (risk_dollars / entry_zone_price * 100) if entry_zone_price > 0 else 5.0
        target_2r = entry_zone_price + (risk_dollars * 2)
        target_3r = entry_zone_price + (risk_dollars * 3)

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

            # Patterns - First Pullback detection (v1.44.0 trader app pattern)
            **self._build_first_pullback_context(
                price, vwap_data, volume_ratio, stock, candles, minutes_since_open
            ),
            'micro_pullback_detected': 'Unknown',
            'flag_pattern_detected': 'Unknown',
            'unfilled_gaps': 'Unknown',

            # Health Status (CRITICAL for validation decisions)
            'health_status': health_status,
            'health_warning': health_warning,
            'price_trend': price_trend,
            'price_change_from_high': price_change_from_high,
            'gap_fade_percent': gap_fade,
            'in_entry_zone': 'Yes' if in_entry_zone else 'No',
            'is_chasing': 'Yes' if is_chasing else 'No',

            # Real-time Catalyst Boost (v1.43.2 trader app data)
            **self._build_realtime_regrade_context(stock),

            # Exit signals (derived from health metrics)
            'exit_macd': 'CAUTION' if price_change_from_high < -5 else 'OK',
            'exit_volume': 'WARNING' if (health_metrics.get('volume_declining', False) or volume_ratio < 3) else 'OK',
            'exit_jackknife': 'CAUTION' if gap_fade > 20 else 'OK',
            'exit_overall': self._get_exit_overall(health_status, price_change_from_high, volume_ratio, gap_fade, health_metrics),

            # Risk/Reward (use runner zones if available)
            'entry_zone_price': entry_zone_price,
            'stop_zone_price': stop_zone_price,
            'risk_dollars': risk_dollars,
            'risk_percent': risk_percent,
            'target_2r': target_2r,
            'target_3r': target_3r,
        }

        return context

    def _get_exit_overall(self, health_status: str, price_change: float, volume_ratio: float, gap_fade: float, health_metrics: Dict) -> str:
        """Determine overall exit status based on health metrics"""
        if health_status == 'DEAD':
            return 'EXIT - Stock is DEAD'
        elif health_status == 'COOLING':
            return 'CAUTION - Momentum slowing'
        elif price_change < -5 or health_metrics.get('volume_declining', False) or volume_ratio < 3:
            return 'CAUTION'
        else:
            return 'HOLD'

    def _build_realtime_regrade_context(self, stock: Dict) -> Dict[str, Any]:
        """
        Build context for real-time catalyst re-grading (v1.43.2 trader app feature).

        When the trader app detects CRITICAL/HIGH priority streaming headlines,
        it re-runs LLM analysis and stores the result in `realtime_regrade`.
        This gives us fresh catalyst data to factor into validation.
        """
        regrade = stock.get('realtime_regrade') or {}

        if not regrade:
            return {
                'catalyst_boosted': False,
                'catalyst_boost_section': 'No recent catalyst boost detected.',
            }

        # Parse timestamp to check freshness
        timestamp_str = regrade.get('timestamp', '')
        minutes_ago = 999  # Default to old if we can't parse
        if timestamp_str:
            try:
                regrade_time = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                # Handle timezone-naive comparison
                if regrade_time.tzinfo:
                    regrade_time = regrade_time.replace(tzinfo=None)
                minutes_ago = (datetime.now() - regrade_time).total_seconds() / 60
            except (ValueError, TypeError):
                pass

        # Only consider "fresh" if within last 30 minutes
        is_fresh = minutes_ago <= 30

        previous_score = regrade.get('previous_score', 0)
        new_score = regrade.get('new_score', 0)
        score_change = new_score - previous_score
        headline = regrade.get('headline', 'Unknown headline')
        priority = regrade.get('priority', 'UNKNOWN')

        # Build descriptive section for prompt
        if is_fresh and score_change > 0:
            boost_section = f"""BREAKING NEWS DETECTED ({int(minutes_ago)} minutes ago)
- Headline: {headline}
- Priority: {priority}
- Catalyst score UPGRADED: {previous_score} -> {new_score} (+{score_change})

This is FRESH breaking news - weight catalyst heavily in analysis. Recent positive news flow supports bullish bias."""
        elif is_fresh:
            boost_section = f"""Recent news detected ({int(minutes_ago)} minutes ago)
- Headline: {headline}
- Priority: {priority}
- Catalyst score: {new_score} (no change from {previous_score})

News was analyzed but did not upgrade catalyst. Consider current score valid."""
        else:
            boost_section = 'No recent catalyst boost detected.'

        return {
            'catalyst_boosted': is_fresh and score_change > 0,
            'catalyst_boost_fresh': is_fresh,
            'catalyst_boost_headline': headline if is_fresh else '',
            'catalyst_boost_minutes_ago': int(minutes_ago) if is_fresh else 0,
            'catalyst_boost_previous_score': previous_score,
            'catalyst_boost_new_score': new_score,
            'catalyst_boost_score_change': score_change,
            'catalyst_boost_priority': priority if is_fresh else '',
            'catalyst_boost_section': boost_section,
        }

    def _build_first_pullback_context(
        self,
        price: float,
        vwap_data: Dict,
        volume_ratio: float,
        stock: Dict,
        candles: Optional[List[Dict]],
        minutes_since_open: int
    ) -> Dict[str, Any]:
        """
        Build context for First Pullback pattern detection (v1.44.0 trader app pattern).

        Ross Cameron's "Morning Panic into Support" pattern:
        1. Gapper with catalyst sells off sharply (weak hands panic)
        2. Price drops below EMA/VWAP (oversold washout)
        3. Shows recovery signal (green candles = buyers stepping in)
        4. Entry on the bounce, not the chase

        This pattern allows entry when price is BELOW EMA - the opposite of normal entries.
        """
        # Default: no First Pullback detected
        default_result = {
            'first_pullback_detected': False,
            'first_pullback_section': 'No First Pullback pattern detected.',
        }

        # Check 1: Time window (9:30-11:30 AM = first 120 minutes)
        if minutes_since_open > 120:
            return default_result

        # Check 2: Price below VWAP (oversold condition)
        vwap = vwap_data.get('vwap', 0) if vwap_data else 0
        if vwap <= 0 or price >= vwap:
            return default_result

        vwap_distance_pct = ((price - vwap) / vwap) * 100 if vwap > 0 else 0

        # Must be below VWAP but not too far (max -15%)
        if vwap_distance_pct < -15:
            return default_result

        # Check 3: Volume still elevated (50x+ for First Pullback plays)
        if volume_ratio < 50:
            return default_result

        # Check 4: Has catalyst
        llm_analysis = stock.get('llm_analysis') or {}
        news_count = len(stock.get('news', [])) if isinstance(stock.get('news'), list) else 0
        catalyst_strength = llm_analysis.get('catalyst_strength', 0)
        has_catalyst = news_count > 0 or catalyst_strength >= 7 or stock.get('has_definitive_catalyst', False)

        if not has_catalyst:
            return default_result

        # Check 5: Recovery signal - consecutive green candles
        green_candles = self._count_consecutive_green_candles(candles)
        if green_candles < 2:
            return default_result

        # SUCCESS - First Pullback pattern detected
        section = f"""FIRST PULLBACK PATTERN DETECTED (Morning Panic into Support)
- Price {abs(vwap_distance_pct):.1f}% below VWAP (oversold washout)
- Volume: {volume_ratio:.0f}x (institutional interest confirmed)
- Recovery signal: {green_candles} consecutive green candles
- Catalyst: {"Yes - fresh news" if news_count > 0 else "Strong catalyst score"}
- Time: {minutes_since_open} minutes since open (within optimal window)

This is Ross Cameron's FIRST PULLBACK setup - entry on the bounce, NOT the chase.
Consider BUY if other conditions support entry."""

        return {
            'first_pullback_detected': True,
            'first_pullback_vwap_distance': vwap_distance_pct,
            'first_pullback_volume': volume_ratio,
            'first_pullback_green_candles': green_candles,
            'first_pullback_section': section,
        }

    def _count_consecutive_green_candles(self, candles: Optional[List[Dict]]) -> int:
        """Count consecutive green candles from the most recent candle."""
        if not candles or len(candles) < 2:
            return 0

        # Get last 10 candles (most recent)
        recent = candles[-10:] if len(candles) >= 10 else candles

        consecutive = 0
        for candle in reversed(recent):
            open_price = candle.get('open', 0)
            close_price = candle.get('close', 0)
            if close_price > open_price:  # Green candle
                consecutive += 1
            else:
                break  # Stop at first non-green

        return consecutive

    def _calculate_5_pillars(self, stock: Dict) -> Dict[str, Any]:
        """Calculate 5 Pillars score for Warrior Trading"""
        gap = stock.get('gap_percent', 0) >= 10
        volume = stock.get('volume_ratio', 0) >= 5
        float_ok = stock.get('float', float('inf')) <= 20_000_000
        price = 2 <= stock.get('price', 0) <= 20
        llm_analysis_data = stock.get('llm_analysis') or {}
        catalyst = stock.get('has_definitive_catalyst', False) or \
                   llm_analysis_data.get('catalyst_strength', 0) >= 7

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

        entry_zones = runner.get('entry_zones') or []
        stop_zone = runner.get('stop_zone') or {}

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
        prompts = self._prompts or {}
        validation = prompts.get('validation') or {}
        return validation.get('system_prompt', 'You are a trading validator. Output valid JSON only.')

    def _build_user_prompt(self, context: Dict[str, Any]) -> str:
        """Build user prompt with variable substitution"""
        # Get template - simplified prompt already includes JSON example
        prompts = self._prompts or {}
        template = prompts.get('user_prompt_template', '')

        # Substitute variables in template
        try:
            user_prompt = template.format(**context)
        except KeyError as e:
            _logger.warning(f"Missing template variable: {e}")
            user_prompt = template

        return user_prompt

    def _extract_json_from_response(self, raw_response: str, symbol: str) -> Optional[Dict]:
        """
        Extract and parse JSON from LLM response with robust error handling.

        This provides an additional parsing layer on top of the Ollama provider's
        JSON repair logic, specifically tuned for our validation response format.
        """
        if not raw_response or not raw_response.strip():
            _logger.warning(f"[{symbol}] Empty response from LLM")
            return None

        content = raw_response.strip()

        # Remove markdown code blocks
        if '```json' in content:
            content = content.split('```json')[1].split('```')[0].strip()
        elif '```' in content:
            parts = content.split('```')
            if len(parts) >= 2:
                content = parts[1].strip()

        # Try direct parse first
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            pass

        # Try to extract JSON object from surrounding text
        match = re.search(r'\{[\s\S]*\}', content)
        if match:
            json_str = match.group(0)

            # Repair trailing commas
            json_str = re.sub(r',\s*([}\]])', r'\1', json_str)

            # Fix single quotes
            json_str = re.sub(r"'(\w+)':", r'"\1":', json_str)
            json_str = re.sub(r":\s*'([^']*)'", r': "\1"', json_str)

            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                pass

        # Try to find our specific fields to validate it looks like our expected format
        # and build a partial result
        if '"signal"' in content or "'signal'" in content:
            _logger.warning(f"[{symbol}] Response contains 'signal' but JSON parsing failed. Raw: {content[:300]}...")

        return None

    def _call_llm_with_json_extraction(self, symbol: str, user_prompt: str, system_prompt: str) -> Dict[str, Any]:
        """
        Call LLM and attempt JSON extraction with enhanced error handling.

        Returns dict with 'success', 'content' (parsed dict if success), and 'error' keys.
        Also returns 'raw_response' for debugging.
        """
        # First try the provider's built-in complete_json
        result = self._provider.complete_json(user_prompt, system_prompt)

        if result['success']:
            return result

        # If complete_json failed, try our own extraction on the raw response
        # We need to call complete() to get the raw text
        raw_result = self._provider.complete(user_prompt, system_prompt)

        if not raw_result['success']:
            _logger.error(f"[{symbol}] LLM request failed: {raw_result.get('error')}")
            return raw_result

        raw_response = raw_result.get('content', '')
        _logger.warning(f"[{symbol}] Provider JSON parse failed. Attempting custom extraction. Raw ({len(raw_response)} chars): {raw_response[:500]}...")

        # Try our custom extraction
        parsed = self._extract_json_from_response(raw_response, symbol)

        if parsed:
            _logger.info(f"[{symbol}] Custom JSON extraction succeeded")
            return {
                'success': True,
                'content': parsed,
                'raw_response': raw_response
            }

        _logger.error(f"[{symbol}] All JSON extraction attempts failed. Full raw response: {raw_response}")
        return {
            'success': False,
            'error': 'Failed to extract valid JSON from LLM response',
            'raw_response': raw_response
        }

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
        """Return fallback result when LLM is unavailable - NOT cached"""
        prompts = self._prompts or {}
        fallback = prompts.get('fallback') or {}

        # NOTE: Fallback results are NOT cached, so next refresh will retry
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

    def get_cached_result(self, symbol: str) -> Optional[ValidationResult]:
        """Check if a cached validation result exists for the symbol"""
        return self._cache.get(symbol)

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
