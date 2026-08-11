# Portfolio Labs

A dependency-free web app for **analyzing and backtesting an investment
portfolio**. Build a portfolio by allocation, pull **live market data**, and get
real risk/return analytics: growth against a benchmark, drawdowns, Sharpe /
Sortino / Calmar, VaR / CVaR, correlations, beta / alpha, and a Monte Carlo
projection.

**Live site:** https://zacharynorman923-design.github.io/portfolio-labs/

No build step, no dependencies, no backend — just HTML, CSS and vanilla JS.

## Live market data (bring your own key)

This is a **static site**, so there is no server to hold a key. Prices are
fetched **directly from your browser** using a free API key that is stored only
in your browser's `localStorage`. Open **⚙ Data source** in the app and pick:

| Provider | Free tier | Get a key |
| --- | --- | --- |
| **Twelve Data** (recommended) | ~800 requests/day, 8/min · good daily history · handles crypto (`BTC/USD`) | <https://twelvedata.com/pricing> |
| **Alpha Vantage** | very common, but a low daily cap | <https://www.alphavantage.co/support/#api-key> |

No key? Click **Explore with demo data** to try every feature using a bundled,
clearly-labelled **synthetic** dataset (not real prices).

Fetched history is cached in your browser for 12 hours to stay inside the free
request limits.

## What it computes

- **Backtest** — growth of $10,000 with periodic rebalancing (annual / quarterly
  / monthly / never), overlaid against a benchmark (SPY, VTI, QQQ, AGG…).
- **Return** — total return, CAGR, best / worst calendar year, % positive months.
- **Risk** — annualized volatility, max drawdown with an underwater chart, and
  monthly VaR & CVaR at 95%.
- **Risk-adjusted** — Sharpe, Sortino and Calmar (risk-free rate configurable).
- **Vs. benchmark** — beta, annualized alpha, correlation.
- **Diversification** — a monthly-return correlation heatmap across holdings.
- **Monte Carlo** — bootstraps the portfolio's own monthly-return history to
  project outcomes over N years, with optional monthly contributions and a
  goal-probability readout.
- **Model portfolios** — one-click load of real, public "lazy" allocations
  (60/40, Bogleheads Three-Fund, All Weather, Permanent, Golden Butterfly, …).

Dark and light themes, responsive down to phone widths, and installable as a
PWA that works offline.

## Running it locally

```bash
git clone https://github.com/zacharynorman923-design/portfolio-labs.git
cd portfolio-labs
python3 -m http.server 8000
# open http://localhost:8000
```

(The service worker needs `http://localhost` or `https://` — it stays inactive
on `file://`, but the app still works opened directly.)

## Deploying

It's a static site, so **Settings → Pages → Deploy from a branch → `main` →
`/ (root)`** publishes it. Any static host works too (Netlify, Vercel,
Cloudflare Pages) with no build command and `/` as the publish directory.

## Files

| File | Responsibility |
| --- | --- |
| `index.html` | Page structure: builder, controls, results |
| `css/styles.css` | Styling; dark + light themes, responsive |
| `js/data.js` | Ticker universe, real lazy-portfolio allocations, formatting, offline demo series |
| `js/providers.js` | Live-data adapters (Twelve Data, Alpha Vantage) — daily history + quotes |
| `js/stats.js` | The engine: backtest, metrics, correlations, VaR/CVaR, Monte Carlo |
| `js/charts.js` | Inline-SVG charts (growth, drawdown, donut, heatmap, fan, bars) |
| `js/app.js` | State, data fetching, rendering, interactions, persistence |
| `manifest.webmanifest`, `sw.js` | PWA install + offline app shell |

## A note on the numbers

Metrics are computed from the price history your provider returns. Free daily
series are typically **unadjusted** (they don't add dividends back), so total
returns for high-yield holdings run slightly low versus a dividend-adjusted
source. This is a research and education tool — **not investment advice**, and
past performance doesn't predict future results.
