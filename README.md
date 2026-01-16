# Momentum Trader Charting App

Professional day trading visualization for Momentum Trader.

## Phase 1 - Foundation

This is the Phase 1 implementation providing:
- Real-time watchlist display from momentum-trader data files
- Candlestick charts using TradingView Lightweight Charts
- Multi-chart grid layout (primary + 4 secondary charts)
- Watchlist heatmap for quick visual scanning
- Python FastAPI backend for Schwab API access

## Quick Start

### 1. Install Frontend Dependencies

```bash
cd momentum-trader-charting
npm install
```

### 2. Install Backend Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 3. Start the Backend

```bash
# Windows
scripts\start-backend.bat

# Mac/Linux
./scripts/start-backend.sh
```

### 4. Start the Frontend (Development)

```bash
npm run dev
```

### 5. Start Electron App

In a separate terminal:

```bash
npm run electron
```

## Architecture

```
momentum-trader-charting/
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.ts
│   │   └── preload.ts
│   └── renderer/       # React frontend
│       ├── App.tsx
│       ├── components/
│       ├── hooks/
│       ├── store/
│       └── styles/
├── backend/            # Python FastAPI
│   ├── main.py
│   ├── api/
│   ├── services/
│   └── core/
└── config/
    └── charting.yaml
```

## Data Sources

This app reads from the sibling `momentum-trader` directory:

- **Watchlist**: `../momentum-trader/data/watchlist_state.json`
- **Runners**: `../momentum-trader/data/runners.json`
- **Credentials**: `../momentum-trader/config/credentials.yaml`
- **Tokens**: `../momentum-trader/data/tokens/schwab_tokens.json`

The app shares OAuth tokens with the main momentum trader app (tokens are per-machine, not per-app).

## API Endpoints

The backend runs on `http://localhost:8081`:

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/watchlist` | Current watchlist |
| `GET /api/runners` | Multi-day runners |
| `GET /api/candles/{symbol}?timeframe=1m` | Price history |
| `GET /api/quote/{symbol}` | Real-time quote |

## Technology Stack

- **Frontend**: React 18, TypeScript, Vite
- **Charts**: TradingView Lightweight Charts v4
- **State**: Zustand
- **Desktop**: Electron 28
- **Backend**: Python FastAPI
- **Data**: Schwab API via schwab-py

## Future Phases

- Phase 2: Visual Enhancements (VWAP, indicators, multi-day runners panel)
- Phase 3: Real-time Integration (WebSocket events from main app)
- Phase 4: Advanced Features (pattern overlays, trade entry panels)

See [docs/CHARTING_APP_DESIGN.md](docs/CHARTING_APP_DESIGN.md) for full design document.

## Documentation

- [FEATURE_SUGGESTIONS.md](FEATURE_SUGGESTIONS.md) - Feature tracking (implemented and planned)
- [docs/CHARTING_APP_DESIGN.md](docs/CHARTING_APP_DESIGN.md) - Full design document
- [session-notes/](session-notes/) - Development session logs
