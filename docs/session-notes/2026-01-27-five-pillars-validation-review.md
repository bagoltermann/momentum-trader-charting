# Session Notes: Five Pillars Validation Review (2026-01-27)

## Context
XHLD showed all 5 pillars green in the charting app, but manual analysis against the Warrior Trading strategy scored it 2.5/5. This triggered a review of the charting app's pillar validation logic.

## XHLD Case Study

| Pillar | Requirement | XHLD Value | Trading App | Charting App |
|--------|-------------|------------|-------------|--------------|
| 1. Gap 10%+ | Pre-market gap 10%+ | 4.7% open, 73% intraday | COMPLICATED | GREEN |
| 2. Volume 5x+ | Relative volume 5x+ | 98-199x | PASS | GREEN |
| 3. Float <20M | Under 20M shares | 279K | PASS | GREEN |
| 4. Price $2-$20 | Price in range | $1.33 open, $2.20 at discovery | FAIL AT OPEN | GREEN |
| 5. Catalyst | Strong news driver | SEC 8-K Reg FD, "neutral" | WEAK | GREEN |

## Potential Issues Identified (UNVERIFIED)

### 1. Gap % - May use intraday move instead of pre-market gap
- **File:** `FivePillarsPanel.tsx` line 50, 65
- **Observation:** Gap check uses `runner?.original_gap_percent ?? watchItem?.gap_percent`. If the trading app recalculates `gap_percent` intraday, the charting app would show 73% (pass) instead of 4.7% (fail).
- **Needs verification:** Does the trading app recalculate `gap_percent` after market open, or does it lock it at pre-market? If the trading app sends the correct pre-market gap, this is NOT a charting app bug.
- **Confidence this is a real bug:** MEDIUM

### 2. Price check uses current price, not open price
- **File:** `FivePillarsPanel.tsx` line 53, 100
- **Observation:** Price check uses `runner?.current_price ?? watchItem?.price`. XHLD opened at $1.33 (below $2 floor) but was $2.20+ when evaluated.
- **Counter-argument:** If the panel is used at entry-decision time (not discovery time), current price is the correct value to check. You care about the price when you're deciding to trade.
- **Needs verification:** Is the panel's design intent for discovery-time or entry-time validation?
- **Confidence this is a real bug:** LOW

### 3. `hasDefinitiveCatalyst` flag may override weak catalyst types
- **File:** `FivePillarsPanel.tsx` lines 112-114
- **Observation:** Line 114 checks `hasDefinitiveCatalyst` as an OR condition. If the trading app sets this flag `true` for any 8-K filing (not just meaningful ones), it would short-circuit past the `SEC_8K_OTHER` partial logic on line 115.
- **Needs verification:** What was XHLD's actual `has_definitive_catalyst` value? What logic in the trading app sets this flag?
- **Confidence this is a real bug:** MEDIUM

## Verified Change Ready to Implement

### Catalyst-Response Mismatch Prompt
- **File:** `config/prompts/validation_prompt.yaml`
- **What:** Add section asking LLM to evaluate whether price action is proportional to catalyst quality
- **Why:** Catches FOMO traps like XHLD (huge volume + micro-float + weak catalyst = disproportionate response)
- **Risk:** LOW - prompt only, no code changes, all variables already exist
- **Plan:** Documented in `.claude/plans/witty-dreaming-swan.md`
- **Confidence this is useful:** HIGH

## Before Fixing: Data Verification Needed

1. **Check trading app's `gap_percent`** - Does it recalculate after market open? Look at what value was sent for XHLD in the watchlist API response.
2. **Check trading app's `has_definitive_catalyst`** - What was XHLD's value? What code path sets this flag?
3. **Clarify panel design intent** - Is Five Pillars meant to validate at discovery time or entry time? This determines whether current price or open price is correct.

## Key Takeaway
Two of the three suspected pillar bugs may not be bugs at all -- they may be correct behavior based on the data received. Verify the actual data before making code changes. The catalyst-response mismatch prompt is the one change that is clearly useful regardless.
