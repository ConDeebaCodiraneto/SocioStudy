/* ============================================================
   config.js — state management (teacher app only)
   All persistence goes through SafeStorage (see shared.js):
   localStorage when available, in-memory fallback otherwise.
   Answers collected through the QR questionnaire live on the
   server and are pulled into Store.responses by sync.js.
   ============================================================ */

const Store = {
  KEYS: {
    config: 'sociostudy_config',
    responses: 'sociostudy_responses',
    anon: 'sociostudy_anon',
  },
  config: null,
  responses: [],

  defaultConfig() {
    return {
      className: '',
      grade: '',
      schoolYear: '',
      roster: [],       // [{id, name, gender: 'boy'|'girl'|'other', age}]
      questions: [],    // [{id, text, type: 'positive'|'negative', maxChoices}]
      options: {
        useAgeBands: true,
        decimals: 2,
      },
    };
  },

  load() {
    try {
      const raw = SafeStorage.get(this.KEYS.config);
      this.config = raw ? JSON.parse(raw) : this.defaultConfig();
    } catch (e) { this.config = this.defaultConfig(); }
    if (!this.config || typeof this.config !== 'object') this.config = this.defaultConfig();
    // Merge options so configs saved by older versions keep new defaults.
    this.config.options = Object.assign(this.defaultConfig().options, this.config.options || {});
    if (!Array.isArray(this.config.roster)) this.config.roster = [];
    if (!Array.isArray(this.config.questions)) this.config.questions = [];

    let raw = null;
    try {
      raw = SafeStorage.get(this.KEYS.responses);
      this.responses = raw ? JSON.parse(raw) : [];
    } catch (e) { this.responses = []; }
    if (!Array.isArray(this.responses)) this.responses = [];

    // Migration: stable question ids, and answers tied to them.
    const idsAdded = this.ensureQuestionIds(this.config);
    const before = JSON.stringify(this.responses);
    this.responses = this.responses.map(r => this.upgradeResponse(this.sanitizeResponse(r))).filter(Boolean);
    if (idsAdded) this.saveConfig();
    if (JSON.stringify(this.responses) !== before) this.saveResponses();
  },

  /** Give every question a stable id (answers are matched by id, never by position). */
  ensureQuestionIds(cfg) {
    let changed = false;
    (cfg.questions || []).forEach(q => { if (!q.id) { q.id = uid('q'); changed = true; } });
    return changed;
  },

  /** Normalise one response; returns null when it is unusable. */
  sanitizeResponse(r) {
    if (!r || typeof r !== 'object' || typeof r.respondent_id !== 'string' || !r.respondent_id) return null;
    const ts = new Date(r.timestamp);
    const answers = (Array.isArray(r.answers) ? r.answers : [])
      .filter(a => a && typeof a === 'object')
      .map(a => ({
        question_id: typeof a.question_id === 'string' ? a.question_id : undefined,
        question_index: Number.isInteger(a.question_index) ? a.question_index : undefined,
        question_text: typeof a.question_text === 'string' ? a.question_text : '',
        question_type: a.question_type === 'negative' ? 'negative' : a.question_type === 'positive' ? 'positive' : undefined,
        chosen_ids: Array.isArray(a.chosen_ids) ? Array.from(new Set(a.chosen_ids.filter(x => typeof x === 'string'))) : [],
      }));
    return { respondent_id: r.respondent_id, timestamp: isNaN(ts.getTime()) ? new Date().toISOString() : ts.toISOString(), answers };
  },

  /** Older exports only know the question position — tie those answers to the question id. */
  upgradeResponse(r) {
    if (!r) return r;
    r.answers.forEach(a => {
      if (!a.question_id && a.question_index != null) {
        const q = this.config.questions[a.question_index];
        if (q) {
          a.question_id = q.id;
          if (!a.question_type) a.question_type = q.type;
        }
      }
    });
    return r;
  },

  /** Merge a list of responses (import or server): newer answer per student wins. */
  mergeResponses(list) {
    let added = 0, updated = 0;
    (Array.isArray(list) ? list : []).forEach(raw => {
      const r = this.upgradeResponse(this.sanitizeResponse(raw));
      if (!r) return;
      const i = this.responses.findIndex(x => x.respondent_id === r.respondent_id);
      if (i < 0) { this.responses.push(r); added++; }
      else if (new Date(r.timestamp) > new Date(this.responses[i].timestamp)) { this.responses[i] = r; updated++; }
    });
    if (added || updated) this.saveResponses();
    return { added, updated };
  },

  saveConfig() {
    SafeStorage.set(this.KEYS.config, JSON.stringify(this.config));
    if (typeof Sync !== 'undefined') Sync.schedulePush();
  },

  saveResponses() {
    SafeStorage.set(this.KEYS.responses, JSON.stringify(this.responses));
  },

  /** Add or replace a response (local only — used by the test-response feature). */
  upsertResponse(response) {
    const i = this.responses.findIndex(r => r.respondent_id === response.respondent_id);
    if (i >= 0) this.responses[i] = response;
    else this.responses.push(response);
    this.saveResponses();
  },

  removeResponse(respondentId) {
    this.responses = this.responses.filter(r => r.respondent_id !== respondentId);
    this.saveResponses();
  },

  reset() {
    SafeStorage.remove(this.KEYS.config);
    SafeStorage.remove(this.KEYS.responses);
    this.config = this.defaultConfig();
    this.responses = [];
  },

  /** Whether exports replace the children's names with codes. */
  get exportAnon() { return SafeStorage.get(this.KEYS.anon) === '1'; },
  set exportAnon(v) { if (v) SafeStorage.set(this.KEYS.anon, '1'); else SafeStorage.remove(this.KEYS.anon); },

  /** Pick up changes made in another tab of the same browser. */
  watch() {
    window.addEventListener('storage', e => {
      if (e.key !== null && e.key !== this.KEYS.config && e.key !== this.KEYS.responses) return;
      this.load();
      if (typeof App !== 'undefined') App.refresh();
    });
  },
};

/* ---------- Small shared helpers ---------- */

/** Unique id (no crypto dependency). */
function uid(prefix) {
  return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9);
}

/* ============================================================
   DD — custom dropdown component.
   Replaces native <select> everywhere: native selects are blocked
   or disabled inside some sandboxed iframes (embedded previews),
   and this component works identically in every environment.
   API:
     DD.html(key, options, value, attrs)  -> markup (options: [{value,label}])
     DD.setValue(ddEl, value)             -> update without firing the event
     'ddchange' event (bubbles) fires on the .dd element on pick;
     the new value is in ddEl.dataset.value.
   ============================================================ */
const DD = {
  openEl: null,

  html(key, options, value, attrs) {
    const val = String(value == null ? '' : value);
    const cur = options.find(o => String(o.value) === val);
    const opts = options.map(o => {
      const v = String(o.value);
      return `<div class="dd-opt" role="option" data-v="${esc(v)}" aria-selected="${v === val}">${esc(o.label)}</div>`;
    }).join('');
    return `<div class="dd" data-key="${esc(key)}" data-value="${esc(val)}"${attrs ? ' ' + attrs : ''}>
      <button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false">
        <span class="dd-txt">${esc(cur ? cur.label : '')}</span><span class="dd-caret" aria-hidden="true">▾</span>
      </button>
      <div class="dd-menu" role="listbox" hidden>${opts}</div>
    </div>`;
  },

  /** Update the displayed value without firing 'ddchange'. */
  setValue(dd, value) {
    if (!dd || !dd.classList.contains('dd')) return;
    const val = String(value == null ? '' : value);
    dd.dataset.value = val;
    const opts = Array.from(dd.querySelectorAll('.dd-opt'));
    const cur = opts.find(o => o.dataset.v === val);
    dd.querySelector('.dd-txt').textContent = cur ? cur.textContent : '';
    opts.forEach(o => o.setAttribute('aria-selected', String(o.dataset.v === val)));
  },

  /** Global wiring — call once at boot. */
  init() {
    document.addEventListener('click', e => {
      const opt = e.target.closest('.dd-opt');
      if (opt) { this.pick(opt); return; }
      const btn = e.target.closest('.dd-btn');
      if (btn) { this.toggle(btn.parentElement); return; }
      this.close();
    });
    document.addEventListener('keydown', e => {
      if (!this.openEl) return;
      const menu = this.openEl.querySelector('.dd-menu');
      const opts = Array.from(menu.querySelectorAll('.dd-opt'));
      let i = opts.findIndex(o => o.classList.contains('hover'));
      if (e.key === 'Escape') { this.close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (i >= 0) opts[i].classList.remove('hover');
        i = e.key === 'ArrowDown' ? (i + 1) % opts.length : (i - 1 + opts.length) % opts.length;
        opts[i].classList.add('hover');
        opts[i].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && i >= 0) {
        e.preventDefault();
        this.pick(opts[i]);
      }
    });
    window.addEventListener('resize', () => this.close());
    window.addEventListener('scroll', e => {
      if (!this.openEl) return;
      // keep the menu open while scrolling inside it
      if (e.target && e.target.closest && e.target.closest('.dd-menu')) return;
      // Only close if the anchor button actually moved on screen —
      // ignores trailing events from smooth-scroll settling.
      const btn = this.openEl.querySelector('.dd-btn');
      if (btn && Math.abs(btn.getBoundingClientRect().top - this._anchorTop) < 2) return;
      this.close();
    }, true);
  },

  toggle(dd) {
    if (this.openEl === dd) { this.close(); return; }
    this.close();
    const menu = dd.querySelector('.dd-menu');
    const r = dd.querySelector('.dd-btn').getBoundingClientRect();
    menu.hidden = false;
    menu.style.minWidth = r.width + 'px';
    menu.style.left = r.left + 'px';
    menu.style.top = (r.bottom + 4) + 'px';
    if (r.bottom + menu.offsetHeight + 8 > window.innerHeight)
      menu.style.top = (r.top - menu.offsetHeight - 4) + 'px';
    dd.querySelector('.dd-btn').setAttribute('aria-expanded', 'true');
    this.openEl = dd;
    this._anchorTop = r.top;
  },

  close() {
    if (!this.openEl) return;
    const dd = this.openEl;
    dd.querySelector('.dd-menu').hidden = true;
    dd.querySelector('.dd-btn').setAttribute('aria-expanded', 'false');
    dd.querySelectorAll('.dd-opt.hover').forEach(o => o.classList.remove('hover'));
    this.openEl = null;
  },

  pick(opt) {
    const dd = opt.closest('.dd');
    if (!dd) return;
    this.setValue(dd, opt.dataset.v);
    this.close();
    dd.dispatchEvent(new Event('ddchange', { bubbles: true }));
  },
};

/* ============================================================
   uiConfirm — in-app confirmation dialog.
   window.confirm() is silently blocked (always returns false)
   inside sandboxed iframes such as embedded previews, which made
   destructive actions look dead. This works everywhere.
   ============================================================ */
function uiConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <p class="modal-msg"></p>
      <div class="row-actions" style="justify-content:flex-end; margin:0">
        <button type="button" class="btn" data-mc="no"></button>
        <button type="button" class="btn danger" data-mc="yes"></button>
      </div>
    </div>`;
    overlay.querySelector('.modal-msg').textContent = String(message);
    overlay.querySelector('[data-mc="no"]').textContent = t('ui.cancel');
    overlay.querySelector('[data-mc="yes"]').textContent = t('ui.confirm');
    document.body.appendChild(overlay);
    const done = v => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    overlay.querySelector('[data-mc="yes"]').addEventListener('click', () => done(true));
    overlay.querySelector('[data-mc="no"]').addEventListener('click', () => done(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) done(false); });
    const onKey = e => {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter') done(true);
    };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('[data-mc="yes"]').focus();
  });
}

/** Standard empty-state block used by every view. Buttons use data-goto / data-action (wired in app.js). */
function emptyState(msg, actionHtml) {
  return `<div class="empty-state">
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" style="margin:0 auto var(--space-4); opacity:.55">
      <circle cx="7" cy="7" r="2.4"/><circle cx="17" cy="8" r="2.4"/><circle cx="12" cy="17" r="2.4"/>
      <path d="M9 7.6l6 .7M7.9 9l3.4 6M15.9 9.8l-3 5.7"/>
    </svg>
    <h3>${esc(t('emptyTitle'))}</h3><p>${esc(msg)}</p>
    ${actionHtml ? `<div class="row-actions" style="justify-content:center">${actionHtml}</div>` : ''}
  </div>`;
}

/* ---------- Roster CSV ---------- */

/** Split one CSV line, honouring "quoted, values". */
function splitCSVLine(line, delim) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Excel in many locales (Bulgarian included) saves CSV with semicolons. */
function detectDelimiter(line) {
  const count = d => splitCSVLine(line, d).length;
  let best = ',', n = count(',');
  [';', '\t'].forEach(d => { if (count(d) > n) { best = d; n = count(d); } });
  return best;
}

/**
 * Parse roster CSV text: name, gender, age (header optional, delimiter auto-detected).
 * Returns { rows, skipped, unknownGender, badAge }.
 */
function parseRosterCSV(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const res = { rows: [], skipped: 0, unknownGender: 0, badAge: 0 };
  if (!lines.length) return res;
  const delim = detectDelimiter(lines[0]);
  lines.forEach((line, i) => {
    const parts = splitCSVLine(line, delim).map(p => p.trim());
    // Skip an optional header row ("name,gender,age" / "име;пол;възраст").
    if (i === 0 && /^(name|names|име|ученик)$/i.test(parts[0]) && !/^\d+$/.test(parts[2] || '')) return;
    if (!parts[0]) { res.skipped++; return; }
    const g = parseGender(parts[1]);
    if (!g.known) res.unknownGender++;
    let age = null;
    if (parts[2]) {
      const n = parseInt(parts[2], 10);
      if (n >= 3 && n <= 19) age = n; else res.badAge++;
    }
    res.rows.push({ name: parts[0], gender: g.gender, age });
  });
  return res;
}

/** Accepts English and Bulgarian gender words. known=false when the word is not recognised. */
function parseGender(raw) {
  const g = String(raw || '').trim().toLowerCase();
  if (!g) return { gender: 'other', known: true };
  if (['girl', 'female', 'f', 'момиче', 'момичета', 'ж', 'жена'].includes(g) || g.startsWith('момич')) return { gender: 'girl', known: true };
  if (['boy', 'male', 'm', 'момче', 'момчета', 'м', 'мъж'].includes(g) || g.startsWith('момч')) return { gender: 'boy', known: true };
  if (['other', 'друго', 'o', 'о', '-'].includes(g)) return { gender: 'other', known: true };
  return { gender: 'other', known: false };
}

function normalizeGender(g) { return parseGender(g).gender; }
