/* ============================================================
   sociogram.js — force-directed sociogram (D3)
   One sphere per child (size = positive votes received, relative
   to the most-chosen child), directed arrows for votes, green
   bidirectional edges for mutual positive ties, dashed red for
   negative choices. Drag, zoom, filter.
   All strings are localized (i18n.js).
   ============================================================ */

const Sociogram = {
  filters: { edge: 'all', minWeight: 1, colorBy: 'gender', band: 'all', genders: { boy: true, girl: true, other: true } },
  pos: {},   // last layout position per child id — filters do not make the spheres jump

  renderView(el) {
    const c = Store.config;
    if (!c.roster.length) {
      el.innerHTML = emptyState(t('so.empty'),
        `<button class="btn primary" data-goto="setup">${t('goToSetup')}</button>`);
      return;
    }
    if (!Store.responses.length) {
      el.innerHTML = emptyState(t('so.emptyNoResp'),
        `<button class="btn primary" data-action="load-demo">${t('setup.loadDemo')}</button>`);
      return;
    }
    const a = Analysis.forView();
    const f = this.filters;

    // A vote count on one edge can never exceed the number of questions of that kind.
    const nPos = c.questions.filter(q => q.type === 'positive').length;
    const nNeg = c.questions.filter(q => q.type === 'negative').length;
    const sliderMax = Analysis.criterion !== 'all' ? 1 : Math.max(1, nPos, nNeg);
    if (f.minWeight > sliderMax) f.minWeight = sliderMax;

    el.innerHTML = `
      <div class="page-head">
        <div><h1>${t('so.title')}</h1><p class="muted">${t('so.desc')}</p></div>
      </div>
      <section class="card socio-controls" style="display:flex">
        ${Analysis.criterionHTML()}
        <label>${t('so.edges')}
          ${DD.html('so-edge', [
            { value: 'all', label: t('so.edgeAll') },
            { value: 'pos', label: t('so.edgePos') },
            { value: 'neg', label: t('so.edgeNeg') },
            { value: 'mutual', label: t('so.edgeMutual') },
          ], f.edge, 'id="so-edge"')}</label>
        <label>${t('so.minVotes')} <span id="so-min-val">${f.minWeight}</span>
          <input type="range" id="so-min" min="1" max="${sliderMax}" step="1" value="${f.minWeight}" ${sliderMax === 1 ? 'disabled' : ''} style="padding:0"></label>
        <label>${t('so.colorBy')}
          ${DD.html('so-color', [
            { value: 'gender', label: t('so.colorGender') },
            { value: 'status', label: t('so.colorStatus') },
          ], f.colorBy, 'id="so-color"')}</label>
        <label>${t('so.band')}
          ${DD.html('so-band', [{ value: 'all', label: t('filter.all') }].concat(
            Analysis.AGE_BANDS.map(b => ({ value: b.label, label: b.label })),
          ), f.band, 'id="so-band"')}</label>
        <fieldset>
          <legend class="tiny" style="color:var(--ink-muted)">${t('so.show')}</legend>
          <label class="check"><input type="checkbox" class="so-g" value="boy" ${f.genders.boy ? 'checked' : ''}> ${t('genderPl.boy')}</label>
          <label class="check"><input type="checkbox" class="so-g" value="girl" ${f.genders.girl ? 'checked' : ''}> ${t('genderPl.girl')}</label>
          <label class="check"><input type="checkbox" class="so-g" value="other" ${f.genders.other ? 'checked' : ''}> ${t('genderPl.other')}</label>
        </fieldset>
        <button class="btn" id="so-relayout">${t('so.relayout')}</button>
      </section>
      <div class="socio-layout">
        <div class="card socio-canvas" id="socio-canvas"></div>
        <aside class="card socio-details" id="socio-details">
          <p class="muted small">${t('so.hint')}</p>
        </aside>
      </div>
      <div class="legend">
        <span><b style="color:var(--pos-strong)">━━</b> ${t('so.legendPos')}</span>
        <span><b style="color:var(--pos-strong)">━━</b> ${t('so.legendMutual')}</span>
        <span><b style="color:var(--neg-strong)">╌╌</b> ${t('so.legendNeg')}</span>
        <span>${t('so.legendSize')}</span>
      </div>`;

    Analysis.bindCriterion(el, () => this.renderView(el));
    el.querySelector('#so-edge').addEventListener('ddchange', e => { f.edge = e.target.dataset.value; this.draw(a); });
    el.querySelector('#so-min').addEventListener('input', e => {
      f.minWeight = Number(e.target.value);
      el.querySelector('#so-min-val').textContent = f.minWeight;
      this.draw(a);
    });
    el.querySelector('#so-color').addEventListener('ddchange', e => { f.colorBy = e.target.dataset.value; this.draw(a); });
    el.querySelector('#so-band').addEventListener('ddchange', e => { f.band = e.target.dataset.value; this.draw(a); });
    el.querySelectorAll('.so-g').forEach(cb => cb.addEventListener('change', () => {
      el.querySelectorAll('.so-g').forEach(x => f.genders[x.value] = x.checked);
      this.draw(a);
    }));
    el.querySelector('#so-relayout').addEventListener('click', () => this.draw(a, { shuffle: true }));

    this.draw(a);
  },

  nodeColor(k, filters) {
    if ((filters || this.filters).colorBy === 'status') return STATUS_META[k.status].color;
    return GENDER_META[k.gender].color;
  },

  draw(a, opts) {
    const wrap = document.getElementById('socio-canvas');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (opts && opts.shuffle) this.pos = {};
    const W = Math.max(wrap.clientWidth - 2, 300);
    const H = W < 520 ? 460 : 560;
    this.buildInto(wrap, a, { interactive: true, W, H, shuffle: !!(opts && opts.shuffle) });
  },

  /**
   * Build the sociogram SVG inside `wrap`.
   * opts: { interactive, W, H, ticks, filters, shuffle }
   * interactive=false runs the simulation synchronously (headless export).
   */
  buildInto(wrap, a, opts) {
    opts = opts || {};
    const f = opts.filters || this.filters;
    const W = opts.W || 1000, H = opts.H || 620;
    const labels = uniqueLabels(a.children);
    const maxP = Math.max(1, ...a.children.map(k => k.P));
    // Sphere size is relative to the most-chosen child, so it never saturates.
    const R = d => 13 + 22 * Math.sqrt(d.P / maxP);

    const svg = d3.select(wrap).append('svg')
      .attr('viewBox', [0, 0, W, H]).attr('width', W).attr('height', H);
    const g = svg.append('g');
    if (opts.interactive)
      svg.call(d3.zoom().scaleExtent([0.25, 3]).on('zoom', e => g.attr('transform', e.transform)));

    const kids = a.children.filter(k =>
      f.genders[k.gender] && (f.band === 'all' || k.band === f.band));

    /* ----- Build the edge list from the vote matrices -----
       A direction counts when it carries at least `minWeight` votes.
       If both directions count, one bidirectional (mutual) edge is drawn;
       if only one does, that one-way arrow is drawn on its own. */
    const links = [];
    const min = f.minWeight;
    const showPos = f.edge === 'all' || f.edge === 'pos' || f.edge === 'mutual';
    const showNeg = f.edge === 'all' || f.edge === 'neg';
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const A = kids[i], B = kids[j];
        const pAB = (a.pos[A.id] || {})[B.id] || 0, pBA = (a.pos[B.id] || {})[A.id] || 0;
        const nAB = (a.neg[A.id] || {})[B.id] || 0, nBA = (a.neg[B.id] || {})[A.id] || 0;
        const okAB = pAB >= min && pAB > 0, okBA = pBA >= min && pBA > 0;
        if (f.edge === 'mutual') {
          if (okAB && okBA) links.push({ u: A.id, v: B.id, kind: 'mutual', weight: (pAB + pBA) / 2 });
          continue;
        }
        if (showPos) {
          if (okAB && okBA) links.push({ u: A.id, v: B.id, kind: 'mutual', weight: (pAB + pBA) / 2 });
          else {
            if (okAB) links.push({ u: A.id, v: B.id, kind: 'pos', weight: pAB });
            if (okBA) links.push({ u: B.id, v: A.id, kind: 'pos', weight: pBA });
          }
        }
        if (showNeg && nAB >= min && nAB > 0) links.push({ u: A.id, v: B.id, kind: 'neg', weight: nAB });
        if (showNeg && nBA >= min && nBA > 0) links.push({ u: B.id, v: A.id, kind: 'neg', weight: nBA });
      }
    }

    const nodes = kids.map(k => {
      const n = Object.assign({}, k);
      const p = this.pos[k.id];
      if (opts.shuffle) { n.x = 60 + Math.random() * (W - 120); n.y = 60 + Math.random() * (H - 120); }
      else if (opts.interactive && p) { n.x = p.x; n.y = p.y; }
      return n;
    });
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    links.forEach(l => { l.source = nodeById.get(l.u); l.target = nodeById.get(l.v); });
    // Curve the two directions apart when both are drawn, so arrowheads never overlap.
    links.forEach(l => {
      l.curved = links.some(o => o.source === l.target && o.target === l.source);
    });

    /* ----- Defs: arrowheads + sphere gradients ----- */
    const defs = svg.append('defs');
    const marker = (id, color, size, orient) => {
      const m = defs.append('marker')
        .attr('id', id).attr('viewBox', '0 -5 10 10')
        .attr('refX', 8).attr('refY', 0)
        .attr('markerWidth', size).attr('markerHeight', size)
        .attr('orient', orient || 'auto');
      m.append('path').attr('d', 'M0,-4.5L9,0L0,4.5').attr('fill', color);
    };
    marker('arrow-pos', '#16a34a', 6);
    marker('arrow-neg', '#dc2626', 6);
    marker('arrow-mutual', '#16a34a', 8);
    marker('arrow-mutual-start', '#16a34a', 8, 'auto-start-reverse');

    nodes.forEach(n => {
      const base = this.nodeColor(n, f);
      const grad = defs.append('radialGradient')
        .attr('id', 'grad-' + n.id).attr('cx', '32%').attr('cy', '30%').attr('r', '75%');
      grad.append('stop').attr('offset', '0%').attr('stop-color', d3.color(base).brighter(1.7).formatHex());
      grad.append('stop').attr('offset', '100%').attr('stop-color', base);
    });

    /* ----- Links ----- */
    const link = g.append('g').selectAll('path').data(links).join('path')
      .attr('class', d => 'so-link ' + d.kind)
      .attr('stroke-width', d => d.kind === 'mutual' ? 2.5 + d.weight : 1.2 + d.weight * 0.7)
      .attr('marker-end', d => `url(#arrow-${d.kind})`);
    link.filter(d => d.kind === 'mutual').attr('marker-start', 'url(#arrow-mutual-start)');

    const linkPath = d => {
      const s = d.source, e = d.target;
      if (!d.curved) return `M${s.x},${s.y}L${e.x},${e.y}`;
      const dx = e.x - s.x, dy = e.y - s.y;
      const dr = Math.hypot(dx, dy) || 1;
      // Opposite sweep flags bend the two directions apart.
      const sweep = s.id < e.id ? 1 : 0;
      return `M${s.x},${s.y}A${dr * 1.2},${dr * 1.2} 0 0 ${sweep} ${e.x},${e.y}`;
    };

    /* ----- Nodes (spheres) ----- */
    const node = g.append('g').selectAll('g.so-node').data(nodes, d => d.id).join('g')
      .attr('class', 'so-node');
    node.append('circle')
      .attr('r', d => R(d))
      .attr('fill', d => `url(#grad-${d.id})`)
      .attr('stroke', d => d3.color(this.nodeColor(d, f)).darker(0.9).formatHex())
      .attr('stroke-width', 1.5);
    node.append('text')
      .text(d => labels[d.id])
      .attr('dy', d => R(d) + 15)
      .attr('text-anchor', 'middle');
    node.append('title').text(d => tp('so.nodeTitle', d));

    /* ----- Simulation ----- */
    const applyPositions = () => {
      // Keep spheres (and their labels) inside the canvas.
      const pad = 40;
      nodes.forEach(d => {
        const r = R(d);
        d.x = Math.max(pad + r, Math.min(W - pad - r, d.x));
        d.y = Math.max(pad + r, Math.min(H - pad - r, d.y));
        if (opts.interactive) this.pos[d.id] = { x: d.x, y: d.y };
      });
      link.attr('d', linkPath);
      node.attr('transform', d => `translate(${d.x},${d.y})`);
    };

    const narrow = W < 520;
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id)
        .distance(d => (narrow ? 80 : 115) - Math.min(d.weight, 5) * 12)
        .strength(d => Math.min(1, 0.3 + d.weight * 0.12)))
      .force('charge', d3.forceManyBody().strength(narrow ? -300 : -520))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide().radius(d => R(d) + (narrow ? 10 : 16)));

    if (opts.interactive) {
      // With remembered positions the layout only needs a gentle settle.
      if (kids.length && kids.every(k => this.pos[k.id])) sim.alpha(0.25);
      sim.on('tick', applyPositions);

      /* ----- Drag ----- */
      node.call(d3.drag()
        .on('start', (e, d) => { sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { sim.alphaTarget(0); d.fx = null; d.fy = null; }));

      /* ----- Click → details ----- */
      node.on('click', (e, d) => this.showDetails(d));
    } else {
      // Headless: run the simulation synchronously, then apply positions once.
      sim.stop();
      const ticks = opts.ticks || 400;
      for (let i = 0; i < ticks; i++) sim.tick();
      sim.alpha(0);
      applyPositions();
    }

    return svg.node();
  },

  /**
   * Serialize the sociogram as a standalone SVG string (computed styles
   * inlined, so it renders outside the app). Always drawn with the light
   * theme and default filters, whatever the screen currently shows.
   */
  exportSVG(a) {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-99999px;top:0;';
    document.body.appendChild(holder);
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    try {
      const filters = {
        edge: 'all', minWeight: 1, band: 'all',
        colorBy: a.statusOk ? 'status' : 'gender',
        genders: { boy: true, girl: true, other: true },
      };
      const svgNode = this.buildInto(holder, a, { interactive: false, W: 1100, H: 700, ticks: 420, filters });
      const clone = svgNode.cloneNode(true);
      const src = [svgNode, ...svgNode.querySelectorAll('*')];
      const dst = [clone, ...clone.querySelectorAll('*')];
      const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
        'stroke-opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'opacity'];
      src.forEach((s, i) => {
        const cs = getComputedStyle(s);
        props.forEach(p => {
          const v = cs.getPropertyValue(p);
          if (v) dst[i].setAttribute(p, v);
        });
      });
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', '1100');
      clone.setAttribute('height', '700');
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('width', '1100'); bg.setAttribute('height', '700');
      bg.setAttribute('fill', getComputedStyle(root).getPropertyValue('--surface').trim() || '#ffffff');
      clone.insertBefore(bg, clone.firstChild);
      return { node: clone, text: new XMLSerializer().serializeToString(clone) };
    } finally {
      if (prevTheme == null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', prevTheme);
      holder.remove();
    }
  },

  showDetails(k) {
    const el = document.getElementById('socio-details');
    if (!el) return;
    const chosePos = k.chose.filter(v => v.type === 'positive');
    const choseNeg = k.chose.filter(v => v.type === 'negative');
    const byPos = k.chosenBy.filter(v => v.type === 'positive');
    const byNeg = k.chosenBy.filter(v => v.type === 'negative');
    el.innerHTML = `
      <h3>${esc(k.name)}</h3>
      <div class="chips" style="margin: var(--space-3) 0">
        <span class="chip"><span class="dot" style="background:${GENDER_META[k.gender].color}"></span>${genderLabel(k.gender)}</span>
        <span class="chip">${tp('so.age', k.age == null ? '–' : k.age)}</span>
        <span class="status-badge" style="--c:${STATUS_META[k.status].color}">${statusLabel(k.status)}</span>
      </div>
      <div class="detail-grid">
        <div><div class="k">${t('th.pos')}</div><div class="v">${k.P}</div></div>
        <div><div class="k">${t('th.neg')}</div><div class="v">${k.N}</div></div>
        <div><div class="k">${t('th.score')}</div><div class="v">${k.SP}</div></div>
        <div><div class="k">${t('th.mutual')}</div><div class="v">${k.mutualWith.length}</div></div>
      </div>
      <h4>${tp('so.chose', chosePos.length + choseNeg.length)}</h4>
      <div class="chips">
        ${chosePos.map(v => `<span class="chip pos">→ ${esc(v.name)}</span>`).join('')}
        ${choseNeg.map(v => `<span class="chip neg">↛ ${esc(v.name)}</span>`).join('') || ''}
        ${!chosePos.length && !choseNeg.length ? `<span class="muted small">${t('so.noChoices')}</span>` : ''}
      </div>
      <h4>${tp('so.chosenBy', byPos.length + byNeg.length)}</h4>
      <div class="chips">
        ${byPos.map(v => `<span class="chip pos">${esc(v.name)} →</span>`).join('')}
        ${byNeg.map(v => `<span class="chip neg">${esc(v.name)} ↛</span>`).join('') || ''}
        ${!byPos.length && !byNeg.length ? `<span class="muted small">${t('so.noVotes')}</span>` : ''}
      </div>
      <h4>${t('so.mutualH')}</h4>
      <div class="chips">${k.mutualWith.length ? k.mutualWith.map(n => `<span class="chip mutual">↔ ${esc(n)}</span>`).join('') : `<span class="muted small">${t('so.noneYet')}</span>`}</div>`;
  },
};
