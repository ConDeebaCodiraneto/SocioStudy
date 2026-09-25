/* ============================================================
   tables.js — sociomatrix, arrow vote lists, CSV exports
   The sociomatrix shows who voted for whom; mutual positive
   pairs are highlighted and marked with ↔.
   All strings and CSV headers are localized (i18n.js).
   CSVs start with a UTF-8 BOM so Excel opens Cyrillic correctly.
   ============================================================ */

const Tables = {

  renderView(el) {
    const c = Store.config;
    if (!c.roster.length) {
      el.innerHTML = emptyState(t('an.empty'),
        `<button class="btn primary" data-goto="setup">${t('goToSetup')}</button>`);
      return;
    }
    const a = Analysis.forView();
    const labels = uniqueLabels(c.roster);

    /* ---------- Sociomatrix ---------- */
    const head = `<tr><th class="voter-col">${t('table.voterTarget')}</th>${c.roster.map(k => `<th title="${esc(k.name)}">${esc(labels[k.id])}</th>`).join('')}</tr>`;
    const rows = c.roster.map(v => `
      <tr><th class="voter-col" title="${esc(v.name)}">${esc(labels[v.id])}</th>
      ${c.roster.map(target => this.cellHTML(a, v, target)).join('')}</tr>`).join('');

    /* ---------- Arrow lists ---------- */
    const mutualChips = [], posChips = [], negChips = [];
    const nameOf = id => { const k = c.roster.find(x => x.id === id); return k ? k.name : id; };
    for (const from in a.pos) {
      for (const to in a.pos[from]) {
        const isMutual = a.pos[to] && a.pos[to][from];
        if (isMutual) {
          // A mutual pair is listed once, never again as two one-way arrows.
          if (from < to) mutualChips.push(`<span class="chip mutual">${esc(nameOf(from))} ↔ ${esc(nameOf(to))}</span>`);
        } else {
          posChips.push(`<span class="chip pos" title="${esc(tp('table.posVotesTip', a.pos[from][to]))}">${esc(nameOf(from))} → ${esc(nameOf(to))}</span>`);
        }
      }
    }
    for (const from in a.neg) {
      for (const to in a.neg[from]) {
        negChips.push(`<span class="chip neg" title="${esc(tp('table.negVotesTip', a.neg[from][to]))}">${esc(nameOf(from))} ↛ ${esc(nameOf(to))}</span>`);
      }
    }

    el.innerHTML = `
      <div class="page-head">
        <div>
          <h1>${t('table.title')}</h1>
          <p class="muted">${tp('table.desc', a.respondents.size, c.roster.length)}</p>
        </div>
        <div class="actions row-actions" style="margin:0">
          <label class="check" style="margin:0"><input type="checkbox" id="tb-anon" ${Store.exportAnon ? 'checked' : ''}> ${t('an.anon')}</label>
          <button class="btn" id="exp-votes-csv">${t('table.votesCsv')}</button>
          <button class="btn" id="exp-matrix-csv">${t('table.matrixCsv')}</button>
        </div>
      </div>

      ${!Store.responses.length ? `<div class="notice warn"><p class="small">${t('table.noResponses')}</p></div>` : ''}

      <section class="card">
        <div class="card-head">
          <h2>${t('table.matrix')}</h2>
          <div class="chart-controls">${Analysis.criterionHTML()}<span class="badge">${t('table.netBadge')}</span></div>
        </div>
        <div class="table-wrap">
          <table class="data-table matrix-table" id="matrix-table">
            <thead>${head}</thead><tbody>${rows}</tbody>
          </table>
        </div>
        <div class="legend">
          <span><b style="color:var(--pos)">+2</b> ${t('table.legendPos')}</span>
          <span><b style="color:var(--pos); background:var(--pos-soft); padding:0 .4em; border-radius:.3em">↔ +1</b> ${t('table.legendMutual')}</span>
          <span><b style="color:var(--neg)">−1</b> ${t('table.legendNeg')}</span>
          <span>${t('table.legendBlank')}</span>
        </div>
      </section>

      <div class="grid-2">
        <section class="card">
          <h3>${t('table.positiveChoices')}</h3>
          <h4 class="muted tiny" style="text-transform:uppercase; letter-spacing:.05em; margin-bottom: var(--space-3)">${t('table.mutual')}</h4>
          <div class="chips">${mutualChips.join('') || `<span class="muted small">${t('table.noneYet')}</span>`}</div>
          <h4 class="muted tiny" style="text-transform:uppercase; letter-spacing:.05em; margin: var(--space-5) 0 var(--space-3)">${t('table.oneWay')}</h4>
          <div class="chips">${posChips.join('') || `<span class="muted small">${t('table.noneYet')}</span>`}</div>
        </section>
        <section class="card">
          <h3>${t('table.negativeChoices')}</h3>
          <p class="muted small" style="margin-bottom: var(--space-3)">${t('table.negHint')}</p>
          <div class="chips">${negChips.join('') || `<span class="muted small">${t('table.noneYet')}</span>`}</div>
        </section>
      </div>`;

    Analysis.bindCriterion(el, () => this.renderView(el));
    el.querySelector('#tb-anon').addEventListener('change', e => { Store.exportAnon = e.target.checked; });
    // Exports always cover every question, whatever the on-screen filter is.
    el.querySelector('#exp-votes-csv').addEventListener('click', () => {
      const ds = Exporter.dataset();
      this.download('sociostudy-votes.csv', this.votesCSV(ds.a, ds.c), 'text/csv;charset=utf-8');
      toast(t('toast.votesCsv'));
    });
    el.querySelector('#exp-matrix-csv').addEventListener('click', () => {
      const ds = Exporter.dataset();
      this.download('sociostudy-matrix.csv', this.matrixCSV(ds.a, ds.c), 'text/csv;charset=utf-8');
      toast(t('toast.matrixCsv'));
    });
  },

  /** One cell of the sociomatrix: voter row v, target column tg. */
  cellHTML(a, v, tg) {
    if (v.id === tg.id) return '<td class="self"></td>';
    const p = (a.pos[v.id] || {})[tg.id] || 0;
    const n = (a.neg[v.id] || {})[tg.id] || 0;
    if (!p && !n) return '<td class="empty"></td>';
    const net = p - n;
    const mutual = p > 0 && ((a.pos[tg.id] || {})[v.id] || 0) > 0;
    const cls = mutual ? 'mutual' : net > 0 ? 'pos' : 'neg';
    const arrow = mutual ? '↔' : p > 0 ? '→' : '↛';
    const val = net > 0 ? `+${net}` : `${net}`;
    return `<td class="cell ${cls}" title="${esc(tp('table.cellTitle', v.name, arrow, tg.name, p, n))}">${mutual || p > 0 ? arrow + ' ' : ''}${val}</td>`;
  },

  /* ---------- Exports ---------- */

  download(filename, content, mime) {
    // Prefix CSVs with a UTF-8 BOM so Excel renders Cyrillic correctly.
    const body = /^text\/csv/.test(mime || '') ? '\uFEFF' + content : content;
    const blob = new Blob([body], { type: mime || 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url; el.download = filename;
    document.body.appendChild(el);
    el.click();
    el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },

  /**
   * Quote a CSV cell. Text that a spreadsheet could read as a formula
   * (starts with = + - @) gets a leading apostrophe; real numbers are left alone.
   */
  csvCell(v) {
    if (typeof v !== 'number') {
      v = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v)) v = "'" + v;
    } else v = String(v);
    return /[",;\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  },

  row(cells) { return cells.map(x => this.csvCell(x)).join(','); },

  /** Edge-list CSV: one row per voter→target pair. */
  votesCSV(a, c) {
    const nameOf = id => { const k = c.roster.find(x => x.id === id); return k ? k.name : id; };
    const lines = [this.row([
      t('csv.voterId'), t('csv.voterName'), t('csv.targetId'), t('csv.targetName'),
      t('csv.posVotes'), t('csv.negVotes'), t('csv.net'), t('csv.mutual'), t('csv.arrow'),
    ])];
    const pair = (from, to) => {
      const p = (a.pos[from] || {})[to] || 0;
      const n = (a.neg[from] || {})[to] || 0;
      const mutual = p > 0 && ((a.pos[to] || {})[from] || 0) > 0;
      const arrow = mutual ? '↔' : p > 0 ? '→' : '↛';
      lines.push(this.row([from, nameOf(from), to, nameOf(to), p, n, p - n, mutual ? 'TRUE' : 'FALSE',
        `${nameOf(from)} ${arrow} ${nameOf(to)}`]));
    };
    const ids = c.roster.map(k => k.id);
    ids.forEach(from => ids.forEach(to => { if (from !== to) pair(from, to); }));
    return lines.join('\n');
  },

  /** Full sociomatrix as CSV (net scores). Column labels are unique even for equal first names. */
  matrixCSV(a, c) {
    const labels = uniqueLabels(c.roster);
    const lines = [this.row([t('csv.voterTarget')].concat(c.roster.map(k => labels[k.id])))];
    c.roster.forEach(v => {
      lines.push(this.row([labels[v.id]].concat(c.roster.map(tg => {
        if (v.id === tg.id) return '';
        const p = (a.pos[v.id] || {})[tg.id] || 0;
        const n = (a.neg[v.id] || {})[tg.id] || 0;
        return p || n ? p - n : '';
      }))));
    });
    return lines.join('\n');
  },

  /** Per-child summary. Column names are plain words (see i18n csv.*). */
  summaryCSV(a, c) {
    const d = c.options.decimals;
    const lines = [this.row([
      t('csv.id'), t('csv.name'), t('csv.gender'), t('csv.age'), t('csv.band'),
      t('csv.posRecv'), t('csv.negRecv'), t('csv.score'), t('csv.impact'),
      t('csv.zP'), t('csv.zN'), t('csv.zSI'), t('csv.zSP'), t('csv.status'),
      t('csv.pSame'), t('csv.pCross'), t('csv.nSame'), t('csv.nCross'),
      t('csv.spSame'), t('csv.spCross'), t('csv.spAdj'), t('csv.mutualWith'),
    ])];
    a.children.forEach(k => {
      lines.push(this.row([
        k.id, k.name, genderLabel(k.gender), k.age == null ? '' : k.age, k.band,
        k.P, k.N, k.SP, k.SI,
        Analysis.fmt(k.zP, d), Analysis.fmt(k.zN, d), Analysis.fmt(k.zSI, d), Analysis.fmt(k.zSP, d),
        statusLabel(k.status), k.P_same, k.P_cross, k.N_same, k.N_cross,
        k.SP_same, k.SP_cross,
        k.SP_adj == null ? '' : Analysis.fmt(k.SP_adj, d),
        k.mutualWith.join('; '),
      ]));
    });
    return lines.join('\n');
  },
};
