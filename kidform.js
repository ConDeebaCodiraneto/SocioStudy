/* ============================================================
   kidform.js — the child-friendly questionnaire
   Used by the student page (kid.html, real answers sent to the
   server) and by the teacher's preview (nothing is saved).
   It contains no navigation to anything else: there is no exit
   button and no link back to the teacher app.

   One question at a time, big tappable cards, max choices
   enforced. Names that already answered are grayed out; the
   server enforces "one answer per student" as well.
   Strings come from i18n.js (t / tp); helpers from shared.js.
   ============================================================ */

const ICON_SMILE = `<svg class="q-icon pos" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8"/><line x1="9" y1="9.5" x2="9.02" y2="9.5"/><line x1="15" y1="9.5" x2="15.02" y2="9.5"/></svg>`;
const ICON_FROWN = `<svg class="q-icon neg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 16c.9-1.2 2.1-1.8 3.5-1.8s2.6.6 3.5 1.8"/><line x1="9" y1="9.5" x2="9.02" y2="9.5"/><line x1="15" y1="9.5" x2="15.02" y2="9.5"/></svg>`;
const ICON_CHECK_BIG = `<svg class="big-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.6 2.6L16 9.5"/></svg>`;
const ICON_INFO_BIG = `<svg class="big-icon" style="color:var(--ink-faint)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 11v5M12 8h.01"/></svg>`;

const KidForm = {

  /** Full-screen message (loading, closed, unavailable, offline…). */
  message(container, o) {
    container.innerHTML = `
      <div class="kid-wrap kid-done">
        ${o.icon === 'check' ? ICON_CHECK_BIG : o.icon === 'none' ? '' : ICON_INFO_BIG}
        <h1 class="kid-title" style="justify-content:center" tabindex="-1">${esc(o.title)}</h1>
        ${o.text ? `<p class="kid-sub" style="margin-inline:auto">${esc(o.text)}</p>` : ''}
        ${o.action ? `<button class="btn primary big" id="kid-msg-action">${esc(o.action.label)}</button>` : ''}
      </div>`;
    const btn = container.querySelector('#kid-msg-action');
    if (btn) btn.addEventListener('click', o.action.onClick);
  },

  /**
   * Mount the questionnaire.
   * data: { roster: [{id, name}], questions: [{id, text, type, maxChoices}], answered: [ids] }
   * opts: { preview: bool,
   *         onSubmit(payload) -> Promise<{ok:true} | {ok:false, code}> }
   *   payload = { respondent_id, answers: [{question_id, chosen_ids}] }
   *   code: 'already_answered' | 'closed' | 'gone' | 'network' | 'invalid'
   */
  mount(container, data, opts) {
    opts = opts || {};
    const preview = !!opts.preview;
    const roster = data.roster || [], questions = data.questions || [];
    const answered = new Set(data.answered || []);

    if (roster.length < 2 || !questions.length) {
      container.innerHTML = `<div class="kid-wrap"><div class="empty-state"><h3>${esc(t('kid.pageTitle'))}</h3><p>${esc(t('kid.notConfigured'))}</p></div></div>`;
      return;
    }

    const st = { screen: 'name', respondent: null, qi: 0, sel: {}, sending: false, attempted: false };
    const nameOf = id => (roster.find(k => k.id === id) || {}).name || '';
    const avatar = (k, extra) => {
      const col = avatarColor(k.id);
      return `<span class="avatar" style="background:${col}22;color:${col};${extra || ''}">${esc(initials(k.name))}</span>`;
    };
    const top = () => { if (!preview) window.scrollTo(0, 0); };
    const focusTitle = () => { const h = container.querySelector('h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } };

    const render = () => {
      if (st.screen === 'name') renderName();
      else if (st.screen === 'confirm') renderConfirm();
      else if (st.screen === 'q') renderQuestion();
      else renderDone();
      top();
      focusTitle();
    };

    /* ---------- Pick your name ---------- */
    const renderName = () => {
      const cards = roster.map(k => {
        const done = !preview && answered.has(k.id);
        return `
        <button class="kid-card ${done ? 'answered' : ''}" data-id="${esc(k.id)}" ${done ? 'disabled' : ''} aria-disabled="${done}">
          ${avatar(k)}
          <span>${esc(k.name)}</span>
          ${done ? `<span class="answered-mark" title="${esc(t('kid.answered'))}">✓ ${esc(t('kid.answered'))}</span>` : ''}
        </button>`;
      }).join('');
      const anyAnswered = !preview && roster.some(k => answered.has(k.id));
      container.innerHTML = `
        <div class="kid-wrap">
          <div class="kid-privacy">${esc(t('kid.privacy'))}</div>
          <h1 class="kid-title">${esc(t('kid.hello'))}</h1>
          <p class="kid-sub">${esc(t('kid.tapToBegin'))}</p>
          <div class="kid-grid">${cards}</div>
          ${anyAnswered ? `<p class="kid-sub" style="margin-top:var(--space-5); font-size:var(--text-sm)">${esc(t('kid.answeredNote'))}</p>` : ''}
        </div>`;
      container.querySelectorAll('.kid-card:not(.answered)').forEach(b => b.addEventListener('click', () => {
        st.respondent = b.dataset.id;
        st.screen = 'confirm';
        render();
      }));
    };

    /* ---------- "Is that you?" — a wrong tap would lock the wrong child out ---------- */
    const renderConfirm = () => {
      const k = roster.find(x => x.id === st.respondent);
      container.innerHTML = `
        <div class="kid-wrap kid-done">
          <div style="display:flex; justify-content:center; margin-bottom:var(--space-5)">${avatar(k, 'width:84px;height:84px;font-size:var(--text-lg)')}</div>
          <h1 class="kid-title" style="justify-content:center">${esc(tp('kid.confirmName', k.name))}</h1>
          <div class="kid-nav" style="justify-content:center; margin-top:var(--space-8)">
            <button class="btn big" id="k-not-me">${esc(t('kid.notMe'))}</button>
            <button class="btn primary big" id="k-me">${esc(t('kid.yesMe'))}</button>
          </div>
        </div>`;
      container.querySelector('#k-not-me').addEventListener('click', () => { st.respondent = null; st.screen = 'name'; render(); });
      container.querySelector('#k-me').addEventListener('click', () => { st.qi = 0; st.screen = 'q'; render(); });
    };

    /* ---------- One question at a time ---------- */
    const renderQuestion = () => {
      const q = questions[st.qi];
      const max = Math.max(1, Number(q.maxChoices) || 3);
      const isLast = st.qi === questions.length - 1;
      const sel = st.sel[q.id] || (st.sel[q.id] = []);
      const step = st.qi + 1;

      const cards = roster.filter(k => k.id !== st.respondent).map(k => {
        const on = sel.includes(k.id);
        return `
        <button class="kid-card ${on ? 'on' : ''}" data-id="${esc(k.id)}" aria-pressed="${on}">
          ${avatar(k)}
          <span>${esc(k.name)}</span>
          <span class="check" aria-hidden="true">✓</span>
        </button>`;
      }).join('');

      container.innerHTML = `
        <div class="kid-wrap">
          <div class="kid-privacy">${esc(t('kid.privacy'))}</div>
          <div class="kid-progress" role="progressbar" aria-valuemin="1" aria-valuemax="${questions.length + 1}" aria-valuenow="${step}">
            <div class="bar" style="width:${Math.round(step / (questions.length + 1) * 100)}%"></div>
          </div>
          <div class="kid-qmeta">${esc(tp('kid.questionOf', step, questions.length))}</div>
          <h1 class="kid-title">${q.type === 'positive' ? ICON_SMILE : ICON_FROWN} ${esc(q.text)}</h1>
          <p class="kid-sub">${esc(q.type === 'positive' ? tp('kid.pickUpTo', max) : tp('kid.pickUpToNeg', max))}</p>
          <div class="kid-counter ${sel.length >= max ? 'full' : ''}">${esc(tp('kid.picked', sel.length, max))}</div>
          <div class="kid-grid">${cards}</div>
          <div class="kid-nav">
            <button class="btn big" id="k-back" ${st.sending ? 'disabled' : ''}>${esc(t('kid.back'))}</button>
            <button class="btn big" id="k-skip" ${st.sending ? 'disabled' : ''}>${esc(t('kid.skip'))}</button>
            <button class="btn primary big" id="k-next" ${st.sending ? 'disabled' : ''}>${esc(st.sending ? t('kid.sending') : isLast ? t('kid.finish') : t('kid.next'))}</button>
          </div>
        </div>`;

      container.querySelectorAll('.kid-card').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.id;
        const idx = sel.indexOf(id);
        if (idx >= 0) sel.splice(idx, 1);
        else if (sel.length >= max) { toast(tp('kid.tooMany', max)); return; }
        else sel.push(id);
        // Re-render in place without jumping the page back to the top.
        const y = window.scrollY;
        renderQuestion();
        window.scrollTo(0, y);
      }));
      container.querySelector('#k-back').addEventListener('click', () => {
        if (st.qi === 0) { st.screen = 'confirm'; } else st.qi--;
        render();
      });
      container.querySelector('#k-skip').addEventListener('click', () => {
        st.sel[q.id] = [];
        if (isLast) submit(); else { st.qi++; render(); }
      });
      container.querySelector('#k-next').addEventListener('click', () => {
        if (isLast) submit(); else { st.qi++; render(); }
      });
    };

    /* ---------- Final step ---------- */
    const renderDone = () => {
      container.innerHTML = `
        <div class="kid-wrap kid-done">
          ${ICON_CHECK_BIG}
          <h1 class="kid-title" style="justify-content:center">${esc(t('kid.thanks'))}</h1>
          <p class="kid-sub" style="margin-inline:auto">${esc(preview ? t('kid.previewNote') : t('kid.saved'))}</p>
          ${preview
            ? `<button class="btn big" id="k-again">${esc(t('kid.changeAnswers'))}</button>`
            : `<button class="btn big" id="k-next-student">${esc(t('kid.nextStudent'))}</button>`}
        </div>`;
      const again = container.querySelector('#k-again');
      if (again) again.addEventListener('click', () => { st.qi = 0; st.screen = 'q'; render(); });
      const nextStudent = container.querySelector('#k-next-student');
      if (nextStudent) nextStudent.addEventListener('click', () => {
        answered.add(st.respondent);
        st.respondent = null; st.sel = {}; st.qi = 0; st.screen = 'name'; st.attempted = false;
        render();
      });
    };

    /* ---------- Save ---------- */
    const submit = async () => {
      if (st.sending) return;
      st.sending = true;
      renderQuestion();
      const payload = {
        respondent_id: st.respondent,
        answers: questions.map(q => ({ question_id: q.id, chosen_ids: (st.sel[q.id] || []).slice() })),
      };
      let res;
      try { res = opts.onSubmit ? await opts.onSubmit(payload) : { ok: true }; }
      catch (e) { res = { ok: false, code: 'network' }; }
      const wasAttempted = st.attempted;
      st.attempted = true;
      st.sending = false;

      if (res.ok) { st.screen = 'done'; render(); return; }
      if (res.code === 'already_answered') {
        // A retry after a lost reply reaches a server that already has our answers.
        if (wasAttempted) { st.screen = 'done'; render(); return; }
        answered.add(st.respondent);
        st.respondent = null; st.sel = {}; st.qi = 0; st.screen = 'name';
        render();
        toast(t('kid.alreadyDone'), 4000);
        return;
      }
      if (res.code === 'closed') { KidForm.message(container, { title: t('kid.closedTitle'), text: t('kid.closedText') }); return; }
      if (res.code === 'gone') { KidForm.message(container, { title: t('kid.unavailable') }); return; }
      renderQuestion();
      toast(t('kid.sendFail'), 5000);
    };

    render();
  },
};
