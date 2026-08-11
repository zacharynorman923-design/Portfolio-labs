/* =========================================================================
   Portfolio Labs — static data + formatting helpers
   -------------------------------------------------------------------------
   - Formatting utilities used across the app.
   - A universe of common tickers for the quick-add suggestions.
   - Real, public "lazy portfolio" allocations (well-known model portfolios).
   - A small OFFLINE DEMO price dataset (clearly synthetic) so the app is
     explorable before you add a live-data API key.
   No external dependencies. Everything here is plain data + pure functions.
   ========================================================================= */

/* ----------------------------- formatting ------------------------------ */
const FMT = {
  money(n, dp = 0) {
    if (n == null || !isFinite(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', {
      minimumFractionDigits: dp, maximumFractionDigits: dp,
    });
  },
  pct(n, dp = 2) {
    if (n == null || !isFinite(n)) return '—';
    return (n * 100).toFixed(dp) + '%';
  },
  signedPct(n, dp = 2) {
    if (n == null || !isFinite(n)) return '—';
    const s = (n * 100).toFixed(dp) + '%';
    return n > 0 ? '+' + s : s;
  },
  num(n, dp = 2) {
    if (n == null || !isFinite(n)) return '—';
    return Number(n).toFixed(dp);
  },
  date(d) {
    if (!d) return '—';
    const dt = (d instanceof Date) ? d : new Date(d);
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  },
};

/* Sign class helper for colouring positive / negative numbers. */
function signClass(n) { return n > 1e-9 ? 'up' : (n < -1e-9 ? 'down' : 'flat'); }

/* ------------------------- ticker suggestions -------------------------- */
/* A pragmatic list of widely-available symbols for the quick-add chips.
   `cls` is only used to colour the allocation chart and group things. */
const UNIVERSE = [
  { s: 'SPY',  n: 'S&P 500 ETF',            cls: 'us' },
  { s: 'VOO',  n: 'Vanguard S&P 500',        cls: 'us' },
  { s: 'VTI',  n: 'US Total Market',         cls: 'us' },
  { s: 'QQQ',  n: 'Nasdaq-100',              cls: 'us' },
  { s: 'VUG',  n: 'US Growth',               cls: 'us' },
  { s: 'VTV',  n: 'US Value',                cls: 'us' },
  { s: 'VBR',  n: 'US Small-Cap Value',      cls: 'us' },
  { s: 'SCHD', n: 'US Dividend',             cls: 'us' },
  { s: 'VXUS', n: 'Total International',      cls: 'intl' },
  { s: 'VEA',  n: 'Developed Markets',       cls: 'intl' },
  { s: 'VWO',  n: 'Emerging Markets',        cls: 'intl' },
  { s: 'BND',  n: 'US Total Bond',           cls: 'bond' },
  { s: 'AGG',  n: 'US Aggregate Bond',       cls: 'bond' },
  { s: 'TLT',  n: '20+ Yr Treasury',         cls: 'bond' },
  { s: 'IEI',  n: '3-7 Yr Treasury',         cls: 'bond' },
  { s: 'SHY',  n: '1-3 Yr Treasury',         cls: 'bond' },
  { s: 'TIP',  n: 'TIPS (Inflation)',        cls: 'bond' },
  { s: 'LQD',  n: 'Corporate Bonds',         cls: 'bond' },
  { s: 'GLD',  n: 'Gold',                    cls: 'alt' },
  { s: 'SLV',  n: 'Silver',                  cls: 'alt' },
  { s: 'DBC',  n: 'Commodities',             cls: 'alt' },
  { s: 'VNQ',  n: 'US Real Estate',          cls: 'alt' },
  { s: 'BIL',  n: '1-3 Mo T-Bills (cash)',   cls: 'cash' },
  { s: 'AAPL', n: 'Apple',                   cls: 'stock' },
  { s: 'MSFT', n: 'Microsoft',               cls: 'stock' },
  { s: 'NVDA', n: 'Nvidia',                  cls: 'stock' },
  { s: 'AMZN', n: 'Amazon',                  cls: 'stock' },
  { s: 'GOOGL',n: 'Alphabet',                cls: 'stock' },
  { s: 'BTC/USD', n: 'Bitcoin',              cls: 'crypto' },
  { s: 'ETH/USD', n: 'Ethereum',             cls: 'crypto' },
];

const UNIVERSE_MAP = UNIVERSE.reduce((m, a) => (m[a.s] = a, m), {});
function assetMeta(sym) {
  return UNIVERSE_MAP[sym] || { s: sym, n: sym, cls: 'stock' };
}

/* Distinct, colour-blind-friendlier palette for allocation slices. */
const SLICE_COLORS = [
  '#3563E9', '#22B8A6', '#F4A63B', '#E5586B', '#8B6CE5',
  '#4FB477', '#E0803C', '#5AA9E6', '#C05FB0', '#7C8B9B',
  '#D4B23C', '#4B9CD3',
];

/* ----------------------- real "lazy" portfolios ------------------------ */
/* Public, well-known model allocations. Weights are percentages that sum
   to 100. Tickers are common, liquid ETFs so the live feed can price them. */
const LAZY = [
  {
    name: 'Classic 60/40',
    author: 'The default balanced portfolio',
    holds: [ ['VTI', 60], ['BND', 40] ],
  },
  {
    name: 'Bogleheads Three-Fund',
    author: 'John Bogle / Bogleheads',
    holds: [ ['VTI', 50], ['VXUS', 30], ['BND', 20] ],
  },
  {
    name: 'S&P 500',
    author: 'Buy the index',
    holds: [ ['VOO', 100] ],
  },
  {
    name: 'Warren Buffett 90/10',
    author: 'Buffett’s advice to his trustee',
    holds: [ ['VOO', 90], ['BIL', 10] ],
  },
  {
    name: 'All Weather',
    author: 'Ray Dalio / Bridgewater',
    holds: [ ['VTI', 30], ['TLT', 40], ['IEI', 15], ['GLD', 7.5], ['DBC', 7.5] ],
  },
  {
    name: 'Permanent Portfolio',
    author: 'Harry Browne',
    holds: [ ['VTI', 25], ['TLT', 25], ['BIL', 25], ['GLD', 25] ],
  },
  {
    name: 'Golden Butterfly',
    author: 'Tyler / Portfolio Charts',
    holds: [ ['VTI', 20], ['VBR', 20], ['TLT', 20], ['SHY', 20], ['GLD', 20] ],
  },
  {
    name: 'Ivy Portfolio',
    author: 'Meb Faber',
    holds: [ ['VTI', 20], ['VEA', 20], ['BND', 20], ['VNQ', 20], ['DBC', 20] ],
  },
];

/* ----------------------------------------------------------------------- *
   OFFLINE DEMO DATA — clearly synthetic.
   A seeded generator builds ~12 years of daily closes for a handful of
   tickers so the whole app (backtest, drawdowns, ratios, Monte Carlo) is
   fully explorable with NO API key. These are NOT real prices; the UI
   labels the demo mode plainly.
 * ----------------------------------------------------------------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* Each demo asset: annual drift (mu), annual vol (sigma), a market beta used
   to inject a shared factor so correlations/diversification look realistic. */
const DEMO_SPEC = {
  SPY:  { mu: 0.09,  sig: 0.16, beta: 1.00, seed: 101 },
  VOO:  { mu: 0.09,  sig: 0.16, beta: 1.00, seed: 102 },
  VTI:  { mu: 0.092, sig: 0.17, beta: 1.02, seed: 103 },
  QQQ:  { mu: 0.13,  sig: 0.22, beta: 1.15, seed: 104 },
  VXUS: { mu: 0.06,  sig: 0.17, beta: 0.85, seed: 105 },
  VEA:  { mu: 0.06,  sig: 0.17, beta: 0.86, seed: 106 },
  VWO:  { mu: 0.07,  sig: 0.20, beta: 0.90, seed: 107 },
  VBR:  { mu: 0.10,  sig: 0.20, beta: 1.05, seed: 108 },
  BND:  { mu: 0.03,  sig: 0.055,beta: -0.05,seed: 109 },
  AGG:  { mu: 0.03,  sig: 0.055,beta: -0.05,seed: 110 },
  TLT:  { mu: 0.035, sig: 0.14, beta: -0.30,seed: 111 },
  IEI:  { mu: 0.028, sig: 0.05, beta: -0.10,seed: 112 },
  SHY:  { mu: 0.025, sig: 0.015,beta: -0.02,seed: 113 },
  BIL:  { mu: 0.028, sig: 0.004,beta: 0.00, seed: 114 },
  GLD:  { mu: 0.05,  sig: 0.15, beta: 0.10, seed: 115 },
  DBC:  { mu: 0.04,  sig: 0.18, beta: 0.25, seed: 116 },
  VNQ:  { mu: 0.08,  sig: 0.19, beta: 0.90, seed: 117 },
};

/* Shared market factor path so demo assets co-move (positive correlations). */
let _DEMO_MARKET = null;
function demoMarketPath(days) {
  if (_DEMO_MARKET && _DEMO_MARKET.length >= days) return _DEMO_MARKET;
  // Seed chosen so the recent window trends realistically upward (demo only).
  const rng = mulberry32(97);
  const out = new Array(days);
  const dsig = 0.16 / Math.sqrt(252);
  for (let i = 0; i < days; i++) out[i] = dsig * gauss(rng);
  _DEMO_MARKET = out;
  return out;
}

const DEMO_YEARS = 12;
function buildDemoSeries(sym) {
  const spec = DEMO_SPEC[sym];
  if (!spec) return null;
  const days = Math.round(DEMO_YEARS * 252);
  const market = demoMarketPath(days);
  const rng = mulberry32(spec.seed);
  const dailyMu = spec.mu / 252;
  // idiosyncratic vol left after removing the market-factor contribution
  const idio = Math.sqrt(Math.max(0.0001, spec.sig * spec.sig - Math.pow(spec.beta * 0.16, 2))) / Math.sqrt(252);
  const start = new Date();
  start.setFullYear(start.getFullYear() - DEMO_YEARS);
  let price = 100;
  const values = [];
  for (let i = 0; i < days; i++) {
    const shock = spec.beta * market[i] + idio * gauss(rng);
    price *= Math.exp(dailyMu - 0.5 * (spec.sig * spec.sig) / 252 + shock);
    // ~5 trading days a week starting from `start`
    const d = new Date(start.getTime());
    d.setDate(d.getDate() + Math.floor(i * 7 / 5));
    values.push({ date: d.toISOString().slice(0, 10), close: +price.toFixed(4) });
  }
  return values;
}

const DEMO_SYMBOLS = Object.keys(DEMO_SPEC);
function demoAvailable(sym) { return !!DEMO_SPEC[sym]; }
