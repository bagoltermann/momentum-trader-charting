# Feature Suggestions - Momentum Trader Charting

This document tracks feature enhancements - both implemented and planned.

> **Navigation**: Use Ctrl+F to search for specific features. Status markers:
> - ✅ IMPLEMENTED - Feature is complete
> - NOT IMPLEMENTED - Planned but not started
> - PARTIALLY IMPLEMENTED - Partially complete
> - BLOCKED - Waiting on external dependency

## Table of Contents

### Implemented Features
- [Recently Implemented](#recently-implemented-) - v1.0.0+ features

### Planned Features - Phase 1 (Foundation)
- [Core Charting](#core-charting---phase-1) - Candlestick charts, multi-chart grid
- [Watchlist Display](#watchlist-display---phase-1) - Real-time watchlist from momentum-trader
- [Heatmap](#heatmap---phase-1) - Visual scanning of watchlist

### Planned Features - Phase 2 (Visual Enhancements)
- [Technical Indicators](#technical-indicators---phase-2) - VWAP, moving averages, volume profile
- [Multi-Day Runners Panel](#multi-day-runners-panel---phase-2) - Continuation play tracking
- [Chart Annotations](#chart-annotations---phase-2) - Entry/exit markers, notes

### Planned Features - Phase 3 (Real-time Integration)
- [WebSocket Events](#websocket-events---phase-3) - Live updates from momentum-trader
- [Signal Overlay](#signal-overlay---phase-3) - Show buy/sell signals on charts
- [Position Tracking](#position-tracking---phase-3) - Display open positions

### Planned Features - Phase 4 (Advanced Features)
- [Pattern Overlays](#pattern-overlays---phase-4) - Technical patterns visualization
- [Trade Entry Panel](#trade-entry-panel---phase-4) - Quick trade execution
- [Replay Mode](#replay-mode---phase-4) - Review past trading sessions

### Planned Features - Phase 5 (LLM Pattern Detection)
- [Sector Momentum Correlation](#idea-2-multi-stock-sector-momentum-correlation---phase-5) - Sector ETF tailwind/headwind context
- [Headline Sentiment Trajectory](#idea-3-news-headline-sentiment-trajectory---phase-5) - Narrative building vs. fading
- [Historical Analog Matching](#idea-4-historical-analog-matching---phase-5) - Trade history similarity search
- [Float/Catalyst/Time Interactions](#idea-5-floatcatalysttime-interaction-analysis---phase-5) - 3-way interaction filter rules

### Planned Features - Phase 6 (Trader App Alignment)
- [Real-Time VWAP](#idea-6-real-time-vwap-from-streaming-cache) - Streaming VWAP from trader app cache
- [Volume Spike Alerts](#idea-7-volume-spike-alert-overlay) - Visual alerts when volume spikes detected
- [ABCD Pattern Overlay](#idea-8-abcd-fibonacci-pattern-overlay) - Fibonacci pattern visualization
- [Options Flow Panel](#idea-9-options-flow-indicator-panel) - Sweep detection and call/put flow
- [Gate Visualization](#idea-10-gate-system-visualization) - MTF/VWAP/Heat gate status
- [Position Monitor](#idea-11-position-monitor-streaming-status) - Real-time position and stop-loss display

### Infrastructure
- [Smart Launcher Scripts](#smart-launcher-scripts) - Auto-detection startup

---

## Recently Implemented ✅

### Warrior Trading Chart Enhancements (v1.6.0) - Jan 2026
**Status**: ✅ Complete
**Source**: [session-notes/2026-01-28.md](session-notes/2026-01-28.md)

**Problems Solved**:
- No visibility into gap % during pre-market (key Warrior Trading metric)
- No visibility into pre-market volume relative to average
- D1 High breakout level not highlighted when price approaches it

**Features**:
1. **Gap % Badge** - Shows Day 1 gap percentage in chart header with color coding (green >= 20%, yellow 10-20%, gray < 10%)
2. **Volume Badge** - Shows total pre-market volume with ratio to average (green >= 2x, yellow 1-2x, gray < 1x)
3. **D1 High Breakout Alert** - Dynamic line styling based on price proximity:
   - Normal (> 2% below): green dashed line
   - Approaching (0-2% below): yellow solid line with "approaching" label
   - Breakout (above): bright green solid line with "BREAKOUT" label

**Files**:
- `src/renderer/components/charts/EnhancedChart.tsx` - Badge rendering, D1 High proximity logic
- `src/renderer/components/charts/MultiChartGrid.tsx` - Gap%, volume calculations
- `src/renderer/styles/global.css` - Badge styling

---

### Streaming Relay Fallback + Stability Fixes - Jan 2026
**Status**: ✅ Complete
**Source**: [session-notes/2026-01-28.md](session-notes/2026-01-28.md)

**Problems Solved**:
- Charts go blank when trader app crashes (no fallback to REST polling)
- Zero candle data from Schwab causes chart crash during pre-market
- httpx requests hang indefinitely on rapid symbol switching

**Features**:
1. **Streaming disconnect fallback** - Backend sends status notifications, frontend falls back to REST polling within 60s of disconnect
2. **Zero candle filtering** - Filters out placeholder candles with all-zero OHLC, shows "No trades yet" message
3. **httpx timeout wrapper** - `asyncio.wait_for()` hard timeout (15s/10s) prevents indefinite hangs (band-aid - root cause unknown)

**Files**:
- `backend/services/quote_relay.py` - Status callbacks for connect/disconnect
- `src/renderer/hooks/useStreamingQuotes.ts` - NEW - WebSocket client with stale detection
- `src/renderer/hooks/useCandleData.ts` - Zero candle filtering
- `backend/services/schwab_client.py` - asyncio.wait_for() wrappers

---

### Backend Async Fix + Process Cleanup - Jan 2026
**Status**: ✅ Complete
**Source**: [session-notes/2026-01-27.md](session-notes/2026-01-27.md)

**Problems Solved**:
- Backend froze over time due to synchronous LLM calls (60s timeout) blocking the async event loop
- React validation timer fired every 5s instead of 60s due to dependency cascade
- Zombie processes lingered after app exit, blocking restart
- Unnecessary Schwab API calls for cached validations

**Features**:
1. **asyncio.to_thread() wrapping** - Offloads synchronous OllamaProvider calls to thread pool, keeping event loop responsive
2. **Route-level cache short-circuit** - Checks LLM cache before fetching Schwab quotes, cached results return in ~200ms
3. **React timer decoupling** - Separates cheap ranking refresh (runs on data change) from expensive LLM validation (fixed 60s timer using useRef)
4. **Watchlist shallow equality** - Prevents unnecessary Zustand store updates when polled data hasn't changed
5. **3-layer process cleanup** - Startup stale process check + atexit handler + port-based final sweep
6. **Safe taskkill** - Changed from tree kill (/T) to PID-only kill to prevent killing trader app

**Files**:
- `backend/services/llm_validator.py` - asyncio.to_thread wrapping + get_cached_result()
- `backend/api/routes.py` - Route-level cache + is_available() thread wrapping
- `launcher.py` - 3-layer zombie process defense
- `src/renderer/App.tsx` - Timer decoupling with useRef
- `src/renderer/store/watchlistStore.ts` - Shallow equality check

---

### Catalyst-Response Mismatch Detection (v1.5.0) - Jan 2026
**Status**: ✅ Complete
**Source**: Session 2026-01-26 - LLM Pattern Detection Analysis

**Problem Solved**:
- LLM had no awareness of whether price action was proportional to catalyst quality
- FOMO-driven over-reactions (mediocre catalyst + huge gap) were not flagged
- Under-reactions (strong catalyst + modest gap) were not highlighted as opportunities

**Features**:
1. **Catalyst-Response Analysis Section** - New prompt section evaluating catalyst-to-response ratio
2. **FOMO Over-Reaction Rule** - Critical rule: catalyst_strength <=4 AND gap >20% biases toward "wait"
3. **Mismatch Pattern Guide** - LLM evaluates over-reaction, under-reaction, proportional, and float amplification patterns

**Technical Details**:
- Prompt-only change to `config/prompts/validation_prompt.yaml` (v1.5.0)
- All required variables (`catalyst_strength`, `gap_percent`, `volume_ratio`, `float_formatted`) already existed in context
- No backend code changes needed

**Files**:
- `config/prompts/validation_prompt.yaml` - Added CATALYST-RESPONSE ANALYSIS section + FOMO critical rule

---

### LLM Validation Health-Aware + NoneType Fix (v1.4.2) - Jan 2026
**Status**: ✅ Complete
**Source**: [session-notes/2026-01-23.md](session-notes/2026-01-23.md)

**Problems Solved**:
- DEAD stocks getting BUY signals (example pollution from hardcoded JSON)
- Stocks with null `llm_analysis` causing NoneType validation errors
- Missing health context in LLM prompt (no awareness of DEAD/COOLING status)
- Watchlist showing DEAD stocks (should match trader app behavior)

**Features**:
1. **Health-Aware Validation** - DEAD stocks always get `no_trade`, COOLING gets `wait`
2. **NoneType Safety** - All `.get()` patterns now use `or {}` to handle null values
3. **DEAD Stock Filter** - `/watchlist` endpoint filters DEAD by default (`?include_dead=true` to override)
4. **Rich Health Context** - LLM now sees health_status, price_trend, gap_fade, chase risk

**Technical Details**:
- Python `.get('key', {})` returns None if key exists but value is None - use `or {}` pattern
- Added CRITICAL RULES to prompt template enforcing health-based signals
- Context builder extracts health_metrics for price trend calculation

**Files**:
- `backend/services/llm_validator.py` - NoneType fixes, health context builder
- `backend/api/routes.py` - DEAD stock filter on `/watchlist`
- `config/prompts/validation_prompt.yaml` - v1.2.0 with HEALTH STATUS section

---

### LLM Validation Reliability (v1.4.1) - Jan 2026
**Status**: ✅ Complete
**Source**: [session-notes/2026-01-23.md](session-notes/2026-01-23.md)

**Problems Solved**:
- LLM validation JSON parsing failures (intermittent "Unable to Validate" errors)
- Tooltips going off bottom of page
- Top 3 panel too tall (3rd stock hidden)
- Runners excluded from Top 3 (wrong 5 Pillars calculation)
- Windows backend crash overnight (asyncio ProactorEventLoop)

**Features**:
1. **Robust JSON Extraction** - Two-layer parsing (provider + custom) with error logging
2. **Top 3 Tooltips** - Hover to see 5 Pillars, quality score, LLM signal, reasoning
3. **Runner Support in Top 3** - Uses Day 1 gap/volume instead of today's values
4. **Windows Stability** - WindowsSelectorEventLoopPolicy for asyncio

**Technical Details**:
- `_extract_json_from_response()` - Extracts JSON from markdown, surrounding text
- `_call_llm_with_json_extraction()` - Logs raw response on failures at WARNING level
- `calculate5Pillars()` - Now handles `continuation_play` stocks correctly
- Tooltip CSS uses `transform: translateY(-100%)` to grow upward

**Files**:
- `backend/services/llm_validator.py` - JSON extraction, retry logic
- `backend/main.py` - Windows asyncio policy
- `src/renderer/store/validationStore.ts` - Runner 5 Pillars fix
- `src/renderer/components/panels/Top3ValidationPanel.tsx` - Tooltip component
- `src/renderer/styles/global.css` - Tooltip and panel compaction

---

### LLM Validation Feature (v1.4.0) - Jan 2026
**Status**: ✅ Complete
**Source**: [session-notes/2026-01-22.md](session-notes/2026-01-22.md)

**Features Implemented**:
- **Ollama LLM Integration** - Reuses momentum-trader's qwen2.5:7b infrastructure
- **Top 3 Auto-Validation** - Ranks watchlist by Warrior Trading criteria, validates top 3
- **Manual Validation** - Button in header to validate selected chart
- **Validation Panels** - Top3ValidationPanel and ManualValidationPanel UI components
- **Auto-Start Ollama** - Launcher checks and starts Ollama if not running

**Technical Details**:
- Backend validates via `/api/validate/{symbol}` endpoint
- 60-second cache prevents duplicate LLM calls
- Zustand store manages validation state
- Rich prompt includes 5 Pillars, VWAP, EMAs, catalyst, exit signals

**Files**:
- `backend/services/llm_validator.py` - LLM validation service
- `config/prompts/validation_prompt.yaml` - LLM prompt template
- `src/renderer/store/validationStore.ts` - Validation state management
- `src/renderer/components/panels/Top3ValidationPanel.tsx` - Top 3 UI
- `src/renderer/components/panels/ManualValidationPanel.tsx` - Manual validation UI

---

### Phase 4: Pattern Overlays (v1.3.0) - Jan 2026
**Status**: ✅ Complete
**Source**: [session-notes/2026-01-16.md](session-notes/2026-01-16.md)

**Features Implemented**:
- **Support/Resistance Detection** - Auto-detect key price levels using pivot point clustering
- **Gap Detection** - Identify and highlight price gaps (up/down, with fill tracking)
- **Flag/Pennant Patterns** - Detect consolidation patterns after strong moves
- **Toggle Controls** - User can enable/disable each pattern type independently
- **Visual Indicators** - Pattern badges in chart header, color-coded overlays

**Technical Implementation**:
- Client-side detection (no backend changes required)
- Zustand store for pattern toggle preferences
- useMemo optimization for performance
- Pattern-specific colors: S/R (purple), Gaps (blue), Flag/Pennant (orange)

**Files**:
- `src/renderer/utils/indicators.ts` - 3 pattern detection algorithms
- `src/renderer/store/patternOverlayStore.ts` - Toggle state management
- `src/renderer/components/panels/PatternOverlayControls.tsx` - UI toggle panel
- `src/renderer/components/charts/EnhancedChart.tsx` - Pattern rendering on chart
- `src/renderer/components/charts/MultiChartGrid.tsx` - Pattern calculation/wiring
- `src/renderer/components/panels/AnalysisPanels.tsx` - Controls integration
- `src/renderer/styles/global.css` - Pattern styling

---

### Backend Event Loop Bugfix (v1.2.1) - Jan 2026
**Status**: ✅ Complete
**Source**: [session-notes/2026-01-16.md](session-notes/2026-01-16.md)

**Problem Solved**:
- Chart switching showed wrong data or no data after Exit button feature
- Backend became unresponsive due to asyncio event loop hang
- `asyncio.get_event_loop().call_later()` with `signal.SIGTERM` caused issues on Windows

**Fix**:
- Replaced deprecated `asyncio.get_event_loop()` with `asyncio.create_task()`
- Changed from `signal.SIGTERM` to `sys.exit(0)` for cross-platform compatibility
- Made shutdown function properly async

**Files**:
- `backend/main.py` - Fixed `/api/shutdown` endpoint

---

### Exit Button and Hidden Terminal Launch (v1.2.0) - Jan 2026
**Status**: ✅ Complete
**Source**: [session-notes/2026-01-15.md](session-notes/2026-01-15.md#session-3---exit-button-and-hidden-terminal-launch)

**Problem Solved**:
- No way to cleanly exit app (had to use Task Manager or close terminal)
- Terminal window stayed open during app use (unprofessional)
- Needed cross-platform solution (Windows, macOS, Linux)

**Features**:
1. **Exit Button** - Red button in header
   - IPC chain: UI → preload → main → HTTP shutdown API → app.quit()
   - Signals backend to shutdown gracefully
   - Cleans up all processes (Vite, Electron, Backend)

2. **Hidden Terminal Launch** - Two-stage architecture
   - Stage 1: Batch/shell script does path detection, config generation (visible briefly)
   - Stage 2: Python launcher runs headless with file logging
   - **Windows**: Uses `pythonw.exe` (Python without console) + `start /B`
   - **macOS/Linux**: Uses `nohup` + `disown` (background process)

3. **File Logging** - Logs to `logs/launcher.log`
   - Auto-detects headless mode
   - Essential for debugging when no console

**Files**:
- `src/main/preload.ts` - exitApp IPC method
- `src/main/main.ts` - exit-app handler
- `src/renderer/components/layout/Header.tsx` - Exit button UI
- `src/renderer/styles/global.css` - Button styling
- `launcher.py` - File logging for headless mode
- `Momentum Trader Charts.bat` - Windows hidden launch
- `Momentum Trader Charts.sh` - macOS/Linux hidden launch

---

### Phase 3 Analysis Panels (v1.1.0) - Jan 2026
**Status**: ✅ Complete
**Source**: [session-notes/2026-01-15.md](session-notes/2026-01-15.md#session-2---phase-3-analysis-panels-implementation)

**Problem Solved**:
- Need real-time decision support while trading
- Historical pattern matching for setup validation
- Multi-timeframe trend confirmation

**Features**:
1. **Signal Strength Gauge** - Composite 0-100% score combining:
   - Catalyst quality and type
   - Volume ratio vs average
   - VWAP proximity (above/below)
   - Float size validation
   - Session timing (open, midday, close)

2. **Timeframe Alignment** - Shows trend direction across:
   - 1-minute (scalp)
   - 5-minute (intraday)
   - 15-minute (swing)
   - Daily (position)

3. **Exit Signal Dashboard** - Real-time exit triggers:
   - VWAP loss detection
   - Profit target proximity
   - Volume exhaustion warning
   - Time-based alerts

4. **Similar Past Setups** - Historical pattern matching:
   - Same-symbol trade history
   - Catalyst type matching
   - Price range similarity
   - Gap % correlation
   - Win rate and Avg R statistics

**Files**:
- `src/renderer/components/panels/SignalStrengthGauge.tsx`
- `src/renderer/components/panels/TimeframeAlignment.tsx`
- `src/renderer/components/panels/ExitSignalDashboard.tsx`
- `src/renderer/components/panels/HistoricalPatternMatch.tsx`
- `src/renderer/components/panels/AnalysisPanels.tsx`
- `backend/api/routes.py` (added `/api/trade-history` endpoint)

---

### Smart Launcher Scripts (v1.0.0) - Jan 2026
**Status**: ✅ Complete
**Source**: [session-notes/2026-01-15.md](session-notes/2026-01-15.md)

**Problem Solved**:
- Backend failed with `FileNotFoundError` when data directory path didn't exist
- Relative paths in `config/charting.yaml` broke when working directory changed
- No easy way to find momentum-trader installation location

**Features**:
- **Windows Launcher** (`Momentum Trader Charts.bat`)
  - Auto-detects charting app location
  - Auto-detects momentum-trader location
  - Updates `config/charting.yaml` with absolute paths
  - Creates missing data directories
  - Can be copied anywhere (Desktop) and still work

- **Linux/Mac Launcher** (`Momentum Trader Charts.sh`)
  - Same functionality as Windows version
  - Uses bash syntax and Unix paths

**Files**:
- `Momentum Trader Charts.bat` (NEW)
- `Momentum Trader Charts.sh` (NEW)
- `scripts/start-backend.bat` (MODIFIED - delegates to main launcher)
- `scripts/start-backend.sh` (MODIFIED - delegates to main launcher)

---

## Core Charting - Phase 1

### Candlestick Charts
**Status**: PARTIALLY IMPLEMENTED
**Priority**: High

**Current State**:
- TradingView Lightweight Charts library integrated
- Basic chart rendering works

**Planned Enhancements**:
- [ ] Proper candle coloring (green/red)
- [ ] Volume bars below price chart
- [ ] Time axis formatting for market hours
- [ ] Zoom and pan controls
- [ ] Crosshair with price/time display

### Multi-Chart Grid Layout
**Status**: PARTIALLY IMPLEMENTED
**Priority**: High

**Current State**:
- Primary chart + 4 secondary charts layout defined
- Grid structure in place

**Planned Enhancements**:
- [ ] Click to expand any chart to full screen
- [ ] Drag to reorder charts
- [ ] Save/restore layout preferences
- [ ] Responsive layout for different screen sizes

---

## Watchlist Display - Phase 1

### Real-time Watchlist
**Status**: PARTIALLY IMPLEMENTED
**Priority**: High

**Current State**:
- Reads `watchlist_state.json` from momentum-trader
- File watcher detects changes

**Planned Enhancements**:
- [ ] Color coding by % change (green/red gradient)
- [ ] Sort by various columns (change %, volume, etc.)
- [ ] Click to load symbol into primary chart
- [ ] Show entry price if position exists
- [ ] Mini sparkline for each symbol

---

## Heatmap - Phase 1

### Watchlist Heatmap
**Status**: NOT IMPLEMENTED
**Priority**: Medium

**Description**:
Visual grid showing all watchlist symbols with color intensity based on % change.

**Features**:
- [ ] Color gradient: deep red (-5%+) to deep green (+5%+)
- [ ] Size boxes by volume or market cap
- [ ] Hover to show details
- [ ] Click to load into chart
- [ ] Group by sector (if data available)

---

## Technical Indicators - Phase 2

### VWAP (Volume Weighted Average Price)
**Status**: NOT IMPLEMENTED
**Priority**: High

**Description**:
Essential indicator for day trading - shows average price weighted by volume.

**Features**:
- [ ] VWAP line on chart
- [ ] Standard deviation bands (optional)
- [ ] Reset at market open each day

### Moving Averages
**Status**: NOT IMPLEMENTED
**Priority**: Medium

**Features**:
- [ ] 9 EMA (fast)
- [ ] 20 EMA (medium)
- [ ] 50 SMA (slow)
- [ ] Configurable periods and types

### Volume Profile
**Status**: NOT IMPLEMENTED
**Priority**: Low

**Description**:
Horizontal histogram showing volume at each price level.

**Features**:
- [ ] POC (Point of Control) line
- [ ] Value area highlighting
- [ ] Session vs. visible range options

---

## Multi-Day Runners Panel - Phase 2

### Continuation Play Tracker
**Status**: NOT IMPLEMENTED
**Priority**: Medium

**Description**:
Dedicated panel showing stocks that ran multiple days.

**Features**:
- [ ] Read from `runners.json`
- [ ] Show multi-day price history
- [ ] Highlight support/resistance levels
- [ ] Calculate potential continuation targets

---

## Chart Annotations - Phase 2

### Entry/Exit Markers
**Status**: NOT IMPLEMENTED
**Priority**: Medium

**Features**:
- [ ] Show trade entries as green arrows
- [ ] Show exits as red arrows
- [ ] Connect entry/exit with P&L line
- [ ] Read from momentum-trader trade history

### Notes and Labels
**Status**: NOT IMPLEMENTED
**Priority**: Low

**Features**:
- [ ] Add text notes to chart
- [ ] Draw trend lines
- [ ] Mark support/resistance levels
- [ ] Save annotations per symbol

---

## WebSocket Events - Phase 3

### Live Updates from Momentum Trader
**Status**: NOT IMPLEMENTED
**Priority**: High

**Description**:
Real-time event stream from main momentum-trader app.

**Features**:
- [ ] New signal alerts
- [ ] Position opened/closed
- [ ] Watchlist updates
- [ ] Price alerts triggered

---

## Signal Overlay - Phase 3

### Buy/Sell Signal Markers
**Status**: NOT IMPLEMENTED
**Priority**: High

**Features**:
- [ ] Show buy signals as up arrows
- [ ] Show sell/skip signals as down arrows
- [ ] Color by signal strength/confidence
- [ ] Click to see signal details (catalyst, pattern, etc.)

---

## Position Tracking - Phase 3

### Open Position Display
**Status**: NOT IMPLEMENTED
**Priority**: Medium

**Features**:
- [ ] Show entry price line on chart
- [ ] Show stop loss line (red dashed)
- [ ] Show target price line (green dashed)
- [ ] Real-time P&L calculation
- [ ] Position size and risk display

---

## Pattern Overlays - Phase 4

### Technical Pattern Visualization
**Status**: ✅ IMPLEMENTED (v1.3.0)
**Priority**: Low

**Features**:
- [x] Flag/pennant detection with pattern strength indicators
- [x] Support/resistance auto-detection using pivot point clustering
- [x] Gap identification (up/down gaps with fill tracking)
- [x] Highlight pattern formations on chart
- [x] Toggle controls for each pattern type
- [x] Pattern counts displayed in controls panel

**Implementation Details**:
- Client-side pattern detection (no backend changes)
- Zustand store for toggle states
- Color-coded overlays: S/R (purple), Gaps (blue), Flag/Pennant (orange)
- Pattern badges in chart header when detected

**Files**:
- `src/renderer/utils/indicators.ts` - Pattern detection algorithms
- `src/renderer/store/patternOverlayStore.ts` - Toggle state management
- `src/renderer/components/panels/PatternOverlayControls.tsx` - UI controls
- `src/renderer/components/charts/EnhancedChart.tsx` - Pattern rendering
- `src/renderer/components/charts/MultiChartGrid.tsx` - Pattern calculation

---

## Trade Entry Panel - Phase 4

### Quick Trade Execution
**Status**: NOT IMPLEMENTED
**Priority**: Low

**Description**:
Panel for executing trades directly from charting app.

**Features**:
- [ ] Buy/Sell buttons
- [ ] Position size calculator
- [ ] Risk calculator
- [ ] One-click order entry
- [ ] Paper trading mode toggle

**Note**: This would require write access to momentum-trader's API.

---

## Replay Mode - Phase 4

### Session Replay
**Status**: NOT IMPLEMENTED
**Priority**: Low

**Description**:
Replay past trading sessions to review decisions.

**Features**:
- [ ] Load historical data for specific date
- [ ] Step through candles one at a time
- [ ] Show signals as they would have appeared
- [ ] Compare actual trades vs. signals
- [ ] Export replay to video/gif

---

## Infrastructure Enhancements

### Error Handling
**Status**: PARTIALLY IMPLEMENTED
**Priority**: Medium

**Features**:
- [ ] Graceful handling when momentum-trader not running
- [ ] Retry logic for API failures
- [x] Clear error messages in UI (chart error overlay added Jan 2026)
- [x] Connection status indicator (header shows connected/disconnected/error)
- [x] Semaphore timeout prevents indefinite hangs (10s timeout, Jan 2026)
- [x] Zombie process cleanup on startup and exit (3-layer defense, Jan 2026)

### Performance Optimization
**Status**: PARTIALLY IMPLEMENTED
**Priority**: Low

**Features**:
- [ ] Lazy load charts (only render visible)
- [ ] Throttle file watcher updates
- [x] Cache API responses (route-level LLM cache + watchlist TTL cache)
- [ ] Virtualized lists for large watchlists
- [x] asyncio.to_thread for blocking LLM calls (prevents event loop freeze, Jan 2026)
- [x] React validation timer decoupled from watchlist polling (60s fixed timer, Jan 2026)
- [x] Watchlist shallow equality check (prevents unnecessary re-renders, Jan 2026)

---

## Integration Ideas (Future)

### Mobile Companion
**Status**: NOT IMPLEMENTED
**Priority**: Low

**Description**:
Mobile app showing key charts and alerts.

### Trading Journal Integration
**Status**: NOT IMPLEMENTED
**Priority**: Low

**Description**:
Export chart screenshots and trade data to trading journal.

### Discord/Telegram Bot
**Status**: NOT IMPLEMENTED
**Priority**: Low

**Description**:
Share chart screenshots to chat channels.

---

## LLM Pattern Detection - Phase 5

> **Source**: `momentum-trader/docs/HIGH_VALUE_LLM_PATTERN_DETECTION.md`
> **Goal**: Push win rate above 65% by giving the LLM context that humans can't synthesize in real-time.
> **Principle**: Use LLMs as **filters** (reduce bad trades) rather than **predictors** (pick good trades).
> **Note**: Idea #1 (Catalyst-Response Mismatch) was implemented in v1.5.0. Ideas #2-#5 below require additional data infrastructure.

### Idea #2: Multi-Stock Sector Momentum Correlation - Phase 5
**Status**: BLOCKED (waiting on trader app API endpoint)
**Priority**: MEDIUM-HIGH

**Description**:
Tells the LLM whether the stock has sector tailwind (related stocks also strong) or headwind. A biotech gapping up when XLV is down 2% is a very different setup than when XLV is up 1%.

**Current State**:
The `MarketContextAnalyzer` in the trader app (`momentum-trader/src/analysis/market_context_analyzer.py`) already tracks:
- 11 sector ETFs: XLK, XLF, XLV, XLE, XLI, XLC, XLY, XLP, XLU, XLRE, XLB
- VIX level and trend
- Market heat index
- Strong/weak sector identification

This data is **NOT** currently exposed via any API endpoint. The charting app has no access to it.

**Implementation Path**:
1. **Trader app**: Add `/api/market-context` endpoint to `momentum-trader/src/web/api.py` returning sector ETF performance, market heat, strong/weak sectors, and VIX
2. **Charting app backend**: Fetch market context from trader app (same pattern as existing watchlist fetch at `localhost:8080/api/watchlist`)
3. **Charting app prompt**: Add `## SECTOR CONTEXT` section to `validation_prompt.yaml` with sector ETF data, market heat, and whether the stock's sector has tailwind/headwind
4. No LLM code changes needed - just more context in the prompt

**Value**: The LLM currently has zero awareness of broader market conditions. Sector tailwind/headwind is one of the strongest filters for whether a gap trade will hold or fade.

---

### Idea #3: News Headline Sentiment Trajectory - Phase 5
**Status**: BLOCKED (waiting on trader app headline aggregation)
**Priority**: MEDIUM

**Description**:
Scores whether the narrative around a stock is building (escalating coverage, bigger outlets picking it up) or fading (weaker follow-ups, corrections appearing). A stock with 1 headline at 7 AM is different from one with 5 increasingly bullish headlines over 24 hours.

**Current State**:
The trader app has:
- `NewsAggregator` (`momentum-trader/src/data/news_aggregator.py`) pulling from FMP, Yahoo RSS, SEC 8-K filings, and Schwab streaming
- `CatalystClassifier` (`momentum-trader/src/streaming/catalyst_classifier.py`) categorizing headlines into CRITICAL/HIGH/MEDIUM/LOW/NEGATIVE tiers

However, this data is per-headline, not aggregated into a trajectory per symbol over time.

**Implementation Path**:
1. **Trader app**: Build a headline trajectory aggregator that collects all headlines for a symbol over 48 hours and scores the trajectory (building/stable/fading)
2. **Trader app**: Expose trajectory data via API (extend `/api/watchlist` response or add `/api/headline-trajectory/{symbol}`)
3. **Charting app**: Fetch trajectory data and include in LLM context
4. **Charting app prompt**: Add `## NARRATIVE TRAJECTORY` section showing headline count, source escalation, and trajectory score

**Value**: Answers the #1 question for gap trades: "Is this catalyst real or fading?" Directly addresses whether buying pressure will continue through the trading session.

---

### Idea #4: Historical Analog Matching - Phase 5
**Status**: NOT IMPLEMENTED
**Priority**: HIGH

**Description**:
Finds the most similar past trades from `trade_outcomes.jsonl` and tells the LLM "setups like this have won 4 out of 5 times." Grounded in actual trade data, not generic patterns.

**Current State**:
- The charting app has a `HistoricalPatternMatch.tsx` panel that displays historical analogs in the UI
- The trader app has `trade_outcomes.jsonl` with full context for each trade (gap_pct, float, catalyst_type, volume_ratio, time, outcome)
- There is **no** vector similarity function to find top-N analogs
- Historical analog data is **not** passed to the LLM during validation

**Implementation Path**:
1. **Charting app backend**: Build a similarity scoring function comparing current stock context against historical trades using: gap_pct, float, catalyst_type, volume_ratio, time_of_day, market_heat
2. **Charting app backend**: Find top 5 most similar trades and their outcomes (win/loss, P&L)
3. **Charting app prompt**: Add `## HISTORICAL ANALOGS` section showing closest matches and their outcomes
4. **LLM evaluation**: Ask the LLM to compare current setup vs. analogs and adjust confidence based on historical outcomes

**Value**: Rated HIGHEST priority in the source document. This is the strongest use case because it's grounded in real trade data. Could be the single biggest contributor to pushing win rate above 65%.

---

### Idea #5: Float/Catalyst/Time Interaction Analysis - Phase 5
**Status**: BLOCKED (waiting on 4+ weeks of signal_events data)
**Priority**: MEDIUM

**Description**:
Identifies 3-way interaction patterns that humans can't track in real-time. Example outputs:
- "Sub-5M float + earnings catalyst + first 30 minutes = high win rate"
- "Sub-5M float + PR catalyst + after 10:30 = low win rate (momentum faded)"
- "Sub-1M float + any catalyst + after 11:00 = very low win rate (liquidity trap)"

**Current State**:
The `signal_events` table from v1.45.0 Signal Intelligence is collecting gate decisions and theoretical outcomes via EOD backfill. The data needs 2-4 weeks of collection before interaction analysis is statistically meaningful (minimum n >= 10 per combination).

**Implementation Path**:
1. **Wait for data maturity**: Minimum 2-4 weeks of `signal_events` with EOD backfill
2. **Trader app**: Run aggregation queries to identify profitable/unprofitable float x catalyst x time combinations (SQL examples in `HIGH_VALUE_LLM_PATTERN_DETECTION.md`)
3. **Build filter rules**: Convert statistically significant patterns into concrete rules
4. **Charting app prompt**: Add `## INTERACTION PROFILE` section showing the historical win rate for the current stock's specific float/catalyst/time combination

**Value**: Produces concrete, data-driven filter rules. Example: "Sub-1M float + PR catalyst + after 11:00 AM has a 23% win rate across 15 signals - avoid." Most rigorous approach but requires the most data.

---

### Phase 5 Implementation Priority

| Idea | Change Type | Dependency | Implement When |
|------|-------------|------------|----------------|
| **#1 Catalyst-Response** | Prompt-only | None | **Done** (v1.5.0) |
| **#2 Sector Momentum** | Prompt + API | Trader app `/api/market-context` endpoint | After trader app exposes sector data |
| **#4 Historical Analogs** | Backend + Prompt | Similarity function + trade data access | Next major feature cycle |
| **#3 Headline Trajectory** | Prompt + API | Trader app headline aggregation | After trader app builds trajectory |
| **#5 Interaction Analysis** | Backend + Prompt | 4+ weeks signal_events data | After data maturity |

---

## Trader App Alignment - Phase 6

> **Source**: Review of Momentum Trader enhancements from Feb 2-6, 2026
> **Goal**: Align charting app with trader app's new streaming data and pattern detection capabilities
> **Principle**: Leverage existing trader app infrastructure rather than duplicate functionality

### Idea #6: Real-Time VWAP from Streaming Cache
**Status**: ✅ IMPLEMENTED
**Priority**: HIGH
**Trader App Version**: v2.6.0
**Source**: [session-notes/2026-02-06.md](session-notes/2026-02-06.md)

**Description**:
The trader app now calculates VWAP in real-time using streaming quote data (volume delta accumulation), eliminating stale REST values. The charting app consumes this fresh VWAP data via proxy endpoints.

**Implementation Summary**:
- **Trader app**: Added `/api/vwap/{symbol}` and `/api/vwap` endpoints exposing VwapCache data
- **Charting backend**: Added VWAP proxy endpoints in `routes.py` (lines 78-138)
- **Charting frontend**: Created `useStreamingVWAP` hook with 2s polling interval
- **Visual indicator**: VWAP badge shows source dot (green=stream, yellow=rest, gray=local)
- **Fallback**: Automatic fallback to local VWAP when trader app unavailable

**Files Modified**:
- `momentum-trader/src/data/vwap_cache.py` - Added `get_all()` method
- `momentum-trader/src/web/api.py` - Added VWAP API endpoints
- `momentum-trader-charting/backend/api/routes.py` - Added VWAP proxy
- `momentum-trader-charting/src/renderer/hooks/useStreamingVWAP.ts` - NEW
- `momentum-trader-charting/src/renderer/components/charts/EnhancedChart.tsx` - Integrated streaming VWAP
- `momentum-trader-charting/src/renderer/styles/global.css` - Source indicator styling

**Value**: Ensures charting app shows same VWAP values as trader app's Gate 4 decisions. Critical for visual confirmation of VWAP reclaim patterns.

---

### Idea #7: Volume Spike Alert Overlay
**Status**: NOT IMPLEMENTED
**Priority**: HIGH
**Trader App Version**: v2.7.0

**Description**:
The trader app detects real-time volume spikes from streaming quotes and triggers pattern re-scans. The charting app should visually highlight these volume spike events on charts.

**Current State**:
- Trader app detects volume acceleration (3x normal for Normal preset, 2x for Scalper)
- First-hour sensitivity boost (0.8x threshold 9:30-10:30 AM)
- 5-second debounce prevents rapid re-scans
- No visual indication in charting app when volume spike occurs

**Implementation Path**:
1. **Trader app**: Emit volume spike events via WebSocket/SocketIO to charting app
2. **Charting app backend**: Subscribe to volume spike events from trader app
3. **Charting app frontend**: Show visual alert (flash, badge, or volume bar highlight) when spike detected
4. **Configuration**: Allow user to toggle volume spike alerts on/off

**Value**: Visual confirmation of the same volume spikes that trigger trader app re-scans. Helps trader understand why a stock suddenly got a new signal.

---

### Idea #8: ABCD Fibonacci Pattern Overlay
**Status**: NOT IMPLEMENTED
**Priority**: MEDIUM
**Trader App Version**: v1.57.0

**Description**:
The trader app now detects ABCD Fibonacci patterns with swing highs/lows, BC retracement validation (38.2-78.6%), and measured move targets. The charting app should visualize these patterns.

**Current State**:
- Trader app has full ABCD detection in `pattern_detector.py`
- Swing detection with 2-candle confirmation
- Fibonacci validation and measured move target calculation
- Pattern coverage now 10/11 Warrior Trading strategies (91%)

**Implementation Path**:
1. **Trader app**: Expose detected ABCD patterns via API (A, B, C, D points + target)
2. **Charting app backend**: Fetch ABCD patterns for displayed symbols
3. **Charting app frontend**: Draw ABCD overlay on chart:
   - Connect A-B-C-D swing points with lines
   - Show Fibonacci retracement levels
   - Display measured move target line
4. **Toggle control**: Add ABCD to pattern overlay controls panel

**Value**: Visualize the same ABCD patterns the trader app uses for signals. Helps trader understand entry/target levels for ABCD setups.

---

### Idea #9: Options Flow Indicator Panel
**Status**: NOT IMPLEMENTED
**Priority**: MEDIUM
**Trader App Version**: v2.4.0

**Description**:
The trader app integrates real-time options flow from Schwab's LEVELONE_OPTIONS streaming, detecting sweeps and golden sweeps (>$1M premium). The charting app should display options flow activity.

**Current State**:
- Trader app has `OptionsFlowAnalyzer` and `OptionsFlowCache`
- Detects call/put flow imbalance (~90% direction accuracy)
- Golden sweep detection (>$1M premium, >100 contracts)
- Confidence boost: +20 golden sweep, +15 multi-strike sweeps

**Implementation Path**:
1. **Trader app**: Expose `/api/options-flow/{symbol}` endpoint with recent flow data
2. **Charting app backend**: Fetch options flow for displayed symbols
3. **Charting app frontend**: New "Options Flow" panel showing:
   - Call/Put ratio bar
   - Recent sweeps list (size, strike, expiry, premium)
   - Golden sweep alerts (highlighted)
4. **Integration**: Show options flow confidence boost in LLM validation context

**Value**: Options flow is a leading indicator often signaling institutional interest before price moves. Valuable context for trade decisions.

---

### Idea #10: Gate System Visualization
**Status**: NOT IMPLEMENTED
**Priority**: MEDIUM

**Description**:
The trader app uses a multi-gate system (MTF → VWAP → Heat) for signal validation. The charting app should visualize which gates are passing/failing for the current stock.

**Current State**:
- Gate 1: Multi-Timeframe alignment (soft gate)
- Gate 2: VWAP position (soft gate)
- Gate 3: Market heat threshold (hard gate)
- Gate status determines signal acceptance/rejection

**Implementation Path**:
1. **Trader app**: Expose gate status in `/api/watchlist` or `/api/signals/{symbol}` response
2. **Charting app backend**: Include gate status when fetching stock data
3. **Charting app frontend**: Gate status panel showing:
   - MTF gate: Pass/Fail with timeframe details
   - VWAP gate: Pass/Fail with price vs VWAP
   - Heat gate: Pass/Fail with current heat value
4. **Visual cues**: Color-coded gates (green pass, red fail, yellow soft-fail)

**Value**: Transparency into why signals are accepted or rejected. Helps trader understand the trader app's decision-making process.

---

### Idea #11: Position Monitor Streaming Status
**Status**: NOT IMPLEMENTED
**Priority**: LOW
**Trader App Version**: v2.5.0

**Description**:
The trader app now has event-driven position monitoring (<100ms latency vs 2-5s polling). The charting app should show position status and stop-loss proximity.

**Current State**:
- Trader app has streaming position monitor with double-exit prevention
- Stop-loss triggers in <100ms
- Connectivity status indicator in trader app UI

**Implementation Path**:
1. **Trader app**: Expose position stream events to charting app
2. **Charting app backend**: Subscribe to position updates
3. **Charting app frontend**:
   - Show entry line on chart for open positions
   - Show stop-loss line (red) with proximity warning
   - Flash/alert when stop-loss is approaching
4. **Status indicator**: Show position monitor connectivity status

**Value**: Real-time awareness of position risk without switching to trader app.

---

### Phase 6 Implementation Priority

| Idea | Change Type | Dependency | Implement When |
|------|-------------|------------|----------------|
| **#6 Real-Time VWAP** | Backend + Frontend | Trader app `/api/vwap` endpoint | **Done** (2026-02-06) |
| **#7 Volume Spike Alerts** | Backend + Frontend | Trader app WebSocket events | High priority - visual feedback for re-scans |
| **#8 ABCD Pattern Overlay** | Backend + Frontend | Trader app pattern API | Medium priority - after core overlays stable |
| **#9 Options Flow Panel** | Backend + Frontend | Trader app `/api/options-flow` endpoint | Medium priority - valuable context |
| **#10 Gate Visualization** | Backend + Frontend | Trader app gate status in API | Medium priority - transparency feature |
| **#11 Position Monitor** | Backend + Frontend | Trader app position stream | Low priority - nice-to-have |

---

**Last Updated**: 2026-02-06
**Maintain this file** as features are implemented and new ideas emerge
