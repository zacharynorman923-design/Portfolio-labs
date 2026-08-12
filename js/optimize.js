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

/* ==================== asset-allocation constraints ======================= *
   A constraint set is a list of groups, each an index list plus min/max bounds
   on the group's total weight:

       groups = [{ idx:[0,3], lo:0.30, hi:0.60 }, ...]

   Groups here never overlap at a given level (each holding sits in exactly one
   subcategory, and each subcategory in exactly one class), which keeps the
   projections below exact and cheap.

   Projecting onto the full feasible set

       { w : w >= 0, sum(w) = 1, lo_g <= sum_{i in g} w_i <= hi_g }

   is done with Dykstra's alternating projection between two sets that each
   have an exact projection: the group-box set and the sum-to-one hyperplane.
   Alternating raw projections would converge to a point in the intersection
   but not the nearest one; Dykstra's correction terms fix that.            */

/* Exact projection of x onto { y >= 0, lo <= sum(y) <= hi }. */
function projectBoundedSimplex(x, lo, hi) {
  const nonneg = x.map(v => Math.max(0, v));
  const s = nonneg.reduce((a, b) => a + b, 0);
  if (s >= lo - 1e-12 && s <= hi + 1e-12) return nonneg;
  const scaleTo = s > hi ? hi : lo;
  if (scaleTo <= 0) return x.map(() => 0);
  // projection onto {y >= 0, sum(y) = c} is c · simplexProject(x / c)
  return projectSimplex(x.map(v => v / scaleTo)).map(v => v * scaleTo);
}

/* Exact projection onto the slab { x : lo <= a·x <= hi }.
   Used when membership is fractional — a fund that style analysis says is 60%
   equity contributes 0.6 of its weight to the equity constraint, so the group
   is a general linear form rather than a plain subset sum. */
function projectSlab(x, a, lo, hi) {
  let s = 0, norm = 0;
  for (let i = 0; i < x.length; i++) { s += a[i] * x[i]; norm += a[i] * a[i]; }
  if (norm < 1e-18) return x.slice();
  if (s >= lo - 1e-12 && s <= hi + 1e-12) return x.slice();
  const target = s < lo ? lo : hi;
  const k = (target - s) / norm;
  return x.map((v, i) => v + k * a[i]);
}

/* Membership vector for a group: 1 for a hard bucket, a fraction when style
   analysis has apportioned the holding across several categories. */
function groupVector(g, n) {
  if (g.wts) return g.wts;
  const a = new Array(n).fill(0);
  g.idx.forEach(i => { a[i] = 1; });
  return a;
}
function groupSum(w, g) {
  if (g.wts) { let s = 0; for (let i = 0; i < w.length; i++) s += g.wts[i] * w[i]; return s; }
  return g.idx.reduce((a, i) => a + w[i], 0);
}

/* Projection onto the group-box set (separable across disjoint groups). */
function projectGroups(w, groups) {
  const out = w.slice();
  groups.forEach(g => {
    const sub = g.idx.map(i => w[i]);
    const p = projectBoundedSimplex(sub, g.lo, g.hi);
    g.idx.forEach((i, k) => { out[i] = p[k]; });
  });
  // indices in no group still need to stay non-negative
  const covered = new Set(); groups.forEach(g => g.idx.forEach(i => covered.add(i)));
  for (let i = 0; i < out.length; i++) if (!covered.has(i)) out[i] = Math.max(0, out[i]);
  return out;
}

/* Projection onto { sum(w) = 1 }. */
function projectSumOne(w) {
  const s = w.reduce((a, b) => a + b, 0);
  const d = (1 - s) / w.length;
  return w.map(v => v + d);
}

/* Dykstra's algorithm onto the intersection of every constraint set.

   Groups are disjoint *within* a level but overlap *across* levels — the
   Equity class contains the large-cap-growth subcategory, for instance. So
   each level becomes its own projection set (exact, because it is separable
   inside that level) and Dykstra reconciles them with the sum-to-one plane. */
/* Total amount by which a point misses the feasible set — used to iterate
   until actually feasible rather than for a fixed number of passes. */
function feasibilityError(x, groups) {
  let err = Math.abs(x.reduce((a, b) => a + b, 0) - 1);
  for (let i = 0; i < x.length; i++) if (x[i] < 0) err -= x[i];
  (groups || []).forEach(g => {
    const s = groupSum(x, g);
    if (s < g.lo) err += g.lo - s;
    if (s > g.hi) err += s - g.hi;
  });
  return err;
}

function projectFeasible(w, groups, tol, maxIter) {
  if (!groups || !groups.length) return projectSimplex(w);
  const TOL = tol || 1e-10;
  // already feasible → return unchanged, so re-projection is a no-op
  if (feasibilityError(w, groups) < TOL) return w.slice();

  const n = w.length;
  const hard = groups.filter(g => !g.wts);
  const frac = groups.filter(g => g.wts);

  /* Hard buckets stay on the fast path: groups are disjoint within a level, so
     one separable projection handles the whole level exactly. Fractional
     groups overlap arbitrarily, so each becomes its own slab, with
     non-negativity as a separate set since the slabs no longer enforce it. */
  const byLevel = {};
  hard.forEach(g => { (byLevel[g.level || 'cat'] = byLevel[g.level || 'cat'] || []).push(g); });
  const sets = Object.keys(byLevel).map(lvl => (x => projectGroups(x, byLevel[lvl])));

  if (frac.length) {
    frac.forEach(g => {
      const a = groupVector(g, n);
      sets.push(x => projectSlab(x, a, g.lo, g.hi));
    });
    sets.push(x => x.map(v => Math.max(0, v)));
  }
  sets.push(projectSumOne);

  const m = sets.length;
  let x = w.slice();
  const corr = Array.from({ length: m }, () => new Array(n).fill(0));
  const steps = maxIter || 400;
  for (let k = 0; k < steps; k++) {
    for (let s = 0; s < m; s++) {
      const shifted = x.map((v, i) => v + corr[s][i]);
      const y = sets[s](shifted);
      for (let i = 0; i < n; i++) corr[s][i] = shifted[i] - y[i];
      x = y;
    }
    if (feasibilityError(x, groups) < TOL) break;
  }
  // Only rescale as a last resort: if the bounds genuinely cannot all be met,
  // return a valid portfolio and let groupViolations() report what was missed.
  if (feasibilityError(x, groups) >= TOL) {
    x = x.map(v => Math.max(0, v));
    const s = x.reduce((a, b) => a + b, 0);
    if (s > 0) x = x.map(v => v / s); else x = projectSimplex(w);
  }
  return x;
}

/* Are the requested bounds satisfiable at all? Groups partition the holdings,
   so the group minimums must not exceed 1 and the maximums must reach it. */
function constraintsFeasible(groups, n) {
  if (!groups || !groups.length) return { ok: true };
  const byLevel = {};
  // relative limits are ratios, not shares of the portfolio, so the
  // "minimums must not exceed 100%" arithmetic below doesn't apply to them
  groups.filter(g => !g.rel).forEach(g => { (byLevel[g.level || 'x'] = byLevel[g.level || 'x'] || []).push(g); });
  for (const level in byLevel) {
    const gs = byLevel[level];
    const covered = new Set(); gs.forEach(g => g.idx.forEach(i => covered.add(i)));
    const partition = covered.size === n;
    const sumLo = gs.reduce((s, g) => s + g.lo, 0);
    const sumHi = gs.reduce((s, g) => s + g.hi, 0);
    if (sumLo > 1 + 1e-9) {
      return { ok: false, reason: 'The minimums add up to ' + Math.round(sumLo * 100) + '%, which is more than 100%.' };
    }
    if (partition && sumHi < 1 - 1e-9) {
      return { ok: false, reason: 'The maximums only add up to ' + Math.round(sumHi * 100) + '%, so 100% can’t be invested.' };
    }
    for (const g of gs) {
      if (g.lo > g.hi + 1e-9) return { ok: false, reason: g.name + ' has a minimum above its maximum.' };
      if (g.lo > 1e-9 && !g.idx.length) return { ok: false, reason: g.name + ' has a minimum but no holdings in it.' };
    }
  }

  /* Cross-level: a subcategory can't be forced past its own class's ceiling,
     and the subcategories inside a class can't cap it below the class floor. */
  const parents = groups.filter(g => g.parent);
  const classGroups = {};
  groups.forEach(g => { if (g.level === 'class') classGroups[g.key] = g; });
  const minByParent = {}, maxByParent = {};
  parents.forEach(g => {
    minByParent[g.parent] = (minByParent[g.parent] || 0) + g.lo;
    maxByParent[g.parent] = (maxByParent[g.parent] || 0) + g.hi;
  });
  for (const p in minByParent) {
    const cg = classGroups[p];
    if (!cg) continue;
    if (minByParent[p] > cg.hi + 1e-9) {
      return { ok: false, reason: 'Subcategory minimums inside ' + cg.name + ' add up to '
        + Math.round(minByParent[p] * 100) + '%, above its ' + Math.round(cg.hi * 100) + '% maximum.' };
    }
  }
  return { ok: true };
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
/* `warm` seeds the descent from a nearby solution. Sweeping γ produces a
   sequence of very similar portfolios, so warm-starting each solve from the
   previous one cuts the work by orders of magnitude versus restarting from
   equal weights every time — which matters because the constrained projection
   is far more expensive than the plain simplex one. */
function meanVarianceGamma(cov, mu, gamma, iters, groups, warm) {
  const n = cov.length;
  const seed = warm ? warm.slice() : new Array(n).fill(1 / n);
  /* Mid-descent projections only need to be good enough to steer the next
     gradient step — the returned portfolio is re-projected tightly by the
     caller — so they run at a loose tolerance and a small iteration cap. */
  const project = groups
    ? (x, tight) => projectFeasible(x, groups, tight ? 1e-9 : 1e-7, tight ? 200 : 25)
    : (x) => projectSimplex(x);

  let w = project(seed, true);
  const lr = 1 / (2 * covScale(cov));            // gradient is 2Σw − γμ
  const obj = (x) => portVariance(x, cov) - (gamma ? gamma * dot(x, mu) : 0);

  /* FISTA: plain projected gradient converges at O(1/k), which needs thousands
     of iterations — and each one pays for a constrained projection. Nesterov
     momentum gives O(1/k²), cutting that by an order of magnitude. Momentum is
     restarted whenever the objective rises, which keeps it monotone. */
  let y = w.slice(), prev = w.slice(), t = 1, fPrev = obj(w);
  const steps = iters || 6000;
  for (let k = 0; k < steps; k++) {
    const mv = matVec(cov, y);
    const g = new Array(n);
    for (let i = 0; i < n; i++) g[i] = 2 * mv[i] - (gamma ? gamma * mu[i] : 0);
    w = project(y.map((x, i) => x - lr * g[i]), false);

    const f = obj(w);
    if (f > fPrev + 1e-15) { t = 1; y = w.slice(); }      // adaptive restart
    else {
      const tNext = (1 + Math.sqrt(1 + 4 * t * t)) / 2;
      const mom = (t - 1) / tNext;
      y = w.map((x, i) => x + mom * (x - prev[i]));
      t = tNext;
    }

    let delta = 0;
    for (let i = 0; i < n; i++) delta += Math.abs(w[i] - prev[i]);
    prev = w.slice();
    fPrev = Math.min(fPrev, f);
    /* The stopping threshold must sit above the projection's own accuracy —
       a tighter one is never reached, so every solve would silently run to its
       iteration cap instead of stopping when it has actually converged. */
    if (delta < (groups ? 1e-9 : 1e-11)) break;
  }
  return w;
}

/* Global minimum-variance portfolio (γ = 0). */
function minVariance(cov, iters, groups) {
  return meanVarianceGamma(cov, null, 0, iters || 8000, groups);
}

/* Efficient frontier as a γ sweep, returned sorted by volatility. */
function efficientFrontier(mu, cov, steps, groups) {
  const muScale = Math.max(...mu.map(Math.abs)) || 1;
  const gMax = 10 * covScale(cov) / muScale;     // enough to reach max-return
  const N = steps || (groups ? 26 : 40);
  const out = [];
  let warm = null;                               // reuse the previous solution
  for (let k = 0; k < N; k++) {
    const g = gMax * Math.pow(k / (N - 1), 2);   // denser at the low-risk end
    const w = meanVarianceGamma(cov, mu, g, groups ? 700 : 3000, groups, warm);
    warm = w;
    out.push({ w, ret: portReturn(w, mu), vol: portVol(w, cov), gamma: g });
  }
  return out.sort((a, b) => a.vol - b.vol);
}

/* Maximum-Sharpe (tangency) portfolio. Sharpe is unimodal along the frontier,
   so a coarse γ sweep followed by a local refinement finds it reliably —
   more stable than differentiating the ratio, which misbehaves as vol → 0. */
function maxSharpe(mu, cov, rf, groups) {
  const muScale = Math.max(...mu.map(Math.abs)) || 1;
  const gMax = 10 * covScale(cov) / muScale;
  const sharpeAt = (w) => {
    const v = portVol(w, cov);
    return v > 1e-12 ? (portReturn(w, mu) - rf) / v : -Infinity;
  };

  /* Warm starts make each solve cheap but the constrained projection still
     dominates, so the scan is coarser when constraints are active and leans on
     the refinement pass for precision. */
  const N = groups ? 26 : 48;
  const sweepIters = groups ? 700 : 3000;
  let best = null, bestG = 0, warm = null;
  for (let k = 0; k < N; k++) {
    const g = gMax * Math.pow(k / (N - 1), 2);
    const w = meanVarianceGamma(cov, mu, g, sweepIters, groups, warm);
    warm = w;
    const s = sharpeAt(w);
    if (!best || s > best.s) { best = { w, s }; bestG = g; }
  }
  // refine on a narrow γ window around the best point
  const span = gMax / N;
  for (let i = -6; i <= 6; i++) {
    const g = bestG + span * (i / 6);
    if (g < 0) continue;
    const w = meanVarianceGamma(cov, mu, g, groups ? 2500 : 8000, groups, best.w);
    const s = sharpeAt(w);
    if (s > best.s) best = { w, s };
  }
  return best.w;
}

/* ------------------- constrained targets along the frontier -------------- *
   Two classic dual problems:

     • maximum return for a given volatility
     • minimum volatility for a given return

   Both sit on the efficient frontier, and along that frontier return and
   volatility each increase monotonically with the risk-aversion parameter γ.
   So instead of adding an inequality constraint, bisect γ until the frontier
   portfolio hits the requested figure. Reuses the solver already verified for
   the unconstrained objectives.

   `metric` is 'vol' or 'ret'. Returns the portfolio plus an honest account of
   whether the target was actually reachable. */
function frontierTarget(mu, cov, metric, target, rf, groups) {
  const muScale = Math.max(...mu.map(Math.abs)) || 1;
  const gMax = 10 * covScale(cov) / muScale;
  const measure = (w) => metric === 'vol' ? portVol(w, cov) : portReturn(w, mu);

  const endIters = groups ? 2500 : 8000;
  const wLo = meanVarianceGamma(cov, mu, 0, endIters, groups);          // min-variance end
  const wHi = meanVarianceGamma(cov, mu, gMax, endIters, groups, wLo);  // max-return end
  const lo = measure(wLo), hi = measure(wHi);

  if (target <= lo + 1e-9) {
    return { w: wLo, feasible: target >= lo - 1e-9, achieved: lo, min: lo, max: hi, bound: 'low' };
  }
  if (target >= hi - 1e-9) {
    return { w: wHi, feasible: target <= hi + 1e-9, achieved: hi, min: lo, max: hi, bound: 'high' };
  }

  /* 20 halvings resolve γ to ~1e-6 of its range; the metric varies smoothly
     with γ, and the full-accuracy solve afterwards lands the target exactly. */
  let a = 0, b = gMax, w = wLo;
  for (let k = 0; k < 20; k++) {
    const mid = (a + b) / 2;
    w = meanVarianceGamma(cov, mu, mid, groups ? 600 : 2500, groups, w); // warm-started
    if (measure(w) < target) a = mid; else b = mid;
  }
  w = meanVarianceGamma(cov, mu, (a + b) / 2, groups ? 3000 : 9000, groups, w); // final solve
  return { w, feasible: true, achieved: measure(w), min: lo, max: hi, bound: null };
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
function riskParity(cov, iters, groups) {
  const n = cov.length;
  let w = new Array(n).fill(1 / n);
  // the fixed point converges quickly; with constraints each pass also pays
  // for a projection, so cap the sweep lower when they're active
  const steps = iters || (groups ? 600 : 3000);
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
    if (groups && groups.length) w = projectFeasible(w, groups, 1e-8, 30);
    if (delta < 1e-13) break;
  }
  return w;
}

/* ================== path-dependent objectives ============================
   Sharpe, variance and the frontier are smooth functions of the weights, so
   gradient descent handles them. Sortino, Calmar, maximum drawdown and VaR are
   not: drawdown depends on the ORDER of returns, and VaR is a quantile, so both
   are non-smooth and have no usable gradient. Alpha is smooth but linear, which
   over a simplex means its unconstrained optimum is always a single holding.

   These are therefore optimized by direct search on the real backtest — the
   same `backtest()` and `metrics()` the results panel reports, so the number
   being maximized is exactly the number displayed, not a proxy for it.      */

/* Score a weight vector on the requested metric. Higher is always better, so
   the minimising objectives are negated. */
function makeObjective(kind, ctx) {
  const { aligned, syms, rebal, rf, benchBt } = ctx;
  return function (w) {
    const wm = {};
    let any = false;
    syms.forEach((s, i) => { wm[s] = w[i]; if (w[i] > 1e-9) any = true; });
    if (!any) return -Infinity;
    const bt = backtest(aligned, wm, rebal);
    if (!bt.values || bt.values.length < 3) return -Infinity;
    const m = metrics(bt.dates, bt.values, { rf });
    switch (kind) {
      case 'sortino':  return isFinite(m.sortino) ? m.sortino : -Infinity;
      case 'calmar':   return isFinite(m.calmar) ? m.calmar : -Infinity;
      case 'mindd':    return isFinite(m.maxDrawdown) ? m.maxDrawdown : -Infinity;  // negative, toward 0
      case 'minvar':   return isFinite(m.var95) ? -m.var95 : -Infinity;
      case 'maxalpha': {
        if (!benchBt) return -Infinity;
        const rel = relativeMetrics(bt.dates, bt.values, benchBt.dates, benchBt.values, rf);
        return (rel && isFinite(rel.alpha)) ? rel.alpha : -Infinity;
      }
      default: return -Infinity;
    }
  };
}

/* Pattern search over the feasible set: repeatedly shift weight from one
   holding to another at a shrinking step size, keeping any move that improves
   the score. Deterministic, needs no derivatives, and every point it visits is
   projected back onto the constraints so it never leaves the feasible set. */
function patternSearch(score, n, groups, seeds, budget) {
  const project = (w) => (groups && groups.length)
    ? projectFeasible(w, groups, 1e-9, 200) : projectSimplex(w);
  let evals = 0;
  const cap = budget || 4000;
  const evalAt = (w) => { evals++; return score(w); };

  let best = null;
  (seeds || []).forEach(s => {
    if (!s) return;
    const w = project(s.slice());
    const f = evalAt(w);
    if (isFinite(f) && (!best || f > best.f)) best = { w, f };
  });
  if (!best) {
    const w = project(new Array(n).fill(1 / n));
    best = { w, f: evalAt(w) };
  }

  let w = best.w.slice(), f = best.f;
  let step = 0.25;
  while (step > 0.0025 && evals < cap) {
    let improved = false;
    for (let i = 0; i < n && evals < cap; i++) {
      if (w[i] <= 1e-9) continue;
      for (let j = 0; j < n && evals < cap; j++) {
        if (i === j) continue;
        const move = Math.min(step, w[i]);
        if (move <= 1e-9) continue;
        const cand = w.slice();
        cand[i] -= move; cand[j] += move;
        const pw = project(cand);
        const pf = evalAt(pw);
        if (pf > f + 1e-12) { w = pw; f = pf; improved = true; }
      }
    }
    if (!improved) step /= 2;          // no gain at this scale — look finer
  }
  return { w, f, evals };
}

/* Optimize one of the path-dependent objectives. `seeds` should include the
   smooth optima (min-vol, max-Sharpe, risk parity) and the current mix — they
   are excellent starting points and make the search far cheaper. */
function optimizePath(kind, ctx, rf, groups, seeds) {
  const n = ctx.syms.length;
  const score = makeObjective(kind, ctx);
  const res = patternSearch(score, n, groups, seeds, 4000);
  let w = res.w.map(x => x < 1e-4 ? 0 : x);
  const sum = w.reduce((s, x) => s + x, 0) || 1;
  w = w.map(x => x / sum);
  if (groups && groups.length) w = projectFeasible(w, groups, 1e-11, 800);
  return w;
}

/* ------------------------------ entry point ----------------------------- */
/* Runs one objective and returns everything the UI needs to explain it. */
const PATH_OBJECTIVES = ['sortino', 'calmar', 'mindd', 'minvar', 'maxalpha'];

function optimizePortfolio(stats, objective, rf, target, groups, ctx) {
  const { mu, cov, syms } = stats;
  let w, info = null;
  const g = (groups && groups.length) ? groups : null;

  if (PATH_OBJECTIVES.indexOf(objective) !== -1) {
    /* Seed the search with the smooth optima — they are close to most of these
       and turn a broad search into a short refinement. */
    const seeds = [
      new Array(mu.length).fill(1 / mu.length),
      minVariance(cov, 4000, g),
      maxSharpe(mu, cov, rf, g),
      riskParity(cov, 600, g),
    ];
    if (ctx && ctx.current) seeds.push(ctx.current);
    w = optimizePath(objective, Object.assign({ syms, rf }, ctx), rf, g, seeds);
  }
  else if (objective === 'minvol')  w = minVariance(cov, 8000, g);
  else if (objective === 'sharpe') w = maxSharpe(mu, cov, rf, g);
  else if (objective === 'parity') w = riskParity(cov, 3000, g);
  else if (objective === 'targetvol') { info = frontierTarget(mu, cov, 'vol', target, rf, g); w = info.w; }
  else if (objective === 'targetret') { info = frontierTarget(mu, cov, 'ret', target, rf, g); w = info.w; }
  else {
    w = new Array(mu.length).fill(1 / mu.length);
    if (g) w = projectFeasible(w, g);            // equal weight, nudged into bounds
  }

  // scrub numerical dust, then re-project tightly so scrubbing (and the loose
  // mid-descent projections) can't leave a bound slightly violated
  w = w.map(x => x < 1e-4 ? 0 : x);
  const sum = w.reduce((s, x) => s + x, 0) || 1;
  w = w.map(x => x / sum);
  if (g) w = projectFeasible(w, g, 1e-11, 800);

  return {
    weights: w, syms,
    ret: portReturn(w, mu),
    vol: portVol(w, cov),
    sharpe: portSharpe(w, mu, cov, rf),
    rc: riskContributions(w, cov),
    target: info,          // null unless a constrained target was requested
    violations: groupViolations(w, groups),
  };
}

/* Report any group whose bound the solution misses, so the UI can be honest
   rather than presenting an infeasible answer as if it satisfied the request. */
function groupViolations(w, groups) {
  if (!groups || !groups.length) return [];
  const out = [];
  groups.forEach(g => {
    const s = groupSum(w, g);
    const slack = g.rel ? 5e-4 : 5e-4;
    if (s < g.lo - slack || s > g.hi + slack) {
      /* For a ratio limit the raw halfspace value is meaningless to a reader,
         so report the actual share of the parent it worked out to. */
      if (g.rel) {
        let sub = 0, par = 0;
        g.wtsSub.forEach((v, i) => { sub += v * w[i]; });
        g.wtsPar.forEach((v, i) => { par += v * w[i]; });
        out.push({ name: g.name, actual: par > 1e-9 ? sub / par : 0, lo: g.relLo, hi: g.relHi, rel: true });
      } else {
        out.push({ name: g.name, actual: s, lo: g.lo, hi: g.hi });
      }
    }
  });
  return out;
}

/* Achievable range of the frontier, for prefilling and validating targets. */
function frontierRange(mu, cov, groups) {
  const muScale = Math.max(...mu.map(Math.abs)) || 1;
  const gMax = 10 * covScale(cov) / muScale;
  const g = (groups && groups.length) ? groups : null;
  const wLo = meanVarianceGamma(cov, mu, 0, 8000, g);
  const wHi = meanVarianceGamma(cov, mu, gMax, 8000, g);
  return {
    minVol: portVol(wLo, cov), maxVol: portVol(wHi, cov),
    minRet: portReturn(wLo, mu), maxRet: portReturn(wHi, mu),
  };
}

/* Build solver groups from category constraints.
   `assign` maps each holding index to its category key; `bounds` maps a
   category key to {lo, hi} as fractions. Categories with no holdings are
   dropped, but a positive minimum on an empty category is reported by
   constraintsFeasible() rather than silently ignored. */
/* Groups from fractional membership. `member[cat][i]` is how much of holding i
   counts toward that category (0–1), as produced by style analysis. */
function buildFractionalGroups(member, bounds, names, level, n) {
  const groups = [];
  Object.keys(bounds || {}).forEach(cat => {
    const b = bounds[cat];
    if (!b) return;
    const lo = Math.max(0, Math.min(1, b.lo == null ? 0 : b.lo));
    const hi = Math.max(0, Math.min(1, b.hi == null ? 1 : b.hi));
    if (lo <= 0 && hi >= 1) return;                     // unconstrained
    const wts = member[cat] || new Array(n).fill(0);
    groups.push({
      wts, idx: wts.map((v, i) => v > 0 ? i : -1).filter(i => i >= 0),
      lo, hi, level: level || 'cat',
      name: (names && names[cat]) || cat, key: cat,
      parent: (level === 'sub' && SUBCLASSES[cat]) ? SUBCLASSES[cat].cls : null,
    });
  });
  return groups;
}

/* Subcategory limits expressed as a share of their PARENT class rather than of
   the whole portfolio — "large cap growth is 30-40% of equity".

   That is a ratio constraint, which is not linear:

       lo <= (sum over sub) / (sum over parent) <= hi

   but multiplying through by the parent total makes it linear and homogeneous:

       (a_sub - lo * a_parent) . w >= 0
       (a_sub - hi * a_parent) . w <= 0

   so each bound becomes an ordinary halfspace and drops straight into the same
   projection used for fractional membership. Note the coefficient vector has
   negative entries for parent holdings outside the subcategory — that is what
   makes the limit scale with the parent instead of the portfolio. */
function buildRelativeGroups(subMember, parentMember, bounds, names, n) {
  const groups = [];
  Object.keys(bounds || {}).forEach(cat => {
    const b = bounds[cat];
    if (!b || !b.rel) return;
    const parentKey = SUBCLASSES[cat] && SUBCLASSES[cat].cls;
    const a = subMember[cat], pa = parentMember[parentKey];
    if (!a || !pa) return;
    const lo = b.lo == null ? 0 : b.lo;
    const hi = b.hi == null ? 1 : b.hi;
    const label = (names && names[cat]) || cat;
    const mk = (c, glo, ghi, txt) => ({
      wts: c, idx: c.map((v, i) => v !== 0 ? i : -1).filter(i => i >= 0),
      lo: glo, hi: ghi, level: 'rel', rel: true, key: cat, parentKey,
      relLo: lo, relHi: hi, name: label + ' ' + txt,
      wtsSub: a, wtsPar: pa,          // kept so violations can report the ratio
    });
    if (lo > 1e-9) {
      groups.push(mk(a.map((v, i) => v - lo * pa[i]), 0, Infinity,
        '(min ' + Math.round(lo * 100) + '% of ' + className(parentKey) + ')'));
    }
    if (hi < 1 - 1e-9) {
      groups.push(mk(a.map((v, i) => v - hi * pa[i]), -Infinity, 0,
        '(max ' + Math.round(hi * 100) + '% of ' + className(parentKey) + ')'));
    }
  });
  return groups;
}

function buildGroups(assign, bounds, names, level) {
  const byCat = {};
  assign.forEach((cat, i) => { (byCat[cat] = byCat[cat] || []).push(i); });
  const groups = [];
  Object.keys(bounds || {}).forEach(cat => {
    const b = bounds[cat];
    if (!b) return;
    const lo = Math.max(0, Math.min(1, b.lo == null ? 0 : b.lo));
    const hi = Math.max(0, Math.min(1, b.hi == null ? 1 : b.hi));
    if (lo <= 0 && hi >= 1) return;                     // unconstrained
    groups.push({
      idx: byCat[cat] || [], lo, hi, level: level || 'cat',
      name: (names && names[cat]) || cat, key: cat,
      parent: (level === 'sub' && SUBCLASSES[cat]) ? SUBCLASSES[cat].cls : null,
    });
  });
  return groups;
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
