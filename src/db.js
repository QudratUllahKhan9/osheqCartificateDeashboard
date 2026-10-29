/** Local JSON cache. On Vercel this is only an ephemeral cache; Cloudinary is
 * the persistent source of truth for uploaded certificates. */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DB_PATH = process.env.VERCEL
  ? path.join(os.tmpdir(), 'osheq-certificate-db.json')
  : path.join(__dirname, '..', 'data', 'db.json');

function read() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch { return []; }
}
function write(rows) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(rows, null, 2));
}
function list() { return read().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
function get(id) { return read().find(r => r.id === id || r.certNo === id) || null; }
function save(record) { const rows = read(); rows.push(record); write(rows); return record; }

module.exports = { list, get, save };
