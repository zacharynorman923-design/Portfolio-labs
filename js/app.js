/* =========================================================================
   Portfolio Labs — app: state, data fetching, rendering, interactions
   ========================================================================= */

const PORT_STORE  = 'plabs_portfolio_v1';
const THEME_STORE = 'plabs_theme_v1';
const CACHE_PREFIX = 'plabs_cache_';
const CACHE_TTL = 12 * 3600 * 1000; // 12h — be gentle on free API tiers

/* ------------------------------- state --------------------------------- */
const state = {
  holdings: [],          // [{ sym, weight }]  weight = percent
  demoMode: false,
  last: null,            // cached analysis result (for Monte Carlo re-runs)
};

const $  = (id) => document.getElementById(id);
const el = {
  holdings: $('holdings'), suggest: $('suggest'), lazyGrid: $('lazyGrid'),
  weightTag: $('weightTag'), tickerInput: $('tickerInput'),
  runStatus: $('runStatus'), empty: $('empty'), results: $('results'),
  settingsPanel: $('settingsPanel'), providerSel: $('providerSel'),
  apiKey: $('apiKey'), keyLink: $('keyLink'), dataMode: $('dataMode'),
};

/* ------------------------------- init ---------------------------------- */
function init() {
  // theme
  try {
    const t = localStorage.getItem(THEME_STORE);
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}

  // data source UI
  el.providerSel.value = DataFeed.provider;
  el.apiKey.value = DataFeed.apiKey;
  updateKeyLink();
  updateDataMode();

  // restore saved portfolio
  try {
    const saved = JSON.parse(localStorage.getItem(PORT_STORE) || 'null');
    if (saved && Array.isArray(saved.holdings)) {
      state.holdings = saved.holdings.filter(h => h.sym);
      if (saved.settings) applySettings(saved.settings);
    }
  } catch (e) {}
  if (!state.holdings.length) state.holdings = [{ sym: 'VTI', weight: 60 }, { sym: 'BND', weight: 40 }];

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
}
function currentSettings() {
  return {
    period: $('periodSel').value, bench: $('benchSel').value,
    rebal: $('rebalSel').value, rf: $('rfInput').value,
  };
}
function persist() {
  try { localStorage.setItem(PORT_STORE, JSON.stringify({ holdings: state.holdings, settings: currentSettings() })); } catch (e) {}
}

/* ----------------------------- rendering ------------------------------- */
function totalWeight() { return state.holdings.reduce((s, h) => s + (+h.weight || 0), 0); }

function renderHoldings() {
  if (!state.holdings.length) {
    el.holdings.innerHTML = '<div class="no-holds">No holdings yet — add tickers below.</div>';
  } else {
    el.holdings.innerHTML = state.holdings.map((h, i) => {
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
  const tw = totalWeight();
  el.weightTag.textContent = 'weights ' + tw.toFixed(0) + '%';
  el.weightTag.className = 'tag' + (Math.abs(tw - 100) < 0.5 ? ' ok' : (tw > 0 ? ' warn' : ''));
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

/* ---------------------------- holdings ops ----------------------------- */
function addHolding(sym) {
  sym = (sym || '').trim().toUpperCase();
  if (!sym) return;
  if (state.holdings.some(h => h.sym === sym)) { flash(el.tickerInput); return; }
  const remaining = Math.max(0, 100 - totalWeight());
  state.holdings.push({ sym, weight: remaining > 0 ? Math.round(remaining) : 10 });
  renderHoldings();
}
function removeHolding(i) { state.holdings.splice(i, 1); renderHoldings(); }
function evenWeights() {
  const n = state.holdings.length; if (!n) return;
  const w = +(100 / n).toFixed(2);
  state.holdings.forEach(h => h.weight = w);
  renderHoldings();
}
function normalizeWeights() {
  const t = totalWeight(); if (t <= 0) return;
  state.holdings.forEach(h => h.weight = +((h.weight / t) * 100).toFixed(2));
  renderHoldings();
}
function loadLazy(i) {
  const p = LAZY[i]; if (!p) return;
  state.holdings = p.holds.map(h => ({ sym: h[0], weight: h[1] }));
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
/* Returns [{date, close}] ascending for a symbol, from cache / demo / live. */
async function fetchDaily(sym) {
  if (state.demoMode) {
    const d = buildDemoSeries(sym);
    if (!d) throw new Error('"' + sym + '" isn’t in the demo set. Demo covers: ' + DEMO_SYMBOLS.join(', ') + '.');
    return d;
  }
  const ck = CACHE_PREFIX + DataFeed.provider + '_' + sym;
  try {
    const hit = JSON.parse(localStorage.getItem(ck) || 'null');
    if (hit && (Date.now() - hit.t) < CACHE_TTL && Array.isArray(hit.v) && hit.v.length) return hit.v;
  } catch (e) {}
  const v = await DataFeed.daily(sym);
  try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), v })); } catch (e) {}
  return v;
}

/* ------------------------------ analyze -------------------------------- */
async function analyze() {
  const holds = state.holdings.filter(h => (+h.weight) > 0 && h.sym);
  if (!holds.length) { setStatus('Add at least one holding with a weight above 0.', 'err'); return; }
  if (!state.demoMode && !DataFeed.hasKey()) {
    setStatus('Add a free API key under “Data source”, or click “Explore with demo data”.', 'err');
    openSettings(true); return;
  }
  const bench = $('benchSel').value;
  const period = +$('periodSel').value;
  const rebal = $('rebalSel').value;
  const rf = (+$('rfInput').value || 0) / 100;

  const holdSyms = holds.map(h => h.sym);
  const allSyms = bench && !holdSyms.includes(bench) ? holdSyms.concat(bench) : holdSyms.slice();

  setRunning(true);
  const seriesMap = {};
  try {
    for (let i = 0; i < allSyms.length; i++) {
      setStatus('Fetching ' + allSyms[i] + '… (' + (i + 1) + '/' + allSyms.length + ')');
      seriesMap[allSyms[i]] = await fetchDaily(allSyms[i]);
      if (!state.demoMode && i < allSyms.length - 1) await sleep(220); // ease rate limits
    }
  } catch (err) {
    setRunning(false); setStatus(err.message || 'Could not fetch market data.', 'err'); return;
  }

  try {
    // align holdings + benchmark on a shared calendar, then slice the window
    let aligned = alignSeries(seriesMap, allSyms);
    aligned = sliceYears(aligned, period);
    if (aligned.dates.length < 25) throw new Error('Not enough overlapping history for these symbols in this period. Try a shorter period or different tickers.');

    const wFrac = {}; holds.forEach(h => wFrac[h.sym] = +h.weight);
    const bt = metricsBundle(aligned, wFrac, rebal, rf);

    let benchBt = null, rel = {};
    if (bench) {
      const bAligned = { dates: aligned.dates, closes: { [bench]: aligned.closes[bench] } };
      benchBt = backtest(bAligned, { [bench]: 1 }, 'none');
      benchBt.metrics = metrics(benchBt.dates, benchBt.values, { rf });
      rel = relativeMetrics(bt.dates, bt.values, benchBt.dates, benchBt.values, rf);
    }

    const corr = holdSyms.length >= 2 ? correlationMatrix(aligned, holdSyms) : null;

    state.last = { holds, holdSyms, bench, bt, benchBt, rel, corr, aligned, rf };
    renderResults(state.last);
    runMonteCarlo();
    setRunning(false); setStatus('');
    el.results.classList.remove('hidden');
    el.empty.classList.add('hidden');
    requestAnimationFrame(() => el.results.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  } catch (err) {
    setRunning(false); setStatus(err.message || 'Analysis failed.', 'err');
  }
}

/* Backtest + full metrics for the portfolio. */
function metricsBundle(aligned, wFrac, rebal, rf) {
  const bt = backtest(aligned, wFrac, rebal);
  const m = metrics(bt.dates, bt.values, { rf });
  return Object.assign(bt, { metrics: m });
}

/* ----------------------------- results UI ------------------------------ */
function renderResults(R) {
  const m = R.bt.metrics;
  // headline
  $('resultHead').innerHTML = `
    <div class="rh-top">
      <div>
        <div class="rh-label">${FMT.date(m.startDate)} → ${FMT.date(m.endDate)} · ${m.years.toFixed(1)} yrs · ${state.demoMode ? 'demo data' : esc(PROVIDERS[DataFeed.provider].label)}</div>
        <div class="rh-value">${FMT.money(m.endValue, 0)}</div>
        <div class="rh-sub">from ${FMT.money(m.startValue, 0)} · <span class="${signClass(m.totalReturn)}">${FMT.signedPct(m.totalReturn)}</span> total</div>
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
  renderDonut(R);
  drawdownChart($('ddChart'), R.bt.dates, m.ddSeries);
  yearBars($('yearChart'), m.yearly);
  renderCorr(R);
}

function statCard(k, v, cls) {
  return `<div class="sc"><div class="sc-k">${k}</div><div class="sc-v ${cls}">${v}</div></div>`;
}

/* "Live quotes" from the most recent closes in the fetched history. */
function renderQuotes(R) {
  const rows = R.holdSyms.map((s, i) => {
    const ser = R.aligned.closes[s];
    const last = ser[ser.length - 1], prev = ser[ser.length - 2];
    const chg = prev ? (last / prev - 1) : 0;
    const dot = SLICE_COLORS[i % SLICE_COLORS.length];
    return `<div class="q-card">
      <div class="q-top"><span class="hold-dot" style="background:${dot}"></span><b>${esc(s)}</b></div>
      <div class="q-price">${FMT.money(last, 2)}</div>
      <div class="q-chg ${signClass(chg)}">${FMT.signedPct(chg)}</div>
    </div>`;
  }).join('');
  $('quotes').innerHTML = rows;
  $('quotesTag').textContent = state.demoMode ? 'demo' : 'latest close';
}

function renderGrowth(R) {
  const series = [{ dates: R.bt.dates, values: R.bt.values, color: 'var(--accent)', label: 'Portfolio' }];
  if (R.benchBt) series.push({ dates: R.benchBt.dates, values: R.benchBt.values, color: 'var(--muted-line)', label: R.bench });
  growthChart($('growthChart'), series, { log: $('logToggle').checked });
  $('growthLegend').innerHTML = series.map(s =>
    `<span class="lg-item"><span class="lg-dash" style="background:${s.color}"></span>${esc(s.label)}</span>`).join('');
}

function renderMetricsTable(R) {
  const m = R.bt.metrics, b = R.benchBt ? R.benchBt.metrics : null;
  const rows = [
    ['Total return', FMT.signedPct(m.totalReturn), b && FMT.signedPct(b.totalReturn)],
    ['CAGR', FMT.signedPct(m.cagr), b && FMT.signedPct(b.cagr)],
    ['Volatility (ann.)', FMT.pct(m.volatility), b && FMT.pct(b.volatility)],
    ['Sharpe ratio', FMT.num(m.sharpe), b && FMT.num(b.sharpe)],
    ['Sortino ratio', FMT.num(m.sortino), b && FMT.num(b.sortino)],
    ['Calmar ratio', FMT.num(m.calmar), b && FMT.num(b.calmar)],
    ['Max drawdown', FMT.pct(m.maxDrawdown), b && FMT.pct(b.maxDrawdown)],
    ['Best year', m.bestYear ? m.bestYear.year + ' · ' + FMT.signedPct(m.bestYear.r, 1) : '—', b && b.bestYear ? b.bestYear.year + ' · ' + FMT.signedPct(b.bestYear.r, 1) : '—'],
    ['Worst year', m.worstYear ? m.worstYear.year + ' · ' + FMT.signedPct(m.worstYear.r, 1) : '—', b && b.worstYear ? b.worstYear.year + ' · ' + FMT.signedPct(b.worstYear.r, 1) : '—'],
    ['Positive months', FMT.pct(m.positiveMonths, 0), b && FMT.pct(b.positiveMonths, 0)],
    ['Monthly VaR 95%', FMT.pct(m.var95), b && FMT.pct(b.var95)],
    ['Monthly CVaR 95%', FMT.pct(m.cvar95), b && FMT.pct(b.cvar95)],
  ];
  if (R.rel && R.rel.beta != null) {
    rows.push(['Beta vs ' + R.bench, FMT.num(R.rel.beta), '1.00']);
    rows.push(['Alpha (ann.)', FMT.signedPct(R.rel.alpha), '—']);
    rows.push(['Correlation vs ' + R.bench, FMT.num(R.rel.correlation), '1.00']);
  }
  const head = `<div class="mt-row mt-head"><span>Metric</span><span>Portfolio</span><span>${R.bench ? esc(R.bench) : ''}</span></div>`;
  $('metricsTable').innerHTML = head + rows.map(r =>
    `<div class="mt-row"><span class="mt-k">${r[0]}</span><span class="mt-v">${r[1]}</span><span class="mt-b">${r[2] || '—'}</span></div>`).join('');
}

function renderDonut(R) {
  const t = R.holds.reduce((s, h) => s + (+h.weight), 0) || 1;
  const slices = R.holds.map((h, i) => ({ label: h.sym, value: +h.weight / t, color: SLICE_COLORS[i % SLICE_COLORS.length] }));
  donut($('donut'), slices);
}

function renderCorr(R) {
  const panel = $('corrPanel');
  if (!R.corr) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  heatmap($('corrChart'), R.corr, R.holdSyms);
}

/* ---------------------------- Monte Carlo ------------------------------ */
function runMonteCarlo() {
  if (!state.last) return;
  const hist = state.last.bt.metrics.monthly;
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
    const i = +inp.dataset.i; state.holdings[i].weight = Math.max(0, +inp.value || 0);
    const tw = totalWeight();
    el.weightTag.textContent = 'weights ' + tw.toFixed(0) + '%';
    el.weightTag.className = 'tag' + (Math.abs(tw - 100) < 0.5 ? ' ok' : (tw > 0 ? ' warn' : ''));
    persist();
  });
  el.holdings.addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (b) removeHolding(+b.dataset.del); });

  $('evenBtn').addEventListener('click', evenWeights);
  $('normBtn').addEventListener('click', normalizeWeights);
  $('clearBtn').addEventListener('click', () => { state.holdings = []; renderHoldings(); });

  $('runBtn').addEventListener('click', analyze);
  ['periodSel', 'benchSel', 'rebalSel', 'rfInput'].forEach(id => $(id).addEventListener('change', persist));
  $('logToggle').addEventListener('change', () => { if (state.last) renderGrowth(state.last); });
  ['mcInitial', 'mcMonthly', 'mcYears', 'mcGoal'].forEach(id => $(id).addEventListener('input', debounce(runMonteCarlo, 250)));

  // settings
  $('settingsBtn').addEventListener('click', () => openSettings());
  el.providerSel.addEventListener('change', () => { DataFeed.setProvider(el.providerSel.value); updateKeyLink(); updateDataMode(); });
  el.apiKey.addEventListener('input', () => { DataFeed.setKey(el.apiKey.value); if (el.apiKey.value.trim()) state.demoMode = false; updateDataMode(); });
  $('demoBtn').addEventListener('click', () => {
    state.demoMode = true; updateDataMode();
    if (!state.holdings.length || state.holdings.every(h => !demoAvailable(h.sym))) {
      state.holdings = [{ sym: 'VTI', weight: 45 }, { sym: 'QQQ', weight: 20 }, { sym: 'BND', weight: 25 }, { sym: 'GLD', weight: 10 }];
      $('benchSel').value = 'SPY';
      renderHoldings();
    }
    openSettings(false);
    analyze();
  });

  // theme
  $('themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_STORE, next); } catch (e) {}
    if (state.last) { renderGrowth(state.last); } // recolor via CSS vars happens automatically
  });
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

init();
