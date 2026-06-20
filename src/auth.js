// Authentication — dependency-free (Node's built-in crypto only).
// - Passwords hashed with scrypt + per-user random salt.
// - Sessions are stateless, signed HTTP-only cookies (HMAC-SHA256), so they
//   survive restarts with no session store.
// - User records live in data/users.json (git-ignored; never committed).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const SECRET_PATH = path.join(DATA_DIR, '.session_secret');
const COOKIE = 'ns_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ---- signing secret -------------------------------------------------------
let SECRET = null;
function getSecret() {
  if (SECRET) return SECRET;
  if (process.env.SESSION_SECRET) return (SECRET = process.env.SESSION_SECRET);
  ensureDir();
  try {
    const fromFile = fs.readFileSync(SECRET_PATH, 'utf8').trim();
    if (fromFile) return (SECRET = fromFile);
  } catch { /* generate below */ }
  SECRET = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(SECRET_PATH, SECRET, { mode: 0o600 }); } catch { /* best effort */ }
  return SECRET;
}

// ---- user store -----------------------------------------------------------
let usersCache = null;
function loadUsers() {
  if (usersCache) return usersCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
    usersCache = Array.isArray(parsed.users) ? parsed : { users: [] };
  } catch {
    usersCache = { users: [] };
  }
  return usersCache;
}
function saveUsers() {
  ensureDir();
  const tmp = USERS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(usersCache, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, USERS_PATH);
}
const publicUser = (u) => (u ? { id: u.id, email: u.email, name: u.name } : null);

// ---- password hashing -----------------------------------------------------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [saltHex, hashHex] = String(stored).split(':');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---- account operations ---------------------------------------------------
export function registerUser({ email, password, name }) {
  email = String(email || '').trim().toLowerCase();
  name = String(name || '').trim().slice(0, 80);
  password = String(password || '');
  if (!EMAIL_RE.test(email)) throw new Error('Please enter a valid email address.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (password.length > 200) throw new Error('Password is too long.');

  const db = loadUsers();
  if (db.users.some((u) => u.email === email)) throw new Error('An account with that email already exists.');

  const user = {
    id: crypto.randomUUID(),
    email,
    name: name || email.split('@')[0],
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  saveUsers();
  return publicUser(user);
}

export function authenticate({ email, password }) {
  email = String(email || '').trim().toLowerCase();
  const db = loadUsers();
  const user = db.users.find((u) => u.email === email);
  if (!user || !verifyPassword(String(password || ''), user.passwordHash)) return null;
  return publicUser(user);
}

export function getUserById(id) {
  return publicUser(loadUsers().users.find((u) => u.id === id));
}

// ---- session tokens (signed cookie) ---------------------------------------
export function createSessionToken(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// ---- cookies + middleware -------------------------------------------------
function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function setSessionCookie(req, res, token) {
  const secure = req.secure || process.env.SECURE_COOKIES === 'true';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`);
}
export function clearSessionCookie(_req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

/** Express middleware: sets req.user to { id, email, name } or null. */
export function attachUser(req, _res, next) {
  const data = verifySessionToken(parseCookies(req)[COOKIE]);
  req.user = data ? getUserById(data.uid) : null;
  next();
}

/** Route guard for endpoints that require a logged-in user. */
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  next();
}
