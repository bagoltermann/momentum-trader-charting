#!/bin/bash
# ============================================================================
# Momentum Trader Charts - Smart Desktop Launcher for Linux/Mac
# ============================================================================
#
# This file can be copied ANYWHERE (Desktop, Documents, etc.) and will work!
# Auto-detects both the charting app and momentum-trader project locations.
#
# If auto-detection fails, edit the paths below.
# ============================================================================

# ============================================================================
# MANUAL OVERRIDE (optional - leave empty for auto-detection)
# ============================================================================
# Example: CHARTING_DIR="/home/yourname/trading-projects/momentum-trader-charting"
# Example: MOMENTUM_DIR="/home/yourname/trading-projects/momentum-trader"
CHARTING_DIR=""
MOMENTUM_DIR=""

echo "==================================================================="
echo "Momentum Trader Charts - Desktop Launcher"
echo "==================================================================="
echo ""

# ============================================================================
# AUTO-DETECTION: Find charting app
# ============================================================================

if [ -n "$CHARTING_DIR" ]; then
    echo "Using configured charting path..."
else
    echo "Auto-detecting charting app location..."

    CHARTING_SEARCH_PATHS=(
        "$HOME/trading-projects/momentum-trader-charting"
        "$HOME/Documents/trading-projects/momentum-trader-charting"
        "$HOME/momentum-trader-charting"
        "$HOME/Documents/momentum-trader-charting"
        "$HOME/Desktop/momentum-trader-charting"
        "/opt/trading-projects/momentum-trader-charting"
        "/opt/momentum-trader-charting"
        "/usr/local/momentum-trader-charting"
        "/home/$USER/trading-projects/momentum-trader-charting"
    )

    FOUND=0
    for DIR in "${CHARTING_SEARCH_PATHS[@]}"; do
        if [ -f "$DIR/backend/main.py" ]; then
            CHARTING_DIR="$DIR"
            echo "  Found charting app: $CHARTING_DIR"
            FOUND=1
            break
        fi
    done

    if [ $FOUND -eq 0 ]; then
        echo "  [ERROR] Could not find charting app"
        echo ""
        echo "==================================================================="
        echo "ERROR: Momentum Trader Charts not found"
        echo "==================================================================="
        echo ""
        echo "Searched these locations:"
        echo "  $HOME/trading-projects/momentum-trader-charting"
        echo "  $HOME/Documents/trading-projects/momentum-trader-charting"
        echo "  $HOME/momentum-trader-charting"
        echo "  /opt/trading-projects/momentum-trader-charting"
        echo ""
        echo "SOLUTIONS:"
        echo "  1. Install momentum-trader-charting to one of the above locations"
        echo "  2. OR edit this file and set CHARTING_DIR to your install path"
        echo ""
        read -p "Press Enter to close..."
        exit 1
    fi
fi

# ============================================================================
# AUTO-DETECTION: Find momentum-trader
# ============================================================================

echo ""

if [ -n "$MOMENTUM_DIR" ]; then
    echo "Using configured momentum-trader path..."
else
    echo "Auto-detecting momentum-trader location..."

    MOMENTUM_SEARCH_PATHS=(
        "$HOME/trading-projects/momentum-trader"
        "$HOME/Documents/trading-projects/momentum-trader"
        "$HOME/momentum-trader"
        "$HOME/Documents/momentum-trader"
        "$HOME/Desktop/momentum-trader"
        "/opt/trading-projects/momentum-trader"
        "/opt/momentum-trader"
        "/usr/local/momentum-trader"
        "/home/$USER/trading-projects/momentum-trader"
    )

    FOUND=0
    for DIR in "${MOMENTUM_SEARCH_PATHS[@]}"; do
        if [ -f "$DIR/launcher.py" ]; then
            MOMENTUM_DIR="$DIR"
            echo "  Found momentum-trader: $MOMENTUM_DIR"
            FOUND=1
            break
        fi
    done

    if [ $FOUND -eq 0 ]; then
        echo "  [ERROR] Could not find momentum-trader"
        echo ""
        echo "==================================================================="
        echo "ERROR: Momentum Trader (main app) not found"
        echo "==================================================================="
        echo ""
        echo "The charting app requires the main momentum-trader app."
        echo ""
        echo "Searched these locations:"
        echo "  $HOME/trading-projects/momentum-trader"
        echo "  $HOME/Documents/trading-projects/momentum-trader"
        echo "  $HOME/momentum-trader"
        echo "  /opt/trading-projects/momentum-trader"
        echo ""
        echo "SOLUTIONS:"
        echo "  1. Install momentum-trader to one of the above locations"
        echo "  2. OR edit this file and set MOMENTUM_DIR to your install path"
        echo ""
        read -p "Press Enter to close..."
        exit 1
    fi
fi

# ============================================================================
# VERIFY DIRECTORIES
# ============================================================================

echo ""
echo "Verifying projects..."

# Verify charting app
if [ ! -f "$CHARTING_DIR/backend/main.py" ]; then
    echo "  [ERROR] Charting app backend not found"
    echo ""
    echo "Path: $CHARTING_DIR"
    read -p "Press Enter to close..."
    exit 1
fi
echo "  Charting app: OK"

# Verify/create momentum-trader data directory
if [ ! -d "$MOMENTUM_DIR/data" ]; then
    echo "  [WARNING] momentum-trader data directory not found"
    echo "  Creating: $MOMENTUM_DIR/data"
    mkdir -p "$MOMENTUM_DIR/data"
fi
echo "  Momentum-trader: OK"
echo ""

# ============================================================================
# UPDATE CONFIG: Write momentum-trader path to charting.yaml
# ============================================================================

echo "Updating charting configuration..."

# Create config directory if it doesn't exist
mkdir -p "$CHARTING_DIR/config"

# Write the config file with absolute paths
cat > "$CHARTING_DIR/config/charting.yaml" << EOF
# Momentum Trader Charting App Configuration
# Auto-generated by startup script - paths are absolute
app:
  name: "Momentum Trader Charts"
  version: "1.0.0"

data_sources:
  momentum_trader:
    data_dir: "$MOMENTUM_DIR/data"
    api_url: "http://localhost:8080"
    poll_interval_ms: 5000

  schwab:
    credentials_path: "$MOMENTUM_DIR/config/credentials.yaml"
    tokens_path: "$MOMENTUM_DIR/data/tokens/schwab_tokens.json"
    read_only: true

charts:
  default_timeframe: "1m"
  available_timeframes: ["1m", "5m", "15m", "D"]
  max_candles: 500

layout:
  primary_chart_ratio: 0.6
  secondary_grid: "2x2"
  heatmap_height: 80
EOF

echo "  Config updated: $CHARTING_DIR/config/charting.yaml"
echo "  Data directory: $MOMENTUM_DIR/data"
echo ""

# ============================================================================
# ACTIVATE VENV AND START BACKEND
# ============================================================================

echo "Starting charting backend..."
echo ""

cd "$CHARTING_DIR/backend"

# Check if venv exists
if [ ! -f "venv/bin/activate" ]; then
    echo "  [ERROR] Virtual environment not found"
    echo ""
    echo "  Please run setup first:"
    echo "    cd $CHARTING_DIR/backend"
    echo "    python3 -m venv venv"
    echo "    source venv/bin/activate"
    echo "    pip install -r requirements.txt"
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

# Activate venv and run
source venv/bin/activate
python3 main.py

# Check exit code
if [ $? -ne 0 ]; then
    echo ""
    echo "==================================================================="
    echo "Application failed to start"
    echo "==================================================================="
    echo "See error messages above for details"
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

exit 0
