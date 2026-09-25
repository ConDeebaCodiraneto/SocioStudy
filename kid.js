/* ============================================================
   kid.js — student page (opened from the QR code, /k/<link>)
   Loads this class's questionnaire from the server and sends the
   finished answers back. It knows nothing about the teacher app
   and holds no other data.
   ============================================================ */
(function () {
  'use strict';

  const root = document.getElementById('view-kid');
  const m = /^\/k\/([A-Za-z0-9_-]{16,64})\/?$/.exec(location.pathname);
  const sid = m && m[1];

  document.documentElement.setAttribute('data-theme',
    window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  function setLang(lang) {
    I18N.lang = lang === 'en' ? 'en' : 'bg';
    document.documentElement.lang = I18N.lang;
    document.title = t('kid.pageTitle');
  }
  setLang('bg');

  async function api(method, path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(path, {
        method, cache: 'no-store', signal: ctrl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      let json = null;
      try { json = await r.json(); } catch (e) { /* no body */ }
      return { status: r.status, json };
    } catch (e) {
      return { status: 0, json: null };
    } finally {
      clearTimeout(timer);
    }
  }

  async function onSubmit(payload) {
    const r = await api('POST', '/api/s/' + sid + '/responses', payload);
    if (r.status === 201) return { ok: true };
    if (r.status === 409) return { ok: false, code: 'already_answered' };
    if (r.status === 403 && r.json && r.json.error === 'closed') return { ok: false, code: 'closed' };
    if (r.status === 404) return { ok: false, code: 'gone' };
    if (r.status === 400) return { ok: false, code: 'invalid' };
    return { ok: false, code: 'network' };
  }

  async function load() {
    KidForm.message(root, { title: t('kid.loading'), icon: 'none' });
    if (!sid) { KidForm.message(root, { title: t('kid.unavailable') }); return; }
    const r = await api('GET', '/api/s/' + sid);
    if (r.status === 404) { KidForm.message(root, { title: t('kid.unavailable') }); return; }
    if (r.status !== 200 || !r.json) {
      KidForm.message(root, { title: t('kid.offline'), action: { label: t('kid.retry'), onClick: load } });
      return;
    }
    setLang(r.json.lang);
    if (r.json.closed) { KidForm.message(root, { title: t('kid.closedTitle'), text: t('kid.closedText') }); return; }
    KidForm.mount(root, r.json, { onSubmit });
  }

  load();
})();
