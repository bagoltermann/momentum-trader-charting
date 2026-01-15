# Momentum Trader Charting App - Startup Guide

## System Requirements

### Required Software

| Software | Version | Download |
|----------|---------|----------|
| **Node.js** | 18+ LTS | https://nodejs.org or `winget install OpenJS.NodeJS.LTS` |
| **Python** | 3.10+ | https://python.org or `winget install Python.Python.3.12` |
| **Momentum Trader** | - | Must be set up with valid Schwab tokens |

### Verify Installation

```powershell
# Check Node.js
node --version    # Should show v18.x.x or higher
npm --version     # Should show 9.x.x or higher

# Check Python
python --version  # Should show 3.10+
```

---

## Installation (One-Time Setup)

### Step 1: Install Node.js (if not installed)

**Windows (PowerShell as Admin):**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Mac:**
```bash
brew install node
```

**Or download directly:** https://nodejs.org (LTS version)

> **Restart your terminal after installing Node.js**

### Step 2: Install Frontend Dependencies

```powershell
cd c:\Users\bagol\trading-projects\momentum-trader-charting
npm install
```

### Step 3: Install Backend Dependencies

```powershell
cd c:\Users\bagol\trading-projects\momentum-trader-charting\backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
venv\Scripts\activate    # Windows
# source venv/bin/activate  # Mac/Linux

# Install Python packages
pip install -r requirements.txt
```

---

## Running the App

### Start Backend (Terminal 1)

```powershell
cd c:\Users\bagol\trading-projects\momentum-trader-charting\backend
venv\Scripts\activate
python main.py
```

Expected output:
```
[OK] Watchlist reloaded: X stocks
[OK] Runners reloaded
[OK] File watcher started for: .../momentum-trader/data
[OK] Charting backend started on port 8081
```

### Start Frontend (Terminal 2)

```powershell
cd c:\Users\bagol\trading-projects\momentum-trader-charting
npm run dev
```

### Start Electron (Terminal 3)

```powershell
cd c:\Users\bagol\trading-projects\momentum-trader-charting
npm run electron
```

---

## Verification

| Test | URL | Expected |
|------|-----|----------|
| Backend Health | http://localhost:8081/api/health | `{"status": "ok"}` |
| Watchlist | http://localhost:8081/api/watchlist | JSON array of stocks |
| Candles | http://localhost:8081/api/candles/AAPL?timeframe=1m | Candle data |

---

## Troubleshooting

### "npm is not recognized"
Node.js not installed or terminal needs restart after install.

### "Credentials not found"
Momentum Trader must be set up first at `../momentum-trader/config/credentials.yaml`

### "Tokens not found"
Run Momentum Trader first to generate Schwab tokens at `../momentum-trader/data/tokens/schwab_tokens.json`

### "Watchlist not available" (503)
Run Momentum Trader at least once to create `../momentum-trader/data/watchlist_state.json`

### Port 8081 in use
Edit `backend/main.py` line with `port=8081` to use different port.

---

## Architecture

```
Electron App (Desktop Window)
    │
    ├── React Frontend (localhost:5173)
    │   └── TradingView Charts, Watchlist, Heatmap
    │
    └── Python Backend (localhost:8081)
        ├── File Watcher → ../momentum-trader/data/
        └── Schwab API → Shared tokens (read-only)
```

---

## Ports

| Port | Service |
|------|---------|
| 5173 | Vite dev server (React) |
| 8081 | FastAPI backend |
| 8080 | Momentum Trader (fallback) |
