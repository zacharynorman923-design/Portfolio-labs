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
  { s: 'VBK',  n: 'US Small-Cap Growth',     cls: 'us' },
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
  { s: 'QAI',  n: 'Hedge Fund Multi-Strat',  cls: 'alt' },
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

/* ======================== asset class taxonomy ==========================
   Three top-level classes, each split into subcategories. Constraints can be
   set at either level, and every subcategory rolls up into exactly one class,
   so the constraint groups never overlap.

   Alongside the core subcategories there are a few extra buckets — large cap
   blend, short and long fixed income, real estate, crypto — because filing
   SPY under "large cap growth" or TLT under "intermediate fixed income" would
   simply be wrong. Any holding can be reassigned by hand in the builder. */
const CLASSES = {
  equity: { name: 'Equity',       color: '#3563E9' },
  fixed:  { name: 'Fixed Income', color: '#22B8A6' },
  alts:   { name: 'Alternatives', color: '#F4A63B' },
};

const SUBCLASSES = {
  /* --- Equity: US --- */
  lcg:      { name: 'Large Cap Growth',          cls: 'equity' },
  lcv:      { name: 'Large Cap Value',           cls: 'equity' },
  lcb:      { name: 'Large Cap Blend',           cls: 'equity' },
  mcg:      { name: 'Mid Cap Growth',            cls: 'equity' },
  mcv:      { name: 'Mid Cap Value',             cls: 'equity' },
  scg:      { name: 'Small Cap Growth',          cls: 'equity' },
  scv:      { name: 'Small Cap Value',           cls: 'equity' },
  scb:      { name: 'Small Cap Blend',           cls: 'equity' },
  eqinc:    { name: 'Equity Income / Derivative',cls: 'equity' },
  /* --- Equity: non-US --- */
  intl:     { name: 'International Blend',       cls: 'equity' },
  intl_g:   { name: 'International Growth',      cls: 'equity' },
  intl_v:   { name: 'International Value',       cls: 'equity' },
  intl_smid:{ name: 'International Small/Mid',   cls: 'equity' },
  em:       { name: 'Emerging Markets',          cls: 'equity' },
  region:   { name: 'Regional / Single Country', cls: 'equity' },
  global:   { name: 'Global Equity',             cls: 'equity' },
  global_smid:{ name: 'Global Small/Mid',        cls: 'equity' },
  /* --- Fixed income: taxable --- */
  fi_int:   { name: 'Intermediate Fixed Income', cls: 'fixed'  },
  fi_long:  { name: 'Long-Term Fixed Income',    cls: 'fixed'  },
  fi_short: { name: 'Short-Term / Cash',         cls: 'fixed'  },
  fi_mbs:   { name: 'Mortgage-Backed',           cls: 'fixed'  },
  fi_sec:   { name: 'Securitized',               cls: 'fixed'  },
  fi_hy:    { name: 'High Yield Taxable',        cls: 'fixed'  },
  /* --- Fixed income: municipal --- */
  muni_short:{ name: 'Muni Short',               cls: 'fixed'  },
  muni_int: { name: 'Muni Intermediate',         cls: 'fixed'  },
  muni_long:{ name: 'Muni Long',                 cls: 'fixed'  },
  muni_hy:  { name: 'Muni High Yield',           cls: 'fixed'  },
  /* --- Alternatives --- */
  comm:     { name: 'Commodities',               cls: 'alts'   },
  comm_foc: { name: 'Commodities Focused',       cls: 'alts'   },
  alt_trend:{ name: 'Systematic Trend',          cls: 'alts'   },
  alt_multi:{ name: 'Multistrategy',             cls: 'alts'   },
  alt_macro:{ name: 'Macro Trading',             cls: 'alts'   },
  alt_ls:   { name: 'Long-Short Equity',         cls: 'alts'   },
  alt_mn:   { name: 'Equity Market Neutral',     cls: 'alts'   },
  alt_rv:   { name: 'Relative Value Arbitrage',  cls: 'alts'   },
  alt_ed:   { name: 'Event Driven',              cls: 'alts'   },
  alt_hedged:{ name: 'Equity Hedged',            cls: 'alts'   },
  re:       { name: 'Real Estate',               cls: 'alts'   },
  crypto:   { name: 'Crypto',                    cls: 'alts'   },
  other:    { name: 'Unclassified',              cls: 'alts'   },
};

/* Morningstar category -> taxonomy. Keys are lower-cased and stripped of
   punctuation so small spelling differences between exports still match. */
const MSTAR_CATEGORY = {
  'large growth': 'lcg', 'large value': 'lcv', 'large blend': 'lcb',
  'mid cap growth': 'mcg', 'mid cap value': 'mcv', 'mid cap blend': 'scb',
  'small growth': 'scg', 'small value': 'scv', 'small blend': 'scb',
  'derivative income': 'eqinc', 'equity income': 'eqinc',
  'foreign large blend': 'intl', 'foreign large growth': 'intl_g',
  'foreign large value': 'intl_v',
  'foreign small mid blend': 'intl_smid', 'foreign small mid growth': 'intl_smid',
  'foreign small mid value': 'intl_smid',
  'diversified emerging mkts': 'em', 'diversified emerging markets': 'em',
  'global large stock blend': 'global', 'global large stock growth': 'global',
  'global large stock value': 'global', 'global small mid stock': 'global_smid',
  'europe stock': 'region', 'japan stock': 'region', 'greater china region': 'region',
  'india equity': 'region', 'pacific asia ex japan stk': 'region',
  'pacific asia ex japan stock': 'region', 'focused region': 'region',
  'latin america stock': 'region', 'china region': 'region',
  'intermediate core plus bond': 'fi_int', 'intermediate core bond': 'fi_int',
  'intermediate government': 'fi_int', 'corporate bond': 'fi_int',
  'long government': 'fi_long', 'long term bond': 'fi_long',
  'ultrashort bond': 'fi_short', 'short term bond': 'fi_short',
  'short government': 'fi_short', 'money market taxable': 'fi_short',
  'government mortgage backed bond': 'fi_mbs',
  'securitized bond diversified': 'fi_sec', 'securitized bond': 'fi_sec',
  'high yield bond': 'fi_hy', 'bank loan': 'fi_hy',
  'muni national short': 'muni_short', 'muni national interm': 'muni_int',
  'muni national intermediate': 'muni_int', 'muni national long': 'muni_long',
  'high yield muni': 'muni_hy',
  'commodities broad basket': 'comm', 'commodities focused': 'comm_foc',
  'systematic trend': 'alt_trend', 'managed futures': 'alt_trend',
  'multistrategy': 'alt_multi', 'macro trading': 'alt_macro',
  'long short equity': 'alt_ls', 'equity market neutral': 'alt_mn',
  'relative value arbitrage': 'alt_rv', 'event driven': 'alt_ed',
  'equity hedged': 'alt_hedged', 'options trading': 'alt_hedged',
  'real estate': 're', 'global real estate': 're',
  'digital assets': 'crypto',
};

/* Categories excluded by default when importing a universe. These encode a
   policy decision rather than a data limitation, so every one is a checkbox in
   the importer and can be switched back on:
     - regional / single-country and global sleeves are handled separately
     - international is carried by one blend sleeve, so the style-split and
       small/mid foreign buckets are folded away
     - emerging markets is held inside a combined international fund, not
       allocated on its own
     - municipal exposure is intermediate-only
     - taxable fixed income is core-plus only                                */
const DEFAULT_EXCLUDED_SUBCLASSES = [
  'region', 'global', 'global_smid',
  'intl_g', 'intl_v', 'intl_smid',
  'em',
  'muni_short', 'muni_long', 'muni_hy',
  'fi_mbs', 'fi_sec',
];

function normalizeCategory(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function subclassFromCategory(cat) {
  return MSTAR_CATEGORY[normalizeCategory(cat)] || null;
}

/* Ticker → subcategory. Anything unknown lands in `other` until reassigned. */
const SUBCLASS_OF = {
  SPY: 'lcb', VOO: 'lcb', VTI: 'lcb',
  QQQ: 'lcg', VUG: 'lcg',
  VTV: 'lcv', SCHD: 'lcv',
  VBK: 'scg', VBR: 'scv',
  VXUS: 'intl', VEA: 'intl', VWO: 'intl',
  BND: 'fi_int', AGG: 'fi_int', IEI: 'fi_int', LQD: 'fi_int', TIP: 'fi_int',
  TLT: 'fi_long',
  SHY: 'fi_short', BIL: 'fi_short',
  QAI: 'alt_multi', MNA: 'alt_ed', BTAL: 'alt_mn',
  MBXIX: 'alt_multi',
  GLD: 'comm', SLV: 'comm', DBC: 'comm',
  VNQ: 're',
  'BTC/USD': 'crypto', 'ETH/USD': 'crypto',
  AAPL: 'lcg', MSFT: 'lcg', NVDA: 'lcg', AMZN: 'lcg', GOOGL: 'lcg',
};

/* User reassignments live here (persisted by app.js) and beat the defaults. */
const SUBCLASS_OVERRIDE = {};

/* Always resolves to a subcategory that exists. Saved settings can outlive a
   taxonomy change and refer to keys that have since been renamed or removed,
   and a stale key must degrade to Unclassified rather than crash the page. */
function validSubclass(k) { return (k && SUBCLASSES[k]) ? k : null; }
function subclassOf(sym) {
  return validSubclass(SUBCLASS_OVERRIDE[sym]) || validSubclass(SUBCLASS_OF[sym]) || 'other';
}
function classOf(sym) { return (SUBCLASSES[subclassOf(sym)] || SUBCLASSES.other).cls; }
function classOfSubclass(k) { return (SUBCLASSES[k] || SUBCLASSES.other).cls; }
function subclassName(k) { return (SUBCLASSES[k] || SUBCLASSES.other).name; }
function className(k) { return (CLASSES[k] || { name: k }).name; }

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

/* ==================== longer-history substitutes ========================
   A backtest can only run over the window every holding shares, so one recent
   ETF drags the whole study forward. Index mutual funds usually predate their
   ETF equivalents by a decade or more, so they make good stand-ins.

   These are CANDIDATES ONLY. The app fetches each one and reports its real
   first date and its actual return correlation with the fund being replaced —
   nothing here is presented to the user as fact until the data confirms it. */
const SUBSTITUTES = {
  VTI:   ['VTSMX', 'VFINX', 'SPY'],
  VOO:   ['VFINX', 'SPY', 'VTSMX'],
  SPY:   ['VFINX'],
  QQQ:   ['VIGRX'],
  VUG:   ['VIGRX'],
  VTV:   ['VIVAX'],
  SCHD:  ['VIVAX', 'VDIGX'],
  VBR:   ['VISVX'],
  VBK:   ['VISGX'],
  VXUS:  ['VGTSX', 'EFA'],
  VEA:   ['VGTSX', 'EFA'],
  VWO:   ['VEIEX', 'EEM'],
  BND:   ['VBMFX', 'AGG'],
  AGG:   ['VBMFX'],
  TLT:   ['VUSTX'],
  IEI:   ['VFITX'],
  SHY:   ['VFISX'],
  BIL:   ['VFISX'],
  TIP:   ['VIPSX'],
  LQD:   ['VWESX'],
  VNQ:   ['VGSIX'],
  GLD:   ['IAU'],
  SLV:   ['IAU'],
};

/* Fall back to any older fund in the same subcategory when the ticker itself
   has no listed stand-in. */
const SUBSTITUTE_BY_SUBCLASS = {
  lcb: ['VTSMX', 'VFINX'], lcg: ['VIGRX'], lcv: ['VIVAX'],
  scg: ['VISGX'], scv: ['VISVX'], intl: ['VGTSX', 'EFA'],
  fi_int: ['VBMFX'], fi_long: ['VUSTX'], fi_short: ['VFISX'],
  re: ['VGSIX'],
};

function substitutesFor(sym) {
  const direct = SUBSTITUTES[sym] || [];
  const byClass = SUBSTITUTE_BY_SUBCLASS[subclassOf(sym)] || [];
  const all = direct.concat(byClass.filter(s => !direct.includes(s)));
  return all.filter(s => s !== sym);
}

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
  VBK:  { mu: 0.095, sig: 0.22, beta: 1.12, seed: 118 },
  VUG:  { mu: 0.115, sig: 0.19, beta: 1.10, seed: 119 },
  VTV:  { mu: 0.085, sig: 0.15, beta: 0.92, seed: 120 },
  SCHD: { mu: 0.09,  sig: 0.14, beta: 0.88, seed: 121 },
  QAI:  { mu: 0.035, sig: 0.06, beta: 0.30, seed: 122 },
  TIP:  { mu: 0.032, sig: 0.06, beta: 0.05, seed: 123 },
  LQD:  { mu: 0.035, sig: 0.08, beta: 0.15, seed: 124 },
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

/* Older index-fund stand-ins, so the substitute finder is demoable offline.
   `yrs` gives each one a longer synthetic history than its ETF equivalent. */
const DEMO_PROXY = {
  VTSMX: { of: 'VTI',  yrs: 26 }, VFINX: { of: 'SPY',  yrs: 30 },
  VIGRX: { of: 'VUG',  yrs: 26 }, VIVAX: { of: 'VTV',  yrs: 26 },
  VISVX: { of: 'VBR',  yrs: 22 }, VISGX: { of: 'VBK',  yrs: 22 },
  VGTSX: { of: 'VXUS', yrs: 24 }, VBMFX: { of: 'BND',  yrs: 28 },
  VUSTX: { of: 'TLT',  yrs: 28 }, VFISX: { of: 'SHY',  yrs: 26 },
  VGSIX: { of: 'VNQ',  yrs: 24 }, VIPSX: { of: 'TIP',  yrs: 20 },
};
/* A few tickers get a deliberately short demo history so the limiting-holding
   logic has something to find. */
const DEMO_SHORT = { VXUS: 7, SCHD: 8, QAI: 9, VBK: 10 };

const DEMO_YEARS = 12;
function buildDemoSeries(sym) {
  const proxy = DEMO_PROXY[sym];
  if (proxy) {
    /* A proxy is the same underlying series extended further back, which is
       what a longer-lived share class of the same index looks like. */
    // same seed as the fund it stands in for, so the two track closely
    const base = DEMO_SPEC[proxy.of];
    if (base) return buildDemoFrom(base, proxy.yrs);
  }
  const spec = DEMO_SPEC[sym];
  if (!spec) return null;
  return buildDemoFrom(spec, DEMO_SHORT[sym] || DEMO_YEARS);
}

const DEMO_MAX_YEARS = 30;   // longest synthetic history any proxy gets

/* Every demo series ENDS today and starts `years` back, so a shorter history
   begins later — which is what makes one holding the binding constraint. All
   of them read the same shared market factor at the same calendar offset, so
   series of different lengths still co-move correctly where they overlap. */
/* Per-asset idiosyncratic shocks, generated once over the full timeline and
   indexed by absolute calendar position. Two series sharing a seed therefore
   see identical shocks on the same dates — which is what makes a proxy track
   the fund it stands in for, exactly as another share class of one index would. */
const _IDIO = {};
function idioPath(seed, maxDays) {
  if (_IDIO[seed] && _IDIO[seed].length >= maxDays) return _IDIO[seed];
  const rng = mulberry32(seed);
  const out = new Array(maxDays);
  for (let i = 0; i < maxDays; i++) out[i] = gauss(rng);
  _IDIO[seed] = out;
  return out;
}

function buildDemoFrom(spec, years) {
  const days = Math.round(years * 252);
  const maxDays = Math.round(DEMO_MAX_YEARS * 252);
  const market = demoMarketPath(maxDays);
  const shocks = idioPath(spec.seed, maxDays);
  const offset = maxDays - days;                    // align to the same timeline
  const dailyMu = spec.mu / 252;
  // idiosyncratic vol left after removing the market-factor contribution
  const idio = Math.sqrt(Math.max(0.0001, spec.sig * spec.sig - Math.pow(spec.beta * 0.16, 2))) / Math.sqrt(252);

  /* Step dates BACKWARD from today so every series ends now and only its start
     differs — stepping forward from the start made long series end years ago. */
  const today = new Date();
  const values = new Array(days);
  let price = 100;
  for (let i = 0; i < days; i++) {
    const shock = spec.beta * market[offset + i] + idio * shocks[offset + i];
    price *= Math.exp(dailyMu - 0.5 * (spec.sig * spec.sig) / 252 + shock);
    const d = new Date(today.getTime());
    d.setDate(d.getDate() - Math.floor((days - 1 - i) * 7 / 5));
    values[i] = { date: d.toISOString().slice(0, 10), close: +price.toFixed(4) };
  }
  return values;
}

const DEMO_SYMBOLS = Object.keys(DEMO_SPEC).concat(Object.keys(DEMO_PROXY));
function demoAvailable(sym) { return !!DEMO_SPEC[sym] || !!DEMO_PROXY[sym]; }
