/* =========================================================================
   Portfolio Labs — returns-based style analysis (Sharpe, 1992)
   -------------------------------------------------------------------------
   Morningstar's style box is licensed data with no free API, so instead of
   looking a fund's box weights up, this infers an equivalent style mix from
   what the fund actually did. Each holding's monthly returns are regressed
   against a basket of style benchmarks with the weights constrained to be
   non-negative and to sum to 1:

       minimise ‖ r_fund − Σ wₖ·r_benchmarkₖ ‖²   s.t.  w ≥ 0, Σw = 1

   The fitted weights are the fund's *effective* exposure — a large-blend fund
   comes back roughly half growth and half value, a balanced fund splits across
   equity and bonds. That is exactly the fractional category membership the
   allocation constraints want, and it is estimated from price history the app
   already downloads.

   This is an estimate of behaviour, not a holdings lookup. R² is reported with
   every fit so a poor explanation is visible rather than hidden.
   ========================================================================= */

/* One benchmark per category, chosen to be liquid and to span the space.
   Large Cap Blend is deliberately absent: blend is a mixture of growth and
   value, so including it would make the basis redundant and the split
   arbitrary. A blend fund correctly resolves to ~half growth, ~half value. */
const STYLE_BASIS = [
  { key: 'lcg',      sym: 'VUG' },
  { key: 'lcv',      sym: 'VTV' },
  { key: 'scg',      sym: 'VBK' },
  { key: 'scv',      sym: 'VBR' },
  { key: 'intl',     sym: 'VEA' },
  { key: 'fi_int',   sym: 'BND' },
  { key: 'fi_long',  sym: 'TLT' },
  { key: 'fi_short', sym: 'BIL' },
  { key: 'comm',     sym: 'DBC' },
  { key: 're',       sym: 'VNQ' },
  { key: 'hedge',    sym: 'QAI' },
];

const STYLE_MIN_MONTHS = 30;   // below this the fit is too unstable to report

/* Constrained least squares: minimise ‖y − Xw‖² over the simplex.
   Solved with the same accelerated projected-gradient scheme the optimizer
   uses — the feasible set here (w ≥ 0, Σw = 1) is the plain simplex, so the
   projection is exact and cheap. */
function fitStyleWeights(X, y) {
  const T = y.length, K = X.length;                 // X is K columns × T rows
  if (!T || !K) return null;

  // normal-equation pieces: XtX (K×K) and Xty (K)
  const XtX = X.map(() => new Array(K).fill(0));
  const Xty = new Array(K).fill(0);
  for (let i = 0; i < K; i++) {
    for (let j = i; j < K; j++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += X[i][t] * X[j][t];
      XtX[i][j] = s; XtX[j][i] = s;
    }
    let s = 0;
    for (let t = 0; t < T; t++) s += X[i][t] * y[t];
    Xty[i] = s;
  }

  let maxRow = 0;
  XtX.forEach(r => { let s = 0; r.forEach(v => s += Math.abs(v)); maxRow = Math.max(maxRow, s); });
  const lr = 1 / (2 * (maxRow || 1e-12));

  const objective = (w) => {
    let q = 0;
    for (let i = 0; i < K; i++) {
      let row = 0;
      for (let j = 0; j < K; j++) row += XtX[i][j] * w[j];
      q += w[i] * row;
    }
    let l = 0;
    for (let i = 0; i < K; i++) l += Xty[i] * w[i];
    return q - 2 * l;
  };

  let w = new Array(K).fill(1 / K);
  let prev = w.slice(), yk = w.slice(), t = 1, fPrev = objective(w);
  for (let k = 0; k < 4000; k++) {
    const g = new Array(K);
    for (let i = 0; i < K; i++) {
      let row = 0;
      for (let j = 0; j < K; j++) row += XtX[i][j] * yk[j];
      g[i] = 2 * (row - Xty[i]);
    }
    w = projectSimplex(yk.map((v, i) => v - lr * g[i]));
    const f = objective(w);
    if (f > fPrev + 1e-18) { t = 1; yk = w.slice(); }        // adaptive restart
    else {
      const tN = (1 + Math.sqrt(1 + 4 * t * t)) / 2;
      const mom = (t - 1) / tN;
      yk = w.map((v, i) => v + mom * (v - prev[i]));
      t = tN;
    }
    let delta = 0;
    for (let i = 0; i < K; i++) delta += Math.abs(w[i] - prev[i]);
    prev = w.slice();
    fPrev = Math.min(fPrev, f);
    if (delta < 1e-12) break;
  }

  // R²: how much of the fund's variation the style mix explains
  const yMean = S.mean(y);
  let ssRes = 0, ssTot = 0;
  for (let t2 = 0; t2 < T; t2++) {
    let fit = 0;
    for (let i = 0; i < K; i++) fit += w[i] * X[i][t2];
    ssRes += (y[t2] - fit) * (y[t2] - fit);
    ssTot += (y[t2] - yMean) * (y[t2] - yMean);
  }
  const r2 = ssTot > 1e-18 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  return { w, r2, months: T };
}

/* Analyse every holding against the style basis.
   `seriesFor(sym)` returns [{date, close}] — supplied by the app so this stays
   independent of where the prices came from (live provider or demo). */
async function analyzeStyles(symbols, seriesFor) {
  const basisSyms = STYLE_BASIS.map(b => b.sym);
  const need = basisSyms.concat(symbols.filter(s => !basisSyms.includes(s)));

  const seriesMap = {};
  for (const s of need) seriesMap[s] = await seriesFor(s);

  const aligned = alignSeries(seriesMap, need);
  if (aligned.dates.length < 60) {
    return { error: 'Not enough overlapping history to estimate style. Try a longer period.' };
  }

  // monthly returns for the basis, as columns
  const basisRet = STYLE_BASIS.map(b => monthlyReturns(aligned.dates, aligned.closes[b.sym]).map(x => x.r));
  const T = Math.min(...basisRet.map(r => r.length));
  if (T < STYLE_MIN_MONTHS) {
    return { error: 'Need at least ' + STYLE_MIN_MONTHS + ' months of overlapping history; only ' + T + ' available.' };
  }
  const X = basisRet.map(r => r.slice(-T));

  const out = {};
  symbols.forEach(sym => {
    const ret = monthlyReturns(aligned.dates, aligned.closes[sym]).map(x => x.r).slice(-T);
    if (ret.length < T) return;
    const fit = fitStyleWeights(X, ret);
    if (!fit) return;
    const mix = {};
    STYLE_BASIS.forEach((b, i) => { if (fit.w[i] > 0.005) mix[b.key] = fit.w[i]; });
    // renormalise after dropping dust so the mix still sums to 1
    const tot = Object.keys(mix).reduce((s, k) => s + mix[k], 0) || 1;
    Object.keys(mix).forEach(k => mix[k] /= tot);
    out[sym] = { mix, r2: fit.r2, months: T };
  });
  return { styles: out, months: T };
}

/* Roll a subcategory mix up into top-level class weights. */
function classMixOf(mix) {
  const out = {};
  Object.keys(mix || {}).forEach(k => {
    const c = (SUBCLASSES[k] || SUBCLASSES.other).cls;
    out[c] = (out[c] || 0) + mix[k];
  });
  return out;
}

/* The single category a holding most resembles — used when a hard bucket is
   still wanted (the category dropdown, the allocation donut labels). */
function dominantStyle(mix) {
  let best = null, bestV = 0;
  Object.keys(mix || {}).forEach(k => { if (mix[k] > bestV) { bestV = mix[k]; best = k; } });
  return best;
}
