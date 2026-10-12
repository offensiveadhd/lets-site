/**
 * lets-client.js — LIP v1 browser transport for uniques.
 *
 * Zero dependencies. Served by the lets host at /sdk/lets-client.js.
 *
 *   import { Lets } from '/sdk/lets-client.js';
 *   const lets = Lets.connect({ unique: 'graph', version: '0.1.0', caps: ['entity','chat'] });
 *   lets.on('graph.load', (data, msg) => { ... });     // a command from Claude
 *   lets.on('*', (data, msg) => { ... });              // every command
 *   lets.emit('graph.node.select', { ids });           // an event to Claude (batched, ~50 ms)
 *   lets.emitNow('lip.ready', {...});                  // immediate
 *   await lets.upload(blob, { source: 'paste' });      // -> media.image event, returns {path,...}
 *   lets.status  // 'connecting' | 'open' | 'closed'
 *
 * The window id and token come from the URL: `?w=<windowId>&t=<token>` or the
 * hash `#w=…&t=…` (the host opens windows with the hash form, which browsers do
 * not send to the server). Both are read once, kept in sessionStorage for the
 * tab's lifetime (so reloads reconnect) and removed from the visible URL. The
 * SSE stream has to carry the token as a query parameter (EventSource cannot
 * set headers); the host redacts it from its logs.
 */

const LIP = 1;

function rid(prefix) {
  // time-sortable id: 10 base36 time chars + 10 random
  const t = Date.now().toString(36).toUpperCase().padStart(10, '0');
  let r = '';
  const a = new Uint8Array(10);
  (globalThis.crypto || { getRandomValues: (x) => x.map(() => (Math.random() * 256) | 0) }).getRandomValues(a);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (const b of a) r += alphabet[b % 36];
  return `${prefix}_${t}${r}`;
}

function readAuth() {
  const out = { w: null, t: null };
  try {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const q = new URLSearchParams(location.search);
    out.w = h.get('w') || q.get('w') || sessionStorage.getItem('lets.w');
    out.t = h.get('t') || q.get('t') || sessionStorage.getItem('lets.t');
    if (out.w) sessionStorage.setItem('lets.w', out.w);
    if (out.t) sessionStorage.setItem('lets.t', out.t);
    if (h.has('t') || q.has('t')) {
      const clean = location.pathname + (q.has('t') ? '' : location.search);
      history.replaceState(null, '', clean);
    }
  } catch { /* non-browser */ }
  return out;
}

export class Lets {
  static connect(opts = {}) {
    const l = new Lets(opts);
    l.open();
    return l;
  }

  constructor(opts = {}) {
    const auth = readAuth();
    this.unique = opts.unique || document.body?.dataset?.unique || 'unknown';
    this.version = opts.version || '0.0.0';
    this.caps = opts.caps || [];
    this.windowId = opts.windowId || auth.w || rid('w').slice(2, 12);
    this.token = opts.token || auth.t || '';
    this.base = opts.base || '';
    this.status = 'connecting';
    this._handlers = new Map();
    this._statusHandlers = new Set();
    this._queue = [];
    this._flushTimer = null;
    this._es = null;
    this._backoff = 500;
    this._closed = false;
    this.from = `unique:${this.unique}#${this.windowId}`;
    this.hello = null;
  }

  // ---- lifecycle -------------------------------------------------------

  open() {
    if (this._closed) return;
    const url = `${this.base}/lip/stream?w=${encodeURIComponent(this.windowId)}&u=${encodeURIComponent(this.unique)}&t=${encodeURIComponent(this.token)}`;
    const es = new EventSource(url);
    this._es = es;
    es.onopen = () => {
      this._backoff = 500;
      this._setStatus('open');
      this.emitNow('lip.ready', {
        unique: this.unique,
        version: this.version,
        caps: this.caps,
        viewport: { w: innerWidth || document.documentElement.clientWidth, h: innerHeight || document.documentElement.clientHeight },
        ua: navigator.userAgent.slice(0, 80),
      });
    };
    es.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const list = Array.isArray(msg) ? msg : [msg];
      for (const m of list) this._dispatch(m);
    };
    es.onerror = () => {
      es.close();
      this._setStatus('closed');
      if (this._closed) return;
      const wait = this._backoff;
      this._backoff = Math.min(this._backoff * 2, 10000);
      setTimeout(() => this.open(), wait);
    };
    addEventListener('beforeunload', () => {
      try { this._flush(true); } catch { /* ignore */ }
    });
    addEventListener('visibilitychange', () => {
      this.emit(document.hidden ? 'session.blur' : 'session.focus', {});
    });
  }

  close() {
    this._closed = true;
    this._es?.close();
    this._setStatus('closed');
  }

  onStatus(fn) { this._statusHandlers.add(fn); return () => this._statusHandlers.delete(fn); }
  _setStatus(s) { if (this.status !== s) { this.status = s; for (const f of this._statusHandlers) f(s); } }

  // ---- commands in ------------------------------------------------------

  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this._handlers.get(type)?.delete(fn);
  }

  _dispatch(m) {
    if (!m || m.lip !== LIP) {
      if (m?.id) this.emitNow('lip.error', { code: 'unsupported', message: 'lip major', re: m.id });
      return;
    }
    if (m.type === 'lip.hello') this.hello = m.data;
    if (m.type === 'lip.ping') { this.emitNow('lip.pong', {}, { re: m.id }); return; }
    const handled = [];
    for (const key of [m.type, m.type.split('.')[0] + '.*', '*']) {
      const set = this._handlers.get(key);
      if (set) for (const fn of set) handled.push(this._safe(fn, m));
    }
    if (m.ack) {
      Promise.all(handled).then(
        () => this.emitNow('lip.ack', { ok: true }, { re: m.id }),
        (err) => this.emitNow('lip.ack', { ok: false, error: String(err?.message || err) }, { re: m.id }),
      );
    }
  }

  async _safe(fn, m) { return fn(m.data, m); }

  // ---- events out ---------------------------------------------------------

  envelope(type, data, extra = {}) {
    return { lip: LIP, id: rid('ev'), ts: Date.now(), dir: 'up', from: this.from, type, data, ...extra };
  }

  emit(type, data = {}, extra) {
    this._queue.push(this.envelope(type, data, extra));
    if (!this._flushTimer) this._flushTimer = setTimeout(() => this._flush(), 50);
  }

  emitNow(type, data = {}, extra) {
    this._queue.push(this.envelope(type, data, extra));
    this._flush();
  }

  _flush(sync = false) {
    clearTimeout(this._flushTimer);
    this._flushTimer = null;
    if (!this._queue.length) return;
    const batch = this._queue.splice(0, this._queue.length);
    const body = JSON.stringify(batch);
    const url = `${this.base}/lip/event?w=${encodeURIComponent(this.windowId)}`;
    if (sync && navigator.sendBeacon) {
      navigator.sendBeacon(`${url}&t=${encodeURIComponent(this.token)}`, new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lets-token': this.token },
      body,
      keepalive: true,
    }).catch(() => { this._queue.unshift(...batch); });
  }

  // ---- blobs ----------------------------------------------------------------

  /**
   * Upload a Blob/File. The host stores it and emits `media.image` (or
   * `media.file`) on your behalf. Resolves {path, w, h, bytes, mime}.
   */
  async upload(blob, { source = 'file', componentId = '', name = '' } = {}) {
    const q = new URLSearchParams({ w: this.windowId, source, component: componentId, name });
    const res = await fetch(`${this.base}/lip/upload?${q}`, {
      method: 'POST',
      headers: { 'content-type': blob.type || 'application/octet-stream', 'x-lets-token': this.token },
      body: blob,
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    return res.json();
  }

  /** Fetch a host-side JSON resource (e.g. /lip/persona). */
  async get(path) {
    const res = await fetch(`${this.base}${path}`, { headers: { 'x-lets-token': this.token } });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }
}

export default Lets;
