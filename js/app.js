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

  loadConstraints();
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

    const holdSyms = [];
    keys.forEach(k => sets[k].forEach(h => { if (!holdSyms.includes(h.sym)) holdSyms.push(h.sym); }));
    state.last = {
      keys, runs, bench, benchBt, aligned, rf, totalReturn: wantTR, trWarn,
      seriesMap, limiting: limitingHolding(seriesMap, holdSyms),
    };
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
  renderHistoryPanel(R);
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
  /* A compact class breakdown under the donut — equity / fixed / alts is the
     first thing most people check about an allocation. */
  const breakdown = (run) => {
    const cw = categoryWeights(run.holds);
    const rows = Object.keys(CLASSES)
      .filter(c => cw.byClass[c] > 0)
      .map(c => `<div class="cb-row">
        <span class="cb-bar"><i style="width:${(cw.byClass[c] * 100).toFixed(1)}%;background:${CLASSES[c].color}"></i></span>
        <span class="cb-name">${esc(CLASSES[c].name)}</span>
        <span class="cb-val">${FMT.pct(cw.byClass[c], 1)}</span></div>`).join('');
    return `<div class="class-break">${rows}</div>`;
  };

  const two = R.keys.length > 1;
  donut($('donut'), build(R.runs.A));
  $('donut').insertAdjacentHTML('beforeend', breakdown(R.runs.A));
  if (two) {
    $('donut').insertAdjacentHTML('afterbegin', '<div class="donut-label">Portfolio A</div>');
    $('donutB').classList.remove('hidden');
    donut($('donutB'), build(R.runs.B));
    $('donutB').insertAdjacentHTML('beforeend', breakdown(R.runs.B));
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

/* --------------------- asset allocation constraints --------------------- */
/* bounds[categoryKey] = { lo, hi } as fractions; blank inputs stay undefined
   so an untouched row means "no limit" rather than 0–100. */
const constraintState = { on: false, bounds: {} };

/* Which categories are actually represented in the portfolio on screen. */
function activeCategories(syms) {
  const classes = [], subs = [];
  const add = (c, sc) => {
    if (c && !classes.includes(c)) classes.push(c);
    if (sc && !subs.includes(sc)) subs.push(sc);
  };
  syms.forEach(s => {
    const st = STYLES[s];
    // a style mix can put a holding into categories its hard bucket never had
    if (styleUseMix && st && st.r2 >= STYLE_R2_OK) {
      Object.keys(st.mix).forEach(k => add(SUBCLASSES[k] && SUBCLASSES[k].cls, k));
    } else {
      add(classOf(s), subclassOf(s));
    }
  });
  const order = Object.keys(CLASSES);
  classes.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const subOrder = Object.keys(SUBCLASSES);
  subs.sort((a, b) => subOrder.indexOf(a) - subOrder.indexOf(b));
  return { classes, subs };
}

/* Current share of the portfolio sitting in each category. */
function categoryWeights(holds) {
  const total = holds.reduce((s, h) => s + (+h.weight), 0) || 1;
  const byClass = {}, bySub = {};
  holds.forEach(h => {
    const w = (+h.weight) / total;
    const st = STYLES[h.sym];
    // when a usable style fit is in play, spread the holding across categories
    if (styleUseMix && st && st.r2 >= STYLE_R2_OK) {
      const cm = classMixOf(st.mix);
      Object.keys(cm).forEach(c => byClass[c] = (byClass[c] || 0) + w * cm[c]);
      Object.keys(st.mix).forEach(k => bySub[k] = (bySub[k] || 0) + w * st.mix[k]);
    } else {
      byClass[classOf(h.sym)] = (byClass[classOf(h.sym)] || 0) + w;
      bySub[subclassOf(h.sym)] = (bySub[subclassOf(h.sym)] || 0) + w;
    }
  });
  return { byClass, bySub, total };
}

function renderConstraints(run) {
  const syms = run.syms;
  const { classes, subs } = activeCategories(syms);
  const cw = categoryWeights(run.holds);

  const row = (key, name, level, current, indent) => {
    const b = constraintState.bounds[key] || {};
    /* Subcategories can be limited either as a share of the whole portfolio or
       as a share of their parent class — the way allocation policies are
       usually written ("growth is 30-40% of equity"). */
    const parent = indent && SUBCLASSES[key] ? SUBCLASSES[key].cls : null;
    const basis = parent
      ? `<select class="cn-basis" data-basis="${key}" aria-label="${esc(name)} limit basis">
           <option value="abs">of total</option>
           <option value="rel">of ${esc(className(parent))}</option>
         </select>`
      : '<span class="cn-pct">%</span>';
    return `<div class="cn-row${indent ? ' sub' : ''}${b.rel ? ' rel' : ''}">
      <span class="cn-name">${esc(name)}</span>
      <span class="cn-cur">${FMT.pct(current || 0, 1)}</span>
      <span class="cn-in">
        <input type="number" min="0" max="100" step="1" placeholder="—"
               data-cn="${key}" data-side="lo" value="${b.lo != null ? +(b.lo * 100).toFixed(1) : ''}"
               aria-label="${esc(name)} minimum %">
        <em>to</em>
        <input type="number" min="0" max="100" step="1" placeholder="—"
               data-cn="${key}" data-side="hi" value="${b.hi != null ? +(b.hi * 100).toFixed(1) : ''}"
               aria-label="${esc(name)} maximum %">
        ${basis}
      </span>
    </div>`;
  };

  /* Rebuild the rows only when the set of categories actually changes —
     otherwise a re-solve mid-edit would replace the input under the cursor. */
  /* A relative row shows its share of the PARENT, so the number lines up with
     the limit next to it rather than silently meaning something else. */
  const shown = (key, isSub) => {
    const b = constraintState.bounds[key] || {};
    if (isSub && b.rel) {
      const par = cw.byClass[classOfSubclass(key)] || 0;
      return par > 1e-9 ? (cw.bySub[key] || 0) / par : 0;
    }
    return isSub ? cw.bySub[key] : cw.byClass[key];
  };

  const sig = classes.join(',') + '|' + subs.join(',');
  if ($('cnRows').dataset.sig !== sig) {
    let html = `<div class="cn-head"><span>Category</span><span>Now</span><span>Min / Max</span></div>`;
    classes.forEach(c => {
      html += row(c, className(c), 'class', shown(c, false));
      subs.filter(s => classOfSubclass(s) === c)
          .forEach(s => { html += row(s, subclassName(s), 'sub', shown(s, true), true); });
    });
    $('cnRows').innerHTML = html;
    $('cnRows').dataset.sig = sig;
  } else {
    // same categories: just refresh the "now" column in place
    $('cnRows').querySelectorAll('.cn-row').forEach(r => {
      const key = r.querySelector('[data-cn]');
      if (!key) return;
      const k = key.dataset.cn;
      const isSub = !CLASSES[k];
      r.querySelector('.cn-cur').textContent = FMT.pct(shown(k, isSub) || 0, 1);
      r.classList.toggle('rel', !!(constraintState.bounds[k] || {}).rel);
    });
  }
  // reflect each subcategory's chosen basis
  $('cnRows').querySelectorAll('[data-basis]').forEach(sel => {
    sel.value = (constraintState.bounds[sel.dataset.basis] || {}).rel ? 'rel' : 'abs';
  });

  // per-holding category assignment
  const opts = Object.keys(SUBCLASSES).map(k =>
    `<option value="${k}">${esc(SUBCLASSES[k].name)}</option>`).join('');
  $('cnAssign').innerHTML = syms.map(s =>
    `<label class="cn-a"><span>${esc(s)}</span>
       <select data-assign="${esc(s)}">${opts}</select></label>`).join('');
  syms.forEach(s => {
    const sel = $('cnAssign').querySelector(`[data-assign="${CSS.escape(s)}"]`);
    if (sel) sel.value = subclassOf(s);
  });

  const n = Object.keys(constraintState.bounds).filter(k => {
    const b = constraintState.bounds[k];
    return b && (b.lo != null || b.hi != null);
  }).length;
  $('cnCount').textContent = constraintState.on && n ? n + ' active' : (n ? n + ' set · off' : '');
  $('cnEnable').checked = constraintState.on;
}

/* ------------------ longer-history substitute finder -------------------- */
/* The backtest can only span the window every holding shares, so the holding
   that starts latest sets the start date for everything. */
function limitingHolding(seriesMap, syms) {
  let worst = null;
  syms.forEach(s => {
    const ser = seriesMap[s];
    if (!ser || !ser.length) return;
    const start = ser[0].date;
    if (!worst || start > worst.start) worst = { sym: s, start, n: ser.length };
  });
  if (!worst) return null;
  // how much earlier everything else begins
  let secondStart = null;
  syms.forEach(s => {
    if (s === worst.sym) return;
    const ser = seriesMap[s];
    if (!ser || !ser.length) return;
    if (!secondStart || ser[0].date > secondStart) secondStart = ser[0].date;
  });
  worst.nextStart = secondStart;
  return worst;
}

/* Fetch each candidate and MEASURE it: real first date, and how closely its
   monthly returns track the fund being replaced over their shared window.
   Nothing is recommended on the strength of the curated list alone. */
/* Measure one candidate against the fund it would replace. */
async function measureCandidate(cand, original, limitDate) {
  let ser;
  try { ser = await fetchDaily(cand, false); }
  catch (e) { return { sym: cand, error: e.message }; }
  if (!ser || ser.length < 60) return { sym: cand, error: 'Too little history returned.' };

  // correlation of monthly returns over the period both cover
  const al = alignSeries({ a: original, b: ser }, ['a', 'b']);
  let corr = null, months = 0;
  if (al.dates.length > 40) {
    const ra = monthlyReturns(al.dates, al.closes.a).map(x => x.r);
    const rb = monthlyReturns(al.dates, al.closes.b).map(x => x.r);
    months = Math.min(ra.length, rb.length);
    if (months >= 12) {
      const A = ra.slice(-months), B = rb.slice(-months);
      const ma = S.mean(A), mb = S.mean(B);
      let cov = 0, va = 0, vb = 0;
      for (let i = 0; i < months; i++) {
        cov += (A[i] - ma) * (B[i] - mb); va += (A[i] - ma) ** 2; vb += (B[i] - mb) ** 2;
      }
      corr = (va > 0 && vb > 0) ? cov / Math.sqrt(va * vb) : null;
    }
  }
  return {
    sym: cand, start: ser[0].date, corr, overlapMonths: months,
    gainDays: Math.max(0, (new Date(limitDate) - new Date(ser[0].date)) / 864e5),
  };
}

async function evaluateSubstitutes(sym, seriesMap, limitDate) {
  const cands = substitutesFor(sym);
  const original = seriesMap[sym];
  const out = [];
  for (const c of cands) out.push(await measureCandidate(c, original, limitDate));
  // best = starts earliest, among those that actually track well
  out.sort((a, b) => {
    if (a.error) return 1; if (b.error) return -1;
    return a.start < b.start ? -1 : 1;
  });
  return out;
}

const SUB_CORR_OK = 0.90;   // below this it isn't really the same exposure

async function findSubstitutes() {
  if (!state.last) return;
  const R = state.last;
  const btn = $('subBtn'), out = $('subOut');
  const lim = R.limiting;
  if (!lim) return;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Checking…';
  out.innerHTML = '<div class="cn-hint">Fetching candidates and measuring how closely they track…</div>';
  try {
    const res = await evaluateSubstitutes(lim.sym, R.seriesMap, lim.start);
    if (!res.length) {
      out.innerHTML = '<div class="cn-hint">No longer-history stand-in is listed for '
        + esc(lim.sym) + '. Adding one manually still works — anything with a longer record will do.</div>';
      return;
    }
    const rows = res.map(r => substituteRow(r, lim)).join('');
    out.innerHTML = `<div class="cn-hint">Measured against your data provider — start dates and
      correlations below are read from the actual series, not assumed. A correlation under
      ${SUB_CORR_OK.toFixed(2)} means it isn't really the same exposure.</div>` + rows;
  } catch (err) {
    out.innerHTML = '<div class="cn-status bad">' + esc(err.message || 'Could not check substitutes.') + '</div>';
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

/* One measured candidate, rendered the same whether it came from the curated
   list or was typed in by hand. */
function substituteRow(r, lim) {
  if (r.error) {
    return `<div class="sb-row bad"><span class="sb-sym">${esc(r.sym)}</span>
      <span class="sb-note">unavailable — ${esc(r.error)}</span></div>`;
  }
      const years = ((new Date(lim.start) - new Date(r.start)) / 864e5 / 365.25);
      /* Swapping only helps until the next-shortest holding takes over as the
         binding one, so report the history this would actually unlock rather
         than how far back the candidate itself goes. */
      const newStart = (lim.nextStart && r.start < lim.nextStart) ? lim.nextStart : r.start;
      const gain = (new Date(lim.start) - new Date(newStart)) / 864e5 / 365.25;
      const good = r.corr != null && r.corr >= SUB_CORR_OK;
      const useful = gain > 0.25;
      const capped = years - gain > 0.5;
      return `<div class="sb-row${good && useful ? '' : ' weak'}">
        <span class="sb-sym">${esc(r.sym)}</span>
        <span class="sb-note">
          from <b>${FMT.date(r.start)}</b>
          ${useful ? '· adds <span class="up">' + gain.toFixed(1) + ' yrs</span>' : '· adds nothing over ' + esc(lim.sym)}
          ${r.corr != null ? '· tracks ' + esc(lim.sym) + ' <b>' + r.corr.toFixed(2) + '</b>' : '· correlation unavailable'}
          ${capped && useful ? '<br><span class="sb-cap">goes back ' + years.toFixed(1)
              + ' yrs further, but the window then stops at your next-shortest holding</span>' : ''}
        </span>
        ${good && useful ? `<button class="chip-btn sb-use" data-sub="${esc(r.sym)}">Use it</button>` : '<span class="sb-skip">—</span>'}
      </div>`;
}

/* Check a ticker the user names — sibling share classes, a predecessor fund,
   anything. Same measurement, so the verdict is comparable. */
async function checkTicker() {
  const R = state.last;
  if (!R || !R.limiting) return;
  const inp = $('subCheck');
  const sym = (inp.value || '').trim().toUpperCase();
  const out = $('subManual');
  if (!sym) { inp.focus(); return; }
  out.innerHTML = '<div class="cn-hint">Checking ' + esc(sym) + '…</div>';
  const btn = $('subCheckBtn');
  btn.disabled = true;
  try {
    const r = await measureCandidate(sym, R.seriesMap[R.limiting.sym], R.limiting.start);
    let extra = '';
    if (!r.error && r.corr == null) {
      extra = `<div class="cn-hint">Not enough overlap with ${esc(R.limiting.sym)} to judge whether
        it's the same exposure — compare them yourself before swapping.</div>`;
    }
    out.innerHTML = substituteRow(r, R.limiting) + extra;
  } catch (err) {
    out.innerHTML = '<div class="cn-status bad">' + esc(err.message || 'Could not check that ticker.') + '</div>';
  } finally {
    btn.disabled = false;
  }
}

/* Swap the limiting holding for the chosen stand-in, keeping its weight. */
function applySubstitute(newSym) {
  const R = state.last;
  if (!R || !R.limiting) return;
  const oldSym = R.limiting.sym;
  const which = focusKey();
  const list = state.portfolios[which];
  const idx = list.findIndex(h => h.sym === oldSym);
  if (idx < 0) return;
  list[idx] = { sym: newSym, weight: list[idx].weight };
  renderHoldings();
  setStatus('Swapped ' + oldSym + ' for ' + newSym + ' in Portfolio ' + which
    + ' — hit Analyze to rerun over the longer history.', 'ok');
  $('runBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderHistoryPanel(R) {
  const panel = $('histPanel');
  const lim = R.limiting;
  if (!lim || !lim.nextStart || R.runs.A.syms.length < 2) { panel.classList.add('hidden'); return; }
  const gainYears = (new Date(lim.start) - new Date(lim.nextStart)) / 864e5 / 365.25;
  if (gainYears < 0.5) { panel.classList.add('hidden'); return; }   // nothing meaningful to gain
  panel.classList.remove('hidden');
  $('histBody').innerHTML =
    `<p class="note"><b>${esc(lim.sym)}</b> starts ${FMT.date(lim.start)} — the latest of your holdings,
      so the whole backtest begins there. Everything else goes back to at least ${FMT.date(lim.nextStart)},
      about <b>${gainYears.toFixed(1)} more years</b> that are currently unused.</p>
     <div class="style-row"><button class="chip-btn" id="subBtn">Find a longer-history stand-in</button></div>
     <div id="subOut" class="style-out"></div>
     <div class="sb-manual">
       <label class="tgt-lab" for="subCheck">Or check a specific ticker — an older share class,
         a predecessor fund, anything you have in mind:</label>
       <div class="tgt-row">
         <input id="subCheck" type="text" autocomplete="off" spellcheck="false"
                placeholder="e.g. ${esc((substitutesFor(lim.sym)[0]) || 'VFINX')}" aria-label="Ticker to check">
         <button class="chip-btn" id="subCheckBtn">Check</button>
       </div>
       <div id="subManual" class="style-out"></div>
     </div>`;
  $('subBtn').addEventListener('click', findSubstitutes);
  $('subCheckBtn').addEventListener('click', checkTicker);
  $('subCheck').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); checkTicker(); } });
}

/* --------------------------- style analysis ----------------------------- */
/* STYLES[sym] = { mix, r2, months } once "Detect style" has run. */
const STYLES = {};
let styleUseMix = false;
const STYLE_R2_OK = 0.60;      // below this the fit explains too little to lean on

async function detectStyles() {
  if (!state.last) return;
  const run = state.last.runs[focusKey()];
  const btn = $('styleBtn'), out = $('styleOut');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Estimating…';
  out.innerHTML = '<div class="cn-hint">Fitting each holding against the style benchmarks…</div>';
  try {
    const res = await analyzeStyles(run.syms, (s) => fetchDaily(s, false));
    if (res.error) throw new Error(res.error);
    Object.keys(res.styles).forEach(s => { STYLES[s] = res.styles[s]; });
    renderStyles(run);
    $('styleUseWrap').hidden = false;
  } catch (err) {
    out.innerHTML = '<div class="cn-status bad">' + esc(err.message || 'Could not estimate style.') + '</div>';
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

function renderStyles(run) {
  const catOptions = Object.keys(SUBCLASSES)
    .map(k => `<option value="${k}">${esc(SUBCLASSES[k].name)}</option>`).join('');

  const rows = run.syms.filter(s => STYLES[s]).map(s => {
    const st = STYLES[s];
    const weak = st.r2 < STYLE_R2_OK;
    const chosen = !!SUBCLASS_OVERRIDE[s];

    /* A weak fit is a bad description of the fund, so rather than show a mix
       nobody should act on, offer the category outright — the fit itself is
       the thing that failed, and a person knows what the fund is. */
    if (weak) {
      return `<div class="sm-row weak${chosen ? ' picked' : ''}">
        <span class="sm-sym">${esc(s)}</span>
        <span class="sm-mix sm-pick">
          <label for="pick-${esc(s)}">${chosen ? 'Filed as' : 'Poor fit — file it as'}</label>
          <select id="pick-${esc(s)}" data-pick="${esc(s)}">${catOptions}</select>
        </span>
        <span class="sm-r2" title="How much of this fund's movement the style mix explains">R² ${st.r2.toFixed(2)}</span>
      </div>`;
    }

    const parts = Object.keys(st.mix).sort((a, b) => st.mix[b] - st.mix[a]).slice(0, 4)
      .map(k => `<span class="sm-part">${esc(subclassName(k))} <b>${FMT.pct(st.mix[k], 0)}</b></span>`).join('');
    return `<div class="sm-row">
      <span class="sm-sym">${esc(s)}</span>
      <span class="sm-mix">${parts}</span>
      <span class="sm-r2" title="How much of this fund's movement the style mix explains">R² ${st.r2.toFixed(2)}</span>
    </div>`;
  }).join('');

  const weakOnes = run.syms.filter(s => STYLES[s] && STYLES[s].r2 < STYLE_R2_OK);
  const unset = weakOnes.filter(s => !SUBCLASS_OVERRIDE[s]);
  const note = weakOnes.length
    ? `<div class="cn-status${unset.length ? ' bad' : ''}">The style benchmarks explain little of what
       ${weakOnes.map(esc).join(', ')} actually did, so ${weakOnes.length > 1 ? 'their mixes are' : 'that mix is'}
       not used — pick the category above instead. Commodities, gold and inflation-linked bonds usually
       land here because nothing in the basis behaves like them.</div>`
    : '';
  const months = run.syms.map(s => STYLES[s] && STYLES[s].months).find(Boolean);
  $('styleOut').innerHTML =
    `<div class="cn-hint">Estimated from ${months || '—'} months of returns. R² shows how much of each
      fund's movement the mix explains — treat anything under ${Math.round(STYLE_R2_OK * 100)}% as unreliable.</div>`
    + rows + note;

  // reflect the current category on each manual picker
  $('styleOut').querySelectorAll('[data-pick]').forEach(sel => {
    sel.value = subclassOf(sel.dataset.pick);
  });
}

/* Fractional class/subcategory membership derived from the fitted mixes.
   Holdings without a usable fit fall back to their hard category. */
function styleMembership(syms, level) {
  const member = {};
  const put = (cat, i, v) => {
    if (!member[cat]) member[cat] = new Array(syms.length).fill(0);
    member[cat][i] += v;
  };
  syms.forEach((s, i) => {
    const st = STYLES[s];
    if (st && st.r2 >= STYLE_R2_OK) {
      const mix = level === 'class' ? classMixOf(st.mix) : st.mix;
      Object.keys(mix).forEach(k => put(k, i, mix[k]));
    } else {
      put(level === 'class' ? classOf(s) : subclassOf(s), i, 1);
    }
  });
  return member;
}

/* Turn the UI state into solver groups for the holdings in `run`. */
function buildConstraintGroups(run) {
  if (!constraintState.on) return [];
  const syms = run.syms;
  const clsBounds = {}, subBounds = {};
  const clsNames = {}, subNames = {};
  Object.keys(CLASSES).forEach(k => clsNames[k] = CLASSES[k].name);
  Object.keys(SUBCLASSES).forEach(k => subNames[k] = SUBCLASSES[k].name);

  const relBounds = {};
  Object.keys(constraintState.bounds).forEach(k => {
    const b = constraintState.bounds[k];
    if (!b || (b.lo == null && b.hi == null)) return;
    const entry = { lo: b.lo == null ? 0 : b.lo, hi: b.hi == null ? 1 : b.hi };
    if (CLASSES[k]) clsBounds[k] = entry;
    else if (SUBCLASSES[k]) {
      if (b.rel) relBounds[k] = Object.assign({ rel: true }, entry);
      else subBounds[k] = entry;
    }
  });

  /* Membership vectors, shared by the absolute and relative builders. */
  const memberOf = (level) => {
    const anyFit = syms.some(s => STYLES[s] && STYLES[s].r2 >= STYLE_R2_OK);
    if (styleUseMix && anyFit) return styleMembership(syms, level);
    const m = {};
    syms.forEach((s, i) => {
      const cat = level === 'class' ? classOf(s) : subclassOf(s);
      if (!m[cat]) m[cat] = new Array(syms.length).fill(0);
      m[cat][i] = 1;
    });
    return m;
  };
  const relGroups = Object.keys(relBounds).length
    ? buildRelativeGroups(memberOf('sub'), memberOf('class'), relBounds, subNames, syms.length)
    : [];

  /* With style analysis applied, a holding contributes fractionally to several
     categories at once; otherwise it sits wholly in one. */
  const anyFit = syms.some(s => STYLES[s] && STYLES[s].r2 >= STYLE_R2_OK);
  if (styleUseMix && anyFit) {
    return buildFractionalGroups(memberOf('class'), clsBounds, clsNames, 'class', syms.length)
      .concat(buildFractionalGroups(memberOf('sub'), subBounds, subNames, 'sub', syms.length))
      .concat(relGroups);
  }
  return buildGroups(syms.map(s => classOf(s)), clsBounds, clsNames, 'class')
    .concat(buildGroups(syms.map(s => subclassOf(s)), subBounds, subNames, 'sub'))
    .concat(relGroups);
}

function persistConstraints() {
  try {
    localStorage.setItem('plabs_constraints_v1', JSON.stringify({
      on: constraintState.on, bounds: constraintState.bounds, overrides: SUBCLASS_OVERRIDE,
    }));
  } catch (e) {}
}
function loadConstraints() {
  try {
    const s = JSON.parse(localStorage.getItem('plabs_constraints_v1') || 'null');
    if (!s) return;
    constraintState.on = !!s.on;
    /* Discard anything referring to a category that no longer exists — saved
       settings can predate a taxonomy change, and carrying a dead key forward
       would break every lookup that trusts it. */
    const bounds = s.bounds || {};
    constraintState.bounds = {};
    Object.keys(bounds).forEach(k => {
      if (CLASSES[k] || SUBCLASSES[k]) constraintState.bounds[k] = bounds[k];
    });
    Object.keys(s.overrides || {}).forEach(k => {
      if (SUBCLASSES[s.overrides[k]]) SUBCLASS_OVERRIDE[k] = s.overrides[k];
    });
  } catch (e) {}
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

  renderConstraints(run);
  const groups = buildConstraintGroups(run);
  const feas = constraintsFeasible(groups, run.syms.length);
  if (!feas.ok) {
    $('cnStatus').innerHTML = '<b>These limits can’t all be met.</b> ' + esc(feas.reason);
    $('cnStatus').className = 'cn-status bad';
    $('constraints').open = true;
  } else {
    $('cnStatus').textContent = constraintState.on && groups.length
      ? 'Limits applied to every optimization below.' : '';
    $('cnStatus').className = 'cn-status';
  }
  const active = feas.ok ? groups : [];   // never solve against impossible bounds

  /* Show what's actually reachable, and seed the target boxes from the
     current mix so the first solve is anchored to something meaningful. */
  const range = frontierRange(stats.mu, stats.cov, active);
  $('volRange').textContent = 'reachable ' + FMT.pct(range.minVol, 1) + ' – ' + FMT.pct(range.maxVol, 1);
  $('retRange').textContent = 'reachable ' + FMT.pct(range.minRet, 1) + ' – ' + FMT.pct(range.maxRet, 1);
  if (!objective) {
    $('tgtVol').value = (cur.vol * 100).toFixed(1);
    $('tgtRet').value = (cur.ret * 100).toFixed(1);
  }

  let target = null;
  if (objective === 'targetvol') target = clampNum($('tgtVol').value, 0, 100, cur.vol * 100) / 100;
  if (objective === 'targetret') target = clampNum($('tgtRet').value, -100, 1000, cur.ret * 100) / 100;

  /* Path-dependent objectives are scored on the real backtest, so they need
     the aligned prices, the rebalance rule and the benchmark — not just the
     covariance matrix. */
  const ctx = {
    aligned: R.aligned, rebal: $('rebalSel').value, benchBt: R.benchBt,
    current: cur.weights.slice(),
  };
  const opt = objective ? optimizePortfolio(stats, objective, R.rf, target, active, ctx) : null;

  // frontier + markers
  const frontier = efficientFrontier(stats.mu, stats.cov, active.length ? 26 : 40, active);
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
  if (objective === 'maxalpha' && !R.bench) {
    infeasible += `<div class="opt-warn"><b>Alpha needs a benchmark.</b> Pick one in the
      Benchmark selector above and analyze again.</div>`;
  }
  if (objective === 'maxalpha' && R.bench && (!active || !active.length)) {
    infeasible += `<div class="opt-warn"><b>Alpha is linear in the weights</b>, so with no
      allocation limits the best answer is nearly always a single holding — whichever had the
      highest alpha over this window. Set some limits above to get a diversified answer.</div>`;
  }
  if (opt.violations && opt.violations.length) {
    infeasible += `<div class="opt-warn"><b>Couldn’t meet ${opt.violations.length === 1 ? 'one limit' : 'some limits'}.</b> `
      + opt.violations.map(v => esc(v.name) + ' came out at ' + FMT.pct(v.actual, 1)
        + (v.rel ? ' of its class' : '')
        + ' (limit ' + FMT.pct(v.lo, 0) + '–' + FMT.pct(v.hi, 0) + ')').join('; ')
      + '. Usually that means there are no holdings in that category — add one, or relax the limit.</div>';
  }
  if (opt.target && !opt.target.feasible) {
    const isVol = objective === 'targetvol';
    const unit = isVol ? 'volatility' : 'return';
    const reachable = FMT.pct(opt.target.min, 1) + ' – ' + FMT.pct(opt.target.max, 1);
    infeasible += `<div class="opt-warn"><b>${FMT.pct(target, 1)} ${unit} isn’t reachable</b>
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
  sortino: 'Max Sortino', calmar: 'Max Calmar', mindd: 'Min drawdown',
  minvar: 'Min VaR', maxalpha: 'Max alpha',
};
/* The objective currently selected, so constraint edits re-solve the same one. */
function currentObjective() {
  const on = $('optPanel').querySelector('[data-obj].on');
  return on ? on.dataset.obj : null;
}

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
    /* Searching the real backtest takes noticeably longer than the closed-form
       solvers, so show it working rather than freezing silently. */
    const heavy = PATH_OBJECTIVES.indexOf(b.dataset.obj) !== -1;
    if (!heavy) { renderOptimizer(b.dataset.obj); return; }
    const prev = b.textContent;
    b.textContent = 'Searching…';
    $('optPanel').querySelectorAll('[data-obj]').forEach(x => x.disabled = true);
    setTimeout(() => {
      try { renderOptimizer(b.dataset.obj); }
      finally {
        b.textContent = prev;
        $('optPanel').querySelectorAll('[data-obj]').forEach(x => x.disabled = false);
      }
    }, 30);
  });
  /* constraint rows: min/max entry, enable switch, category reassignment */
  /* Record the edit immediately and debounce only the expensive re-solve.
     Debouncing the state update itself would collapse edits to two different
     inputs into one call and silently drop the earlier one. */
  const resolveSoon = debounce(() => { if (state.last) renderOptimizer(currentObjective()); }, 500);
  $('cnRows').addEventListener('input', e => {
    const inp = e.target.closest('[data-cn]');
    if (!inp) return;
    const key = inp.dataset.cn, side = inp.dataset.side;
    const raw = inp.value.trim();
    const b = constraintState.bounds[key] || (constraintState.bounds[key] = {});
    b[side] = raw === '' ? null : Math.max(0, Math.min(100, parseFloat(raw) || 0)) / 100;
    // keep the entry alive if a basis was chosen, or that choice is lost
    if (b.lo == null && b.hi == null && !b.rel) delete constraintState.bounds[key];
    persistConstraints();
    resolveSoon();
  });

  /* Switching a subcategory between "% of total" and "% of its class". The
     numbers already typed keep their values but change meaning, so the row's
     "now" figure is recomputed on the new basis straight away. */
  $('cnRows').addEventListener('change', e => {
    const sel = e.target.closest('[data-basis]');
    if (!sel) return;
    const key = sel.dataset.basis;
    const b = constraintState.bounds[key] || (constraintState.bounds[key] = {});
    b.rel = sel.value === 'rel';
    // only discard once there is nothing left to remember
    if (b.lo == null && b.hi == null && !b.rel) delete constraintState.bounds[key];
    persistConstraints();
    if (state.last) renderOptimizer(currentObjective());
  });

  $('cnEnable').addEventListener('change', e => {
    constraintState.on = e.target.checked;
    persistConstraints();
    if (state.last) renderOptimizer(currentObjective());
  });

  $('histPanel').addEventListener('click', e => {
    const b = e.target.closest('[data-sub]');
    if (b) applySubstitute(b.dataset.sub);
  });

  $('styleBtn').addEventListener('click', detectStyles);

  /* Choosing a category for a poorly-fitted fund. It feeds the same override
     the constraint mapping already falls back to, so the choice applies
     whether or not the estimated mix is switched on. */
  $('styleOut').addEventListener('change', e => {
    const sel = e.target.closest('[data-pick]');
    if (!sel) return;
    SUBCLASS_OVERRIDE[sel.dataset.pick] = sel.value;
    persistConstraints();
    renderHoldings();
    if (state.last) {
      const run = state.last.runs[focusKey()];
      renderStyles(run);
      delete $('cnRows').dataset.sig;      // categories may have changed
      renderDonuts(state.last);
      renderOptimizer(currentObjective());
    }
  });
  $('styleUse').addEventListener('change', e => {
    styleUseMix = e.target.checked;
    delete $('cnRows').dataset.sig;      // categories change, so rebuild the rows
    if (state.last) renderOptimizer(currentObjective());
  });

  $('cnAssign').addEventListener('change', e => {
    const sel = e.target.closest('[data-assign]');
    if (!sel) return;
    SUBCLASS_OVERRIDE[sel.dataset.assign] = sel.value;
    persistConstraints();
    renderHoldings();
    if (state.last) { renderDonuts(state.last); renderOptimizer(currentObjective()); }
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
