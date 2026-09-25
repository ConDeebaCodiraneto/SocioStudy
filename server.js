#!/usr/bin/env node
/* ============================================================
   SocioStudy server — no dependencies, Node 18+.

   • Serves the teacher app and the student questionnaire page.
   • Stores each class questionnaire as its own "session": an
     unguessable link (the QR code) for students and a secret
     admin key that only the teacher's browser holds.
   • Students can only reach /k/<link> and the tiny API behind it.
     Everything else (teacher app, all responses) needs either the
     teacher password (optional) or the session's admin key.
   • Deleting a session removes its file — link, roster, answers.
     Sessions also expire automatically after SESSION_TTL_DAYS
     without activity.

   Environment variables (all optional):
     PORT              default 3000
     HOST              default 0.0.0.0
     DATA_DIR          default ./data
     SESSION_TTL_DAYS  default 30
     TEACHER_PASSWORD  if set, the teacher app asks for it (any user name)
     PUBLIC_URL        public address, e.g. https://sociostudy.example.org
     TRUST_PROXY       set to 1 when running behind a reverse proxy
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const VERSION = '1.0.0';
const env = process.env;
const PORT = parseInt(env.PORT, 10) || 3000;
const HOST = env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(env.DATA_DIR || path.join(__dirname, 'data'));
const TTL_DAYS = Number(env.SESSION_TTL_DAYS) > 0 ? Number(env.SESSION_TTL_DAYS) : 30;
const TTL_MS = TTL_DAYS * 86400000;
const TEACHER_PASSWORD = env.TEACHER_PASSWORD || '';
const PUBLIC_URL = (env.PUBLIC_URL || '').replace(/\/+$/, '');
const TRUST_PROXY = env.TRUST_PROXY === '1';

const MAX_BODY = 200 * 1024;
const MAX_STUDENTS = 80;
const MAX_QUESTIONS = 12;
const MAX_SESSIONS = 500;
const SID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/* ---------- Static files (fixed allow-list, no user-controlled paths) ---------- */

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
// Files a student's phone may load.
const PUBLIC_FILES = {
  '/styles.css': 'styles.css', '/shared.js': 'shared.js', '/i18n.js': 'i18n.js',
  '/kidform.js': 'kidform.js', '/kid.js': 'kid.js', '/robots.txt': 'robots.txt',
  '/login.js': 'login.js',
};
// The teacher app — behind the teacher password when one is set.
const TEACHER_FILES = {
  '/': 'index.html', '/index.html': 'index.html', '/config.js': 'config.js',
  '/analysis.js': 'analysis.js', '/tables.js': 'tables.js', '/charts.js': 'charts.js',
  '/sociogram.js': 'sociogram.js', '/export.js': 'export.js', '/qr.js': 'qr.js',
  '/sync.js': 'sync.js', '/app.js': 'app.js',
};

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

/* ---------- Small helpers ---------- */

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));
const b64url = n => crypto.randomBytes(n).toString('base64url');

function httpError(status, code) { const e = new Error(code); e.status = status; e.code = code; return e; }

function baseHeaders(extra) {
  return Object.assign({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': CSP,
  }, extra);
}

function sendJSON(res, status, obj, extra) {
  const body = JSON.stringify(obj);
  res.writeHead(status, baseHeaders(Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body),
  }, extra)));
  res.end(body);
}

function sendText(res, status, text, extra) {
  res.writeHead(status, baseHeaders(Object.assign({
    'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
  }, extra)));
  res.end(text);
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return req.socket.remoteAddress || 'unknown';
}

/* Fixed-window rate limiter (in memory). */
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count++;
  return b.count > max;
}
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (b.reset <= n) buckets.delete(k); }, 60000).unref();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, over = false;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) over = true; else chunks.push(c); });
    req.on('end', () => over ? reject(httpError(413, 'too_large')) : resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJSON(req) {
  const ct = String(req.headers['content-type'] || '');
  if (!/^application\/json\b/i.test(ct)) throw httpError(415, 'json_required');
  const text = await readBody(req);
  try { const v = JSON.parse(text || '{}'); if (v && typeof v === 'object') return v; } catch (e) { /* fallthrough */ }
  throw httpError(400, 'bad_json');
}

/* ---------- Session store (one JSON file per session) ---------- */

const sessions = new Map();

function sessionFile(sid) { return path.join(DATA_DIR, sid + '.json'); }

function persist(s) {
  const file = sessionFile(s.sid), tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
  fs.renameSync(tmp, file);
  s._saved = Date.now();
}

function destroySession(sid) {
  sessions.delete(sid);
  try { fs.unlinkSync(sessionFile(sid)); } catch (e) { /* already gone */ }
  try { fs.unlinkSync(sessionFile(sid) + '.tmp'); } catch (e) { /* none */ }
}

function loadSessions() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  for (const f of fs.readdirSync(DATA_DIR)) {
    const m = /^([A-Za-z0-9_-]{16,64})\.json$/.exec(f);
    if (!m) { if (/\.json\.tmp$/.test(f)) { try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch (e) { /* ignore */ } } continue; }
    try {
      const s = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      if (s && s.sid === m[1] && s.keyHash) { s._saved = Date.now(); sessions.set(s.sid, s); }
    } catch (e) { console.warn('Skipping unreadable session file', f); }
  }
}

function cleanup() {
  const now = Date.now();
  for (const s of [...sessions.values()]) if (now - s.updatedAt > TTL_MS) destroySession(s.sid);
}

/** Look up a live session; expired ones are deleted on the spot. */
function getSession(sid) {
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.updatedAt > TTL_MS) { destroySession(sid); return null; }
  return s;
}

/** Record activity; only rewrite the file at most hourly for pure reads. */
function touch(s, force) {
  s.updatedAt = Date.now();
  if (force || Date.now() - (s._saved || 0) > 3600000) persist(s);
}

function requireAdmin(req, s) {
  const key = String(req.headers['x-admin-key'] || '');
  const a = Buffer.from(s.keyHash, 'hex'), b = sha256(key);
  if (key.length < 16 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw httpError(403, 'forbidden');
}

/* ---------- Validation ---------- */

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

function cleanRoster(v) {
  if (!Array.isArray(v) || v.length < 2 || v.length > MAX_STUDENTS) throw httpError(400, 'bad_roster');
  const seen = new Set();
  return v.map(k => {
    const id = k && typeof k.id === 'string' && ID_RE.test(k.id) ? k.id : null;
    const name = clean(k && k.name, 80);
    if (!id || !name || seen.has(id)) throw httpError(400, 'bad_roster');
    seen.add(id);
    return { id, name };
  });
}

function cleanQuestions(v, rosterSize) {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_QUESTIONS) throw httpError(400, 'bad_questions');
  const seen = new Set();
  return v.map(q => {
    const id = q && typeof q.id === 'string' && ID_RE.test(q.id) ? q.id : null;
    const text = clean(q && q.text, 300);
    const type = q && q.type === 'negative' ? 'negative' : q && q.type === 'positive' ? 'positive' : null;
    let max = Math.round(Number(q && q.maxChoices));
    if (!id || !text || !type || seen.has(id)) throw httpError(400, 'bad_questions');
    seen.add(id);
    if (!(max >= 1)) max = 3;
    return { id, text, type, maxChoices: Math.min(10, max, Math.max(1, rosterSize - 1)) };
  });
}

function cleanLang(v) { return v === 'en' ? 'en' : 'bg'; }

/* ---------- API ---------- */

function publicView(s) {
  if (s.closed) return { closed: true, lang: s.lang };
  return {
    closed: false, lang: s.lang,
    roster: s.roster, questions: s.questions,
    answered: Object.keys(s.responses),
  };
}

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
    }
  }
  const priv = a => /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  return out.sort((a, b) => Number(priv(b)) - Number(priv(a)));
}

/* ---------- Teacher login (session cookie, not Basic Auth) ----------
   Basic Auth headers are not guaranteed to be attached to every request a
   page makes (some mobile browsers drop them for background <script>
   requests), so a password-protected page could silently fail to load its
   own scripts with no visible error. A signed cookie is attached by the
   browser to every request automatically, so this is used instead. */

const SESSION_COOKIE = 'sociostudy_session';
const SESSION_MAX_AGE = 12 * 3600; // seconds

function sessionSecret() {
  // Stable for the life of this process; every login before a restart is fine,
  // and a restart simply requires teachers to log in again.
  if (!sessionSecret._v) sessionSecret._v = crypto.randomBytes(32);
  return sessionSecret._v;
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function teacherAuthOk(req) {
  if (!TEACHER_PASSWORD) return true;
  const token = parseCookies(req)[SESSION_COOKIE];
  return !!verifySession(token);
}

function requireTeacher(req, res, ip) {
  if (teacherAuthOk(req)) return true;
  sendJSON(res, 401, { error: 'login_required' });
  return false;
}

/** Redirects browser navigations to /login instead of returning a bare 401 (API calls still get JSON). */
function requireTeacherPage(req, res, ip) {
  if (teacherAuthOk(req)) return true;
  res.writeHead(302, baseHeaders({ Location: '/login', 'Cache-Control': 'no-store' }));
  res.end();
  return false;
}

function checkOrigin(req) {
  const o = req.headers.origin;
  if (!o) return;
  let host = '';
  try { host = new URL(o).host; } catch (e) { throw httpError(403, 'bad_origin'); }
  if (host !== req.headers.host) throw httpError(403, 'bad_origin');
}

async function handleApi(req, res, p, ip) {
  if (limited('api:' + ip, 900, 60000)) throw httpError(429, 'rate_limited');
  const method = req.method;
  if (method !== 'GET') checkOrigin(req);

  if (p === '/api/login' && method === 'POST') {
    if (limited('login:' + ip, 20, 600000)) throw httpError(429, 'rate_limited');
    if (!TEACHER_PASSWORD) return sendJSON(res, 200, { ok: true });
    const body = await readJSON(req);
    if (typeof body.password !== 'string' || !safeEqual(body.password, TEACHER_PASSWORD)) {
      return sendJSON(res, 401, { error: 'wrong_password' });
    }
    const token = signSession({ exp: Date.now() + SESSION_MAX_AGE * 1000 });
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}; Path=/` + (TRUST_PROXY || PUBLIC_URL ? '; Secure' : '');
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }

  if (p === '/api/logout' && method === 'POST') {
    const cookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`;
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }

  if (p === '/api/info' && method === 'GET') {
    if (!requireTeacher(req, res, ip)) return;
    return sendJSON(res, 200, {
      app: 'sociostudy', version: VERSION, ttlDays: TTL_DAYS,
      publicUrl: PUBLIC_URL || null, lan: lanUrls(), port: PORT,
      passwordProtected: !!TEACHER_PASSWORD,
    });
  }

  if (p === '/api/sessions' && method === 'POST') {
    if (!requireTeacher(req, res, ip)) return;
    if (limited('create:' + ip, 40, 3600000)) throw httpError(429, 'rate_limited');
    if (sessions.size >= MAX_SESSIONS) throw httpError(503, 'server_full');
    const body = await readJSON(req);
    const roster = cleanRoster(body.roster);
    const questions = cleanQuestions(body.questions, roster.length);
    const sid = b64url(16), adminKey = b64url(24), now = Date.now();
    const s = {
      sid, keyHash: sha256(adminKey).toString('hex'), createdAt: now, updatedAt: now,
      lang: cleanLang(body.lang), className: clean(body.className, 60), closed: false,
      roster, questions, responses: {},
    };
    sessions.set(sid, s);
    persist(s);
    return sendJSON(res, 201, { sid, adminKey, expiresAt: now + TTL_MS, ttlDays: TTL_DAYS });
  }

  let m = /^\/api\/s\/([A-Za-z0-9_-]{16,64})(?:\/(responses)(?:\/([A-Za-z0-9_-]{1,64}))?)?$/.exec(p);
  if (!m) throw httpError(404, 'not_found');
  const [, sid, sub, rid] = m;
  const s = getSession(sid);
  if (!s) throw httpError(404, 'not_found');

  // Student page data
  if (!sub && method === 'GET') { touch(s, false); return sendJSON(res, 200, publicView(s)); }

  // Teacher: update the questionnaire (roster / questions / open-closed)
  if (!sub && method === 'PUT') {
    requireAdmin(req, s);
    const body = await readJSON(req);
    if ('roster' in body) s.roster = cleanRoster(body.roster);
    if ('questions' in body || 'roster' in body) s.questions = cleanQuestions('questions' in body ? body.questions : s.questions, s.roster.length);
    if ('lang' in body) s.lang = cleanLang(body.lang);
    if ('className' in body) s.className = clean(body.className, 60);
    if ('closed' in body) s.closed = !!body.closed;
    touch(s, true);
    return sendJSON(res, 200, { ok: true, closed: s.closed, expiresAt: s.updatedAt + TTL_MS });
  }

  // Teacher: delete everything for this class
  if (!sub && method === 'DELETE') {
    requireAdmin(req, s);
    destroySession(sid);
    return sendJSON(res, 200, { ok: true });
  }

  // Teacher: read all answers
  if (sub === 'responses' && !rid && method === 'GET') {
    requireAdmin(req, s);
    touch(s, false);
    return sendJSON(res, 200, {
      closed: s.closed, expiresAt: s.updatedAt + TTL_MS,
      responses: Object.values(s.responses),
    });
  }

  // Teacher: let one student answer again
  if (sub === 'responses' && rid && method === 'DELETE') {
    requireAdmin(req, s);
    delete s.responses[rid];
    touch(s, true);
    return sendJSON(res, 200, { ok: true });
  }

  // Student: submit answers
  if (sub === 'responses' && !rid && method === 'POST') {
    if (limited('sub:' + sid, 600, 60000)) throw httpError(429, 'rate_limited');
    if (s.closed) throw httpError(403, 'closed');
    const body = await readJSON(req);
    const rid2 = typeof body.respondent_id === 'string' ? body.respondent_id : '';
    if (!s.roster.some(k => k.id === rid2)) throw httpError(400, 'bad_respondent');
    if (s.responses[rid2]) throw httpError(409, 'already_answered');
    if (!Array.isArray(body.answers) || body.answers.length > s.questions.length) throw httpError(400, 'bad_answers');
    const byQ = new Map();
    for (const a of body.answers) {
      if (!a || typeof a.question_id !== 'string' || byQ.has(a.question_id)) throw httpError(400, 'bad_answers');
      byQ.set(a.question_id, a);
    }
    for (const qid of byQ.keys()) if (!s.questions.some(q => q.id === qid)) throw httpError(400, 'bad_answers');
    const answers = s.questions.map((q, i) => {
      const a = byQ.get(q.id);
      const ids = a && Array.isArray(a.chosen_ids) ? a.chosen_ids : [];
      if (new Set(ids).size !== ids.length || ids.length > q.maxChoices) throw httpError(400, 'bad_answers');
      for (const id of ids) {
        if (id === rid2 || !s.roster.some(k => k.id === id)) throw httpError(400, 'bad_answers');
      }
      return { question_id: q.id, question_index: i, question_text: q.text, question_type: q.type, chosen_ids: ids.slice() };
    });
    s.responses[rid2] = { respondent_id: rid2, timestamp: new Date().toISOString(), answers };
    touch(s, true);
    return sendJSON(res, 201, { ok: true });
  }

  throw httpError(405, 'method_not_allowed');
}

/* ---------- Static ---------- */

function serveFile(req, res, file, cacheControl) {
  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) return sendText(res, 404, 'Not found');
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const etag = '"' + crypto.createHash('sha1').update(data).digest('hex').slice(0, 20) + '"';
    const headers = baseHeaders({ 'Content-Type': type, 'Cache-Control': cacheControl, ETag: etag });
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    headers['Content-Length'] = data.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function handleStatic(req, res, p, ip) {
  if (p === '/healthz') return sendText(res, 200, 'ok');
  if (p === '/login') {
    if (!TEACHER_PASSWORD || teacherAuthOk(req)) {
      res.writeHead(302, baseHeaders({ Location: '/', 'Cache-Control': 'no-store' }));
      return res.end();
    }
    return serveFile(req, res, 'login.html', 'no-store');
  }

  // Student questionnaire page: /k/<link>
  if (/^\/k\/[A-Za-z0-9_-]{16,64}\/?$/.test(p)) return serveFile(req, res, 'kid.html', 'no-cache');

  if (PUBLIC_FILES[p]) return serveFile(req, res, PUBLIC_FILES[p], 'no-cache');
  const font = /^\/fonts\/([A-Za-z0-9._-]+\.woff2)$/.exec(p);
  if (font) return serveFile(req, res, 'fonts/' + font[1], 'public, max-age=31536000, immutable');
  // Vendored libraries (Chart.js, D3, qrcode-generator, JSZip) are generic code with
  // nothing class-specific or sensitive in them, so they stay unauthenticated.
  const vendor = /^\/vendor\/([A-Za-z0-9._-]+\.js)$/.exec(p);
  if (vendor) return serveFile(req, res, 'vendor/' + vendor[1], 'public, max-age=31536000, immutable');

  const teacherFile = TEACHER_FILES[p];
  if (teacherFile) {
    // All of these are only ever requested by the teacher page itself (as <script>
    // tags), never opened directly by a person, so redirecting to /login on a
    // missing/expired session is safe and — unlike a bare 401 on a background
    // script request — actually visible: the browser follows the redirect for
    // the main document, and for a script tag the resulting HTML simply fails
    // to parse as JS, which app.js's global error handler below catches and
    // turns into the same redirect.
    if (!requireTeacherPage(req, res, ip)) return;
    return serveFile(req, res, teacherFile, 'no-cache');
  }
  return sendText(res, 404, 'Not found');
}

/* ---------- Server ---------- */

const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://localhost').pathname;
    if (p.startsWith('/api/')) return await handleApi(req, res, p, clientIp(req));
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
    return handleStatic(req, res, p, clientIp(req));
  } catch (e) {
    if (res.headersSent) return res.end();
    const status = e.status || 500;
    if (!e.status) console.error('Unexpected error:', e.message);
    sendJSON(res, status, { error: e.code || 'server_error' }, status === 413 ? { Connection: 'close' } : undefined);
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;

function start(cb) {
  loadSessions();
  cleanup();
  setInterval(cleanup, 3600000).unref();
  server.listen(PORT, HOST, () => {
    console.log(`SocioStudy ${VERSION} is running.`);
    console.log(`  Teacher app:   http://localhost:${PORT}/`);
    if (PUBLIC_URL) console.log(`  Public address: ${PUBLIC_URL}`);
    const lan = lanUrls();
    if (lan.length) console.log(`  On your network (phones on the same Wi-Fi): ${lan.join('  ')}`);
    console.log(`  Data folder:   ${DATA_DIR}  (sessions are deleted after ${TTL_DAYS} days without activity)`);
    if (!TEACHER_PASSWORD) console.log('  Note: no TEACHER_PASSWORD set — anyone who can reach this address can open the teacher app.');
    if (cb) cb();
  });
}

if (require.main === module) {
  start();
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { server, start };
