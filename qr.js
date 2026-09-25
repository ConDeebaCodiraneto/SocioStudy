/* ============================================================
   qr.js — QR code for the class questionnaire + the teacher's
   "Questionnaire & QR" tab.

   QR: rendered locally with qrcode-generator (vendor/qrcode.js) —
   nothing is sent anywhere. The link inside the code belongs to
   one class (see sync.js) and stops working when the teacher
   deletes the class data.
   ============================================================ */

const QR = {
  /** SVG markup of a QR code for `url`. */
  svg(url) {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 12, scalable: true, alt: 'QR' });
  },

  render(container, url) {
    container.innerHTML = url ? this.svg(url) : '';
  },

  /** Printable page with just the QR code, the class name and short instructions. */
  printSheet(url, className) {
    if (!url) { toast(t('qr.printFirst')); return; }
    const w = window.open('', '_blank', 'width=520,height=700');
    if (!w) { toast(t('qr.popupBlocked')); return; }
    w.document.write(`<!DOCTYPE html><html lang="${I18N.lang}"><head><meta charset="UTF-8"><title>${esc(tp('qr.sheetTitle', className))}</title>
      <style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;padding:48px 24px}
      svg{width:320px;height:320px}h1{font-size:22px}p{color:#555;font-size:14px;margin-top:8px}</style></head><body>
      <h1>${esc(tp('qr.sheetH1', className))}</h1>
      ${this.svg(url)}
      <p>${esc(t('qr.sheetScan'))}</p>
      <p style="font-size:12px;color:#999;word-break:break-all">${esc(url)}</p></body></html>`);
    w.document.close();
    w.focus();
    // Print from here (an inline script in the new window would be blocked by the page's security policy).
    setTimeout(() => { try { w.print(); } catch (e) { /* user can print manually */ } }, 350);
  },
};

/* ============================================================
   Teacher tab
   ============================================================ */

const QRView = {

  render(el) {
    const c = Store.config;
    const ready = c.roster.length >= 2 && c.questions.length >= 1;
    el.innerHTML = `
      <div class="page-head">
        <div><h1>${t('qr.title')}</h1><p class="muted">${t('qr.desc')}</p></div>
      </div>
      <div class="grid-2">
        <section class="card" id="qr-card"></section>
        <section class="card">
          <div class="card-head"><h2>${t('qr.preview')}</h2></div>
          ${ready ? '' : `<p class="muted small">${t('qr.previewHint')}</p>`}
          <div class="preview-frame" id="q-preview"></div>
          <div class="row-actions">
            <button class="btn" id="q-simulate">${t('qr.simulate')}</button>
          </div>
        </section>
      </div>`;

    this.renderCard(el.querySelector('#qr-card'));
    document.getElementById('q-simulate').addEventListener('click', () => Demo.simulateResponse());
    KidForm.mount(document.getElementById('q-preview'), {
      roster: c.roster.map(k => ({ id: k.id, name: k.name })),
      questions: c.questions.map(q => ({ id: q.id, text: q.text, type: q.type, maxChoices: q.maxChoices })),
      answered: [],
    }, { preview: true });
  },

  /* ---------- left card: three states ---------- */

  renderCard(card) {
    const c = Store.config;

    // 1. Server not reachable (page opened as a file, or a static host)
    if (Sync.available === false && !Sync.session) {
      card.innerHTML = `
        <h2>${t('qr.card')}</h2>
        <div class="notice"><p class="small"><b>${t('qr.serverH')}</b></p><p class="small muted" style="margin-top:var(--space-2)">${t('qr.serverText')}</p></div>
        <div class="row-actions"><button class="btn" id="qr-retry">${t('qr.retry')}</button></div>`;
      card.querySelector('#qr-retry').addEventListener('click', async () => { await Sync.detect(); App.refresh(); });
      return;
    }
    if (Sync.available === null) {
      card.innerHTML = `<h2>${t('qr.card')}</h2><p class="muted small">${t('kid.loading')}</p>`;
      return;
    }

    // 2. No QR code for this class yet
    if (!Sync.session) {
      const ready = Sync.readiness().ok;
      const suggestions = this.suggestions();
      card.innerHTML = `
        <h2>${t('qr.card')}</h2>
        ${ready ? '' : `<div class="notice warn"><p class="small">${t('qr.notReady')}</p><div class="row-actions"><button class="btn small" data-goto="setup">${t('goToSetup')}</button></div></div>`}
        <label>${t('qr.serverAddr')} <input id="qr-base" type="text" value="${esc(Sync.suggestBase())}" spellcheck="false" autocapitalize="off" inputmode="url"></label>
        <p class="muted small" id="qr-local-warn" style="margin:var(--space-2) 0"></p>
        ${suggestions.length ? `<div class="row-actions" style="margin-top:0"><span class="muted small">${t('qr.addrSuggested')}</span>${suggestions.map(s => `<button class="btn small" data-base="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
        <p class="muted small" style="margin:var(--space-3) 0">${t('qr.addrHint')}</p>
        <label>${t('qr.kidLang')}
          ${DD.html('qr-lang', [{ value: 'bg', label: 'Български' }, { value: 'en', label: 'English' }], I18N.lang, 'id="qr-lang"')}</label>
        <p class="muted small" style="margin:var(--space-3) 0">${t('qr.consent')}</p>
        <div class="row-actions"><button class="btn primary big" id="qr-create" ${ready ? '' : 'disabled'}>${t('qr.create')}</button></div>`;

      const base = card.querySelector('#qr-base');
      const warn = () => {
        card.querySelector('#qr-local-warn').textContent = /^(https?:\/\/)?(localhost|127\.|\[::1\])/i.test(base.value.trim()) ? t('qr.localWarn') : '';
      };
      warn();
      base.addEventListener('input', warn);
      card.querySelectorAll('[data-base]').forEach(b => b.addEventListener('click', () => { base.value = b.dataset.base; warn(); }));
      card.querySelector('#qr-create').addEventListener('click', async e => {
        const url = this.normalizeBase(base.value);
        if (!url) { toast(t('qr.invalidAddr')); return; }
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = t('qr.creating');
        const r = await Sync.create(url, card.querySelector('#qr-lang').dataset.value);
        if (r.ok) toast(t('qr.created'));
        else toast(t(r.error === 'server' ? 'qr.serverError' : 'qr.createFail'));
        App.refresh();
      });
      return;
    }

    // 3. QR code exists
    const s = Sync.session;
    const url = Sync.url();
    card.innerHTML = `
      <h2>${t('qr.card')}</h2>
      <div class="qr-box" id="qr-box">${QR.svg(url)}</div>
      <div class="qr-status">
        <span class="status-dot ${s.closed ? 'off' : 'on'}" id="qr-dot"></span>
        <b id="qr-state">${t(s.closed ? 'qr.stateClosed' : 'qr.stateOpen')}</b>
        <span class="muted">·</span>
        <span id="qr-progress">${esc(this.progressText())}</span>
      </div>
      <label>${t('qr.link')}
        <span class="link-row"><input id="qr-link" type="text" value="${esc(url)}" readonly spellcheck="false"><button class="btn" id="qr-copy">${t('qr.copy')}</button></span></label>
      <div class="row-actions">
        <button class="btn primary" id="qr-print">${t('qr.print')}</button>
        <button class="btn" id="qr-toggle">${t(s.closed ? 'qr.reopenBtn' : 'qr.closeBtn')}</button>
      </div>
      <details class="qr-more">
        <summary class="small">${t('qr.serverAddr')}</summary>
        <label style="margin-top:var(--space-3)"><input id="qr-base" type="text" value="${esc(s.base)}" spellcheck="false" autocapitalize="off" inputmode="url"></label>
        <label>${t('qr.kidLang')}
          ${DD.html('qr-lang', [{ value: 'bg', label: 'Български' }, { value: 'en', label: 'English' }], s.lang, 'id="qr-lang"')}</label>
      </details>
      <p class="muted small" style="margin:var(--space-3) 0">${esc(tp('qr.retention', s.ttlDays || (Sync.info && Sync.info.ttlDays) || 30))}</p>
      <p class="muted small">${t('qr.consent')}</p>
      <div class="row-actions"><button class="btn danger" id="qr-delete">${t('qr.deleteBtn')}</button></div>`;

    card.querySelector('#qr-copy').addEventListener('click', () => this.copy(url));
    card.querySelector('#qr-link').addEventListener('focus', e => e.target.select());
    card.querySelector('#qr-print').addEventListener('click', () => QR.printSheet(url, c.className));
    card.querySelector('#qr-toggle').addEventListener('click', async () => {
      if (await Sync.setClosed(!s.closed)) App.refresh();
    });
    card.querySelector('#qr-base').addEventListener('change', e => {
      const nb = this.normalizeBase(e.target.value);
      if (!nb) { toast(t('qr.invalidAddr')); e.target.value = s.base; return; }
      s.base = nb; Sync.saveSession(); App.refresh();
    });
    card.querySelector('#qr-lang').addEventListener('ddchange', async e => { await Sync.setLang(e.target.dataset.value); });
    card.querySelector('#qr-delete').addEventListener('click', async () => {
      if (!(await uiConfirm(t('qr.deleteConfirm')))) return;
      const ok = await Sync.destroy();
      toast(ok ? t('qr.deleted') : t('toast.onlineQueued'), ok ? 2800 : 6000);
      App.refresh();
    });
  },

  /** Update the live numbers without redrawing the whole tab. */
  updateStatus() {
    const s = Sync.session;
    const p = document.getElementById('qr-progress');
    if (!s || !p) return;
    p.textContent = this.progressText();
    const st = document.getElementById('qr-state');
    if (st) st.textContent = t(s.closed ? 'qr.stateClosed' : 'qr.stateOpen');
    const dot = document.getElementById('qr-dot');
    if (dot) dot.className = 'status-dot ' + (s.closed ? 'off' : 'on');
  },

  progressText() {
    const c = Store.config;
    const n = new Set(Store.responses.map(r => r.respondent_id).filter(id => c.roster.some(k => k.id === id))).size;
    return tp('qr.progress', n, c.roster.length);
  },

  /** "192.168.1.5:3000" → "http://192.168.1.5:3000"; returns '' when it is not a usable address. */
  normalizeBase(v) {
    v = String(v || '').trim().replace(/\/+$/, '');
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'http://' + v;
    try { const u = new URL(v); return u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '')); } catch (e) { return ''; }
  },

  suggestions() {
    const out = [];
    if (Sync.info) {
      if (Sync.info.publicUrl) out.push(Sync.info.publicUrl);
      (Sync.info.lan || []).forEach(a => out.push(a));
    }
    const base = Sync.suggestBase();
    return out.filter((a, i) => out.indexOf(a) === i && a !== base);
  },

  async copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const input = document.getElementById('qr-link');
      if (input) { input.select(); try { document.execCommand('copy'); } catch (e2) { /* ignore */ } }
    }
    toast(t('qr.copied'));
  },
};
