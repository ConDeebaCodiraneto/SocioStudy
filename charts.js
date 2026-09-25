/* ============================================================
   charts.js — Chart.js visualizations
   1. Linear chart  — positive / negative / overall score per child
   2. Step chart    — same data, stepped lines
   3. Radar         — per-child profile, every axis relative to the
                      class maximum (0–100 %) so the axes are comparable
   4. Distribution  — histogram by gender
   On-screen charts follow the light/dark theme; exported PNGs always
   use a fixed light theme on a white background so they stay readable
   wherever they are opened.
   ============================================================ */

const Charts = {
  sortMode: 'sp',     // 'sp' | 'p' | 'name'
  radarChild: null,   // child id
  distMetric: 'SP',   // 'P' | 'N' | 'SP'

  renderView(el) {
    const c = Store.config;
    if (!c.roster.length) {
      el.innerHTML = emptyState(t('ch.empty'),
        `<button class="btn primary" data-goto="setup">${t('goToSetup')}</button>`);
      return;
    }
    if (!Store.responses.length) {
      el.innerHTML = emptyState(t('ch.emptyNoResp'),
        `<button class="btn primary" data-action="load-demo">${t('setup.loadDemo')}</button>`);
      return;
    }
    const a = Analysis.forView();

    el.innerHTML = `
      <div class="page-head">
        <div><h1>${t('ch.title')}</h1><p class="muted">${t('ch.desc')}</p></div>
        <div class="chart-controls" style="margin:0">
          ${Analysis.criterionHTML()}
          <label>${t('ch.sortBy')}
            ${DD.html('ch-sort', [
              { value: 'sp', label: t('ch.sort.sp') },
              { value: 'p', label: t('ch.sort.p') },
              { value: 'name', label: t('ch.sort.name') },
            ], this.sortMode, 'id="ch-sort"')}</label>
        </div>
      </div>
      <div class="grid-2">
        <section class="card">
          <h2>${t('ch.linear')}</h2>
          <div class="chart-box"><canvas id="ch-linear" role="img" aria-label="${esc(t('ch.ariaLinear'))}"></canvas></div>
        </section>
        <section class="card">
          <h2>${t('ch.step')}</h2>
          <div class="chart-box"><canvas id="ch-step" role="img" aria-label="${esc(t('ch.ariaStep'))}"></canvas></div>
        </section>
        <section class="card">
          <div class="card-head"><h2>${t('ch.radar')}</h2>
            <label>${t('ch.child')} <span id="ch-child-holder"></span></label>
          </div>
          <div class="chart-box tall"><canvas id="ch-radar" role="img" aria-label="${esc(t('ch.ariaRadar'))}"></canvas></div>
        </section>
        <section class="card">
          <div class="card-head"><h2>${t('ch.dist')}</h2>
            <label>${t('ch.metric')}
              ${DD.html('ch-dist', [
                { value: 'SP', label: this.metricLabel('SP') },
                { value: 'P', label: this.metricLabel('P') },
                { value: 'N', label: this.metricLabel('N') },
              ], this.distMetric, 'id="ch-dist"')}</label>
          </div>
          <div class="chart-box"><canvas id="ch-dist-canvas" role="img" aria-label="${esc(t('ch.ariaDist'))}"></canvas></div>
        </section>
      </div>`;

    if (!this.radarChild || !a.children.some(k => k.id === this.radarChild)) {
      this.radarChild = a.children.length ? a.children[0].id : null;
    }
    const childSel = el.querySelector('#ch-child-holder');
    childSel.innerHTML = DD.html('ch-child',
      [...a.children].sort((x, y) => x.name.localeCompare(y.name)).map(k => ({ value: k.id, label: k.name })),
      this.radarChild, '');

    this.buildAll(a);

    Analysis.bindCriterion(el, () => this.renderView(el));
    el.querySelector('#ch-sort').addEventListener('ddchange', e => { this.sortMode = e.target.dataset.value; this.buildAll(a); });
    childSel.addEventListener('ddchange', e => { this.radarChild = e.target.dataset.value; this.mount('ch-radar', this.config('radar', a, { childId: this.radarChild })); });
    el.querySelector('#ch-dist').addEventListener('ddchange', e => { this.distMetric = e.target.dataset.value; this.mount('ch-dist-canvas', this.config('dist', a, { metric: this.distMetric })); });
  },

  metricLabel(m) { return m === 'P' ? t('ch.legendP') : m === 'N' ? t('ch.legendN') : t('ch.legendSP'); },

  sortedKids(a) {
    const kids = [...a.children];
    if (this.sortMode === 'name') kids.sort((x, y) => x.name.localeCompare(y.name));
    else if (this.sortMode === 'p') kids.sort((x, y) => y.P - x.P || x.name.localeCompare(y.name));
    else kids.sort((x, y) => y.SP - x.SP || y.P - x.P || x.name.localeCompare(y.name));
    return kids;
  },

  /** Colours and font: the live theme on screen, a fixed light theme for exports. */
  theme(forExport) {
    if (forExport) return { ink: '#3a3a3a', grid: 'rgba(0,0,0,0.12)', font: 'Inter, "Segoe UI", system-ui, sans-serif' };
    const style = getComputedStyle(document.documentElement);
    return {
      ink: style.getPropertyValue('--chart-ink').trim() || '#666',
      grid: style.getPropertyValue('--chart-grid').trim() || 'rgba(0,0,0,.1)',
      font: style.getPropertyValue('--font-body').trim() || 'sans-serif',
    };
  },

  /** Paints a white background behind the chart (so exported PNGs are not transparent). */
  whiteBackground: {
    id: 'whiteBackground',
    beforeDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    },
  },

  seriesData(kids) {
    return [
      { label: t('ch.legendP'), data: kids.map(k => k.P), borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,.12)' },
      { label: t('ch.legendN'), data: kids.map(k => k.N), borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,.12)' },
      { label: t('ch.legendSP'), data: kids.map(k => k.SP), borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,.12)' },
    ];
  },

  /**
   * Chart.js configuration for one chart.
   * type: 'linear' | 'step' | 'radar' | 'dist'
   * o: { forExport, childId, metric }
   */
  config(type, a, o) {
    o = o || {};
    const th = this.theme(o.forExport);
    const tick = { color: th.ink, font: { family: th.font, size: 11 } };
    const common = {
      responsive: !o.forExport,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: th.ink, font: { family: th.font, size: 12 } } } },
    };
    if (o.forExport) { common.animation = false; common.devicePixelRatio = 1; }
    const plugins = o.forExport ? [this.whiteBackground] : [];
    const axes = {
      x: { ticks: { ...tick, maxRotation: 60, minRotation: 30 }, grid: { color: th.grid } },
      y: { ticks: tick, grid: { color: th.grid } },
    };

    if (type === 'linear' || type === 'step') {
      const kids = this.sortedKids(a);
      const names = uniqueLabels(kids);
      const stepped = type === 'step';
      return {
        type: 'line', plugins,
        data: {
          labels: kids.map(k => names[k.id]),
          datasets: this.seriesData(kids).map(s => ({
            ...s, stepped, tension: stepped ? 0 : 0.3,
            pointRadius: stepped ? 3 : 4, borderWidth: stepped ? 2 : 2.5,
          })),
        },
        options: { ...common, interaction: { mode: 'nearest', intersect: false }, scales: axes },
      };
    }

    if (type === 'radar') {
      const k = a.children.find(x => x.id === o.childId) || a.children[0];
      if (!k) return null;
      const max = key => Math.max(1, ...a.children.map(x => x[key]));
      const keys = ['P', 'N', 'mutualCount', 'given'];
      const raw = keys.map(key => k[key]);
      const pct = keys.map(key => Math.round(100 * k[key] / max(key)));
      return {
        type: 'radar', plugins,
        data: {
          labels: [t('ch.axP'), t('ch.axN'), t('ch.axMutual'), t('ch.axGiven')],
          datasets: [{ label: k.name, data: pct, borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,.18)', pointRadius: 4, borderWidth: 2.5 }],
        },
        options: {
          ...common,
          plugins: {
            ...common.plugins,
            tooltip: { callbacks: { label: ctx => `${ctx.label}: ${raw[ctx.dataIndex]}` } },
          },
          scales: {
            r: {
              min: 0, max: 100,
              ticks: { stepSize: 25, color: th.ink, backdropColor: 'transparent', callback: v => v + '%' },
              grid: { color: th.grid }, angleLines: { color: th.grid },
              pointLabels: { color: th.ink, font: { family: th.font, size: 12 } },
            },
          },
        },
      };
    }

    // distribution
    const metric = o.metric || this.distMetric;
    const vals = a.children.map(k => k[metric]);
    const min = Math.min(0, ...vals), max = Math.max(1, ...vals);
    const bins = [];
    for (let v = min; v <= max; v++) bins.push(v);
    const count = (gender, v) => a.children.filter(k => k.gender === gender && k[metric] === v).length;
    return {
      type: 'bar', plugins,
      data: {
        labels: bins.map(b => String(b)),
        datasets: [
          { label: t('ch.boys'), data: bins.map(b => count('boy', b)), backgroundColor: '#2563ebcc', borderRadius: 5 },
          { label: t('ch.girls'), data: bins.map(b => count('girl', b)), backgroundColor: '#db2777cc', borderRadius: 5 },
          { label: t('ch.other'), data: bins.map(b => count('other', b)), backgroundColor: '#9333eacc', borderRadius: 5 },
        ],
      },
      options: {
        ...common,
        scales: {
          x: { ...axes.x, title: { display: true, text: this.metricLabel(metric), color: th.ink } },
          y: { ...axes.y, title: { display: true, text: t('ch.distY'), color: th.ink }, ticks: { ...tick, precision: 0 } },
        },
      },
    };
  },

  buildAll(a) {
    this.mount('ch-linear', this.config('linear', a));
    this.mount('ch-step', this.config('step', a));
    this.mount('ch-radar', this.config('radar', a, { childId: this.radarChild }));
    this.mount('ch-dist-canvas', this.config('dist', a, { metric: this.distMetric }));
  },

  /** (Re)build the chart shown in the canvas with this id. */
  mount(id, cfg) {
    const old = window.Chart && Chart.getChart(id);
    if (old) old.destroy();
    const canvas = document.getElementById(id);
    if (canvas && cfg) new Chart(canvas, cfg);
  },

  /** Render one chart on a detached canvas and return PNG base64 (used by the ZIP export). */
  chartPNG(type, a, opts) {
    opts = opts || {};
    const cfg = this.config(type, a, { ...opts, forExport: true });
    if (!cfg) return null;
    const canvas = document.createElement('canvas');
    canvas.width = opts.W || 1100;
    canvas.height = opts.H || 560;
    const chart = new Chart(canvas, cfg);
    const b64 = canvas.toDataURL('image/png').split(',')[1];
    chart.destroy();
    return b64;
  },
};
