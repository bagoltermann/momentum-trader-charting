# LLM Real-Time Signal Validation Feature Design

**Created:** 2026-01-22
**Status:** Implemented (v1.0.0)
**Last Updated:** 2026-01-22

---

## Overview

Add an LLM-powered validation feature that:
1. **Automatically validates the top 3 candidates** that meet Warrior Trading criteria (5 Pillars ≥3.5)
2. **Dynamically re-evaluates** the top 3 every 60 seconds as conditions change
3. **Provides manual validation** via button for any stock in the main chart

---

## Architecture

### Auto-Validation Flow (Top 3 Candidates)

```
[Watchlist updates every 5s] → [Rank stocks by Warrior criteria]
                                          ↓
                              [Select top 3 with 5 Pillars ≥3.5]
                                          ↓
                              [For each: check if validation cached]
                                          ↓
                              [If stale/missing → POST /api/validate/{symbol}]
                                          ↓
                              [Top3Panel shows all 3 with signals]
```

### Manual Validation Flow (Any Stock)

```
[User clicks Validate on chart] → [POST /api/validate/{symbol}]
                                          ↓
                              [ValidationPanel shows result for selected stock]
```

### Candidate Ranking Algorithm

Stocks scored using weighted criteria:

| Criteria | Weight | Source |
|----------|--------|--------|
| 5 Pillars score | 40% | Calculated (gap, volume, float, price, catalyst) |
| Quality score | 25% | `quality_score` from watchlist |
| Volume ratio | 20% | `volume_ratio` (log-scaled, capped at 50x) |
| Runner bonus | 10% | +10 if in `runners.json` |
| Gap freshness | 5% | Higher for premarket/opening gaps |

**Minimum threshold:** Only stocks with **5 Pillars ≥3.5** qualify for auto-validation.

### Dynamic Re-evaluation

- **Every 60 seconds:** Re-rank all stocks, identify new top 3
- **New entrant:** If stock enters top 3, validate immediately
- **Dropout:** If stock leaves top 3, keep cached validation but remove from Top3Panel
- **Stale validation:** Re-validate if cache >60s old and still in top 3

### Caching Strategy

| Layer | TTL | Purpose |
|-------|-----|---------|
| Server cache | 60s | Prevent duplicate LLM calls |
| Client cache | 60s | Instant UI response |
| Top 3 refresh | 60s | Re-evaluate rankings |

**Max LLM calls:** ~3 per minute (only when top 3 changes or cache expires)

---

## LLM Providers

Supports two providers, configurable via `config/charting.yaml`:

| Provider | Cost | Speed | Notes |
|----------|------|-------|-------|
| **Ollama (local)** | Free | 3-10s | Requires local installation |
| **Anthropic Claude** | ~$0.01/call | 1-3s | Requires API key |

Default to Ollama for cost-free local inference.

---

## Phase 1: Backend - LLM Validator Service

### New File: `backend/services/llm_validator.py`

```python
# Core components:
# - ValidationResult dataclass (signal, entry, stop, target, confidence, reasoning)
# - Server-side cache with 30s TTL (follows schwab_client pattern)
# - Provider abstraction: OllamaProvider and AnthropicProvider
# - Async LLM API call with timeout handling
# - Context builder aggregating watchlist + runners + quote data
# - Structured prompt for Warrior Trading validation
```

**Key Functions:**
- `validate_signal(symbol, watchlist, runners, quote)` - Main validation logic
- `_build_prompt(context)` - Constructs LLM prompt with trading data
- `_parse_response(llm_output)` - Extracts structured result from LLM
- `_call_ollama(prompt)` - Local Ollama API call
- `_call_anthropic(prompt)` - Anthropic Claude API call

**LLM Prompt:** Loaded from `config/prompts/validation_prompt.md` (not hardcoded)
- Allows tuning prompt without code changes
- Uses template variables: `{symbol}`, `{price}`, `{gap_percent}`, etc.
- Includes Warrior Trading criteria and JSON output format

---

## Phase 2: Backend - API Endpoint

### Modify: `backend/api/routes.py`

Add new endpoint:

```python
@router.post("/validate/{symbol}")
async def validate_signal(symbol: str):
    # Get context data
    watchlist = get_cached_watchlist()
    runners = get_cached_runners()
    quote = await get_schwab_client().get_quote(symbol)

    # Call validator
    result = await llm_validator.validate_signal(symbol, watchlist, runners, quote)
    return result
```

**Error Handling:**
- 400: Symbol not in watchlist
- 504: LLM timeout (>10s)
- 500: LLM API error

---

## Phase 3: Frontend - Validation Store

### New File: `src/renderer/store/validationStore.ts`

```typescript
interface ValidationResult {
  signal: 'buy' | 'wait' | 'no_trade'
  entry_price: number | null
  stop_price: number | null
  target_price: number | null
  confidence: number  // 0-100
  reasoning: string[]
  timestamp: string
}

interface ValidationState {
  currentSymbol: string | null
  validationResult: ValidationResult | null
  isLoading: boolean
  error: string | null
  validationCache: Map<string, { result: ValidationResult; fetchedAt: number }>

  validateSymbol: (symbol: string) => Promise<void>
  clearValidation: () => void
}
```

**Pattern:** Follows `watchlistStore.ts` - Zustand store with axios API calls

---

## Phase 4: Frontend - UI Components

### 4A: Modify `src/renderer/components/layout/Header.tsx`

Add "Validate" button next to Exit button:

```tsx
<button
  className="validate-btn"
  onClick={() => validateSymbol(selectedSymbol)}
  disabled={!selectedSymbol || isLoading}
>
  {isLoading ? 'Validating...' : 'Validate'}
</button>
```

### 4B: New File `src/renderer/components/panels/ValidationPanel.tsx`

Display validation results:
- Signal badge (BUY=green, WAIT=yellow, NO_TRADE=red)
- Price levels: Entry, Stop, Target
- Confidence meter (0-100%)
- Reasoning bullet points
- Timestamp

**Pattern:** Follows `ExitSignalDashboard.tsx` layout and styling

### 4C: Modify `src/renderer/styles/global.css`

Add validation-specific styles:
```css
.validate-btn { /* Blue button, similar to exit-btn */ }
.validation-panel { /* Similar to exit-signal-panel */ }
.validation-signal-badge.signal-buy { background: var(--accent-green); }
.validation-signal-badge.signal-wait { background: var(--accent-yellow); }
.validation-signal-badge.signal-no-trade { background: var(--accent-red); }
```

### 4D: Modify `src/renderer/components/panels/AnalysisPanels.tsx`

Include ValidationPanel in the analysis panels row.

---

## Phase 5: Configuration

### Modify: `config/charting.yaml`

Add LLM configuration with provider switching:
```yaml
llm:
  # Provider: "ollama" (local, free) or "anthropic" (cloud, ~$0.01/call)
  provider: "ollama"

  # Ollama settings (when provider: ollama)
  ollama:
    base_url: "http://localhost:11434"
    model: "llama3"  # or mistral, codellama, etc.

  # Anthropic settings (when provider: anthropic)
  anthropic:
    model: "claude-3-5-haiku-20241022"
    # API key from ANTHROPIC_API_KEY env var

  # Shared settings
  timeout_seconds: 10  # Ollama may need more time
  cache_ttl_seconds: 30
```

**Provider Switching:**
- Default to Ollama for free local inference
- Switch to Anthropic in config when faster/better results needed
- Ollama requires local installation with model pulled

---

## Files Summary

| Action | File | Purpose |
|--------|------|---------|
| CREATE | `backend/services/llm_validator.py` | LLM validation service |
| CREATE | `config/prompts/validation_prompt.yaml` | LLM prompt template (YAML format) |
| CREATE | `src/renderer/store/validationStore.ts` | State + ranking logic |
| CREATE | `src/renderer/components/panels/Top3ValidationPanel.tsx` | Auto-validated top 3 |
| CREATE | `src/renderer/components/panels/ManualValidationPanel.tsx` | Manual validation result |
| MODIFY | `backend/api/routes.py` | Add /validate endpoint |
| MODIFY | `config/charting.yaml` | LLM configuration |
| MODIFY | `src/renderer/components/layout/Header.tsx` | Validate button |
| MODIFY | `src/renderer/components/panels/AnalysisPanels.tsx` | Include panels |
| MODIFY | `src/renderer/styles/global.css` | Validation styles |
| MODIFY | `src/renderer/App.tsx` | Auto-validation interval |

---

## Implementation Order

All steps completed:

| Step | Task | Status |
|------|------|--------|
| 1 | Create `config/prompts/validation_prompt.yaml` template | ✅ Done |
| 2 | Create `llm_validator.py` with validation logic and caching | ✅ Done |
| 3 | Add `/validate/{symbol}` endpoint to routes.py | ✅ Done |
| 4 | Add LLM config to charting.yaml | ✅ Done |
| 5 | Create `validationStore.ts` with ranking algorithm | ✅ Done |
| 6 | Create `Top3ValidationPanel.tsx` | ✅ Done |
| 7 | Create `ManualValidationPanel.tsx` | ✅ Done |
| 8 | Add Validate button to Header.tsx | ✅ Done |
| 9 | Add both panels to AnalysisPanels.tsx | ✅ Done |
| 10 | Add auto-validation interval to App.tsx | ✅ Done |
| 11 | Add CSS styles | ✅ Done |
| 12 | Test end-to-end | Pending |

---

## Verification

### Test 1: Backend Endpoint
```bash
curl -X POST http://localhost:8081/api/validate/SLGB
# Should return JSON with signal, prices, confidence, reasoning
```

### Test 2: UI Flow
1. Launch charting app
2. Select a stock from watchlist
3. Click "Validate" button
4. Verify loading spinner appears
5. Verify validation result displays in panel
6. Verify cached result returns instantly on re-click

### Test 3: Error Handling
1. Test with symbol not in watchlist → 400 error displayed
2. Test with LLM timeout → Appropriate error message

---

## Cost Considerations

- **Ollama (local):** Free, but slower (3-10s depending on hardware)
- **Anthropic Claude:** ~$0.01-0.02 per validation, faster (1-3s)
- **Caching:** 30s TTL prevents rapid re-requests
- **Manual trigger only:** No auto-validation to control costs
- **Default:** Ollama for cost-free usage; switch to Claude when needed

---

## Deferred Items

| Item | Reason |
|------|--------|
| Auto-validation on symbol select | Cost control - add later if desired |
| Historical pattern matching in prompt | Can enhance prompt iteratively |
| Validation history/logging | Nice-to-have for tracking accuracy |
| UI provider toggle | Could add dropdown to switch providers in UI |

---

## Prerequisites

**For Ollama (local):**
```bash
# Install Ollama (if not installed)
# Download from https://ollama.ai

# Pull the model used by momentum-trader
ollama pull qwen2.5:7b

# Verify running
curl http://localhost:11434/api/tags
```

**For Anthropic (cloud):**
```bash
# Set API key in environment
set ANTHROPIC_API_KEY=sk-ant-...
```

---

## Data Available for Validation

The charting app has access to rich trading data:

| Data Source | Fields |
|-------------|--------|
| **Watchlist** | symbol, price, high, gap_percent, volume_ratio, float, quality_score, llm_analysis |
| **Runners** | entry_zones, stop_zone, status, pullback_percent, cumulative_move_percent |
| **Quotes** | bid/ask, last price, volume, day high/low |
| **Candles** | OHLCV data for technical analysis |
| **Trade History** | Historical trades with outcomes for pattern matching |

---

## Prompt Template File

### New File: `config/prompts/validation_prompt.md`

Comprehensive prompt including ALL available Warrior Trading data points:

### Data Categories Included

**1. Basic Setup (from watchlist)**
- Symbol, price, day high, gap %, quality score

**2. 5 Pillars Assessment (calculated)**
- Gap 10%+, Volume 5x+, Float <20M, Price $2-$20, Catalyst
- Overall score out of 5

**3. Entry Timing (critical for Warrior)**
- Current time, minutes since market open
- Signal freshness (fresh/aging/stale/expired)
- Gap age (Day 0 = fresh, Day 1+ = continuation)
- VWAP distance %, VWAP zone (GREEN/YELLOW/RED)
- Chase risk assessment

**4. Technical Indicators (from candles)**
- EMA 9 and EMA 20 with price position
- Support/Resistance levels with strength
- Volume trend (increasing/declining)
- Float rotation %

**5. Timeframe Alignment**
- 1m, 5m, 15m, Daily bias
- Alignment count (X/4 bullish)

**6. Catalyst Details (from LLM analysis)**
- Type, strength (1-10), definitive flag
- Full catalyst description

**7. Runner Status (if multi-day play)**
- Entry zones with triggers
- Stop zone with reasoning
- Pullback %, cumulative move %

**8. Pattern Detection**
- Micro-pullback (flat-top consolidation)
- Flag/pennant patterns
- Unfilled gaps

**9. Exit Signal Status**
- MACD crossover status
- Volume decline status
- Jackknife rejection status
- Overall exit recommendation

**10. Risk/Reward Framework**
- Suggested entry zone
- Suggested stop with reasoning
- Risk amount in $ and %
- 2R and 3R target levels

### Template Variables Summary

| Category | Variables |
|----------|-----------|
| Basic | symbol, price, high, gap_percent, quality_score |
| 5 Pillars | pillar_gap, pillar_volume, pillar_float, pillar_price, pillar_catalyst, pillars_score |
| Timing | current_time, minutes_since_open, signal_freshness, gap_age_days |
| VWAP | vwap, vwap_distance_percent, vwap_zone, chase_risk_assessment |
| Technical | ema9, ema20, resistance_1, support_1, volume_trend, float_rotation_percent |
| Alignment | tf_1m_bias, tf_5m_bias, tf_15m_bias, tf_daily_bias, timeframe_alignment |
| Catalyst | catalyst_type, catalyst_strength, catalyst_details, has_definitive_catalyst |
| Runner | entry_zone_price, entry_zone_trigger, stop_zone_price, stop_zone_reason |
| Patterns | micro_pullback_detected, flag_pattern_detected, unfilled_gaps |
| Exit | exit_macd, exit_volume, exit_jackknife, exit_overall |
| R/R | risk_dollars, risk_percent, target_2r, target_3r |

### Benefits of Comprehensive Prompt

- All Warrior Trading decision factors in one view
- LLM can cross-reference multiple signals
- Consistent validation across all candidates
- Easy to tune by adjusting which sections to include

---

## Related Files

- [Session notes 2026-01-21](../session-notes/2026-01-21-cleanup-and-sidebar.md) - Data analysis section
- [Backend routes](../../backend/api/routes.py) - API patterns to follow
- [Schwab client](../../backend/services/schwab_client.py) - Caching/retry patterns
- [Watchlist store](../../src/renderer/store/watchlistStore.ts) - Zustand patterns
- [Exit Signal Dashboard](../../src/renderer/components/panels/ExitSignalDashboard.tsx) - UI patterns
