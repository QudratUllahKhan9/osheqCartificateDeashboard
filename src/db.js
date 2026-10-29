/**
 * db.js — tiny JSON store.
 *
 * On Vercel the filesystem is throw-away (only /tmp is writable and it dies with
 * the instance), so this file is only a CACHE. Cloudinary remains the source of
 * truth: every record written here is also recoverable from the PDF/preview
 * asset's `context` metadata. That is why /v/:id can still verify a certificate
 * on a cold serverless instance that never saw the original request.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DB_PATH = process.env.VERCEL
  ? path.join(os.tmpdir(), 'osheq-certificates.json')
  : path.join(__dirname, '..', 'data', 'db.json');

function read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(rows) {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(rows, null, 2));
  } catch (err) {
    console.warn('[db] cache write failed (non-fatal):', err.message);
  }
}

function all() {
  return read().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function get(id) {
  const needle = String(id || '');
  if (!needle) return null;
  return read().find((r) => r.id === needle || r.localId === needle || r.certNo === needle) || null;
}

/** Insert-or-replace by id so re-generating the same certificate cannot duplicate rows. */
function upsert(record) {
  const rows = read();
  const idx = rows.findIndex((r) => r.id === record.id);
  if (idx >= 0) rows[idx] = { ...rows[idx], ...record };
  else rows.push(record);
  write(rows);
  return record;
}

function remove(id) {
  const rows = read();
  const next = rows.filter((r) => r.id !== id && r.localId !== id);
  write(next);
  return rows.length !== next.length;
}

module.exports = { all, list: all, get, upsert, save: upsert, remove };
