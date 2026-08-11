/* =========================================================================
   Portfolio Labs — app: state, data fetching, rendering, interactions
   ========================================================================= */

const PORT_STORE  = 'plabs_portfolio_v2';
const THEME_STORE = 'plabs_theme_v1';
const CACHE_PREFIX = 'plabs_cache_';
const DIV_PREFIX   = 'plabs_div_';
const CACHE_TTL = 12 * 3600 * 1000; // 12h — be gentle on free API tiers

/* ------------------------------- state --------------------------------- */
const state = {
  portfolios: { A: [], B: [] },   // each: [{ sym, weight }]  weight = percent
  active: 'A',                    // which one the builder is editing
  compare: false,
  demoMode: false,
  last: null,                     // cached analysis (for Monte Carlo re-runs)
};

const $  = (id) => document.getElementById(id);
const el = {
  holdings: $('holdings'), suggest: $('suggest'), lazyGrid: $('lazyGrid'),
  weightTag: $('weightTag'), tickerInput: $('tickerInput'),
  runStatus: $('runStatus'), empty: $('empty'), results: $('results'),
  settingsPanel: $('settingsPanel'), providerSel: $('providerSel'),
  apiKey: $('apiKey'), keyLink: $('keyLink'), dataMode: $('dataMode'),
  abTabs: $('abTabs'), cacheNote: $('cacheNote'),
};

/* Portfolio currently being edited. */
function holdings() { return state.portfolios[state.active]; }
/* Which portfolios take part in an analysis. */
function activeKeys() { return state.compare ? ['A', 'B'] : ['A']; }

const PORT_COLOR = { A: 'var(--accent)', B: 'var(--accent-2)' };

/* ------------------------------- init ---------------------------------- */
function init() {
  try {
    const t = localStorage.getItem(THEME_STORE);
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}

  el.providerSel.value = DataFeed.provider;
  el.apiKey.value = DataFeed.apiKey;
  updateKeyLink();
  updateDataMode();

  try {
    const saved = JSON.parse(localStorage.getItem(PORT_STORE) || 'null');
    if (saved && saved.portfolios) {
      state.portfolios.A = (saved.portfolios.A || []).filter(h => h.sym);
      state.portfolios.B = (saved.portfolios.B || []).filter(h => h.sym);
      state.compare = !!saved.compare;
      if (saved.settings) applySettings(saved.settings);
    }
  } catch (e) {}
  if (!state.portfolios.A.length) state.portfolios.A = [{ sym: 'VTI', weight: 60 }, { sym: 'BND', weight: 40 }];
  if (!state.portfolios.B.length) state.portfolios.B = [{ sym: 'VTI', weight: 100 }];

  $('compareToggle').checked = state.compare;
  syncCompareUI();
  renderSuggest();
  renderLazy();
  renderHoldings();
  bindEvents();
}

function applySettings(s) {
  if (s.period != null) $('periodSel').value = s.period;
  if (s.bench != null)  $('benchSel').value = s.bench;
  if (s.rebal != null)  $('rebalSel').value = s.rebal;
  if (s.rf != null)     $('rfInput').value = s.rf;
  if (s.tr != null)     $('totalReturnToggle').checked = !!s.tr;
}
function currentSettings() {
  return {
    period: $('periodSel').value, bench: $('benchSel').value,
    rebal: $('rebalSel').value, rf: $('rfInput').value,
    tr: $('totalReturnToggle').checked,
  };
}
function persist() {
  try {
    localStorage.setItem(PORT_STORE, JSON.stringify({
      portfolios: state.portfolios, compare: state.compare, settings: currentSettings(),
    }));
  } catch (e) {}
}

/* ----------------------------- rendering ------------------------------- */
function totalWeight() { return holdings().reduce((s, h) => s + (+h.weight || 0), 0); }

function paintWeightTag() {
  const tw = totalWeight();
  el.weightTag.textContent = 'weights ' + tw.toFixed(0) + '%';
  el.weightTag.className = 'tag' + (Math.abs(tw - 100) < 0.5 ? ' ok' : (tw > 0 ? ' warn' : ''));
}

function renderHoldings() {
  const hs = holdings();
  if (!hs.length) {
    el.holdings.innerHTML = '<div class="no-holds">No holdings yet — add tickers below.</div>';
  } else {
    el.holdings.innerHTML = hs.map((h, i) => {
      const meta = assetMeta(h.sym);
      const dot = SLICE_COLORS[i % SLICE_COLORS.length];
      return `<div class="hold-row">
        <span class="hold-dot" style="background:${dot}"></span>
        <span class="hold-sym">${esc(h.sym)}</span>
        <span class="hold-name">${esc(meta.n)}</span>
        <span class="hold-weight">
          <input class="w-in" data-i="${i}" type="number" min="0" step="1" value="${h.weight}" inputmode="decimal" aria-label="${esc(h.sym)} weight %">
          <span class="pct">%</span>
        </span>
        <button class="hold-x" data-del="${i}" aria-label="Remove ${esc(h.sym)}">✕</button>
      </div>`;
    }).join('');
  }
  paintWeightTag();
  persist();
}

function renderSuggest() {
  el.suggest.innerHTML = UNIVERSE.map(a =>
    `<button class="sg" data-add="${esc(a.s)}" title="${esc(a.n)}">${esc(a.s)}</button>`).join('');
}

function renderLazy() {
  el.lazyGrid.innerHTML = LAZY.map((p, i) =>
    `<button class="lazy-card" data-lazy="${i}">
       <span class="lz-name">${esc(p.name)}</span>
       <span class="lz-auth">${esc(p.author)}</span>
       <span class="lz-mix">${p.holds.map(h => esc(h[0]) + ' ' + h[1] + '%').join(' · ')}</span>
     </button>`).join('');
}

/* --------------------------- A / B controls ---------------------------- */
function syncCompareUI() {
  el.abTabs.classList.toggle('hidden', !state.compare);
  $('mcWhich').classList.toggle('hidden', !state.compare);
  if (!state.compare) state.active = 'A';
  el.abTabs.querySelectorAll('.ab-tab').forEach(b => {
    b.setAttribute('aria-selected', b.dataset.port === state.active ? 'true' : 'false');
  });
}
function setActive(which) {
  state.active = which;
  syncCompareUI();
  renderHoldings();
}

/* ---------------------------- holdings ops ----------------------------- */
function addHolding(sym) {
  sym = (sym || '').trim().toUpperCase();
  if (!sym) return;
  const hs = holdings();
  if (hs.some(h => h.sym === sym)) { flash(el.tickerInput); return; }
  const remaining = Math.max(0, 100 - totalWeight());
  hs.push({ sym, weight: remaining > 0 ? Math.round(remaining) : 10 });
  renderHoldings();
}
function removeHolding(i) { holdings().splice(i, 1); renderHoldings(); }
function evenWeights() {
  const hs = holdings(); if (!hs.length) return;
  const w = +(100 / hs.length).toFixed(2);
  hs.forEach(h => h.weight = w);
  renderHoldings();
}
function normalizeWeights() {
  const t = totalWeight(); if (t <= 0) return;
  holdings().forEach(h => h.weight = +((h.weight / t) * 100).toFixed(2));
  renderHoldings();
}
function loadLazy(i) {
  const p = LAZY[i]; if (!p) return;
  state.portfolios[state.active] = p.holds.map(h => ({ sym: h[0], weight: h[1] }));
  renderHoldings();
  el.tickerInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ------------------------- data source controls ------------------------ */
function updateKeyLink() {
  const p = PROVIDERS[el.providerSel.value] || PROVIDERS.twelvedata;
  el.keyLink.href = p.signup;
}
function updateDataMode() {
  if (state.demoMode) {
    el.dataMode.innerHTML = '<b class="demo">● Demo data</b> — synthetic prices, no key needed';
  } else if (DataFeed.hasKey()) {
    el.dataMode.innerHTML = '<b class="live">● Live</b> — ' + esc(PROVIDERS[DataFeed.provider].label);
  } else {
    el.dataMode.innerHTML = '<b class="off">● No key</b> — add one above, or use demo data';
  }
}

/* ----------------------------- data fetch ------------------------------ */
/* Price history for a symbol: demo, cache, or live. `force` skips the cache. */
async function fetchDaily(sym, force) {
  if (state.demoMode) {
    const d = buildDemoSeries(sym);
    if (!d) throw new Error('"' + sym + '" isn’t in the demo set. Demo covers: ' + DEMO_SYMBOLS.join(', ') + '.');
    return d;
  }
  const ck = CACHE_PREFIX + DataFeed.provider + '_' + sym;
  if (!force) {
    try {
      const hit = JSON.parse(localStorage.getItem(ck) || 'null');
      if (hit && (Date.now() - hit.t) < CACHE_TTL && Array.isArray(hit.v) && hit.v.length) return hit.v;
    } catch (e) {}
  }
  const v = await DataFeed.daily(sym);
  try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), v })); } catch (e) {}
  return v;
}

/* Dividend history, cached the same way. Never throws — a failure just means
   we fall back to price-only for that symbol and say so in the UI. */
async function fetchDividends(sym, force) {
  if (state.demoMode) return { list: [], ok: true };
  const ck = DIV_PREFIX + DataFeed.provider + '_' + sym;
  if (!force) {
    try {
      const hit = JSON.parse(localStorage.getItem(ck) || 'null');
      if (hit && (Date.now() - hit.t) < CACHE_TTL && Array.isArray(hit.v)) return { list: hit.v, ok: true };
    } catch (e) {}
  }
  try {
    const v = await DataFeed.dividends(sym);
    try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), v })); } catch (e) {}
    return { list: v, ok: true };
  } catch (err) {
    return { list: [], ok: false, reason: err.message };
  }
}

/* Age of the oldest cached series in play, for the "prices cached N ago" note. */
function cacheAgeNote(symbols) {
  if (state.demoMode) { el.cacheNote.textContent = ''; return; }
  let oldest = 0;
  symbols.forEach(s => {
    try {
      const hit = JSON.parse(localStorage.getItem(CACHE_PREFIX + DataFeed.provider + '_' + s) || 'null');
      if (hit && hit.t) oldest = Math.max(oldest, Date.now() - hit.t);
    } catch (e) {}
  });
  if (!oldest) { el.cacheNote.textContent = ''; return; }
  const mins = Math.round(oldest / 60000);
  el.cacheNote.textContent = 'Prices cached ' + (mins < 60 ? mins + ' min' : Math.round(mins / 60) + ' h')
    + ' ago · “Refresh data” fetches new ones.';
}

/* ------------------------------ analyze -------------------------------- */
async function analyze(force) {
  const keys = activeKeys();
  const sets = {};
  for (const k of keys) {
    const hs = state.portfolios[k].filter(h => (+h.weight) > 0 && h.sym);
    if (!hs.length) {
      setStatus('Portfolio ' + k + ' needs at least one holding with a weight above 0.', 'err');
      return;
    }
    sets[k] = hs;
  }
  if (!state.demoMode && !DataFeed.hasKey()) {
    setStatus('Add a free API key under “Data source”, or click “Explore with demo data”.', 'err');
    openSettings(true); return;
  }

  const bench = $('benchSel').value;
  const period = +$('periodSel').value;
  const rebal = $('rebalSel').value;
  const rf = (+$('rfInput').value || 0) / 100;
  const wantTR = $('totalReturnToggle').checked;

  const allSyms = [];
  keys.forEach(k => sets[k].forEach(h => { if (!allSyms.includes(h.sym)) allSyms.push(h.sym); }));
  if (bench && !allSyms.includes(bench)) allSyms.push(bench);

  setRunning(true);
  const seriesMap = {};
  const trWarn = [];
  try {
    for (let i = 0; i < allSyms.length; i++) {
      const sym = allSyms[i];
      setStatus('Fetching ' + sym + '… (' + (i + 1) + '/' + allSyms.length + ')');
      let series = await fetchDaily(sym, force);

      if (wantTR && !state.demoMode) {
        const dv = await fetchDividends(sym, force);
        if (!dv.ok) trWarn.push(sym);
        if (dv.list && dv.list.length) {
          const dates = series.map(p => p.date);
          const adj = applyDividends(dates, series.map(p => p.close), dv.list);
          series = series.map((p, j) => ({ date: p.date, close: adj[j], rawClose: p.close }));
        }
        await sleep(220);
      }
      seriesMap[sym] = series;
      if (!state.demoMode && i < allSyms.length - 1) await sleep(220);
    }
  } catch (err) {
    setRunning(false); setStatus(err.message || 'Could not fetch market data.', 'err'); return;
  }

  try {
    let aligned = alignSeries(seriesMap, allSyms);
    aligned = sliceYears(aligned, period);
    if (aligned.dates.length < 25) {
      throw new Error('Not enough overlapping history for these symbols in this period. Try a shorter period or different tickers.');
    }

    const runs = {};
    keys.forEach(k => {
      const w = {}; sets[k].forEach(h => w[h.sym] = +h.weight);
      const bt = backtest(aligned, w, rebal);
      bt.metrics = metrics(bt.dates, bt.values, { rf });
      bt.holds = sets[k];
      bt.syms = sets[k].map(h => h.sym);
      runs[k] = bt;
    });

    let benchBt = null;
    if (bench) {
      const bAligned = { dates: aligned.dates, closes: { [bench]: aligned.closes[bench] } };
      benchBt = backtest(bAligned, { [bench]: 1 }, 'none');
      benchBt.metrics = metrics(benchBt.dates, benchBt.values, { rf });
    }
    keys.forEach(k => {
      runs[k].rel = benchBt ? relativeMetrics(runs[k].dates, runs[k].values, benchBt.dates, benchBt.values, rf) : {};
    });

    state.last = { keys, runs, bench, benchBt, aligned, rf, totalReturn: wantTR, trWarn };
    renderResults(state.last);
    runMonteCarlo();
    setRunning(false);

    if (wantTR && trWarn.length) {
      setStatus('Total return is on, but no dividend data came back for ' + trWarn.join(', ')
        + ' — those are price-only.', 'warn');
    } else {
      setStatus('');
    }
    cacheAgeNote(allSyms);

    el.results.classList.remove('hidden');
    el.empty.classList.add('hidden');
    requestAnimationFrame(() => el.results.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  } catch (err) {
    setRunning(false); setStatus(err.message || 'Analysis failed.', 'err');
  }
}

/* ----------------------------- results UI ------------------------------ */
function renderResults(R) {
  const A = R.runs.A, m = A.metrics;
  const cmp = R.keys.length > 1 ? R.runs.B : null;
  const modeBits = [
    FMT.date(m.startDate) + ' → ' + FMT.date(m.endDate),
    m.years.toFixed(1) + ' yrs',
    state.demoMode ? 'demo data' : PROVIDERS[DataFeed.provider].label,
    R.totalReturn ? 'total return' : 'price return',
  ];

  $('resultHead').innerHTML = `
    <div class="rh-top">
      <div>
        <div class="rh-label">${esc(modeBits.join(' · '))}</div>
        <div class="rh-value">${FMT.money(m.endValue, 0)}${cmp ? ' <span class="rh-vs">vs</span> <span class="rh-b">' + FMT.money(cmp.metrics.endValue, 0) + '</span>' : ''}</div>
        <div class="rh-sub">from ${FMT.money(m.startValue, 0)} · ${cmp ? 'A ' : ''}<span class="${signClass(m.totalReturn)}">${FMT.signedPct(m.totalReturn)}</span>${cmp ? ' · B <span class="' + signClass(cmp.metrics.totalReturn) + '">' + FMT.signedPct(cmp.metrics.totalReturn) + '</span>' : ' total'}</div>
      </div>
    </div>
    <div class="stat-strip">
      ${statCard('CAGR', FMT.signedPct(m.cagr), signClass(m.cagr))}
      ${statCard('Volatility', FMT.pct(m.volatility), '')}
      ${statCard('Max drawdown', FMT.pct(m.maxDrawdown), 'down')}
      ${statCard('Sharpe', FMT.num(m.sharpe), m.sharpe >= 1 ? 'up' : '')}
      ${statCard('Sortino', FMT.num(m.sortino), m.sortino >= 1 ? 'up' : '')}
    </div>`;

  renderQuotes(R);
  renderGrowth(R);
  renderMetricsTable(R);
  renderDonuts(R);
  renderDrawdown(R);
  yearBars($('yearChart'), m.yearly);
  renderCorr(R);
  renderOptimizer(null);          // frontier + current-mix marker, no objective yet
}

function statCard(k, v, cls) {
  return `<div class="sc"><div class="sc-k">${k}</div><div class="sc-v ${cls}">${v}</div></div>`;
}

/* Latest close per holding — raw price when total-return mode rebased them. */
function renderQuotes(R) {
  const syms = [];
  R.keys.forEach(k => R.runs[k].syms.forEach(s => { if (!syms.includes(s)) syms.push(s); }));
  const src = R.aligned.raw || R.aligned.closes;
  $('quotes').innerHTML = syms.map((s, i) => {
    const ser = src[s] || R.aligned.closes[s];
    const last = ser[ser.length - 1], prev = ser[ser.length - 2];
    const chg = prev ? (last / prev - 1) : 0;
    const dot = SLICE_COLORS[i % SLICE_COLORS.length];
    return `<div class="q-card">
      <div class="q-top"><span class="hold-dot" style="background:${dot}"></span><b>${esc(s)}</b></div>
      <div class="q-price">${FMT.money(last, 2)}</div>
      <div class="q-chg ${signClass(chg)}">${FMT.signedPct(chg)}</div>
    </div>`;
  }).join('');
  $('quotesTag').textContent = state.demoMode ? 'demo' : 'latest close';
}

function renderGrowth(R) {
  const series = R.keys.map(k => ({
    dates: R.runs[k].dates, values: R.runs[k].values,
    color: PORT_COLOR[k], label: R.keys.length > 1 ? 'Portfolio ' + k : 'Portfolio',
  }));
  if (R.benchBt) series.push({ dates: R.benchBt.dates, values: R.benchBt.values, color: 'var(--muted-line)', label: R.bench });
  growthChart($('growthChart'), series, { log: $('logToggle').checked });
  $('growthLegend').innerHTML = series.map(s =>
    `<span class="lg-item"><span class="lg-dash" style="background:${s.color}"></span>${esc(s.label)}</span>`).join('');
}

function renderMetricsTable(R) {
  const two = R.keys.length > 1;
  const A = R.runs.A.metrics, B = two ? R.runs.B.metrics : null;
  const b = R.benchBt ? R.benchBt.metrics : null;
  const yr = (y) => y ? y.year + ' · ' + FMT.signedPct(y.r, 1) : '—';

  const rows = [
    ['Total return', FMT.signedPct(A.totalReturn), B && FMT.signedPct(B.totalReturn), b && FMT.signedPct(b.totalReturn)],
    ['CAGR', FMT.signedPct(A.cagr), B && FMT.signedPct(B.cagr), b && FMT.signedPct(b.cagr)],
    ['Volatility (ann.)', FMT.pct(A.volatility), B && FMT.pct(B.volatility), b && FMT.pct(b.volatility)],
    ['Sharpe ratio', FMT.num(A.sharpe), B && FMT.num(B.sharpe), b && FMT.num(b.sharpe)],
    ['Sortino ratio', FMT.num(A.sortino), B && FMT.num(B.sortino), b && FMT.num(b.sortino)],
    ['Calmar ratio', FMT.num(A.calmar), B && FMT.num(B.calmar), b && FMT.num(b.calmar)],
    ['Max drawdown', FMT.pct(A.maxDrawdown), B && FMT.pct(B.maxDrawdown), b && FMT.pct(b.maxDrawdown)],
    ['Best year', yr(A.bestYear), B && yr(B.bestYear), b && yr(b.bestYear)],
    ['Worst year', yr(A.worstYear), B && yr(B.worstYear), b && yr(b.worstYear)],
    ['Positive months', FMT.pct(A.positiveMonths, 0), B && FMT.pct(B.positiveMonths, 0), b && FMT.pct(b.positiveMonths, 0)],
    ['Monthly VaR 95%', FMT.pct(A.var95), B && FMT.pct(B.var95), b && FMT.pct(b.var95)],
    ['Monthly CVaR 95%', FMT.pct(A.cvar95), B && FMT.pct(B.cvar95), b && FMT.pct(b.cvar95)],
  ];
  const relA = R.runs.A.rel, relB = two ? R.runs.B.rel : null;
  if (relA && relA.beta != null) {
    rows.push(['Beta vs ' + R.bench, FMT.num(relA.beta), relB && FMT.num(relB.beta), '1.00']);
    rows.push(['Alpha (ann.)', FMT.signedPct(relA.alpha), relB && FMT.signedPct(relB.alpha), '—']);
    rows.push(['Correlation vs ' + R.bench, FMT.num(relA.correlation), relB && FMT.num(relB.correlation), '1.00']);
  }

  const cls = two ? 'mt-row three' : 'mt-row';
  const head = `<div class="${cls} mt-head"><span>Metric</span><span>${two ? 'A' : 'Portfolio'}</span>`
    + (two ? '<span>B</span>' : '') + `<span>${R.bench ? esc(R.bench) : ''}</span></div>`;
  $('metricsTable').innerHTML = head + rows.map(r =>
    `<div class="${cls}"><span class="mt-k">${r[0]}</span><span class="mt-v">${r[1]}</span>`
    + (two ? `<span class="mt-v mt-b2">${r[2] || '—'}</span>` : '')
    + `<span class="mt-b">${r[3] || '—'}</span></div>`).join('');
}

function renderDonuts(R) {
  const build = (run) => {
    const t = run.holds.reduce((s, h) => s + (+h.weight), 0) || 1;
    return run.holds.map((h, i) => ({ label: h.sym, value: +h.weight / t, color: SLICE_COLORS[i % SLICE_COLORS.length] }));
  };
  const two = R.keys.length > 1;
  donut($('donut'), build(R.runs.A));
  if (two) {
    $('donut').insertAdjacentHTML('afterbegin', '<div class="donut-label">Portfolio A</div>');
    $('donutB').classList.remove('hidden');
    donut($('donutB'), build(R.runs.B));
    $('donutB').insertAdjacentHTML('afterbegin', '<div class="donut-label">Portfolio B</div>');
  } else {
    $('donutB').classList.add('hidden');
  }
}

function renderDrawdown(R) {
  const two = R.keys.length > 1;
  drawdownChart($('ddChart'), R.runs.A.dates, R.runs.A.metrics.ddSeries,
    two ? { dd: R.runs.B.metrics.ddSeries, color: PORT_COLOR.B } : null);
}

function renderCorr(R) {
  const panel = $('corrPanel');
  const which = R.keys.length > 1 ? mcWhich() : 'A';
  const run = R.runs[which];
  if (!run || run.syms.length < 2) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  $('corrTag').textContent = R.keys.length > 1
    ? 'portfolio ' + which + ' · monthly returns' : 'monthly returns';
  heatmap($('corrChart'), correlationMatrix(R.aligned, run.syms), run.syms);
}

/* ----------------------------- optimizer -------------------------------- */
/* Which portfolio the optimizer, correlations and projection act on. */
function focusKey() {
  if (!state.last) return 'A';
  return state.last.keys.length > 1 ? mcWhich() : 'A';
}

function renderOptimizer(objective) {
  const R = state.last;
  const out = $('optOut');
  if (!R) return;
  const which = focusKey();
  const run = R.runs[which];
  $('optTag').textContent = (R.keys.length > 1 ? 'portfolio ' + which + ' · ' : '')
    + 'long-only · fully invested';

  if (run.syms.length < 2) {
    out.innerHTML = '<div class="note">Add at least two holdings to optimize.</div>';
    $('frontierChart').innerHTML = '';
    return;
  }

  const stats = assetStats(R.aligned, run.syms);
  if (!stats) {
    out.innerHTML = '<div class="note">Need at least 12 months of overlapping history to optimize. Try a longer period.</div>';
    $('frontierChart').innerHTML = '';
    return;
  }

  const cur = evaluateWeights(stats, run.holds.map(h => +h.weight), R.rf);

  /* Show what's actually reachable, and seed the target boxes from the
     current mix so the first solve is anchored to something meaningful. */
  const range = frontierRange(stats.mu, stats.cov);
  $('volRange').textContent = 'reachable ' + FMT.pct(range.minVol, 1) + ' – ' + FMT.pct(range.maxVol, 1);
  $('retRange').textContent = 'reachable ' + FMT.pct(range.minRet, 1) + ' – ' + FMT.pct(range.maxRet, 1);
  if (!objective) {
    $('tgtVol').value = (cur.vol * 100).toFixed(1);
    $('tgtRet').value = (cur.ret * 100).toFixed(1);
  }

  let target = null;
  if (objective === 'targetvol') target = clampNum($('tgtVol').value, 0, 100, cur.vol * 100) / 100;
  if (objective === 'targetret') target = clampNum($('tgtRet').value, -100, 1000, cur.ret * 100) / 100;

  const opt = objective ? optimizePortfolio(stats, objective, R.rf, target) : null;

  // frontier + markers
  const frontier = efficientFrontier(stats.mu, stats.cov, 40);
  const assetDots = run.syms.map((s, i) => ({
    label: s, vol: Math.sqrt(stats.cov[i][i]), ret: stats.mu[i],
  }));
  const marks = [{ label: 'Current', vol: cur.vol, ret: cur.ret, color: PORT_COLOR[which] }];
  if (opt) marks.push({ label: objLabel(objective, target), vol: opt.vol, ret: opt.ret, color: 'var(--gold)' });
  frontierChart($('frontierChart'), frontier, assetDots, marks);

  if (!opt) {
    out.innerHTML = `<div class="opt-hint">Your current mix is marked on the frontier below —
      pick an objective above to see a suggested set of weights.</div>`;
    return;
  }

  const delta = (a, b) => {
    const d = a - b;
    return `<span class="${signClass(d)}">${d >= 0 ? '+' : ''}${(d * 100).toFixed(2)}%</span>`;
  };
  const rows = run.syms.map((s, i) => {
    const now = cur.weights[i], next = opt.weights[i];
    return `<div class="ow-row">
      <span class="ow-sym">${esc(s)}</span>
      <span class="ow-now">${FMT.pct(now, 1)}</span>
      <span class="ow-arrow">→</span>
      <span class="ow-next">${FMT.pct(next, 1)}</span>
      <span class="ow-bar"><i style="width:${(Math.min(1, next) * 100).toFixed(1)}%"></i></span>
      <span class="ow-rc">${FMT.pct(opt.rc[i], 0)}</span>
    </div>`;
  }).join('');

  /* If the requested target sits outside what these holdings can reach, say so
     plainly and show what was solved instead — never present a clamped answer
     as though it met the request. */
  let infeasible = '';
  if (opt.target && !opt.target.feasible) {
    const isVol = objective === 'targetvol';
    const unit = isVol ? 'volatility' : 'return';
    const reachable = FMT.pct(opt.target.min, 1) + ' – ' + FMT.pct(opt.target.max, 1);
    infeasible = `<div class="opt-warn"><b>${FMT.pct(target, 1)} ${unit} isn’t reachable</b>
      with these holdings — the frontier spans ${reachable}.
      Showing the closest achievable portfolio (${FMT.pct(opt.target.achieved, 1)} ${unit}) instead.
      Add a ${isVol ? (opt.target.bound === 'low' ? 'lower-risk' : 'higher-risk') : (opt.target.bound === 'high' ? 'higher-returning' : 'lower-returning')} holding to widen the range.</div>`;
  }

  out.innerHTML = infeasible + `
    <div class="opt-compare">
      <div class="oc-col"><div class="oc-h">Current</div>
        <div class="oc-v">${FMT.num(cur.sharpe)}</div><div class="oc-k">Sharpe</div>
        <div class="oc-sub">${FMT.pct(cur.ret, 1)} return · ${FMT.pct(cur.vol, 1)} vol</div></div>
      <div class="oc-col opt"><div class="oc-h">${esc(objLabel(objective, target))}</div>
        <div class="oc-v">${FMT.num(opt.sharpe)}</div><div class="oc-k">Sharpe ${delta(opt.sharpe, cur.sharpe)}</div>
        <div class="oc-sub">${FMT.pct(opt.ret, 1)} return · ${FMT.pct(opt.vol, 1)} vol</div></div>
    </div>
    <div class="ow-head"><span>Holding</span><span>Now</span><span></span><span>Suggested</span><span></span><span>Risk</span></div>
    ${rows}
    <button class="chip-btn apply" id="applyOpt">Apply these weights to Portfolio ${which}</button>
    <div class="opt-foot">“Risk” is each holding’s share of total portfolio risk, which is
      why risk parity’s weights look uneven while its risk split is equal.</div>`;

  $('applyOpt').addEventListener('click', () => {
    state.portfolios[which] = run.syms.map((s, i) => ({ sym: s, weight: +(opt.weights[i] * 100).toFixed(2) }));
    if (state.compare) { state.active = which; syncCompareUI(); }
    renderHoldings();
    setStatus('Applied ' + objLabel(objective, target) + ' weights to Portfolio ' + which
      + ' — hit Analyze to backtest them.', 'ok');
    document.querySelector('.builder-tools').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

const OBJ_LABEL = {
  sharpe: 'Max Sharpe', minvol: 'Min volatility',
  parity: 'Risk parity', equal: 'Equal weight',
  targetvol: 'Max return', targetret: 'Min volatility',
};
/* Constrained objectives read better with the target baked into the label. */
function objLabel(objective, target) {
  if (objective === 'targetvol') return 'Max return @ ' + FMT.pct(target, 1) + ' vol';
  if (objective === 'targetret') return 'Min vol @ ' + FMT.pct(target, 1) + ' return';
  return OBJ_LABEL[objective] || 'Optimized';
}

/* ---------------------------- Monte Carlo ------------------------------ */
function mcWhich() {
  const v = $('mcWhich').value;
  return (state.last && state.last.runs[v]) ? v : 'A';
}
function runMonteCarlo() {
  if (!state.last) return;
  const hist = state.last.runs[mcWhich()].metrics.monthly;
  const mc = monteCarlo(hist, {
    years: clampNum($('mcYears').value, 1, 50, 20),
    initial: clampNum($('mcInitial').value, 0, 1e9, 10000),
    monthly: clampNum($('mcMonthly').value, 0, 1e7, 0),
    goal: clampNum($('mcGoal').value, 0, 1e12, 0),
  });
  if (!mc) { $('mcStats').innerHTML = '<div class="note">Not enough history for a projection.</div>'; return; }
  fanChart($('mcChart'), mc);
  const reach = mc.reachGoal != null
    ? `<div class="sc"><div class="sc-k">Chance of reaching goal</div><div class="sc-v ${mc.reachGoal >= 0.5 ? 'up' : 'down'}">${FMT.pct(mc.reachGoal, 0)}</div></div>` : '';
  $('mcStats').innerHTML =
    statCard('Median outcome', FMT.money(mc.median, 0), 'up')
    + statCard('Pessimistic (10%)', FMT.money(mc.p10, 0), 'down')
    + statCard('Optimistic (90%)', FMT.money(mc.p90, 0), 'up')
    + statCard('You contribute', FMT.money(mc.contributions, 0), '')
    + reach;
}

/* ------------------------------ helpers -------------------------------- */
function setStatus(msg, kind) { el.runStatus.textContent = msg || ''; el.runStatus.className = 'run-status' + (kind ? ' ' + kind : ''); }
function setRunning(on) {
  const btn = $('runBtn');
  btn.disabled = on;
  $('refreshBtn').disabled = on;
  btn.innerHTML = on ? 'Analyzing… <span class="arrow spin">◠</span>' : 'Analyze portfolio <span class="arrow">→</span>';
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clampNum(v, lo, hi, dflt) { v = parseFloat(v); if (!isFinite(v)) v = dflt; return Math.max(lo, Math.min(hi, v)); }
function flash(node) { node.classList.remove('flash'); void node.offsetWidth; node.classList.add('flash'); }
function openSettings(open) {
  const p = el.settingsPanel, b = $('settingsBtn');
  const show = open != null ? open : p.classList.contains('hidden');
  p.classList.toggle('hidden', !show);
  b.setAttribute('aria-expanded', show ? 'true' : 'false');
}

/* ------------------------------- events -------------------------------- */
function bindEvents() {
  $('addBtn').addEventListener('click', () => { addHolding(el.tickerInput.value); el.tickerInput.value = ''; el.tickerInput.focus(); });
  el.tickerInput.addEventListener('keydown', e => { if (e.key === 'Enter') { addHolding(el.tickerInput.value); el.tickerInput.value = ''; } });

  el.suggest.addEventListener('click', e => { const b = e.target.closest('[data-add]'); if (b) addHolding(b.dataset.add); });
  el.lazyGrid.addEventListener('click', e => { const b = e.target.closest('[data-lazy]'); if (b) loadLazy(+b.dataset.lazy); });

  el.holdings.addEventListener('input', e => {
    const inp = e.target.closest('.w-in'); if (!inp) return;
    holdings()[+inp.dataset.i].weight = Math.max(0, +inp.value || 0);
    paintWeightTag();
    persist();
  });
  el.holdings.addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (b) removeHolding(+b.dataset.del); });

  $('evenBtn').addEventListener('click', evenWeights);
  $('normBtn').addEventListener('click', normalizeWeights);
  $('clearBtn').addEventListener('click', () => { state.portfolios[state.active] = []; renderHoldings(); });

  /* A / B comparison */
  $('compareToggle').addEventListener('change', e => {
    state.compare = e.target.checked;
    if (state.compare) state.active = 'A';
    syncCompareUI(); renderHoldings(); persist();
  });
  el.abTabs.addEventListener('click', e => {
    const t = e.target.closest('[data-port]');
    if (t) setActive(t.dataset.port);
  });
  $('copyAB').addEventListener('click', () => {
    state.portfolios.B = state.portfolios.A.map(h => ({ sym: h.sym, weight: h.weight }));
    setActive('B');
    setStatus('Copied A into B — tweak it, then analyze.', 'ok');
  });

  $('runBtn').addEventListener('click', () => analyze(false));
  $('refreshBtn').addEventListener('click', () => {
    if (state.demoMode) { setStatus('Demo data is generated locally — there’s nothing to refresh.', 'err'); return; }
    analyze(true);
  });

  ['periodSel', 'benchSel', 'rebalSel', 'rfInput', 'totalReturnToggle'].forEach(id => $(id).addEventListener('change', persist));
  $('logToggle').addEventListener('change', () => { if (state.last) renderGrowth(state.last); });
  $('mcWhich').addEventListener('change', () => {
    runMonteCarlo();
    if (state.last) { renderCorr(state.last); renderOptimizer(null); }
  });
  $('optPanel').addEventListener('click', e => {
    const b = e.target.closest('[data-obj]');
    if (!b || !state.last) return;
    $('optPanel').querySelectorAll('[data-obj]').forEach(x => x.classList.toggle('on', x === b));
    renderOptimizer(b.dataset.obj);
  });
  // Enter in a target box solves it, rather than doing nothing
  [['tgtVol', 'targetvol'], ['tgtRet', 'targetret']].forEach(([id, obj]) => {
    $(id).addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !state.last) return;
      e.preventDefault();
      $('optPanel').querySelectorAll('[data-obj]').forEach(x => x.classList.toggle('on', x.dataset.obj === obj));
      renderOptimizer(obj);
    });
  });
  ['mcInitial', 'mcMonthly', 'mcYears', 'mcGoal'].forEach(id => $(id).addEventListener('input', debounce(runMonteCarlo, 250)));

  $('settingsBtn').addEventListener('click', () => openSettings());
  el.providerSel.addEventListener('change', () => { DataFeed.setProvider(el.providerSel.value); updateKeyLink(); updateDataMode(); });
  el.apiKey.addEventListener('input', () => { DataFeed.setKey(el.apiKey.value); if (el.apiKey.value.trim()) state.demoMode = false; updateDataMode(); });
  $('demoBtn').addEventListener('click', () => {
    state.demoMode = true; updateDataMode();
    const usable = state.portfolios.A.length && state.portfolios.A.every(h => demoAvailable(h.sym));
    if (!usable) {
      state.portfolios.A = [{ sym: 'VTI', weight: 45 }, { sym: 'QQQ', weight: 20 }, { sym: 'BND', weight: 25 }, { sym: 'GLD', weight: 10 }];
      state.portfolios.B = [{ sym: 'VTI', weight: 100 }];
      $('benchSel').value = 'SPY';
      renderHoldings();
    }
    openSettings(false);
    analyze(false);
  });

  $('themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_STORE, next); } catch (e) {}
  });
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

init();
