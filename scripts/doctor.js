#!/usr/bin/env node
/**
 * doctor.js — deployment self-check. Pure JS renderer, so there is NO browser
 * to look for. Run: npm run doctor
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

let hardFail = 0;
let softFail = 0;

function check(label, ok, detail = '', hard = true) {
  console.log(`${ok ? '  PASS' : (hard ? '  FAIL' : '  WARN')}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) { if (hard) hardFail++; else softFail++; }
  return ok;
}

(async () => {
  console.log('\nOSHEQ backend — doctor\n');

  /* 1. renderer modules (pure JS) */
  console.log('renderer');
  for (const m of ['pdf-lib', '@pdf-lib/fontkit', 'pureimage', 'qrcode']) {
    try { require(m); check(m, true); } catch (e) { check(m, false, e.message.split('\n')[0]); }
  }

  /* 2. assets */
  console.log('\nassets');
  const A = path.join(__dirname, '..', 'assets');
  for (const f of ['bg_clean2.jpg', 'fonts/Montserrat.ttf', 'fonts/EBGaramond.ttf']) {
    const p = path.join(A, f);
    check(f, fs.existsSync(p) && fs.statSync(p).size > 1000,
      fs.existsSync(p) ? fs.statSync(p).size + ' bytes' : 'missing');
  }

  /* 3. writable work dir */
  console.log('\nstorage');
  const work = process.env.WORK_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), 'osheq-work') : path.join(__dirname, '..', 'work'));
  try { fs.mkdirSync(work, { recursive: true }); fs.writeFileSync(path.join(work, '.probe'), 'x'); fs.unlinkSync(path.join(work, '. probe'.replace(' ', ''))); check('work dir writable', true, work); }
  catch (e) { check('work dir writable', false, work + ' — ' + e.message, false); }

  /* 4. cloudinary */
  console.log('\ncloudinary');
  const okCfg = Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
  check('env vars present', okCfg, okCfg ? process.env.CLOUDINARY_CLOUD_NAME : 'missing');
  if (okCfg) {
    const cld = require('../src/cloudinary');
    try { const r = await cld.ping(); check('reachable', Boolean(r), JSON.stringify(r).slice(0, 80)); }
    catch (e) { check('reachable', false, e.message.split('\n')[0], false); }
  }

  /* 5. base urls */
  console.log('\nurls');
  const fe = process.env.PUBLIC_BASE_URL || '';
  const be = process.env.BACKEND_BASE_URL || '';
  console.log('  INFO  PUBLIC_BASE_URL  =', fe || '(unset → derived)');
  console.log('  INFO  BACKEND_BASE_URL =', be || '(unset → derived from request host)');
  const bad = v => /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(v);
  if (fe) check('PUBLIC_BASE_URL is public', !bad(fe), fe, false);

  /* 6. real render */
  console.log('\nrender test');
  const { renderCertificate } = require('../src/render-pdf');
  const { formatDate } = require('../src/template');
  try {
    const qrDataUrl = await require('qrcode').toDataURL('https://example.com/v/DOCTOR01', { width: 512, margin: 0 });
    const out = path.join(work, 'doctor');
    const r = await renderCertificate(
      { name: 'Doctor Test', course: 'Safety Training', provider: 'Safety Solution Pvt Ltd.', dateText: formatDate('2026-11-03'), certNo: 'DOCTOR01', qrDataUrl },
      { pdfPath: path.join(out, 'DOCTOR01.pdf'), pngPath: path.join(out, 'DOCTOR01.png') }
    );
    check('PDF + PNG generated', r.pdfBytes > 20000 && r.pngBytes > 20000, `pdf ${r.pdfBytes}B, png ${r.pngBytes}B`);
  } catch (e) { check('PDF + PNG generated', false, e.message.split('\n')[0]); }

  console.log(`\n${hardFail ? 'FAILED' : 'ALL GOOD'} — hard failures: ${hardFail}, warnings: ${softFail}\n`);
  process.exit(hardFail ? 1 : 0);
})();
