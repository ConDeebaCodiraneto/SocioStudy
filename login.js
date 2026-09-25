/* login.js — submits the teacher password via fetch (never as a URL query string) */
(function () {
  'use strict';
  const f = document.getElementById('f'), err = document.getElementById('err'), go = document.getElementById('go'), pw = document.getElementById('pw');

  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (go.disabled) return;
    err.textContent = '';
    go.disabled = true; go.textContent = '…';
    try {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ password: pw.value }),
      });
      if (r.ok) { location.href = '/'; return; }
      err.textContent = r.status === 429 ? 'Твърде много опити — опитайте по-късно.' : 'Грешна парола.';
      pw.select();
    } catch (e2) {
      err.textContent = 'Няма връзка със сървъра.';
    }
    go.disabled = false; go.textContent = 'Вход';
  });
})();
