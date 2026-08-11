/* =========================================================================
   Portfolio Labs — live market-data providers (bring your own key)
   -------------------------------------------------------------------------
   This is a STATIC site: there is no Portfolio Labs backend. Your API key is
   stored only in this browser's localStorage and every request goes directly
   from your browser to the data provider you chose. Nothing is proxied.

   Two providers are supported. Both offer a free key and allow browser
   (CORS) requests:
     • Twelve Data  — recommended. Free tier ~800 req/day, 8 req/min.
                      Good daily history + quotes. Handles crypto (BTC/USD).
     • Alpha Vantage — very common free key, but a low daily request cap.

   Each adapter exposes the same shape:
     daily(symbol)  -> Promise<[{date:'YYYY-MM-DD', close:Number}, ...ascending]>
     quote(symbol)  -> Promise<{price, changePct, name}>
   ========================================================================= */

const KEY_STORE      = 'plabs_apikey_v1';
const PROVIDER_STORE = 'plabs_provider_v1';

const DataFeed = {
  provider: 'twelvedata',
  apiKey: '',

  load() {
    try {
      this.apiKey   = localStorage.getItem(KEY_STORE) || '';
      this.provider = localStorage.getItem(PROVIDER_STORE) || 'twelvedata';
    } catch (e) { /* private mode — just run without persistence */ }
  },
  setKey(k)      { this.apiKey = (k || '').trim(); try { localStorage.setItem(KEY_STORE, this.apiKey); } catch (e) {} },
  setProvider(p) { this.provider = p; try { localStorage.setItem(PROVIDER_STORE, p); } catch (e) {} },
  hasKey()       { return !!this.apiKey; },

  meta() { return PROVIDERS[this.provider] || PROVIDERS.twelvedata; },

  daily(symbol) { return this.meta().daily(symbol, this.apiKey); },
  quote(symbol) { return this.meta().quote(symbol, this.apiKey); },
};

/* Small helper: fetch JSON with a friendly timeout + error surface. */
async function getJSON(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') throw new Error('The data request timed out. Check your connection and retry.');
    throw new Error('Network error reaching the data provider (possibly a CORS or connectivity issue).');
  }
  clearTimeout(t);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('The API key was rejected. Check it in Settings.');
    if (res.status === 429) throw new Error('Rate limit hit. Wait a minute (free tiers cap requests) and retry.');
    throw new Error('Data provider returned an error (' + res.status + ').');
  }
  return res.json();
}

const PROVIDERS = {
  /* ------------------------------ Twelve Data ------------------------------ */
  twelvedata: {
    label: 'Twelve Data',
    signup: 'https://twelvedata.com/pricing',
    async daily(symbol, key) {
      if (!key) throw new Error('Add a Twelve Data API key in Settings.');
      const url = 'https://api.twelvedata.com/time_series'
        + '?symbol=' + encodeURIComponent(symbol)
        + '&interval=1day&outputsize=5000&order=ASC&format=JSON&apikey=' + encodeURIComponent(key);
      const data = await getJSON(url);
      if (data && data.status === 'error') {
        const m = String(data.message || '');
        if (/api key/i.test(m)) throw new Error('The Twelve Data API key was rejected. Check it in Settings.');
        if (/run out|limit|credits/i.test(m)) throw new Error('Twelve Data request limit reached — wait, then retry.');
        if (/not found|symbol/i.test(m)) throw new Error('Symbol "' + symbol + '" was not found on Twelve Data.');
        throw new Error(m || 'Twelve Data could not return "' + symbol + '".');
      }
      const vals = (data && data.values) || [];
      if (!vals.length) throw new Error('No price history returned for "' + symbol + '".');
      return vals
        .map(v => ({ date: v.datetime, close: parseFloat(v.close) }))
        .filter(v => v.date && isFinite(v.close))
        .sort((a, b) => a.date < b.date ? -1 : 1);
    },
    async quote(symbol, key) {
      if (!key) throw new Error('Add a Twelve Data API key in Settings.');
      const url = 'https://api.twelvedata.com/quote?symbol=' + encodeURIComponent(symbol)
        + '&apikey=' + encodeURIComponent(key);
      const d = await getJSON(url);
      if (d && d.status === 'error') throw new Error(d.message || 'Quote unavailable for "' + symbol + '".');
      const price = parseFloat(d.close);
      let changePct = parseFloat(d.percent_change);
      if (!isFinite(changePct) && isFinite(price) && isFinite(parseFloat(d.previous_close))) {
        const pc = parseFloat(d.previous_close);
        changePct = pc ? (price - pc) / pc * 100 : 0;
      }
      return { price, changePct: isFinite(changePct) ? changePct : 0, name: d.name || '' };
    },
  },

  /* ------------------------------ Alpha Vantage ---------------------------- */
  alphavantage: {
    label: 'Alpha Vantage',
    signup: 'https://www.alphavantage.co/support/#api-key',
    async daily(symbol, key) {
      if (!key) throw new Error('Add an Alpha Vantage API key in Settings.');
      const url = 'https://www.alphavantage.co/query?function=TIME_SERIES_DAILY'
        + '&symbol=' + encodeURIComponent(symbol)
        + '&outputsize=full&apikey=' + encodeURIComponent(key);
      const data = await getJSON(url);
      if (data['Error Message']) throw new Error('Symbol "' + symbol + '" was not found on Alpha Vantage.');
      if (data['Note'] || data['Information']) {
        throw new Error('Alpha Vantage rate limit reached (free keys are capped per day). Try Twelve Data instead.');
      }
      const series = data['Time Series (Daily)'];
      if (!series) throw new Error('No price history returned for "' + symbol + '".');
      return Object.keys(series)
        .map(date => ({ date, close: parseFloat(series[date]['4. close']) }))
        .filter(v => isFinite(v.close))
        .sort((a, b) => a.date < b.date ? -1 : 1);
    },
    async quote(symbol, key) {
      if (!key) throw new Error('Add an Alpha Vantage API key in Settings.');
      const url = 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol='
        + encodeURIComponent(symbol) + '&apikey=' + encodeURIComponent(key);
      const d = await getJSON(url);
      const q = d['Global Quote'] || {};
      if (d['Note'] || d['Information']) throw new Error('Alpha Vantage rate limit reached.');
      const price = parseFloat(q['05. price']);
      const changePct = parseFloat(String(q['10. change percent'] || '').replace('%', ''));
      return { price, changePct: isFinite(changePct) ? changePct : 0, name: '' };
    },
  },
};

DataFeed.load();
