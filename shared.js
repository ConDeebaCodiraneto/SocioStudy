/* ============================================================
   shared.js — small helpers used by BOTH the teacher app and
   the student questionnaire page. Contains no study data.
   ============================================================ */

/* localStorage can be blocked (private mode, sandboxed frames).
   Access it indirectly and probe once — when unavailable,
   SafeStorage falls back to an in-memory map so the app never
   crashes; data then lives only for the session. */
const SafeStorage = {
  _ls: (function () { try { return window['local' + 'Storage']; } catch (e) { return null; } })(),
  ok: false,
  _mem: {},
  init() {
    try {
      const k = '__socio_probe__';
      this._ls.setItem(k, '1');
      this._ls.removeItem(k);
      this.ok = true;
    } catch (e) {
      this.ok = false;
    }
    return this;
  },
  get(k) {
    if (this.ok) { try { return this._ls.getItem(k); } catch (e) { return null; } }
    return Object.prototype.hasOwnProperty.call(this._mem, k) ? this._mem[k] : null;
  },
  set(k, v) {
    if (this.ok) { try { this._ls.setItem(k, v); } catch (e) { /* quota */ } }
    else this._mem[k] = v;
  },
  remove(k) {
    if (this.ok) { try { this._ls.removeItem(k); } catch (e) { /* noop */ } }
    else delete this._mem[k];
  },
}.init();

/** Escape a string for safe interpolation into HTML. */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/** Initials for avatar circles ("Anna Smith" -> "AS"). */
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (!parts[0]) return '?';
  return (Array.from(parts[0])[0] + (parts[1] ? Array.from(parts[1])[0] : '')).toUpperCase();
}

/** First token of a name (keeps tables compact). */
function shortName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '?';
}

/**
 * Short, unique labels for a roster: "Иван"; when first names collide
 * "Иван П." (last-name initial); if that still collides "Иван П. 2".
 * Returns { [id]: label }.
 */
function uniqueLabels(roster) {
  const counts = {};
  roster.forEach(k => { const f = shortName(k.name).toLowerCase(); counts[f] = (counts[f] || 0) + 1; });
  const used = {}, out = {};
  roster.forEach(k => {
    let label = shortName(k.name);
    if (counts[label.toLowerCase()] > 1) {
      const parts = String(k.name || '').trim().split(/\s+/);
      const last = parts[parts.length - 1];
      if (parts.length > 1) label = /^\d+$/.test(last) ? parts.join(' ') : label + ' ' + Array.from(last)[0].toUpperCase() + '.';
    }
    const key = label.toLowerCase();
    used[key] = (used[key] || 0) + 1;
    out[k.id] = used[key] > 1 ? label + ' ' + used[key] : label;
  });
  return out;
}

/** Neutral avatar colour derived from an id (no gender colouring for children). */
const AVATAR_COLORS = ['#4f46e5', '#0d9488', '#c2410c', '#7c3aed', '#0369a1', '#b45309', '#be185d', '#15803d'];
function avatarColor(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** Short message at the bottom of the screen. */
function toast(msg, ms) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms || 2800);
}
