# Trading Bot (Backtester + Paper Trading) — Design

**Date:** 2026-06-13
**Status:** Approved, ready for implementation plan
**Lives in:** the existing `/bets` feature

## Goal

Add a trading-bot capability to the `bets` page. Two primary goals: a **learning vehicle** (understand how strategies and backtesting work by building and tinkering) and a **portfolio showpiece** (looks great on the public site, demonstrates engineering range). It is explicitly **not** a tool to act on with real money — the owner's real strategy is "VWCE and chill." No real trades, ever, in any phase.

The Buy & Hold benchmark is the recurring punchline: every strategy is scored against "what if you'd just bought and held this asset instead," which is honest (most active strategies lose to buy-and-hold) and is itself the core lesson.

## Scope

In scope for v1:

- **Interactive, visitor-driven backtester** — anyone can pick an asset + strategy + params, run a backtest, and see the equity curve, trades, and metrics render live.
- **Admin-curated paper trading** — the owner starts persistent "pretend money" runs that advance daily over real calendar time; the public page displays them.

Out of scope:

- Real trades / broker integration (never).
- **Dual Momentum** strategy — it is inherently multi-asset (picks the best of a basket, rebalances monthly) and clashes with the single-asset "pick one ticker" model. Strong phase-2 candidate once the single-asset engine is proven.
- Visitor-started paper accounts — invites unbounded junk and abuse; admin-only.
- Persisting backtests — they are ephemeral and computed inline. Shareable backtest URLs are a possible later add (YAGNI now).
- Shorting, leverage, margin — long-or-cash only.

## What a trading bot is (for reference)

A strategy is a pure function: `strategy(prices_up_to_today, state) → signal` (buy / sell / hold, and how much). A **backtest** replays history through that function day by day — with a strict no-lookahead rule — simulating trades and scoring the result. **Paper trading** runs the same function forward on new data as it arrives, recording pretend orders into a fake account. Real trading would only swap the "pretend order" call for a broker API call; we never do that.

## Architecture

Five units, each with one job. The key property: **Strategies, Execution, and Metrics are pure functions with no I/O**, so the backtester (loop over history) and the paper-trading cron (one day at a time) drive the *same* code, and everything is trivially unit-testable.

```
                    ┌─────────────┐
   daily closes ──> │  Strategies │  pure: (prices_so_far, state) → signal
                    └──────┬──────┘
                           v
  ┌──────────┐      ┌─────────────┐      ┌──────────┐
  │ Backtest │ ───> │  Execution  │ ───> │ Metrics  │
  │ (replay) │      │ (sim fills) │      │ (scoring)│
  └──────────┘      └─────────────┘      └──────────┘
        ^                  ^
        └── Paper trading reuses the same two boxes, fed one day at a time by cron
```

## Strategies (7 at launch)

All work on **daily close prices only** (no OHLC/volume — that's all `PriceSnapshot` stores), and all are single-asset, fitting the "pick one ticker" model. All share the interface `strategy(prices_so_far, state) → signal`.

**Beginner trio:**

- **Buy & Hold** — buy once, never sell. The benchmark every other strategy is measured against; always computed and shown.
- **Moving-Average Crossover** — buy when the short moving average crosses above the long, sell when it crosses back below. Trend-following 101. Knobs: short window, long window.
- **Dollar-Cost Averaging** — buy a fixed dollar amount every N days regardless of price. Passive averaging; tends to win, which is a good lesson. Knobs: amount, interval (days).

**Sophisticated additions:**

- **MACD** — momentum oscillator from two exponential moving averages; buy/sell on signal-line crossovers. Knobs: fast, slow, signal periods.
- **Bollinger Bands (mean-reversion)** — bands at ±N standard deviations around a moving average; buy when price pierces the lower band ("oversold"), sell at the upper. Knobs: window, band width (std-dev multiple).
- **RSI mean-reversion** — buy when oversold (RSI < low threshold), sell when overbought (RSI > high threshold). Knobs: period, low/high thresholds.
- **Time-Series (Absolute) Momentum** — if the asset is up over the trailing N months, hold it; otherwise sit in cash. The single-asset core of Antonacci's Dual Momentum. Knobs: lookback (days/months).

Each strategy declares a **param schema** (param names, types, sensible defaults, and bounds) that drives the frontend form and the server-side validation.

## Execution model (correctness-critical)

- **Starting cash:** $10,000.
- **Fill timing:** a signal generated from day T's close is filled at **day T+1's close**. This is the primary defense against lookahead bias — you cannot trade on the same price you used to decide. This rule is the single most important thing to get right.
- **Fees:** flat **0.1% per trade** (toggleable). No slippage modeling in v1 — daily-close fills make it moot.
- **Position sizing:** all-in / all-out — use 100% of cash to buy, sell the entire position. DCA is the exception (fixed dollar amount each interval).
- **No shorting, no leverage, no margin** — long-or-cash only.

## Metrics

Scored for every run and always shown alongside the Buy & Hold benchmark for the same asset/period:

- Total return %
- CAGR (annualized return)
- Max drawdown (worst peak-to-trough %)
- Sharpe ratio (return per unit of risk)
- Number of trades
- Win rate

## Data model

New models (one file each, per the split-subdirectory convention):

- **`PaperAccount`** — `ticker` (FK), `strategy` (key), `params` (JSON), `starting_cash`, `started_on`, `is_active`, `created_at`.
- **`PaperTrade`** — `account` (FK), `date`, `side` (buy/sell), `shares`, `price`, `cash_after`, `reason`.
- **`PaperSnapshot`** — `account` (FK), `date`, `portfolio_value`, `cash`, `position_value`. The daily equity curve for the live chart.

Backtests are **not** persisted — computed and returned inline.

**Historical backfill:** a one-time `backfill_history` management command pulls ~10 years of daily closes per existing ticker from Alpha Vantage / CoinGecko into the existing `PriceSnapshot` table. Crypto may have less than 10y — take what exists. Without this, backtests have too little history to be interesting.

## Paper-trading loop

A `tick_paper_accounts` management command called at the **end of the existing `sync_prices` run** (fires right after new closes land — no separate cron to manage). For each active `PaperAccount`:

1. Get the latest close the account hasn't processed yet.
2. Run the same strategy + execution functions the backtester uses, advancing one day.
3. Write any resulting `PaperTrade`, and always write a daily `PaperSnapshot`.

**Idempotent** — re-running for an already-processed date is a no-op, so a double-sync or restart cannot double-trade. Because history is backfilled, a freshly-started account can optionally be "warmed up" (a 50-day MA needs 50 prior days) without waiting 50 real days.

## API endpoints

Under `/api/bets/`, following existing patterns:

```
GET  /api/bets/strategies/              public: list strategies + param schemas (drives the UI form)
POST /api/bets/backtest/                public, rate-limited: {ticker_id, strategy, params, period}
                                          → equity curve, trades, metrics, benchmark — computed inline, not stored
GET  /api/bets/paper/                    public: list active paper accounts + latest value/metrics
GET  /api/bets/paper/<id>/               public: one account — equity curve, trades, positions, metrics
POST /api/bets/paper/create/             admin: start a paper run {ticker_id, strategy, params, starting_cash}
POST /api/bets/paper/<id>/stop/          admin: set is_active=false (history kept)
POST /api/bets/paper/<id>/delete/        admin: remove account + its trades/snapshots
```

- The backtest endpoint is **rate-limited per IP** (reuse the existing Redis rate-limit pattern).
- Params are **server-side bounded** (e.g. MA windows 2–400) so absurd inputs can't DoS the compute.

## Code layout (follows split-subdirectory convention)

- `website/strategies/` — new package: `base.py` (the `Strategy` interface + signal type), one file per strategy (`buy_hold.py`, `ma_crossover.py`, `dca.py`, `macd.py`, `bollinger.py`, `rsi.py`, `momentum.py`), `__init__.py` registry.
- `website/services/backtest.py` — the replay loop + execution simulator + metrics (pure, no Django).
- `website/models/paper_account.py`, `paper_trade.py`, `paper_snapshot.py` — new models (add imports to `models/__init__.py` + `__all__`).
- Views added to existing `website/views/bets.py`; routes to `website/urls.py`.
- `website/management/commands/backfill_history.py`, `tick_paper_accounts.py`.

## Frontend (extends `/bets`, same visual language)

Charts are **hand-rolled SVG** (`<polyline>`/`<path>`), matching the existing sparkline/history charts on the page — no new charting library.

Two new sections below the current ticker grid:

1. **Backtest sandbox** — pick ticker (dropdown of existing tickers) → pick strategy (cards) → param inputs/sliders (built from the strategy's schema) → **Run**. Renders an **equity curve** (strategy vs. Buy & Hold overlaid), metric cards (return / CAGR / drawdown / Sharpe / trades / win-rate, each vs. benchmark), and buy/sell markers on the curve.
2. **Paper-trading showcase** — a card per active paper account: live equity curve, current position (in/out + value), recent trades, days running. Admin sees create/stop/delete controls, gated on `adminToken` like other admin UI.

## Testing

- **Backend (pytest):** unit tests for each strategy's signal logic; the execution simulator (T+1 fills, fees, all-in/all-out, DCA sizing); metrics (return, CAGR, drawdown, Sharpe on known inputs); the no-lookahead guarantee; paper-tick idempotency. API tests for backtest validation/bounds, rate limiting, and admin gating on paper endpoints.
- **Frontend (vitest):** pure helpers in `src/lib/` (e.g. equity-curve → SVG points, metric formatting).

## Docs (per CLAUDE.md)

- Update `docs/README.md` with the new bets capability.
- Add QA items to `docs/QA-CHECKLIST.md` for the backtester and paper-trading sections.

## Phasing

The two v1 features share strategy + execution + metrics code, so they're naturally sequenced:

1. **Phase A — Backtester:** strategies, execution simulator, metrics, backfill command, `/strategies/` + `/backtest/` endpoints, sandbox UI. Self-contained; ~90% of the learning/showpiece value.
2. **Phase B — Paper trading:** the three new models, `tick_paper_accounts` hooked into `sync_prices`, paper API endpoints, showcase UI + admin controls. Builds on the now-proven engine.

(Both are in v1 scope; this is build order, not a scope cut.)
