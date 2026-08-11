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
- **Compare two portfolios** — flip on *compare two* to build an A and a B and
  run them side by side: both plotted on the growth and drawdown charts, an
  extra column in the metrics table, both allocations, and a selector for which
  one the correlation matrix and Monte Carlo project.
- **Optimization** — find better weights for the holdings you already have:
  **max Sharpe** (tangency), **min volatility**, **risk parity** (equal risk
  contribution) or **equal weight**, plotted against the **efficient frontier**
  with your current mix marked on it. One click applies the suggested weights.
  See [Optimization](#optimization).
- **Total return** — optionally reinvest dividends instead of measuring price
  only (see below).
- **Refresh data** — prices are cached for 12 hours to protect your free quota;
  this button forces a fresh pull when you want today's close.

### Optimization

The optimizer works on the holdings and period currently on screen, using the
annualized covariance of their monthly returns. Every result is **long-only and
fully invested** (`w ≥ 0`, `Σw = 1`) — no shorting, no leverage.

| Objective | What it solves for |
| --- | --- |
| **Max Sharpe** | Highest `(return − risk-free) / volatility` — the tangency portfolio |
| **Min volatility** | Smallest achievable portfolio variance |
| **Risk parity** | Every holding contributes an equal share of total risk |
| **Equal weight** | The naive `1/n` baseline, for reference |
| **Max return at a given volatility** | "I can live with 12% volatility — get me the most return available at that risk" |
| **Min volatility for a given return** | "I need 8% a year — get me there with the least risk" |

The last two are the constrained duals of the same frontier. Both are solved by
bisecting `γ`, since return and volatility each increase monotonically along the
frontier — no extra constraint machinery needed. Each box shows the **reachable
range** for the current holdings, and if you ask for something outside it the app
says so, reports the closest achievable portfolio, and tells you what kind of
holding would widen the range — rather than quietly returning a clamped answer
as if it met the request.

#### Asset allocation constraints

Every objective can be solved subject to minimum and maximum weights per asset
class and per subcategory — "equity 50–60%, fixed income 30–40%, at least 5%
international". Holdings are classified automatically and anything can be
reassigned by hand.

| Class | Subcategories |
| --- | --- |
| **Equity** | Large Cap Growth · Large Cap Value · Large Cap Blend · Small Cap Growth · Small Cap Value · International |
| **Fixed Income** | Intermediate · Long-Term · Short-Term / Cash |
| **Alternatives** | Hedge Funds · Commodities · Real Estate · Crypto |

Large Cap Blend, the short/long fixed income splits, real estate and crypto sit
alongside the core categories because filing SPY under "large cap growth" or TLT
under "intermediate" would be wrong.

Constraints are enforced by projecting every optimizer iterate onto the feasible
set

```
{ w : w ≥ 0, Σw = 1, loᵍ ≤ Σ_{i∈g} wᵢ ≤ hiᵍ for every category g }
```

Groups are disjoint within a level but overlap across levels (Equity contains
Large Cap Growth), so each level gets its own exact projection and **Dykstra's
algorithm** reconciles them with the sum-to-one constraint — alternating plain
projections would land somewhere in the intersection but not the nearest point.

Contradictory limits are caught before solving and explained ("the minimums add
up to 115%", "subcategory minimums inside Equity add up to 45%, above its 30%
maximum"). If a limit can't be met because nothing in the portfolio belongs to
that category, the result says which one and by how much rather than quietly
returning something that breaks it.

The **efficient frontier** is traced by sweeping a risk-aversion parameter `γ`
through `min wᵀΣw − γ(w·μ)`, solved with projected gradient descent onto the
probability simplex. Sweeping `γ` is used rather than pinning a target return
with a penalty term: a penalty stiff enough to hold the return constraint
forces a tiny step size, which leaves the variance under-minimised and draws a
frontier that sits inside the true one.

The **Risk** column is each holding's share of total portfolio risk
(`wᵢ(Σw)ᵢ / wᵀΣw`). It can go slightly negative for a strong diversifier — an
asset that reduces total risk carries a negative marginal contribution. That's
also why risk parity's *weights* look uneven while its *risk* split is exactly
equal.

> **Optimizing on past returns is not a forecast.** Max Sharpe in particular
> concentrates into whatever happened to perform best over the window, and
> expected-return estimates are far noisier than covariance estimates. Treat it
> as a study of the period, not a recommendation. Min volatility and risk parity
> depend only on covariance and tend to be more stable out of sample.

### Total return vs price return

Free daily feeds quote **price only**, so a distribution shows up as a drop in
the series and the payout is never counted — which understates returns for
income-heavy holdings like `SCHD`, `VYM` or `BND`.

Ticking **Total return** fetches each holding's dividend history and rebuilds a
reinvested-distribution index:

```
TR[0] = P[0]
TR[i] = TR[i-1] × (P[i] + D[i]) / P[i-1]
```

Dividends are credited to the first trading day on or after the ex-date, so a
payout whose ex-date lands on a weekend or holiday still counts. It costs one
extra request per holding. If a provider returns no dividend data for a symbol,
that symbol quietly falls back to price-only and the app **says so** rather than
reporting a number it can't stand behind.

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
| `js/optimize.js` | Optimization: covariance, efficient frontier, max Sharpe, min variance, risk parity |
| `js/charts.js` | Inline-SVG charts (growth, drawdown, donut, heatmap, fan, bars) |
| `js/app.js` | State, data fetching, rendering, interactions, persistence |
| `manifest.webmanifest`, `sw.js` | PWA install + offline app shell |

## A note on the numbers

Metrics are computed from the price history your provider returns. Leave
**Total return** off and you're measuring price return only, which runs low for
dividend payers; turn it on and returns include reinvested distributions where
the provider supplies them. Either way the mode is labelled in the results
header, so you always know which one you're reading.

This is a research and education tool — **not investment advice**, and past
performance doesn't predict future results.
