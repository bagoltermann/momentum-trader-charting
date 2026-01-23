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

### Infrastructure
- [Smart Launcher Scripts](#smart-launcher-scripts) - Auto-detection startup

---

## Recently Implemented ✅

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
**Status**: NOT IMPLEMENTED
**Priority**: Medium

**Features**:
- [ ] Graceful handling when momentum-trader not running
- [ ] Retry logic for API failures
- [ ] Clear error messages in UI
- [ ] Connection status indicator

### Performance Optimization
**Status**: NOT IMPLEMENTED
**Priority**: Low

**Features**:
- [ ] Lazy load charts (only render visible)
- [ ] Throttle file watcher updates
- [ ] Cache API responses
- [ ] Virtualized lists for large watchlists

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

**Last Updated**: 2026-01-23
**Maintain this file** as features are implemented and new ideas emerge
