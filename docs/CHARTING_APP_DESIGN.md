# Momentum Trader Charting App - Design Document

**Status**: Design Complete - Implementation In Progress
**Created**: 2026-01-14
**Moved From**: `momentum-trader/docs/CHARTING_APP_DESIGN.md`
**Priority**: HIGH
**Total Effort**: 40-60 hours (4 phases)

---

## Executive Summary

Design a **standalone charting application** for the Momentum Trader system that provides professional day trader visualization without impacting the core trading app's execution. The app will consume data passively (file-based + REST API polling) and implement Warrior Trading methodology visualization with novel decision-support features.

---

## 1. Architecture Overview

### Independence Strategy

```
+-------------------------------------------------------------------+
|                    MOMENTUM TRADER (Existing)                      |
|  +---------------------------------------------------------------+ |
|  | Main Trading Loop (untouched)                                 | |
|  | - Market scanning, signal generation, trade execution         | |
|  +---------------------------------------------------------------+ |
|  +---------------------------------------------------------------+ |
|  | Data Layer (read-only by charting app)                        | |
|  | - data/watchlist_state.json                                   | |
|  | - data/runners.json                                           | |
|  | - data/trades/trade_history.json                              | |
|  | - data/paper_trading_state.json                               | |
|  | - REST API: localhost:8080/api/*                              | |
|  +---------------------------------------------------------------+ |
+-------------------------------------------------------------------+
                              | (Read-only access)
                              v
+-------------------------------------------------------------------+
|                  CHARTING APP (New - Standalone)                   |
|  +--------------+  +--------------+  +--------------------------+ |
|  | Data Poller  |  | Chart Engine |  | Decision Support UI      | |
|  | (file watch) |  | (Lightweight |  | (Entry zones, R:R,       | |
|  |              |  |  Charts)     |  |  Warrior patterns)       | |
|  +--------------+  +--------------+  +--------------------------+ |
|  +---------------------------------------------------------------+ |
|  | Own Schwab Client (shares tokens - per-machine, not per-app)  | |
|  | - Dedicated price history fetching                            | |
|  | - No impact on main app's API quota                           | |
|  +---------------------------------------------------------------+ |
+-------------------------------------------------------------------+
```

### Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Desktop Runtime** | **Electron** | Proven ecosystem, extensive plugin support, used by VS Code/Slack |
| **Frontend** | React + TypeScript | Modern, component-based, excellent tooling |
| **Charting Library** | TradingView Lightweight Charts v5 | 35kB, multi-pane, Apache 2.0, used by 40K+ companies |
| **Backend** | Python FastAPI | Fast async, native Python for Schwab client reuse |
| **Data Sync** | File watcher + REST polling + WebSocket events | Real-time updates with minimal main app changes |
| **IPC** | Electron IPC + WebSocket | Frontend <-> Python backend communication |

---

## 2. Data Access Strategy

### Zero-Impact Data Sources (Primary)

| Source | Access Method | Update Frequency | Data |
|--------|---------------|------------------|------|
| `data/watchlist_state.json` | File watch (chokidar/watchdog) | Real-time on change | Current watchlist with all metadata |
| `data/runners.json` | File watch | On update | Multi-day runners, entry zones |
| `data/trades/trade_history.json` | File watch | On new trade | Trade history |
| `data/paper_trading_state.json` | File watch | On position change | Open positions, P&L |
| `localhost:8080/api/status` | REST poll (5s) | 5 seconds | Overall app status |
| `localhost:8080/api/positions` | REST poll (5s) | 5 seconds | Live position data |

### Own Data Fetching (Separate from main app)

The charting app will have its **own Schwab client instance** for price history:

```python
# backend/services/schwab_client.py
class ChartSchwabClient:
    """
    Dedicated Schwab client for charting app.
    Shares tokens with main app (tokens are per-machine, not per-app).
    Only fetches price history - no trading operations.
    """
    def get_candles(self, symbol: str, timeframe: str) -> List[Candle]:
        # Timeframes: 1m, 5m, 15m, daily
        pass

    def get_quotes(self, symbols: List[str]) -> Dict[str, Quote]:
        # Real-time quotes for active watchlist
        pass
```

### Token Sharing Strategy (Simplified)

**Key Discovery:** Schwab OAuth tokens are **per-machine, not per-app**. This means:
- Both apps can share the same `data/tokens/schwab_tokens.json` on the same machine
- No token conflicts when both apps run simultaneously
- Main momentum trader app handles token refresh (already implemented)
- Charting app only reads tokens - never writes or refreshes

```
+-------------------------------------------------------------------+
|                    SAME MACHINE (Windows or Mac)                   |
|                                                                    |
|  +---------------------+       +---------------------+             |
|  |  Momentum Trader    |       |   Charting App      |             |
|  |  (Main App)         |       |   (New)             |             |
|  |                     |       |                     |             |
|  |  - Token refresh    |       |  - Read-only tokens |             |
|  |  - Trading ops      |       |  - Price history    |             |
|  |  - Position mgmt    |       |  - Quotes           |             |
|  +----------+----------+       +----------+----------+             |
|             |                             |                        |
|             +-------------+---------------+                        |
|                           v                                        |
|              +------------------------+                            |
|              | data/tokens/           |                            |
|              | schwab_tokens.json     |                            |
|              | (Shared - Read by both)|                            |
|              +------------------------+                            |
+-------------------------------------------------------------------+
```

**When Switching Machines (Mac <-> Windows):**
- Regenerate tokens on the new machine using `generate-tokens.sh` or `generate-tokens.bat`
- Both apps on that machine will use the new tokens
- This is existing behavior - no change required

**Graceful Degradation:**
- Circuit breaker for Schwab API failures
- Fall back to cached data if API unavailable
- Continue displaying charts with stale data + warning indicator

---

## 3. Feature Design

### 3.1 Core Charting Features

#### Multi-Chart Grid Layout
```
+-------------------------------------------------------------------+
| [Market Heat: HOT] [Positions: 2] [Daily P&L: +$127.50]           |
+-------------------------------+-----------------------------------+
|        PRIMARY CHART          |     SECONDARY CHARTS (2x2)        |
|   (Selected/Active Stock)     |  +-------------+-------------+    |
|                               |  |   #2 Runner |   #3 Runner |    |
|   +-------------------------+ |  |   (5m)      |   (5m)      |    |
|   |     1-min Candlestick   | |  +-------------+-------------+    |
|   |     + VWAP overlay      | |  |   #4 Runner |   #5 Runner |    |
|   |     + Entry zone bands  | |  |   (5m)      |   (5m)      |    |
|   +-------------------------+ |  +-------------+-------------+    |
|   [1m] [5m] [15m] [D]         |                                   |
+-------------------------------+-----------------------------------+
|                      WATCHLIST HEATMAP                            |
|  [LFS +18%] [SOGP +34%] [ABC +12%] [DEF +9%] ...                 |
+-------------------------------------------------------------------+
```

#### Chart Types (Novel Approaches)

1. **Standard Candlesticks** - 1m, 5m, 15m, daily timeframes
2. **VWAP Bands Chart** - VWAP with +/- 1, 2, 3 standard deviation bands
3. **Volume Profile (Horizontal)** - Shows price levels with highest volume
4. **Entry Zone Overlay** - Visual bands showing:
   - Green zone: Ideal entry (near VWAP, within pattern)
   - Yellow zone: Acceptable (slightly extended)
   - Red zone: Chase territory (>3.5% above VWAP)

### 3.2 Warrior Trading Visualization Tools

#### "5 Pillars" Quick Assessment Panel
```
+-----------------------------------------+
|  LFS - 5 PILLARS CHECK                  |
|  ---------------------------------------+
|  [x] Gap 10%+         18.2%             |
|  [x] Rel Volume 5x+   14.3x             |
|  [x] Float <20M       6.3M              |
|  [x] Price $2-$20     $2.92             |
|  [?] Catalyst         OTHER (70% conf)  |
|  ---------------------------------------+
|  SCORE: 4.5/5  |  OBVIOUS RANK: #2      |
+-----------------------------------------+
```

#### Risk:Reward Visualization
```
On-chart overlay showing:
- Entry price line (blue)
- Stop loss zone (red band with $ risk displayed)
- Target 1 (2R) zone (green band)
- Target 2 (3R) zone (light green band)
- Real-time R multiple as price moves
```

#### Micro-Pullback Pattern Detector
- Visual annotation when flat-top consolidation detected
- "BREAKOUT SETUP" label with entry trigger price
- Automatic stop placement at consolidation low

### 3.3 Novel Decision Support Features

#### 1. Cognitive Load Reducer - "Signal Strength Gauge"
```
+--------------------------+
|    SIGNAL STRENGTH       |
|    ============---- 75%  |
|                          |
|  Contributing Factors:   |
|  + Strong catalyst       |
|  + High volume ratio     |
|  + Near VWAP             |
|  - Extended from D1 low  |
|  - Late in session       |
+--------------------------+
```
Single visual gauge combining all factors into one actionable metric.

#### 2. "Time Pressure Indicator"
- Visual countdown showing optimal entry window
- Based on signal expiration (20 min default)
- Color gradient: Green (fresh) -> Yellow (aging) -> Red (stale)

#### 3. Multi-Timeframe Alignment Display
```
+-----------------------------+
|  TIMEFRAME ALIGNMENT        |
|  1m:  ^ Bullish pattern     |
|  5m:  ^ Higher lows         |
|  15m: ^ Above VWAP          |
|  D:   o Mid-range (neutral) |
|                             |
|  ALIGNMENT: 3/4 BULLISH     |
+-----------------------------+
```

#### 4. "The Obvious Stock" Highlighter
- Automatic visual emphasis on #1-3 gainers
- Pulsing border effect on most obvious setup
- Rank badge display

#### 5. Exit Signal Dashboard
Real-time monitoring with visual alerts:
```
+-----------------------------+
|  EXIT SIGNALS (LFS)         |
|  ---------------------------+
|  MACD Crossover:    [OK]    |
|  Volume Decline:    [OK]    |
|  Jackknife Reject:  [OK]    |
|  Price vs Stop:     [OK]    |
|  ---------------------------+
|  STATUS: HOLD POSITION      |
+-----------------------------+
```
Lights turn yellow (warning) or red (exit now) based on conditions.

#### 6. Historical Pattern Match Preview (Novel)
When viewing a setup, show thumbnails of similar historical patterns:
```
+-----------------------------------------+
|  SIMILAR PAST SETUPS (from your trades) |
|  +-----+ +-----+ +-----+                |
|  |Win  | |Win  | |Loss |  Win Rate: 67% |
|  |+2.1R| |+1.8R| |-1R  |  Avg R: +1.3   |
|  +-----+ +-----+ +-----+                |
+-----------------------------------------+
```
Uses trade_history.json to find similar setups by gap%, float, catalyst type.

### 3.4 Live Trading Mode Features

When running in live trading mode:

1. **Position P&L Tracker** - Real-time unrealized P&L with color coding
2. **Account Equity Curve** - Intraday equity line chart
3. **Risk Utilization Bar** - Visual of daily max loss remaining
4. **Active Order Display** - Pending orders with fill status

---

## 4. Project Structure

```
momentum-trader-charting/
├── README.md
├── package.json                    # Root workspace config
├── electron-builder.json           # Electron build config
│
├── src/
│   ├── main/                       # Electron main process
│   │   ├── main.ts                 # Electron entry point
│   │   ├── preload.ts              # Preload script for IPC
│   │   └── ipc-handlers.ts         # IPC message handlers
│   │
│   └── renderer/                   # React frontend
│       ├── App.tsx                 # Main app component
│       ├── index.tsx               # React entry point
│       ├── index.html              # HTML template
│       │
│       ├── components/
│       │   ├── charts/
│       │   │   ├── CandlestickChart.tsx      # Core chart with Lightweight Charts
│       │   │   ├── VWAPBandsOverlay.tsx      # VWAP + std dev bands
│       │   │   ├── RiskRewardOverlay.tsx     # Entry/stop/target zones
│       │   │   ├── VolumeProfile.tsx         # Horizontal volume distribution
│       │   │   ├── SignalAnnotation.tsx      # Pattern/signal markers
│       │   │   └── MultiChartGrid.tsx        # Grid layout manager
│       │   │
│       │   ├── panels/
│       │   │   ├── WatchlistHeatmap.tsx      # Color-coded watchlist tiles
│       │   │   ├── FivePillarsPanel.tsx      # Warrior Trading criteria check
│       │   │   ├── SignalStrengthGauge.tsx   # 0-100% decision gauge
│       │   │   ├── TimeframeAlignment.tsx    # Multi-TF trend arrows
│       │   │   ├── ExitSignalDashboard.tsx   # MACD/volume/jackknife monitor
│       │   │   ├── PositionTracker.tsx       # Live P&L display
│       │   │   ├── RiskUtilization.tsx       # Daily max loss bar
│       │   │   ├── TimePressure.tsx          # Signal expiration countdown
│       │   │   └── ObviousStockBadge.tsx     # Gainer rank badge
│       │   │
│       │   └── layout/
│       │       ├── Header.tsx                # Market heat, daily P&L summary
│       │       ├── Sidebar.tsx               # Watchlist selection
│       │       ├── StatusBar.tsx             # Connection status, mode
│       │       └── ChartToolbar.tsx          # Timeframe selector, tools
│       │
│       ├── hooks/
│       │   ├── useWatchlist.ts               # WebSocket + file watch
│       │   ├── useRunners.ts                 # Multi-day runner data
│       │   ├── usePositions.ts               # Live position updates
│       │   ├── useCandleData.ts              # Price history from backend
│       │   ├── useSignals.ts                 # Real-time signal events
│       │   └── useWebSocket.ts               # Main app WebSocket client
│       │
│       ├── services/
│       │   ├── backendApi.ts                 # FastAPI backend client
│       │   ├── mainAppApi.ts                 # Main momentum trader REST
│       │   ├── websocketClient.ts            # SocketIO client for events
│       │   └── alertService.ts               # Audio/visual notifications
│       │
│       ├── store/                            # State management (Zustand)
│       │   ├── chartStore.ts                 # Chart state, selected symbol
│       │   ├── watchlistStore.ts             # Watchlist data
│       │   └── positionStore.ts              # Positions and P&L
│       │
│       └── utils/
│           ├── indicators.ts                 # VWAP, MACD, EMA calculations
│           ├── patternDetection.ts           # Micro-pullback, flat-top
│           ├── tradeMatching.ts              # Historical pattern matching
│           └── formatters.ts                 # Price, percent, time formats
│
├── backend/                        # Python FastAPI backend
│   ├── main.py                     # FastAPI app entry
│   ├── requirements.txt            # Python dependencies
│   │
│   ├── api/
│   │   ├── routes.py               # API route definitions
│   │   └── websocket.py            # WebSocket relay to frontend
│   │
│   ├── services/
│   │   ├── schwab_client.py        # Schwab API (read-only, price history)
│   │   ├── file_watcher.py         # Watchdog for data files
│   │   ├── data_aggregator.py      # Combines all data sources
│   │   ├── pattern_detector.py     # Technical pattern detection
│   │   └── pattern_matcher.py      # Historical trade matching
│   │
│   ├── models/
│   │   ├── candle.py               # OHLCV data model
│   │   ├── watchlist.py            # Watchlist item model
│   │   ├── signal.py               # Trading signal model
│   │   └── position.py             # Position model
│   │
│   └── core/
│       ├── config.py               # Configuration loading
│       └── schwab_tokens.py        # Token reading (read-only)
│
├── config/
│   ├── charting.yaml               # Charting app config
│   ├── layout.json                 # Saved layout preferences
│   └── default-layout.json         # Default layout template
│
└── scripts/
    ├── start-backend.sh            # Start Python backend
    ├── start-backend.bat           # Windows backend start
    └── build.js                    # Build script
```

---

## 5. Integration with Main App (WebSocket Events)

The charting app integrates via **WebSocket events** for real-time signal updates. This requires minimal changes to the main app.

### 5.1 WebSocket Event Stream

**Main app change:** Add 10-15 lines to emit events on existing SocketIO.

**File to modify:** `src/web/api.py` and signal generation points in `main.py`

```python
# Add to api.py - new event types for charting app
def emit_chart_event(event_type: str, data: Dict):
    """Emit events for charting app consumption"""
    socketio.emit('chart_event', {
        'type': event_type,
        'timestamp': datetime.now().isoformat(),
        'data': serialize_for_json(data)
    })

# Event types to emit:
# - 'signal_generated': New trading signal with entry/stop/target
# - 'position_opened': New position entered
# - 'position_closed': Position exited with P&L
# - 'watchlist_updated': Watchlist changed
# - 'runner_status_changed': Runner state transition
```

**Events to emit from main.py:**
```python
# In signal generation (pattern_detector.py or main.py)
from src.web.api import emit_chart_event

emit_chart_event('signal_generated', {
    'symbol': signal.symbol,
    'entry_price': signal.entry_price,
    'stop_loss': signal.stop_loss,
    'profit_target': signal.profit_target,
    'pattern_type': signal.pattern_type,
    'quality_score': signal.quality_score,
    'expiration_time': signal.expiration_time
})

# In position monitoring (paper_trading_manager.py)
emit_chart_event('position_opened', {
    'symbol': symbol,
    'shares': shares,
    'entry_price': entry_price,
    'stop_loss': stop_loss,
    'target': target
})

emit_chart_event('position_closed', {
    'symbol': symbol,
    'exit_price': exit_price,
    'pnl_dollar': pnl,
    'pnl_percent': pnl_pct,
    'r_multiple': r_mult,
    'outcome': 'WIN' if pnl > 0 else 'LOSS'
})
```

**Benefit:** Real-time signal overlays on charts, position tracking, instant alerts - all without polling.

**Total main app changes: ~25 lines across 3 files**

---

## 6. Implementation Phases

All four phases will be implemented as a complete trading visualization solution.

### Phase 1: Foundation (Core Charting)
- Set up Electron + React + TypeScript project structure
- Implement TradingView Lightweight Charts integration
- Build Python FastAPI backend with Schwab client
- Create file watchers for watchlist and runners (Python watchdog)
- WebSocket connection to main app for real-time events
- Basic multi-chart grid layout (1 primary + 4 secondary)
- REST polling fallback for positions and status

**Key Files:**
- `src/main/main.ts` - Electron main process
- `src/renderer/App.tsx` - React app entry
- `backend/main.py` - FastAPI server
- `backend/services/schwab_client.py` - Price history fetching

**Deliverable:** Working app showing real-time watchlist charts

### Phase 2: Warrior Trading Features
- 5 Pillars assessment panel with visual checkmarks
- Risk:Reward overlay with entry/stop/target zones on chart
- VWAP bands overlay (+/- 1, 2, 3 std dev)
- VWAP distance indicator (green/yellow/red zones)
- Micro-pullback pattern detection with annotations
- "Obvious stock" ranking display with badges
- Entry zone visualization bands

**Key Files:**
- `src/renderer/components/panels/FivePillarsPanel.tsx`
- `src/renderer/components/charts/RiskRewardOverlay.tsx`
- `src/renderer/components/charts/VWAPBands.tsx`
- `backend/services/pattern_detector.py`

**Deliverable:** Charts with Warrior Trading decision support

### Phase 3: Novel Decision Support
- Signal strength gauge (single 0-100% visual metric)
- Time pressure indicator (countdown to signal expiration)
- Multi-timeframe alignment display (1m/5m/15m/D trend arrows)
- Exit signal dashboard (MACD/volume/jackknife monitoring)
- Historical pattern matching (using trade_history.json)
- Cognitive load reducer - consolidated decision panel

**Key Files:**
- `src/renderer/components/panels/SignalStrengthGauge.tsx`
- `src/renderer/components/panels/TimeframeAlignment.tsx`
- `src/renderer/components/panels/ExitSignalDashboard.tsx`
- `backend/services/pattern_matcher.py`

**Deliverable:** Full decision support suite

### Phase 4: Live Trading Mode
- Real-time position P&L tracking with WebSocket updates
- Intraday account equity curve chart
- Risk utilization bar (daily max loss remaining)
- Active order status display
- Trade execution confirmation overlays
- Alert sounds for signals and position events
- Paper/Live mode indicator

**Key Files:**
- `src/renderer/components/panels/PositionTracker.tsx`
- `src/renderer/components/charts/EquityCurve.tsx`
- `src/renderer/components/panels/RiskUtilization.tsx`
- `src/renderer/services/alertService.ts`

**Deliverable:** Production-ready for live trading

### Phase 5: Polish & Performance (Post-MVP)
- Layout persistence and customization
- Keyboard shortcuts for quick navigation
- Performance optimization for many symbols
- Dark/light theme support
- User preference syncing
- Export chart snapshots

**Deliverable:** Professional-grade trading terminal

---

## 7. Configuration

```yaml
# config/charting.yaml
app:
  name: "Momentum Trader Charts"
  version: "1.0.0"

data_sources:
  momentum_trader:
    data_dir: "../momentum-trader/data"
    api_url: "http://localhost:8080"
    poll_interval_ms: 5000

  schwab:
    # Uses same credentials as main app
    credentials_path: "../momentum-trader/config/credentials.yaml"
    tokens_path: "../momentum-trader/data/tokens/schwab_tokens.json"
    read_only: true  # Never write tokens

charts:
  default_timeframe: "1m"
  available_timeframes: ["1m", "5m", "15m", "D"]
  max_candles: 500
  vwap_bands: [1, 2, 3]  # Standard deviations

layout:
  primary_chart_ratio: 0.6  # 60% of width
  secondary_grid: "2x2"
  heatmap_height: 80  # pixels

warrior_trading:
  five_pillars:
    min_gap_percent: 10
    min_relative_volume: 5
    max_float: 20000000
    min_price: 2.0
    max_price: 20.0

  vwap_distance_gate:
    max_above_percent: 3.5
    warning_above_percent: 2.5

risk_display:
  default_risk_per_trade: 50
  show_r_multiples: [1, 2, 3, 4]
  color_profit: "#00C853"
  color_loss: "#FF1744"
```

---

## 8. Verification Plan

### Testing the Charting App

1. **Data Access Verification**
   - Confirm file watchers detect changes to watchlist_state.json
   - Verify REST API polling works with main app running
   - Test Schwab client fetches price history independently

2. **Zero Impact Verification**
   - Run both apps simultaneously
   - Monitor main app's CPU/memory usage
   - Verify no degradation in main app's scan timing
   - Confirm no token refresh conflicts

3. **Chart Accuracy**
   - Compare candle data with TradingView/broker platform
   - Verify VWAP calculation matches main app's implementation
   - Test pattern detection against known setups

4. **Live Trading Mode**
   - Test with paper trading first
   - Verify position P&L updates match main app
   - Confirm no duplicate API calls affecting rate limits

---

## 9. Summary of Decisions

| Decision | Selection |
|----------|-----------|
| **Desktop Framework** | Electron |
| **Backend** | Python FastAPI with dedicated Schwab client |
| **Integration** | WebSocket events for real-time signals |
| **Scope** | Full scope (Phases 1-4) |
| **Chart Library** | TradingView Lightweight Charts v5 |

---

## 10. Related Documentation

- **Feature Tracking:** [FEATURE_SUGGESTIONS.md](../FEATURE_SUGGESTIONS.md) - All planned features
- **Project Rules:** [.clinerules](../.clinerules) - Development guidelines
- **Session Notes:** [session-notes/](../session-notes/) - Development logs

---

---

## 11. Implementation Status & Next Features

### Completed Features

**Phase 1 (Foundation):**
- [x] Electron + React + TypeScript project structure
- [x] TradingView Lightweight Charts integration
- [x] Python FastAPI backend with Schwab client
- [x] File watchers for watchlist and runners
- [x] Multi-chart grid layout (1 primary + 4 secondary)
- [x] REST polling for positions and status
- [x] Eastern Time timezone display on charts
- [x] Today-only intraday data filtering

**Phase 2 (Warrior Trading - Complete):**
- [x] VWAP overlay on charts
- [x] VWAP bands overlay (optional)
- [x] VWAP distance indicator (green/yellow/red zones)
- [x] EMA 9 and EMA 20 indicators
- [x] Multi-day Runners panel with quality scores
- [x] Secondary charts showing top runners by quality score
- [x] Entry zone price lines - D1 High, D1 Close, Stop levels from runners data
- [x] 5 Pillars assessment panel with visual checkmarks (Gap, Volume, Float, Price, Catalyst)
- [x] Risk:Reward overlay with entry/stop/target zones (2R, 3R targets)
- [x] Micro-pullback pattern detection with SETUP badge and breakout annotations
- [x] "Obvious stock" ranking badges (#1 gold, #2 silver, #3 bronze)

### Next Features to Implement

**Phase 3 (Novel Decision Support):** ✅ Complete
- [x] Signal strength gauge (0-100% visual metric)
- [x] Time pressure indicator (countdown to signal expiration)
- [x] Multi-timeframe alignment display
- [x] Exit signal dashboard
- [x] Historical pattern matching

**Phase 4 (Live Trading Mode):**
- [ ] Position P&L tracking
- [ ] Intraday equity curve
- [ ] Risk utilization bar
- [ ] Active order display

**Phase 5 (Polish):**
- [ ] Keyboard shortcuts - Quick keys: 1-5 to switch symbols, T for timeframe toggle, arrow keys to navigate
- [ ] Click secondary chart to promote to primary
- [ ] Alert/notification system - Visual/audio alerts when runner approaches entry zone or breaks out
- [ ] Layout persistence and customization
- [ ] Dark/light theme support

---

**Last Updated**: 2026-01-15
**Author**: Design created via Claude Code planning session
**Moved to charting project**: 2026-01-15
