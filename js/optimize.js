/* =========================================================================
   Portfolio Labs — portfolio optimization
   -------------------------------------------------------------------------
   Long-only, fully-invested optimization over the holdings you already have:

     • Minimum volatility   — smallest achievable portfolio variance
     • Maximum Sharpe       — best risk-adjusted return (tangency portfolio)
     • Risk parity          — every holding contributes equal risk

   Inputs come from the same monthly returns the rest of the app uses, so an
   optimization always reflects the period and holdings on screen. Weights are
   constrained to w >= 0 and sum(w) = 1: no shorting and no leverage.

   No solver library. Constrained problems are handled with projected gradient
   descent onto the probability simplex, which is exact for this constraint set
   and converges reliably for the small covariance matrices here (< ~20 assets).
   ========================================================================= */

/* Annualized expected returns + covariance matrix from monthly asset returns.
   Arithmetic means are used, which is the convention for mean-variance work. */
function assetStats(aligned, syms) {
  const rets = syms.map(s => monthlyReturns(aligned.dates, aligned.closes[s]).map(x => x.r));
  const n = Math.min(...rets.map(r => r.length));
  if (!isFinite(n) || n < 12) return null;             // need a year of months
  const R = rets.map(r => r.slice(-n));                // common trailing window

  const mu = R.map(r => S.mean(r) * 12);
  const means = R.map(r => S.mean(r));
  const cov = R.map(() => new Array(syms.length).fill(0));
  for (let i = 0; i < syms.length; i++) {
    for (let j = i; j < syms.length; j++) {
      let c = 0;
      for (let k = 0; k < n; k++) c += (R[i][k] - means[i]) * (R[j][k] - means[j]);
      c = (c / (n - 1)) * 12;                          // annualize
      cov[i][j] = c; cov[j][i] = c;
    }
  }
  return { mu, cov, n, syms };
}

/* --------------------------- linear algebra ----------------------------- */
function matVec(M, v) {
  return M.map(row => { let s = 0; for (let i = 0; i < v.length; i++) s += row[i] * v[i]; return s; });
}
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

function portVariance(w, cov) { return dot(w, matVec(cov, w)); }
function portVol(w, cov) { return Math.sqrt(Math.max(0, portVariance(w, cov))); }
function portReturn(w, mu) { return dot(w, mu); }
function portSharpe(w, mu, cov, rf) {
  const v = portVol(w, cov);
  return v > 1e-12 ? (portReturn(w, mu) - rf) / v : 0;
}

/* Euclidean projection onto { w : w >= 0, sum(w) = 1 } (Duchi et al. 2008).
   This is what keeps every iterate a valid long-only portfolio. */
function projectSimplex(v) {
  const n = v.length;
  const u = v.slice().sort((a, b) => b - a);
  let css = 0, rho = -1, theta = 0;
  for (let j = 0; j < n; j++) {
    css += u[j];
    const t = (css - 1) / (j + 1);
    if (u[j] - t > 0) { rho = j; theta = t; }
  }
  if (rho < 0) return new Array(n).fill(1 / n);
  return v.map(x => Math.max(0, x - theta));
}

/* Curvature scale of the covariance matrix — sets a safe gradient step. */
function covScale(cov) {
  let maxRow = 0;
  cov.forEach(r => { let s = 0; r.forEach(x => s += Math.abs(x)); maxRow = Math.max(maxRow, s); });
  return maxRow || 1e-9;
}

/* Projected gradient descent on the mean-variance objective

       f(w) = wᵀΣw − γ (w·μ)

   subject to w >= 0, sum(w) = 1. Sweeping the risk-aversion parameter γ from 0
   upward traces the whole efficient frontier: γ = 0 is the global
   minimum-variance portfolio, and large γ drives it to the highest-return
   holding. This is used in preference to pinning a target return with a
   penalty term — a penalty large enough to hold the return constraint forces a
   tiny step size, which leaves the variance under-minimised and produces a
   frontier that sits inside the true one. */
function meanVarianceGamma(cov, mu, gamma, iters) {
  const n = cov.length;
  let w = new Array(n).fill(1 / n);
  const lr = 1 / (2 * covScale(cov));            // gradient is 2Σw − γμ
  const steps = iters || 6000;
  for (let k = 0; k < steps; k++) {
    const mv = matVec(cov, w);
    const g = new Array(n);
    for (let i = 0; i < n; i++) g[i] = 2 * mv[i] - (gamma ? gamma * mu[i] : 0);
    const next = projectSimplex(w.map((x, i) => x - lr * g[i]));
    let delta = 0;
    for (let i = 0; i < n; i++) delta += Math.abs(next[i] - w[i]);
    w = next;
    if (delta < 1e-13) break;                    // converged
  }
  return w;
}

/* Global minimum-variance portfolio (γ = 0). */
function minVariance(cov, iters) {
  return meanVarianceGamma(cov, null, 0, iters || 8000);
}

/* Efficient frontier as a γ sweep, returned sorted by volatility. */
function efficientFrontier(mu, cov, steps) {
  const muScale = Math.max(...mu.map(Math.abs)) || 1;
  const gMax = 10 * covScale(cov) / muScale;     // enough to reach max-return
  const N = steps || 40;
  const out = [];
  for (let k = 0; k < N; k++) {
    const g = gMax * Math.pow(k / (N - 1), 2);   // denser at the low-risk end
    const w = meanVarianceGamma(cov, mu, g, 3000);
    out.push({ w, ret: portReturn(w, mu), vol: portVol(w, cov), gamma: g });
  }
  return out.sort((a, b) => a.vol - b.vol);
}

/* Maximum-Sharpe (tangency) portfolio. Sharpe is unimodal along the frontier,
   so a coarse γ sweep followed by a local refinement finds it reliably —
   more stable than differentiating the ratio, which misbehaves as vol → 0. */
function maxSharpe(mu, cov, rf) {
  const muScale = Math.max(...mu.map(Math.abs)) || 1;
  const gMax = 10 * covScale(cov) / muScale;
  const sharpeAt = (w) => {
    const v = portVol(w, cov);
    return v > 1e-12 ? (portReturn(w, mu) - rf) / v : -Infinity;
  };

  let best = null, bestG = 0;
  const N = 48;
  for (let k = 0; k < N; k++) {
    const g = gMax * Math.pow(k / (N - 1), 2);
    const w = meanVarianceGamma(cov, mu, g, 3000);
    const s = sharpeAt(w);
    if (!best || s > best.s) { best = { w, s }; bestG = g; }
  }
  // refine on a narrow γ window around the best point
  const span = gMax / N;
  for (let i = -6; i <= 6; i++) {
    const g = bestG + span * (i / 6);
    if (g < 0) continue;
    const w = meanVarianceGamma(cov, mu, g, 8000);
    const s = sharpeAt(w);
    if (s > best.s) best = { w, s };
  }
  return best.w;
}

/* Fractional risk contributions: RC_i = w_i (Σw)_i / wᵀΣw, summing to 1. */
function riskContributions(w, cov) {
  const mv = matVec(cov, w);
  const varp = dot(w, mv);
  if (varp <= 1e-16) return w.map(() => 0);
  return w.map((x, i) => (x * mv[i]) / varp);
}

/* Equal-risk-contribution ("risk parity") portfolio.
   At the solution w_i·(Σw)_i is identical for every asset, so w_i ∝ 1/(Σw)_i
   is the fixed point; iterating that and renormalising converges quickly for
   positive semi-definite covariance. Damped to stay stable. */
function riskParity(cov, iters) {
  const n = cov.length;
  let w = new Array(n).fill(1 / n);
  const steps = iters || 3000;
  for (let k = 0; k < steps; k++) {
    const mv = matVec(cov, w);
    const next = new Array(n);
    for (let i = 0; i < n; i++) {
      const denom = Math.abs(mv[i]) < 1e-14 ? 1e-14 : mv[i];
      next[i] = denom > 0 ? 1 / denom : w[i];
      if (!isFinite(next[i]) || next[i] <= 0) next[i] = w[i];
    }
    let sum = next.reduce((s, x) => s + x, 0) || 1;
    for (let i = 0; i < n; i++) next[i] /= sum;
    // damping: half step toward the fixed point keeps it from oscillating
    let delta = 0;
    for (let i = 0; i < n; i++) {
      const v = 0.5 * w[i] + 0.5 * next[i];
      delta += Math.abs(v - w[i]);
      w[i] = v;
    }
    let s2 = w.reduce((s, x) => s + x, 0) || 1;
    for (let i = 0; i < n; i++) w[i] /= s2;
    if (delta < 1e-13) break;
  }
  return w;
}

/* ------------------------------ entry point ----------------------------- */
/* Runs one objective and returns everything the UI needs to explain it. */
function optimizePortfolio(stats, objective, rf) {
  const { mu, cov, syms } = stats;
  let w;
  if (objective === 'minvol')      w = minVariance(cov, 8000);
  else if (objective === 'sharpe') w = maxSharpe(mu, cov, rf);
  else if (objective === 'parity') w = riskParity(cov);
  else                             w = new Array(mu.length).fill(1 / mu.length);

  // scrub numerical dust so the suggested weights read cleanly
  w = w.map(x => x < 1e-4 ? 0 : x);
  const sum = w.reduce((s, x) => s + x, 0) || 1;
  w = w.map(x => x / sum);

  return {
    weights: w, syms,
    ret: portReturn(w, mu),
    vol: portVol(w, cov),
    sharpe: portSharpe(w, mu, cov, rf),
    rc: riskContributions(w, cov),
  };
}

/* Evaluate an arbitrary weight vector (e.g. the user's current mix) on the
   same basis, so "current vs optimized" is a like-for-like comparison. */
function evaluateWeights(stats, weights, rf) {
  const { mu, cov } = stats;
  const sum = weights.reduce((s, x) => s + x, 0) || 1;
  const w = weights.map(x => x / sum);
  return {
    weights: w,
    ret: portReturn(w, mu),
    vol: portVol(w, cov),
    sharpe: portSharpe(w, mu, cov, rf),
    rc: riskContributions(w, cov),
  };
}
