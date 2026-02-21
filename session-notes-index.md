# Momentum Trader Charting - Session Notes Index

## Overview
This index tracks all development sessions for the Momentum Trader Charting companion app.

## Session History

| Date | Topics | Key Changes | Status |
|------|--------|-------------|--------|
| 2026-02-20 | Streaming Rotation Discovery Display (Idea #12) | Rotation proxy endpoint; useRotationDiscovery hook with feature flag; StatusBar scanner indicator; collapsible DiscoveryPanel with clickable promoted symbols | ✅ Complete |
| 2026-02-11 | Pre-market VWAP tooltip, trader app audit, Ideas #12-#13 | Pre-market aware VWAP tooltip; integration audit v1.66-v1.75; Idea #12 Rotation Display, #13 Indicator Tooltips; audit log section in FEATURE_SUGGESTIONS | ✅ Complete |
| 2026-02-06 | Real-Time VWAP from Trader App (Idea #6) | Streaming VWAP proxy from trader app VwapCache; useStreamingVWAP hook; source indicator dot (green=stream, yellow=rest, gray=local); 2s polling | ✅ Complete |
| 2026-02-05 | Fix #24: websockets stdout Logging Blocking | Stack dump revealed websockets library logging to stdout blocks event loop; redirected all third-party loggers to file only | ✅ Tentative |
| 2026-02-04 | Event Loop Freeze Fix #23 + Diagnostics | Fix #23 (call_soon_threadsafe), suppressed httpx logging, asyncio debug mode, thread stack dump in watchdog; ran 6+ hours without freeze after fixes — monitoring | ✅ Tentative |
| 2026-02-03 | Thread Pool Deadlock Fix + Watchdog Thread | Fix #22: Return dict instead of httpx.Response from thread pool (prevents WindowsSelectorEventLoop deadlock), watchdog thread for freeze detection, troubleshooting doc updated | ✅ Complete |
| 2026-02-02 | SSL Event Loop Fix + Duplicate Analysis Fix + Request Pileup Fix + Pre-Market Data | httpx in thread pool (Fix #16/#19), useMemo deps fix (#21), CancelToken deduplication (#20), needExtendedHoursData for pre-market candles, troubleshooting doc updated | ✅ Complete |
| 2026-01-28 | Warrior Trading Chart Enhancements + 8 Stability Fixes | Gap % badge, volume badge, D1 High breakout alert, ErrorBoundary, timestamp tracking, async httpx client, thread pool 50 workers, launcher port-first cleanup | ✅ Complete |
| 2026-01-27 | Backend Freeze Fix + Zombie Process Cleanup + Troubleshooting Docs | asyncio.to_thread for LLM calls, route-level cache, React timer decoupling, watchlist equality check, launcher 3-layer cleanup, semaphore timeout, Five Pillars review (tabled) | ✅ Complete |
| 2026-01-26 | Performance Tuning (8) + TS Cleanup (5) + LLM Pattern Detection | Template bug, semaphore, cached candles, watchlist TTL, debugLog, single-pass transforms, incremental charts, VWAP bands, 36 TS errors fixed, catalyst-response mismatch v1.5.0, Ideas #2-#5 documented | ✅ Complete |
| 2026-01-23 | LLM Validation Enhancements + Watchlist Sync | Health-aware validation, NoneType fixes, watchlist API sync, real-time catalyst boost (v1.43.2), First Pullback pattern (v1.44.0) | ✅ Complete |
| 2026-01-22 | LLM Validation Feature | Added Ollama-powered validation with Top3 panel, manual validate button, auto-start Ollama in launcher | ✅ Complete |
| 2026-01-20 | Chart switching fix (async httpx) | Fixed blank charts by converting sync httpx to async, shared candle store | ✅ Complete |
| 2026-01-19 | Exit button fix | Fixed async/await on IPC call for Exit button | ✅ Complete |
| 2026-01-16 | Backend event loop bugfix | Fixed asyncio shutdown causing chart switching issues | ✅ Complete |
| 2026-01-15 | Project setup, smart launcher, Phase 3 panels, Exit button, hidden launch | Startup scripts, .clinerules, analysis panels, Exit button + hidden terminal launch | ✅ Complete |

## Quick Links
- [.clinerules](.clinerules) - Project rules and guidelines
- [config/charting.yaml](config/charting.yaml) - Main configuration (auto-generated)
- [STARTUP_GUIDE.md](STARTUP_GUIDE.md) - How to run the application

## Session File Naming Convention
- Format: `session-notes/YYYY-MM-DD.md`
- One file per day
- Target size: 1,000-2,000 lines

---

**Last Updated**: 2026-02-20
