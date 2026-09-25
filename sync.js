/* ============================================================
   sync.js — teacher app ↔ SocioStudy server
   - detect(): is the server there? (not when the page is opened
     from a file or a static host — everything else still works)
   - create():  one questionnaire session per class → QR link
   - polling:   pulls new answers into Store.responses
   - destroy(): deletes the session on the server (QR link,
     roster and answers). If the server cannot be reached the
     deletion is queued and retried, and the server also removes
     idle sessions by itself.
   The admin key that controls a session lives only in this
   browser (never in exports).
   ============================================================ */

const Sync = {
  KEY: 'sociostudy_session',
  PENDING: 'sociostudy_pending_delete',
  POLL_MS: 8000,

  session: null,      // { sid, adminKey, base, lang, closed, expiresAt, ttlDays }
  available: null,    // null = unknown, true / false after detect()
  info: null,         // server info from /api/info
  listeners: [],
  _poll: null,
  _push: null,
  _pulling: false,
  _lastFail: 0,

  /* ---------- lifecycle ---------- */

  async init() {
    this.loadSession();
    window.addEventListener('storage', e => {
      if (e.key !== this.KEY && e.key !== null) return;
      this.loadSession();
      this.emit({ session: true });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.active) this.pull(); });
    await this.detect();
    this.retryPending();
    if (this.active) this.startPolling();
  },

  get active() { return !!(this.session && this.available); },

  loadSession() {
    try { this.session = JSON.parse(SafeStorage.get(this.KEY) || 'null'); } catch (e) { this.session = null; }
    if (this.session && !(this.session.sid && this.session.adminKey)) this.session = null;
  },

  saveSession() {
    if (this.session) SafeStorage.set(this.KEY, JSON.stringify(this.session));
    else SafeStorage.remove(this.KEY);
  },

  on(fn) { this.listeners.push(fn); },
  emit(info) { this.listeners.forEach(fn => { try { fn(info); } catch (e) { console.error(e); } }); },

  /* ---------- HTTP ---------- */

  async request(method, path, o) {
    o = o || {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeout || 12000);
    const headers = {};
    if (o.body) headers['Content-Type'] = 'application/json';
    if (o.admin) headers['X-Admin-Key'] = o.admin;
    try {
      const r = await fetch(path, {
        method, headers, cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal,
        body: o.body ? JSON.stringify(o.body) : undefined,
      });
      // The teacher's login session expired (or was never there) — send them to
      // /login rather than let the page carry on with data it can no longer fetch.
      if (r.status === 401) { location.href = '/login'; return { status: 401, ok: false, json: null }; }
      let json = null;
      try { json = await r.json(); } catch (e) { /* no body */ }
      return { status: r.status, ok: r.ok, json };
    } catch (e) {
      return { status: 0, ok: false, json: null };
    } finally {
      clearTimeout(timer);
    }
  },

  /** Is the SocioStudy server behind this page? */
  async detect() {
    if (location.protocol === 'file:') { this.available = false; this.info = null; return false; }
    const r = await this.request('GET', '/api/info', { timeout: 5000 });
    this.available = !!(r.ok && r.json && r.json.app === 'sociostudy');
    this.info = this.available ? r.json : null;
    return this.available;
  },

  /* ---------- what gets sent ---------- */

  /** Only what students need: names and questions (no gender, age, class name). */
  payload() {
    const c = Store.config;
    return {
      roster: c.roster.map(k => ({ id: k.id, name: k.name.trim() })),
      questions: c.questions.map(q => ({ id: q.id, text: q.text.trim(), type: q.type, maxChoices: q.maxChoices })),
    };
  },

  readiness() {
    const c = Store.config;
    const ok = c.roster.length >= 2 && c.roster.every(k => k.name.trim()) &&
      c.questions.length >= 1 && c.questions.every(q => q.text.trim());
    return { ok };
  },

  /** Address phones should open: public URL, this page's origin, or the computer's network address. */
  suggestBase() {
    if (this.info && this.info.publicUrl) return this.info.publicUrl;
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') {
      return (this.info && this.info.lan && this.info.lan[0]) || location.origin;
    }
    return location.origin;
  },

  url() {
    return this.session ? `${this.session.base.replace(/\/+$/, '')}/k/${this.session.sid}` : '';
  },

  /* ---------- session ---------- */

  async create(base, lang) {
    if (!this.available) return { ok: false, error: 'server' };
    const r = await this.request('POST', '/api/sessions', { body: Object.assign({ lang }, this.payload()) });
    if (r.status !== 201 || !r.json) return { ok: false, error: r.status === 0 ? 'server' : 'rejected' };
    this.session = {
      sid: r.json.sid, adminKey: r.json.adminKey, base, lang,
      closed: false, expiresAt: r.json.expiresAt, ttlDays: r.json.ttlDays,
    };
    this.saveSession();
    this.startPolling();
    return { ok: true };
  },

  /** Keep the server copy of names/questions in step with the teacher's edits. */
  schedulePush() {
    if (!this.session || !this.available) return;
    clearTimeout(this._push);
    this._push = setTimeout(() => this.push(), 1200);
  },

  async push() {
    const s = this.session;
    if (!s || !this.readiness().ok) return; // never send half-edited data
    const r = await this.request('PUT', `/api/s/${s.sid}`, { body: this.payload(), admin: s.adminKey });
    if (r.status === 404) return this.gone();
    if (!r.ok) this.failToast();
  },

  async setClosed(closed) {
    const s = this.session; if (!s) return false;
    const r = await this.request('PUT', `/api/s/${s.sid}`, { body: { closed }, admin: s.adminKey });
    if (r.status === 404) { this.gone(); return false; }
    if (!r.ok) { this.failToast(); return false; }
    s.closed = closed; this.saveSession();
    return true;
  },

  async setLang(lang) {
    const s = this.session; if (!s) return false;
    const r = await this.request('PUT', `/api/s/${s.sid}`, { body: { lang }, admin: s.adminKey });
    if (r.status === 404) { this.gone(); return false; }
    if (!r.ok) { this.failToast(); return false; }
    s.lang = lang; this.saveSession();
    return true;
  },

  failToast() {
    if (Date.now() - this._lastFail < 60000) return;
    this._lastFail = Date.now();
    toast(t('qr.syncFail'));
  },

  /* ---------- answers ---------- */

  startPolling() {
    this.stopPolling();
    this.pull();
    this._poll = setInterval(() => {
      if (document.hidden) return;
      if (this.active) this.pull();
      this.retryPending();
    }, this.POLL_MS);
  },

  stopPolling() { clearInterval(this._poll); this._poll = null; },

  /** Fetch answers from the server and merge them locally. Returns the number of new/updated answers. */
  async pull() {
    const s = this.session;
    if (!s || !this.available || this._pulling) return 0;
    this._pulling = true;
    try {
      const r = await this.request('GET', `/api/s/${s.sid}/responses`, { admin: s.adminKey });
      if (r.status === 404) { this.gone(); return 0; }
      if (!r.ok || !r.json) return 0;
      s.closed = !!r.json.closed;
      s.expiresAt = r.json.expiresAt;
      this.saveSession();
      const res = Store.mergeResponses(r.json.responses);
      const n = res.added + res.updated;
      this.emit({ changed: n > 0, count: n });
      return n;
    } finally {
      this._pulling = false;
    }
  },

  /** Let one student answer again (removes the answer on the server first). */
  async deleteResponse(rid) {
    const s = this.session;
    if (!s || !this.available) return true;
    const r = await this.request('DELETE', `/api/s/${s.sid}/responses/${encodeURIComponent(rid)}`, { admin: s.adminKey });
    return r.ok || r.status === 404;
  },

  /** The server no longer has this session (expired or deleted elsewhere). */
  gone() {
    this.session = null;
    this.saveSession();
    this.stopPolling();
    toast(t('qr.expired'), 7000);
    this.emit({ gone: true });
  },

  /* ---------- deletion ---------- */

  /**
   * Delete the QR link and everything stored online. The local copy of the
   * session is forgotten immediately; if the server is unreachable the
   * deletion is queued and retried until it succeeds.
   * Resolves true when the server confirmed the deletion.
   */
  async destroy() {
    const s = this.session;
    clearTimeout(this._push);
    this.session = null;
    this.saveSession();
    this.stopPolling();
    if (!s) return true;
    const r = await this.request('DELETE', `/api/s/${s.sid}`, { admin: s.adminKey });
    if (r.ok || r.status === 404) return true;
    const list = this.loadPending();
    list.push({ sid: s.sid, adminKey: s.adminKey });
    this.savePending(list);
    return false;
  },

  loadPending() {
    try { const v = JSON.parse(SafeStorage.get(this.PENDING) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  },
  savePending(list) {
    if (list.length) SafeStorage.set(this.PENDING, JSON.stringify(list));
    else SafeStorage.remove(this.PENDING);
  },

  async retryPending() {
    if (!this.available) return;
    const list = this.loadPending();
    if (!list.length) return;
    const left = [];
    for (const p of list) {
      const r = await this.request('DELETE', `/api/s/${p.sid}`, { admin: p.adminKey });
      if (!(r.ok || r.status === 404)) left.push(p);
    }
    this.savePending(left);
  },
};
