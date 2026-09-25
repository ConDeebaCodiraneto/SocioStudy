/* ============================================================
   app.js — navigation, setup view, data management, demo data
   All strings are localized (i18n.js); the demo class follows
   the active language (Bulgarian names/questions by default).
   This is the TEACHER app. Students never load this file — they
   only get kid.html (see server.js).
   ============================================================ */

const App = {
  VIEWS: ['setup', 'qr', 'table', 'analysis', 'charts', 'sociogram', 'data'],
  current: 'setup',

  init() {
    Store.load();
    I18N.init();
    I18N.applyStatic();
    DD.init();
    Store.watch();
    this.bindNav();
    this.bindGlobalClicks();
    window.addEventListener('hashchange', () => this.route());
    if (!location.hash || !this.VIEWS.includes(location.hash.slice(1))) history.replaceState(null, '', '#setup');
    initTheme();
    document.getElementById('langToggle').addEventListener('click', () =>
      I18N.setLang(I18N.lang === 'bg' ? 'en' : 'bg'));
    if (!SafeStorage.ok) document.getElementById('storageNote').hidden = false;

    Sync.on(info => this.onSync(info));
    this.route();
    // Find out whether the server is there, then redraw (the QR tab depends on it).
    Sync.init().then(() => this.refresh());
  },

  bindNav() {
    document.querySelectorAll('#mainNav .tab').forEach(btn => {
      btn.addEventListener('click', () => { location.hash = '#' + btn.dataset.view; });
    });
  },

  /** Buttons inside generated views use data attributes instead of inline handlers. */
  bindGlobalClicks() {
    document.addEventListener('click', e => {
      const go = e.target.closest('[data-goto]');
      if (go) { location.hash = '#' + go.dataset.goto; return; }
      if (e.target.closest('[data-action="load-demo"]')) Demo.load();
    });
  },

  route() {
    const h = (location.hash || '#setup').slice(1);
    document.querySelectorAll('#mainNav .tab').forEach(b => b.classList.toggle('active', b.dataset.view === h));
    this.VIEWS.forEach(v => document.getElementById('view-' + v).classList.toggle('active', v === h));
    if (this.VIEWS.includes(h)) {
      this.current = h;
      this.renderView(h);
      window.scrollTo({ top: 0 });
    } else {
      location.hash = '#setup';
    }
  },

  renderView(v) {
    const el = document.getElementById('view-' + v);
    if (v === 'setup') renderSetup(el);
    else if (v === 'qr') QRView.render(el);
    else if (v === 'table') Tables.renderView(el);
    else if (v === 'analysis') Analysis.renderView(el);
    else if (v === 'charts') Charts.renderView(el);
    else if (v === 'sociogram') Sociogram.renderView(el);
    else if (v === 'data') renderDataView(el);
  },

  /** Re-render whatever the user is looking at (after data changes). */
  refresh() {
    if (this.VIEWS.includes(this.current)) this.renderView(this.current);
  },

  /** News from the server connection (new answers, session gone …). */
  onSync(info) {
    if (!info) return;
    if (info.gone || info.session) { this.refresh(); return; }
    if (info.changed && this.current !== 'setup' && this.current !== 'qr') { this.refresh(); return; }
    if (this.current === 'qr') QRView.updateStatus();
  },
};

/* ============================================================
   Theme toggle (light / dark)
   ============================================================ */
function initTheme() {
  const btn = document.getElementById('themeToggle');
  let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const apply = () => {
    document.documentElement.setAttribute('data-theme', theme);
    btn.innerHTML = theme === 'dark'
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    btn.setAttribute('aria-label', t('themeToggleLabel'));
  };
  btn.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    apply();
    App.refresh(); // rebuild charts with the new theme colors
  });
  apply();
}

/* ============================================================
   Setup view
   ============================================================ */
function renderSetup(el) {
  const c = Store.config;
  el.innerHTML = `
    <div class="page-head">
      <div><h1>${t('setup.title')}</h1>
        <p class="muted">${t('setup.desc')}</p></div>
      <div class="row-actions" style="margin:0">
        <button class="btn" id="btn-demo">${t('setup.loadDemo')}</button>
        <button class="btn primary" id="btn-preview-q">${t('setup.previewQ')}</button>
      </div>
    </div>

    <div class="grid-2">
      <section class="card">
        <h2>${t('setup.classInfo')}</h2>
        <div class="form-grid">
          <label>${t('setup.className')} <input id="f-classname" type="text" value="${esc(c.className)}" placeholder="${esc(t('setup.classNamePh'))}"></label>
          <label>${t('setup.grade')} <input id="f-grade" type="text" value="${esc(c.grade)}" placeholder="${esc(t('setup.gradePh'))}"></label>
          <label>${t('setup.year')} <input id="f-year" type="text" value="${esc(c.schoolYear)}" placeholder="${esc(t('setup.yearPh'))}"></label>
        </div>
      </section>

      <section class="card">
        <h2>${t('setup.analysisOptions')}</h2>
        <label class="check"><input type="checkbox" id="f-bands" ${c.options.useAgeBands ? 'checked' : ''}>
          ${t('setup.ageBands')}</label>
        <label>${t('setup.decimals')} <input type="number" id="f-dec" min="0" max="4" value="${c.options.decimals}" style="width:100px"></label>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h2>${t('setup.roster')}</h2><span class="badge" id="roster-count"></span></div>
      <div class="notice warn" id="roster-warn" hidden><p class="small"></p></div>
      <div class="table-wrap" style="max-height:420px">
        <table class="data-table">
          <thead><tr><th>${t('setup.name')}</th><th>${t('setup.gender')}</th><th>${t('setup.age')}</th><th></th></tr></thead>
          <tbody id="roster-tbody"></tbody>
        </table>
      </div>
      <div class="row-actions">
        <button class="btn" id="btn-add-student">${t('setup.addStudent')}</button>
        <details class="csv-import" style="margin:0">
          <summary>${t('setup.importCsv')}</summary>
          <p class="muted small" style="margin: var(--space-2) 0">${t('setup.csvHint')}</p>
          <textarea id="csv-text" rows="4" placeholder="${esc(t('setup.csvPh'))}"></textarea>
          <button class="btn" id="btn-import-csv">${t('setup.importBtn')}</button>
        </details>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>${t('setup.questions')}</h2><span class="badge" id="q-count"></span></div>
      <p class="muted small" style="margin-bottom: var(--space-4)">
        ${t('setup.qHint')}
      </p>
      <div class="notice warn" id="q-warn" hidden><p class="small"></p></div>
      <div id="q-list"></div>
      <div class="row-actions">
        <button class="btn" id="btn-add-q">${t('setup.addQuestion')}</button>
        <span class="muted small">${t('setup.suggested')}</span>
        <button class="btn small q-preset" data-text="${esc(t('preset.sit.text'))}" data-type="positive" data-max="3">${t('preset.sit.label')}</button>
        <button class="btn small q-preset" data-text="${esc(t('preset.birthday.text'))}" data-type="positive" data-max="3">${t('preset.birthday.label')}</button>
        <button class="btn small q-preset" data-text="${esc(t('preset.work.text'))}" data-type="positive" data-max="3">${t('preset.work.label')}</button>
        <button class="btn small q-preset" data-text="${esc(t('preset.notsit.text'))}" data-type="negative" data-max="2">${t('preset.notsit.label')}</button>
      </div>
    </section>`;

  /* ---------- class info ---------- */
  const bindText = (id, key) => el.querySelector('#' + id).addEventListener('input', e => {
    c[key] = e.target.value; Store.saveConfig();
  });
  bindText('f-classname', 'className');
  bindText('f-grade', 'grade');
  bindText('f-year', 'schoolYear');

  /* ---------- options ---------- */
  el.querySelector('#f-bands').addEventListener('change', e => { c.options.useAgeBands = e.target.checked; Store.saveConfig(); });
  el.querySelector('#f-dec').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10); if (!isNaN(v)) { c.options.decimals = Math.min(4, Math.max(0, v)); Store.saveConfig(); }
  });

  /* ---------- warnings ---------- */
  const showWarn = (id, msg) => {
    const box = el.querySelector(id);
    box.hidden = !msg;
    box.querySelector('p').textContent = msg || '';
  };
  const updateWarnings = () => {
    const names = c.roster.map(k => k.name.trim().toLowerCase()).filter(Boolean);
    showWarn('#roster-warn', names.length !== new Set(names).size ? t('setup.dupNames') : '');
    const young = c.roster.some(k => k.age != null && k.age < 8);
    showWarn('#q-warn', young && c.questions.some(q => q.type === 'negative') ? t('setup.negYoung') : '');
  };

  /* ---------- roster ---------- */
  const renderRoster = () => {
    el.querySelector('#roster-tbody').innerHTML = c.roster.map(k => `
      <tr data-id="${esc(k.id)}">
        <td><input type="text" data-field="name" value="${esc(k.name)}" placeholder="${esc(t('setup.name'))}"></td>
        <td>${DD.html('gender', [
          { value: 'boy', label: t('gender.boy') },
          { value: 'girl', label: t('gender.girl') },
          { value: 'other', label: t('gender.other') },
        ], k.gender, 'data-field="gender"')}</td>
        <td><input type="number" data-field="age" min="3" max="19" value="${k.age == null ? '' : k.age}" placeholder="${esc(t('setup.age'))}" style="width:90px"></td>
        <td><button class="btn small" data-remove="${esc(k.id)}" title="${esc(t('setup.removeStudent'))}" style="color:var(--neg)">✕</button></td>
      </tr>`).join('') || `<tr><td colspan="4" class="muted" style="padding:var(--space-6);text-align:center">${t('setup.noStudents')}</td></tr>`;
    el.querySelector('#roster-count').textContent = tp('setup.students', c.roster.length);
    updateWarnings();
  };
  renderRoster();

  const tbody = el.querySelector('#roster-tbody');
  const onRosterEdit = e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr || !e.target.dataset.field) return;
    const kid = c.roster.find(k => k.id === tr.dataset.id); if (!kid) return;
    const f = e.target.dataset.field;
    const val = e.target.matches('.dd') ? e.target.dataset.value : e.target.value;
    if (f === 'age') {
      const n = parseInt(val, 10);
      kid.age = n >= 3 && n <= 19 ? n : null;
    } else kid[f] = val;
    Store.saveConfig();
    updateWarnings();
  };
  tbody.addEventListener('input', onRosterEdit);
  tbody.addEventListener('change', onRosterEdit);
  tbody.addEventListener('ddchange', onRosterEdit);
  tbody.addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]'); if (!btn) return;
    c.roster = c.roster.filter(k => k.id !== btn.dataset.remove);
    Store.saveConfig(); renderRoster();
  });
  el.querySelector('#btn-add-student').addEventListener('click', () => {
    c.roster.push({ id: uid('s'), name: '', gender: 'other', age: null });
    Store.saveConfig(); renderRoster();
    const rows = el.querySelectorAll('#roster-tbody tr');
    if (rows.length) rows[rows.length - 1].querySelector('input').focus();
  });
  el.querySelector('#btn-import-csv').addEventListener('click', () => {
    const res = parseRosterCSV(el.querySelector('#csv-text').value);
    if (!res.rows.length) { toast(t('toast.csvInvalid')); return; }
    const seen = new Set(c.roster.map(k => k.name.trim().toLowerCase()));
    let dup = 0;
    res.rows.forEach(r => {
      const key = r.name.toLowerCase();
      if (seen.has(key)) dup++;
      seen.add(key);
      c.roster.push(Object.assign({ id: uid('s') }, r));
    });
    Store.saveConfig(); renderRoster();
    el.querySelector('#csv-text').value = '';
    toast(tp('toast.csvImported', res.rows.length, res.unknownGender, dup), 5000);
  });

  /* ---------- questions ---------- */
  const renderQuestions = () => {
    el.querySelector('#q-list').innerHTML = c.questions.map((q, i) => `
      <div class="q-editor" data-index="${i}">
        <span class="badge">${i + 1}</span>
        <input type="text" class="q-text" data-field="text" value="${esc(q.text)}" placeholder="${esc(t('setup.qTextPh'))}">
        ${DD.html('type', [
          { value: 'positive', label: t('setup.positive') },
          { value: 'negative', label: t('setup.negative') },
        ], q.type, 'data-field="type"')}
        <input type="number" data-field="maxChoices" min="1" max="10" value="${q.maxChoices}" title="${esc(t('setup.maxChoices'))}" style="width:86px">
        <button class="btn small" data-remove-q="${i}" title="${esc(t('setup.removeQuestion'))}" style="color:var(--neg)">✕</button>
      </div>`).join('') || `<p class="muted small">${t('setup.noQuestions')}</p>`;
    el.querySelector('#q-count').textContent = tp('setup.questionsCount', c.questions.length);
    updateWarnings();
  };
  renderQuestions();

  const qList = el.querySelector('#q-list');
  const onQEdit = e => {
    const div = e.target.closest('.q-editor'); if (!div || !e.target.dataset.field) return;
    const q = c.questions[Number(div.dataset.index)]; if (!q) return;
    const f = e.target.dataset.field;
    const val = e.target.matches('.dd') ? e.target.dataset.value : e.target.value;
    if (f === 'maxChoices') q.maxChoices = Math.min(10, Math.max(1, parseInt(val, 10) || 1));
    else q[f] = val;
    Store.saveConfig();
    updateWarnings();
  };
  qList.addEventListener('input', onQEdit);
  qList.addEventListener('change', onQEdit);
  qList.addEventListener('ddchange', onQEdit);
  qList.addEventListener('click', e => {
    const btn = e.target.closest('[data-remove-q]'); if (!btn) return;
    c.questions.splice(Number(btn.dataset.removeQ), 1);
    Store.saveConfig(); renderQuestions();
  });
  el.querySelector('#btn-add-q').addEventListener('click', () => {
    c.questions.push({ id: uid('q'), text: '', type: 'positive', maxChoices: 3 });
    Store.saveConfig(); renderQuestions();
    const items = el.querySelectorAll('.q-editor');
    if (items.length) items[items.length - 1].querySelector('.q-text').focus();
  });
  el.querySelectorAll('.q-preset').forEach(btn => btn.addEventListener('click', () => {
    c.questions.push({ id: uid('q'), text: btn.dataset.text, type: btn.dataset.type, maxChoices: Number(btn.dataset.max) });
    Store.saveConfig(); renderQuestions();
  }));

  /* ---------- top actions ---------- */
  el.querySelector('#btn-demo').addEventListener('click', () => Demo.load());
  el.querySelector('#btn-preview-q').addEventListener('click', () => { location.hash = '#qr'; });
}

/* ============================================================
   Data management view
   ============================================================ */
function renderDataView(el) {
  const c = Store.config;
  const nameOf = id => { const k = c.roster.find(x => x.id === id); return k ? k.name : id; };

  el.innerHTML = `
    <div class="page-head">
      <div><h1>${t('data.title')}</h1>
        <p class="muted">${t('data.desc')}</p></div>
    </div>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>${t('data.responses')}</h2><span class="badge">${tp('data.of', Store.responses.length, c.roster.length)}</span></div>
        <div class="table-wrap" style="max-height:340px">
          <table class="data-table">
            <thead><tr><th>${t('data.student')}</th><th>${t('data.submitted')}</th><th></th></tr></thead>
            <tbody>
              ${Store.responses.map(r => `
                <tr><td class="strong">${esc(nameOf(r.respondent_id))}</td>
                <td class="muted">${new Date(r.timestamp).toLocaleString()}</td>
                <td><button class="btn small" data-del="${esc(r.respondent_id)}" style="color:var(--neg)" title="${esc(t('data.delete'))}">✕</button></td></tr>`).join('')
                || `<tr><td colspan="3" class="muted" style="padding:var(--space-6);text-align:center">${t('data.noResponses')}</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="row-actions">
          ${Sync.active ? `<button class="btn" id="btn-sync">${t('data.syncNow')}</button>` : `<button class="btn" id="btn-simulate">${t('data.simulate')}</button>`}
        </div>
      </section>

      <section class="card">
        <h2>${t('data.export')}</h2>
        <label class="check"><input type="checkbox" id="dv-anon" ${Store.exportAnon ? 'checked' : ''}> ${t('an.anon')}</label>
        <div class="btn-col">
          <button class="btn" id="exp-config">${t('data.expConfig')}</button>
          <button class="btn" id="exp-responses">${t('data.expResponses')}</button>
          <button class="btn" id="exp-votes">${t('data.expVotes')}</button>
          <button class="btn" id="exp-matrix">${t('data.expMatrix')}</button>
          <button class="btn" id="exp-summary">${t('data.expSummary')}</button>
        </div>
      </section>

      <section class="card">
        <h2>${t('data.import')}</h2>
        <label class="file-label">${t('data.impConfig')} <input type="file" id="imp-config" accept=".json,application/json"></label>
        <label class="file-label">${t('data.impResponses')} <input type="file" id="imp-responses" accept=".json,application/json"></label>
        <p class="muted tiny" style="margin-top: var(--space-3)">${t('data.importHint')}</p>
      </section>

      <section class="card" style="border-left: 4px solid var(--neg-strong)">
        <h2>${t('data.danger')}</h2>
        <div class="btn-col">
          <button class="btn" id="btn-demo2">${t('data.demo2')}</button>
          <button class="btn danger" id="btn-reset">${t('data.reset')}</button>
        </div>
      </section>
    </div>

    <section class="card">
      <h2>${t('data.privacyH')}</h2>
      <p class="muted">${t('data.privacyQuote')}</p>
      <p class="muted tiny" style="margin-top: var(--space-3)">${t('data.privacyNote')}</p>
    </section>`;

  /* ---------- responses ---------- */
  el.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.del;
    if (!(await uiConfirm(tp('data.delConfirm', nameOf(id))))) return;
    // Delete online first, otherwise the next refresh would bring the answer back.
    if (!(await Sync.deleteResponse(id))) { toast(t('toast.deleteFail')); return; }
    Store.removeResponse(id);
    toast(t('toast.deleted'));
    App.refresh();
  }));
  const sim = el.querySelector('#btn-simulate');
  if (sim) sim.addEventListener('click', () => Demo.simulateResponse());
  const sync = el.querySelector('#btn-sync');
  if (sync) sync.addEventListener('click', async () => {
    const n = await Sync.pull();
    toast(n ? tp('toast.synced', n) : t('toast.noNew'));
    App.refresh();
  });

  /* ---------- exports (always every question; names hidden when requested) ---------- */
  el.querySelector('#dv-anon').addEventListener('change', e => { Store.exportAnon = e.target.checked; });
  el.querySelector('#exp-config').addEventListener('click', () => {
    Tables.download('sociostudy-config.json', JSON.stringify(Exporter.dataset().c, null, 2), 'application/json');
    toast(t('toast.configExported'));
  });
  el.querySelector('#exp-responses').addEventListener('click', () => {
    Tables.download('sociostudy-responses.json', JSON.stringify(Store.responses, null, 2), 'application/json');
    toast(t('toast.responsesExported'));
  });
  el.querySelector('#exp-votes').addEventListener('click', () => {
    const ds = Exporter.dataset();
    Tables.download('sociostudy-votes.csv', Tables.votesCSV(ds.a, ds.c), 'text/csv;charset=utf-8');
    toast(t('toast.votesCsv'));
  });
  el.querySelector('#exp-matrix').addEventListener('click', () => {
    const ds = Exporter.dataset();
    Tables.download('sociostudy-matrix.csv', Tables.matrixCSV(ds.a, ds.c), 'text/csv;charset=utf-8');
    toast(t('toast.matrixCsv'));
  });
  el.querySelector('#exp-summary').addEventListener('click', () => {
    const ds = Exporter.dataset();
    Tables.download('sociostudy-summary.csv', Tables.summaryCSV(ds.a, ds.c), 'text/csv;charset=utf-8');
    toast(t('toast.summaryCsv'));
  });

  /* ---------- imports ---------- */
  const importJSON = (input, handle) => {
    input.addEventListener('change', () => {
      const file = input.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const msg = handle(JSON.parse(reader.result), file.name);
          toast(msg);
          App.refresh();
        } catch (e) { toast(t('data.importFail')); }
        input.value = '';
      };
      reader.readAsText(file);
    });
  };
  importJSON(el.querySelector('#imp-config'), (d, name) => {
    if (!d || !Array.isArray(d.roster) || !Array.isArray(d.questions)) throw new Error('bad shape');
    const cfg = Object.assign(Store.defaultConfig(), d);
    cfg.options = Object.assign(Store.defaultConfig().options, d.options || {});
    cfg.roster = d.roster.filter(k => k && typeof k.id === 'string' && typeof k.name === 'string')
      .map(k => ({ id: k.id, name: k.name, gender: parseGender(k.gender).gender, age: Number.isInteger(k.age) ? k.age : null }));
    cfg.questions = d.questions.filter(q => q && typeof q.text === 'string')
      .map(q => ({ id: q.id, text: q.text, type: q.type === 'negative' ? 'negative' : 'positive', maxChoices: Math.min(10, Math.max(1, parseInt(q.maxChoices, 10) || 3)) }));
    Store.ensureQuestionIds(cfg);
    Store.config = cfg;
    // Answers in the old format only know the question position: tie them to the new question ids.
    Store.responses = Store.responses.map(r => Store.upgradeResponse(r));
    Store.saveConfig(); Store.saveResponses();
    return tp('toast.imported', name);
  });
  importJSON(el.querySelector('#imp-responses'), (d, name) => {
    if (!Array.isArray(d)) throw new Error('bad shape');
    const res = Store.mergeResponses(d);
    return tp('toast.imported', name, res.added + res.updated);
  });

  /* ---------- danger zone ---------- */
  el.querySelector('#btn-demo2').addEventListener('click', () => Demo.load());
  el.querySelector('#btn-reset').addEventListener('click', async () => {
    if (!(await uiConfirm(t('data.resetConfirm')))) return;
    // QR link, roster and answers on the server go first; the local copy after.
    const online = await Sync.destroy();
    Store.reset();
    Analysis.criterion = 'all';
    Sociogram.pos = {};
    Charts.radarChild = null;
    toast(online ? t('toast.allReset') : t('toast.onlineQueued'), online ? 2800 : 6000);
    App.refresh();
  });
}

/* ============================================================
   Demo data — a reproducible 16-student class with realistic
   cliques, a popular pair, a rejected child and mutual friends.
   Names and questions follow the active language.
   ============================================================ */
const Demo = {
  /** Mulberry32-style seeded RNG so the demo class is stable. */
  rng(seed) {
    let t = seed;
    return function () {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  },

  /** Weighted sample of k distinct items. */
  weightedPick(items, weightFn, k, rand) {
    const pool = items.slice(), out = [];
    while (out.length < k && pool.length) {
      const weights = pool.map(weightFn);
      let r = rand() * weights.reduce((s, w) => s + w, 0);
      let idx = pool.length - 1;
      for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) { idx = i; break; } }
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  },

  config() {
    let boys, girls, className, grade, questions;
    if (I18N.lang === 'bg') {
      boys = [['Иван', 9], ['Петър', 9], ['Георги', 8], ['Мартин', 10], ['Александър', 8], ['Николай', 9], ['Васил', 10], ['Дамян', 8]];
      girls = [['Мария', 9], ['Елена', 8], ['Даниела', 9], ['Симона', 8], ['Виктория', 10], ['Надежда', 8], ['Калина', 9], ['Радост', 10]];
      className = '3А'; grade = '3. клас';
      questions = [
        { text: 'До кого искаш да седиш в клас?', type: 'positive', maxChoices: 3 },
        { text: 'Кого би поканил на рождения си ден?', type: 'positive', maxChoices: 3 },
        { text: 'С кого не би искал да работиш по проект?', type: 'negative', maxChoices: 2 },
      ];
    } else {
      boys = [['Alex', 9], ['Ben', 9], ['Chris', 8], ['Daniel', 10], ['Ethan', 8], ['Frank', 9], ['George', 10], ['Henry', 8]];
      girls = [['Anna', 9], ['Bella', 8], ['Clara', 9], ['Daria', 8], ['Emma', 10], ['Fiona', 8], ['Grace', 9], ['Hanna', 10]];
      className = '3A'; grade = 'Grade 3';
      questions = [
        { text: 'Who would you like to sit next to?', type: 'positive', maxChoices: 3 },
        { text: 'Who would you invite to your birthday party?', type: 'positive', maxChoices: 3 },
        { text: 'Who would you not want to work with on a project?', type: 'negative', maxChoices: 2 },
      ];
    }
    const roster = [];
    boys.forEach(([n, a]) => roster.push({ id: uid('s'), name: n, gender: 'boy', age: a }));
    girls.forEach(([n, a]) => roster.push({ id: uid('s'), name: n, gender: 'girl', age: a }));
    return {
      className, grade, schoolYear: '2026/2027',
      roster,
      questions: questions.map(q => Object.assign({ id: uid('q') }, q)),
      options: { useAgeBands: true, decimals: 2 },
    };
  },

  load() {
    if (Store.config.roster.length || Store.responses.length || Sync.session) {
      uiConfirm(t('demo.confirm')).then(ok => { if (ok) this._doLoad(); });
      return;
    }
    this._doLoad();
  },

  async _doLoad() {
    // The demo class has other children — an existing QR link would no longer match.
    if (Sync.session) await Sync.destroy();
    Store.config = this.config();
    Store.responses = this.generate(Store.config);
    Analysis.criterion = 'all';
    Sociogram.pos = {};
    Store.saveConfig(); Store.saveResponses();
    toast(t('demo.loaded'));
    App.refresh();
  },

  /** Generate plausible responses: gender-homophilous choices, a few
      popular kids, one rejected child, three guaranteed mutual pairs. */
  generate(config) {
    const rand = this.rng(42);
    const isBg = I18N.lang === 'bg';
    const popularity = isBg
      ? { Мария: 3, Иван: 3, Калина: 2.2, Мартин: 2.2, Петър: 0.3 }
      : { Anna: 3, Alex: 3, Grace: 2.2, Daniel: 2.2, Ben: 0.3 };
    const unpopularity = isBg
      ? { Петър: 5, Николай: 2.2, Дамян: 1.4 }
      : { Ben: 5, Frank: 2.2, Henry: 1.4 };
    const besties = isBg
      ? { Даниела: 'Симона', Симона: 'Даниела', Александър: 'Николай', Николай: 'Александър', Елена: 'Виктория', Виктория: 'Елена' }
      : { Clara: 'Daria', Daria: 'Clara', Ethan: 'Frank', Frank: 'Ethan', Bella: 'Emma', Emma: 'Bella' };
    const responses = [];
    for (const kid of config.roster) {
      const answers = config.questions.map((q, qi) => {
        const others = config.roster.filter(o => o.id !== kid.id);
        let chosen;
        if (q.type === 'positive') {
          const k = Math.max(1, q.maxChoices - (rand() < 0.25 ? 1 : 0));
          const weight = o => (popularity[o.name] || 1) * (o.gender === kid.gender ? 2.4 : 0.55);
          chosen = this.weightedPick(others, weight, k, rand).map(o => o.id);
          const best = besties[kid.name];
          if (best) {
            const b = others.find(o => o.name === best);
            if (b && !chosen.includes(b.id)) {
              if (chosen.length >= q.maxChoices) chosen.pop();
              chosen.push(b.id);
            }
          }
        } else {
          const k = rand() < 0.5 ? 1 : 2;
          const weight = o => (unpopularity[o.name] || 0.35) * (o.gender === kid.gender ? 1.3 : 0.8);
          chosen = this.weightedPick(others, weight, k, rand).map(o => o.id);
        }
        return { question_id: q.id, question_index: qi, question_text: q.text, question_type: q.type, chosen_ids: chosen };
      });
      responses.push({
        respondent_id: kid.id,
        timestamp: new Date(Date.now() - Math.floor(rand() * 86400000)).toISOString(),
        answers,
      });
    }
    return responses;
  },

  /** Random response for trying out the analysis (not while a real questionnaire is running). */
  simulateResponse() {
    const c = Store.config;
    if (!c.roster.length || !c.questions.length) { toast(t('toast.configureFirst')); return; }
    if (Sync.session) { toast(t('toast.simDisabled')); return; }
    const rand = this.rng(Date.now() & 0xfffff);
    const pending = c.roster.filter(k => !Store.responses.some(r => r.respondent_id === k.id));
    const pool = pending.length ? pending : c.roster;
    const kid = pool[Math.floor(rand() * pool.length)];
    const answers = c.questions.map((q, qi) => {
      const others = c.roster.filter(o => o.id !== kid.id);
      const k = 1 + Math.floor(rand() * q.maxChoices);
      const shuffled = others.slice().sort(() => rand() - 0.5);
      return {
        question_id: q.id, question_index: qi, question_text: q.text, question_type: q.type,
        chosen_ids: shuffled.slice(0, Math.min(k, q.maxChoices)).map(o => o.id),
      };
    });
    Store.upsertResponse({ respondent_id: kid.id, timestamp: new Date().toISOString(), answers });
    toast(tp('toast.simulated', kid.name));
    App.refresh();
  },
};

/* ---------- Boot ---------- */

document.addEventListener('DOMContentLoaded', () => App.init());
