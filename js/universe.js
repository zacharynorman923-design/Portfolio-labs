/* =========================================================================
   Portfolio Labs — investable universe: import, map, probe
   -------------------------------------------------------------------------
   Loads a fund list from CSV, maps each row's Morningstar category onto the
   app's taxonomy, and applies the category exclusions.

   Before committing a large fetch, `probeUniverse` samples a handful of
   tickers spread across the categories and reports exactly which ones the
   data provider can actually return and how far back each goes. A universe of
   several hundred funds costs tens of minutes and most of a day's request
   quota, so it is worth spending ninety seconds to find out whether the
   provider covers institutional mutual fund share classes before spending the
   rest of the day discovering it doesn't.
   ========================================================================= */

/* ------------------------------ CSV parsing ----------------------------- */
/* A real CSV reader: handles quoted fields containing commas and quotes,
   CRLF, and a trailing newline. Fund names routinely contain commas
   ("BlackRock Emerging Markets Fund, Inc."), so splitting on ',' would
   silently corrupt the ticker column. */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = String(text || '').replace(/^﻿/, '');   // strip BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }     // escaped quote
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

/* Header aliases, so an export from Morningstar, a custodian or a hand-built
   sheet all load without the user editing column names first. */
const UNIVERSE_HEADERS = {
  ticker: ['ticker', 'symbol', 'fund ticker', 'identifier'],
  name: ['fund name', 'name', 'fund', 'security name', 'description'],
  category: ['category', 'morningstar category', 'ms category', 'asset class', 'fund category'],
  inception: ['inception', 'inception date', 'start', 'start date', 'first date'],
  expense: ['expense', 'expense ratio', 'net expense ratio', 'er'],
};

function matchHeader(h) {
  const k = String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
  for (const field in UNIVERSE_HEADERS) {
    if (UNIVERSE_HEADERS[field].indexOf(k) !== -1) return field;
  }
  return null;
}

/* Parse a universe file into rows plus a report of what happened. */
function parseUniverse(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { error: 'That file has no data rows.' };

  const header = rows[0].map(matchHeader);
  if (header.indexOf('ticker') === -1) {
    return {
      error: 'No ticker column found. Expected a header called "Ticker" or "Symbol"; got: '
        + rows[0].map(h => '"' + String(h).trim() + '"').join(', '),
    };
  }

  const out = [], seen = {}, unmapped = {};
  let dupes = 0, blank = 0;
  for (let i = 1; i < rows.length; i++) {
    const rec = {};
    header.forEach((f, j) => { if (f) rec[f] = String(rows[i][j] || '').trim(); });
    const sym = (rec.ticker || '').toUpperCase();
    if (!sym) { blank++; continue; }
    if (seen[sym]) { dupes++; continue; }
    seen[sym] = true;

    const sub = rec.category ? subclassFromCategory(rec.category) : null;
    if (rec.category && !sub) unmapped[rec.category] = (unmapped[rec.category] || 0) + 1;
    out.push({
      sym, name: rec.name || sym, category: rec.category || '',
      sub: sub || 'other', mapped: !!sub,
      inception: rec.inception || '', expense: rec.expense || '',
    });
  }
  return { rows: out, unmapped, dupes, blank, columns: header.filter(Boolean) };
}

/* --------------------------- exclusions + stats ------------------------- */
/* `excluded` is a set of subcategory keys. Returns the rows that survive plus
   a per-category tally for the UI. */
function applyUniverseFilter(rows, excluded) {
  const ex = excluded || {};
  const kept = rows.filter(r => !ex[r.sub]);
  const bySub = {};
  rows.forEach(r => {
    if (!bySub[r.sub]) bySub[r.sub] = { key: r.sub, total: 0, kept: 0 };
    bySub[r.sub].total++;
    if (!ex[r.sub]) bySub[r.sub].kept++;
  });
  return { kept, bySub: Object.values(bySub).sort((a, b) => b.total - a.total) };
}

/* ------------------------------- probing -------------------------------- */
/* Pick a spread of tickers rather than the first N, which would all come from
   the same fund family and tell you nothing about the rest. Sampling across
   categories, and across mutual funds versus ETFs, is what makes the answer
   generalize — provider coverage of institutional share classes is usually the
   open question, not coverage of ETFs.

   US mutual fund symbols are five characters ending in X (CBBYX, WIPIX);
   ETFs are one to four characters (SPY, QQQ, ILOW). */
function isMutualFund(sym) { return /^[A-Z]{4}X$/.test(sym); }

function pickProbeSample(rows, n) {
  const want = n || 12;
  const byCat = {};
  rows.forEach(r => { (byCat[r.sub] = byCat[r.sub] || []).push(r); });
  const cats = Object.keys(byCat).sort((a, b) => byCat[b].length - byCat[a].length);

  const picked = [], seen = {};
  const take = (r) => { if (r && !seen[r.sym]) { seen[r.sym] = true; picked.push(r); return true; } return false; };

  /* Reserve slots for each kind. Institutional share classes are the coverage
     risk so they get the larger share, but ETFs must be represented too: if
     they fail as well, the problem is the key or the provider, not mutual fund
     coverage, and that is a completely different fix. */
  const fundSlots = Math.max(1, Math.round(want * 0.65));
  const etfSlots = want - fundSlots;
  let funds = 0, etfs = 0;

  for (const c of cats) {
    if (funds >= fundSlots) break;
    if (take(byCat[c].find(r => isMutualFund(r.sym)))) funds++;
  }
  for (const c of cats) {
    if (etfs >= etfSlots) break;
    if (take(byCat[c].find(r => !isMutualFund(r.sym)))) etfs++;
  }
  // top up from any category if one kind was scarce
  for (const c of cats) { if (picked.length >= want) break; byCat[c].some(take); }
  return picked.slice(0, want);
}

/* Fetch each sample ticker and report what came back. `fetchOne` is supplied
   by the app so this works with whatever provider is configured. */
async function probeUniverse(rows, fetchOne, n, onProgress) {
  const sample = pickProbeSample(rows, n);
  const results = [];
  for (let i = 0; i < sample.length; i++) {
    const r = sample[i];
    if (onProgress) onProgress(i, sample.length, r.sym);
    try {
      const ser = await fetchOne(r.sym);
      if (!ser || !ser.length) throw new Error('empty series');
      results.push({
        sym: r.sym, name: r.name, sub: r.sub, kind: isMutualFund(r.sym) ? 'fund' : 'etf',
        ok: true, start: ser[0].date, end: ser[ser.length - 1].date, points: ser.length,
      });
    } catch (e) {
      results.push({
        sym: r.sym, name: r.name, sub: r.sub, kind: isMutualFund(r.sym) ? 'fund' : 'etf',
        ok: false, error: e.message || 'unavailable',
      });
    }
  }
  return { results, summary: summarizeProbe(results) };
}

/* Turn probe results into the recommendation the user actually needs. */
function summarizeProbe(results) {
  const funds = results.filter(r => r.kind === 'fund');
  const etfs = results.filter(r => r.kind === 'etf');
  const rate = (a) => a.length ? a.filter(r => r.ok).length / a.length : null;
  const oldest = results.filter(r => r.ok).map(r => r.start).sort()[0] || null;
  const newest = results.filter(r => r.ok).map(r => r.start).sort().pop() || null;
  return {
    total: results.length,
    ok: results.filter(r => r.ok).length,
    fundRate: rate(funds), etfRate: rate(etfs),
    fundCount: funds.length, etfCount: etfs.length,
    oldestStart: oldest, newestStart: newest,
  };
}

/* Time and quota a full fetch would cost, at the provider's stated rate. */
function fetchEstimate(count, perMinute) {
  const rpm = perMinute || 8;
  return { requests: count, minutes: Math.ceil(count / rpm), quotaPct: Math.round(count / 800 * 100) };
}
