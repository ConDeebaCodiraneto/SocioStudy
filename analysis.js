/* ============================================================
   analysis.js — sociometric calculations
   Classic peer-nomination sociometry:

   - P  = positive nominations received
   - N  = negative nominations received
   - SP (overall score, social preference) = P − N
   - SI (social impact) = P + N — how visible the child is
   - z-scores standardise P, N, SI, SP across the class and are
     used internally for the status categories and in the CSV export
   - Status: simplified Coie, Dodge & Copeland scheme on z(SP), z(SI):
        Popular       zSP > +1  and zSI > 0
        Rejected      zSP < −1  and zSI > 0
        Neglected     zSI < −1
        Controversial zSI > +1 and |zSP| ≤ 1
        Average       everyone else
     Statuses are only assigned when enough of the class answered
     (MIN_RESPONSE_RATE) and the class is large enough (MIN_CLASS);
     otherwise every child is "Undetermined" so nobody is mislabelled.
   - Gender-adjusted score (CSV only): same-gender and other-gender
     scores are converted to a rate per available voter and averaged
     with equal weight, then scaled back to the size of the class —
     so it is comparable with the overall score and does not favour
     the larger gender group.
   - Age bands (6–7, 8–9, 10–11, 12+) for filtering.
   ============================================================ */

const MIN_RESPONSE_RATE = 0.6;
const MIN_CLASS = 5;

const STATUS_META = {
  Popular: { color: '#16a34a', labelKey: 'status.Popular', descKey: 'statusDesc.Popular' },
  Rejected: { color: '#dc2626', labelKey: 'status.Rejected', descKey: 'statusDesc.Rejected' },
  Controversial: { color: '#d97706', labelKey: 'status.Controversial', descKey: 'statusDesc.Controversial' },
  Neglected: { color: '#94a3b8', labelKey: 'status.Neglected', descKey: 'statusDesc.Neglected' },
  Average: { color: '#0284c7', labelKey: 'status.Average', descKey: 'statusDesc.Average' },
  Undetermined: { color: '#cbd5e1', labelKey: 'status.Undetermined', descKey: 'statusDesc.Undetermined' },
};
const STATUS_ORDER = ['Popular', 'Rejected', 'Controversial', 'Neglected', 'Average'];

const GENDER_META = {
  boy: { labelKey: 'gender.boy', color: '#2563eb' },
  girl: { labelKey: 'gender.girl', color: '#db2777' },
  other: { labelKey: 'gender.other', color: '#9333ea' },
};

const Analysis = {

  /** Question the views are filtered to: 'all' or a question id. */
  criterion: 'all',

  AGE_BANDS: [
    { label: '6-7', min: 0, max: 7 },
    { label: '8-9', min: 8, max: 9 },
    { label: '10-11', min: 10, max: 11 },
    { label: '12+', min: 12, max: 200 },
  ],

  ageBand(age) {
    if (age == null) return 'n/a';
    const b = this.AGE_BANDS.find(b => age >= b.min && age <= b.max);
    return b ? b.label : 'n/a';
  },

  /** Turn every submitted questionnaire into a flat list of single votes. */
  collectVotes(config, responses, questionId) {
    const ids = new Set(config.roster.map(c => c.id));
    const qById = new Map(config.questions.map(q => [q.id, q]));
    const votes = []; // {from, to, type, questionId}
    for (const resp of responses) {
      if (!resp || !ids.has(resp.respondent_id)) continue; // unknown respondent
      for (const a of (resp.answers || [])) {
        const q = a && a.question_id ? qById.get(a.question_id) : null;
        if (!q) continue; // question was deleted after submission
        if (questionId && q.id !== questionId) continue;
        // The type the child actually saw wins over later edits of the question.
        const type = a.question_type || q.type;
        const seen = new Set();
        for (const to of (a.chosen_ids || [])) {
          // Ignore duplicates, self-votes and kids no longer on the roster.
          if (!ids.has(to) || to === resp.respondent_id || seen.has(to)) continue;
          seen.add(to);
          votes.push({ from: resp.respondent_id, to, type, questionId: q.id });
        }
      }
    }
    return votes;
  },

  /**
   * Full analysis of the class. Returns per-child stats, the vote
   * matrices, mutual pairs and class-level statistics.
   * opts.questionId limits the analysis to one question.
   */
  compute(config, responses, opts) {
    const qid = opts && opts.questionId && opts.questionId !== 'all' ? opts.questionId : null;
    const roster = config.roster;
    const byId = {};
    roster.forEach(c => {
      byId[c.id] = Object.assign({
        P: 0, N: 0, SI: 0, SP: 0, given: 0,
        P_same: 0, P_cross: 0, N_same: 0, N_cross: 0,
        SP_same: 0, SP_cross: 0, SP_adj: null,
        chose: [],        // votes this child gave  [{to, name, type}]
        chosenBy: [],     // votes this child received [{from, name, type}]
        mutualWith: [],   // names of children with mutual positive ties
        band: 'n/a',
      }, c);
    });

    const votes = this.collectVotes(config, responses, qid);
    // pos[fromId][toId] = number of positive votes from → to (same for neg).
    const pos = {}, neg = {};
    const bump = (m, a, b) => { (m[a] = m[a] || {})[b] = (m[a][b] || 0) + 1; };

    for (const v of votes) {
      const voter = byId[v.from], target = byId[v.to];
      if (!voter || !target) continue;
      const sameGender = voter.gender === target.gender;
      if (v.type === 'positive') {
        bump(pos, v.from, v.to);
        target.P++;
        voter.given++;
        if (sameGender) target.P_same++; else target.P_cross++;
        voter.chose.push({ to: v.to, name: target.name, type: 'positive', question: v.questionId });
        target.chosenBy.push({ from: v.from, name: voter.name, type: 'positive' });
      } else {
        bump(neg, v.from, v.to);
        target.N++;
        if (sameGender) target.N_same++; else target.N_cross++;
        voter.chose.push({ to: v.to, name: target.name, type: 'negative', question: v.questionId });
        target.chosenBy.push({ from: v.from, name: voter.name, type: 'negative' });
      }
    }

    const children = roster.map(c => byId[c.id]);
    children.forEach(c => {
      c.SI = c.P + c.N;
      c.SP = c.P - c.N;
      c.SP_same = c.P_same - c.N_same;
      c.SP_cross = c.P_cross - c.N_cross;
      c.band = this.ageBand(c.age);
    });

    // z-scores across the class (population SD — the class is the
    // whole population of interest, not a sample).
    const zscore = (key) => {
      const n = children.length || 1;
      const vals = children.map(c => c[key]);
      const mean = vals.reduce((s, v) => s + v, 0) / n;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n);
      children.forEach(c => { c['z' + key] = sd > 0 ? (c[key] - mean) / sd : 0; });
      return { mean, sd };
    };
    const statsP = zscore('P');
    const statsN = zscore('N');
    zscore('SI');
    zscore('SP');

    const respondents = new Set(
      responses.filter(r => r && byId[r.respondent_id]).map(r => r.respondent_id)
    );
    const n = children.length;
    const rate = n ? respondents.size / n : 0;
    const statusReason = n < MIN_CLASS ? 'small' : rate < MIN_RESPONSE_RATE ? 'low' : null;
    const statusOk = !statusReason;

    // Status classification (simplified Coie–Dodge–Copeland scheme).
    // Order matters: Popular/Rejected first, then Neglected, then Controversial.
    children.forEach(c => {
      c.status = !statusOk ? 'Undetermined' :
        (c.zSP > 1 && c.zSI > 0) ? 'Popular' :
        (c.zSP < -1 && c.zSI > 0) ? 'Rejected' :
        (c.zSI < -1) ? 'Neglected' :
        (c.zSI > 1 && Math.abs(c.zSP) <= 1) ? 'Controversial' : 'Average';
    });

    // Gender-adjusted score: rate per available voter in each gender group,
    // averaged with equal weight, scaled back to the whole class.
    const respByGender = {};
    children.forEach(c => { if (respondents.has(c.id)) respByGender[c.gender] = (respByGender[c.gender] || 0) + 1; });
    children.forEach(c => {
      const self = respondents.has(c.id) ? 1 : 0;
      const same = (respByGender[c.gender] || 0) - self;
      const cross = respondents.size - self - same;
      c.SP_adj = (same > 0 && cross > 0)
        ? (same + cross) * ((c.SP_same / same + c.SP_cross / cross) / 2)
        : c.SP;
    });

    // Mutual positive pairs: A→B and B→A both carry ≥ 1 positive vote.
    const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    const mutualSet = new Set();
    const mutualPairs = [];
    for (const from in pos) {
      for (const to in pos[from]) {
        if (from < to && pos[to] && pos[to][from]) {
          mutualPairs.push({ a: from, b: to });
          mutualSet.add(pairKey(from, to));
        }
      }
    }
    children.forEach(c => {
      c.mutualWith = children
        .filter(o => o.id !== c.id && mutualSet.has(pairKey(c.id, o.id)))
        .map(o => o.name);
      c.mutualCount = c.mutualWith.length;
    });

    return {
      children, votes, pos, neg, mutualPairs, mutualSet, pairKey, respondents,
      rate, statusOk, statusReason,
      classStats: {
        n,
        meanP: statsP.mean, sdP: statsP.sd,
        meanN: statsN.mean, sdN: statsN.sd,
        maxP: Math.max(0, ...children.map(c => c.P)),
      },
    };
  },

  /** Analysis of the current class, filtered by the selected question. */
  forView() {
    const c = Store.config;
    if (this.criterion !== 'all' && !c.questions.some(q => q.id === this.criterion)) this.criterion = 'all';
    return this.compute(c, Store.responses, { questionId: this.criterion });
  },

  /** "Question: [All questions ▾]" selector shown on the data views. */
  criterionHTML() {
    const qs = Store.config.questions;
    if (qs.length < 2) return '';
    const clip = s => (s.length > 46 ? s.slice(0, 45) + '…' : s);
    const options = [{ value: 'all', label: t('crit.all') }]
      .concat(qs.map((q, i) => ({ value: q.id, label: `${i + 1}. ${clip(q.text || '')}` })));
    return `<label>${t('crit.label')} ${DD.html('crit', options, this.criterion, 'id="crit"')}</label>`;
  },

  bindCriterion(el, onChange) {
    const dd = el.querySelector('#crit');
    if (dd) dd.addEventListener('ddchange', () => { Analysis.criterion = dd.dataset.value; onChange(); });
  },

  /** Copy of the config with the children's names replaced by codes (for exports). */
  anonymize(config) {
    const c = JSON.parse(JSON.stringify(config));
    c.roster.forEach((k, i) => { k.name = `${t('exp.codePrefix')} ${String(i + 1).padStart(2, '0')}`; });
    return c;
  },

  /** Format a number with the configured decimals (or 2 by default). */
  fmt(x, d) {
    if (x == null) return '–';
    return Number(x).toFixed(d == null ? 2 : d);
  },
};

/* ============================================================
   Analysis view — summary table with sorting + filters
   ============================================================ */

Analysis.ui = {
  sortKey: 'SP',
  sortDir: -1,
  filterGender: 'all',
  filterStatus: 'all',
  filterBand: 'all',
};

Analysis.renderView = function (el) {
  const c = Store.config;
  if (!c.roster.length) {
    el.innerHTML = emptyState(t('an.empty'),
      `<button class="btn primary" data-goto="setup">${t('goToSetup')}</button>`);
    return;
  }
  const a = Analysis.forView();
  const opt = c.options, d = opt.decimals;
  const ui = Analysis.ui;

  const statusCounts = {};
  a.children.forEach(k => statusCounts[k.status] = (statusCounts[k.status] || 0) + 1);
  const rate = Math.round(100 * a.rate);
  const noVariation = a.statusOk && a.classStats.sdP === 0 && a.classStats.sdN === 0;
  const hasResponses = Store.responses.length > 0;

  const columns = [
    ['name', t('th.name'), ''], ['gender', t('th.gender'), ''], ['age', t('th.age'), ''],
    ['P', t('th.pos'), t('th.posTip')], ['N', t('th.neg'), t('th.negTip')],
    ['SP', t('th.score'), t('th.scoreTip')],
    ['status', t('th.status'), t('th.statusTip')],
    ['mutual', t('th.mutual'), t('th.mutualTip')],
  ];

  const statusOptions = [{ value: 'all', label: t('filter.all') }]
    .concat(STATUS_ORDER.map(s => ({ value: s, label: statusLabel(s) })));
  if (!a.statusOk) statusOptions.push({ value: 'Undetermined', label: statusLabel('Undetermined') });
  if (ui.filterStatus !== 'all' && !statusOptions.some(o => o.value === ui.filterStatus)) ui.filterStatus = 'all';

  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${t('an.title')}</h1>
        <p class="muted">${tp('an.desc', esc(c.className || t('an.yourClass')))}</p>
      </div>
      <div class="actions row-actions" style="margin:0">
        <label class="check" style="margin:0"><input type="checkbox" id="an-anon" ${Store.exportAnon ? 'checked' : ''}> ${t('an.anon')}</label>
        <button class="btn primary" id="an-export-zip">${t('an.exportZip')}</button>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat-card"><div class="stat-value">${a.classStats.n}</div><div class="stat-label">${t('an.students')}</div></div>
      <div class="stat-card"><div class="stat-value">${a.respondents.size}</div><div class="stat-label">${t('an.responses')}</div></div>
      <div class="stat-card"><div class="stat-value">${rate}%</div><div class="stat-label">${t('an.rate')}</div></div>
      <div class="stat-card"><div class="stat-value">${a.mutualPairs.length}</div><div class="stat-label">${t('an.mutualPairs')}</div></div>
      <div class="stat-card"><div class="stat-value">${Analysis.fmt(a.classStats.meanP, d)}</div><div class="stat-label">${t('an.avgP')}</div></div>
      <div class="stat-card"><div class="stat-value">${Analysis.fmt(a.classStats.meanN, d)}</div><div class="stat-label">${t('an.avgN')}</div></div>
    </div>

    ${hasResponses && !a.statusOk ? `<div class="notice warn"><p class="small"><b>${a.statusReason === 'small'
      ? t('an.smallClass')
      : tp('an.lowResponse', a.respondents.size, a.classStats.n, Math.round(MIN_RESPONSE_RATE * 100))}</b></p></div>` : ''}
    ${hasResponses && noVariation ? `<div class="notice warn"><p class="small"><b>${t('an.noVariation')}</b></p></div>` : ''}

    ${a.statusOk ? `<section class="card">
      <div class="card-head"><h2>${t('an.statusOverview')}</h2></div>
      <div class="chips">
        ${STATUS_ORDER.map(s => `
          <span class="chip" style="border-color:${STATUS_META[s].color}66; color:${STATUS_META[s].color}">
            <span class="dot" style="background:${STATUS_META[s].color}"></span>
            ${statusLabel(s)} — ${statusCounts[s] || 0}
          </span>`).join('')}
      </div>
      <div class="legend" style="margin-top: var(--space-4)">
        ${STATUS_ORDER.map(s => `<span><b style="color:${STATUS_META[s].color}">${statusLabel(s)}</b> — ${t(STATUS_META[s].descKey)}</span>`).join('')}
      </div>
    </section>` : ''}

    <section class="card">
      <div class="card-head">
        <h2>${t('an.summary')}</h2>
        <div class="chart-controls">
          ${Analysis.criterionHTML()}
          <label>${t('an.filterGender')}
            ${DD.html('an-gender', [
              { value: 'all', label: t('filter.all') },
              { value: 'boy', label: t('genderPl.boy') },
              { value: 'girl', label: t('genderPl.girl') },
              { value: 'other', label: t('genderPl.other') },
            ], ui.filterGender, 'id="an-gender"')}</label>
          <label>${t('an.filterStatus')}
            ${DD.html('an-status', statusOptions, ui.filterStatus, 'id="an-status"')}</label>
          ${opt.useAgeBands ? `<label>${t('an.filterBand')}
            ${DD.html('an-band', [{ value: 'all', label: t('filter.all') }].concat(
              Analysis.AGE_BANDS.map(b => ({ value: b.label, label: b.label })),
            ), ui.filterBand, 'id="an-band"')}</label>` : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table" id="an-table">
          <thead><tr>
            ${columns.map(([key, label, tip]) => `<th class="sortable" data-key="${key}"${tip ? ` title="${esc(tip)}"` : ''}>${esc(label)}${ui.sortKey === key ? `<span class="sort-arrow">${ui.sortDir === 1 ? '↑' : '↓'}</span>` : ''}</th>`).join('')}
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <p class="muted tiny" style="margin-top: var(--space-3)">
        ${esc(t('an.footnote'))} ${esc(t('an.disclaimer'))}
      </p>
    </section>`;

  const renderRows = () => {
    const kids = a.children.filter(k =>
      (ui.filterGender === 'all' || k.gender === ui.filterGender) &&
      (ui.filterStatus === 'all' || k.status === ui.filterStatus) &&
      (!opt.useAgeBands || ui.filterBand === 'all' || k.band === ui.filterBand)
    );
    const key = ui.sortKey;
    kids.sort((x, y) => {
      let vx = key === 'mutual' ? x.mutualCount : x[key];
      let vy = key === 'mutual' ? y.mutualCount : y[key];
      if (vx == null) vx = -1; if (vy == null) vy = -1;
      if (typeof vx === 'string') { vx = vx.toLowerCase(); vy = String(vy).toLowerCase(); }
      return (vx < vy ? -1 : vx > vy ? 1 : 0) * ui.sortDir;
    });
    el.querySelector('#an-table tbody').innerHTML = kids.map(k => `
      <tr>
        <td class="strong">${esc(k.name)}</td>
        <td><span class="dot" style="background:${GENDER_META[k.gender].color}"></span>${genderLabel(k.gender)}</td>
        <td class="num">${k.age == null ? '–' : k.age}</td>
        <td class="num">${k.P}</td>
        <td class="num">${k.N}</td>
        <td class="num strong">${k.SP}</td>
        <td><span class="status-badge" style="--c:${STATUS_META[k.status].color}">${statusLabel(k.status)}</span></td>
        <td class="muted">${k.mutualWith.length ? esc(k.mutualWith.join(', ')) : '–'}</td>
      </tr>`).join('') || `<tr><td colspan="8" class="muted" style="text-align:center;padding:var(--space-8)">${t('an.noMatch')}</td></tr>`;
  };

  el.querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (ui.sortKey === key) ui.sortDir *= -1;
    else { ui.sortKey = key; ui.sortDir = key === 'name' || key === 'gender' ? 1 : -1; }
    el.querySelectorAll('th.sortable').forEach(h => {
      const label = columns.find(col => col[0] === h.dataset.key)[1];
      h.innerHTML = esc(label) + (h.dataset.key === key ? `<span class="sort-arrow">${ui.sortDir === 1 ? '↑' : '↓'}</span>` : '');
    });
    renderRows();
  }));
  Analysis.bindCriterion(el, () => Analysis.renderView(el));
  el.querySelector('#an-gender').addEventListener('ddchange', e => { ui.filterGender = e.target.dataset.value; renderRows(); });
  el.querySelector('#an-status').addEventListener('ddchange', e => { ui.filterStatus = e.target.dataset.value; renderRows(); });
  const bandSel = el.querySelector('#an-band');
  if (bandSel) bandSel.addEventListener('ddchange', e => { ui.filterBand = e.target.dataset.value; renderRows(); });
  el.querySelector('#an-anon').addEventListener('change', e => { Store.exportAnon = e.target.checked; });
  el.querySelector('#an-export-zip').addEventListener('click', () => Exporter.exportZIP());

  renderRows();
};
