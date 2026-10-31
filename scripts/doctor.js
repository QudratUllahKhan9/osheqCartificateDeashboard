/**
 * doctor.js — production readiness check. Run before/after deploy:
 *     npm run doctor
 * Prints PASS/FAIL for: env vars, browser binary, write access, Cloudinary
 * reachability, and the exact QR URL that will be printed on certificates.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
}
function section(title) {
  console.log(`\n${title}`);
}

async function main() {
  console.log('=== OSHEQ backend doctor ===');
  console.log(`node ${process.version} | ${process.platform}/${process.arch} | cwd ${process.cwd()}`);

  /* ---------------------------------------------------------------- env */
  section('-- environment');
  const required = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  check('Cloudinary env vars', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : 'all present');

  const base = (process.env.PUBLIC_BASE_URL || '').trim();
  check('PUBLIC_BASE_URL set', Boolean(base), base || 'not set');
  check(
    'PUBLIC_BASE_URL is public https',
    /^https:\/\//i.test(base) && !/localhost|127\.0\.0\.1/i.test(base),
    /^https:\/\//i.test(base) && !/localhost|127\.0\.0\.1/i.test(base)
      ? 'ok — QR will work on any phone'
      : 'WARNING: QR only works on this machine'
  );

  /* ------------------------------------------------------------ browser */
  section('-- browser');
  let browserOk = false;
  try {
    const { resolveExecutablePath } = require('../src/render');
    const { executablePath } = await resolveExecutablePath();
    browserOk = true;
    check('Chromium/Chrome found', true, executablePath);
  } catch (err) {
    check('Chromium/Chrome found', false, err.message.split('\n')[0]);
  }

  /* -------------------------------------------------------------- disk */
  section('-- writable directories');
  const workDir = process.env.WORK_DIR || path.join(__dirname, '..', 'work');
  for (const dir of [workDir, path.join(workDir, 'pdf'), path.join(workDir, 'png')]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.probe-${Date.now()}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      check(`writable: ${dir}`, true, 'ok');
    } catch (err) {
      check(`writable: ${dir}`, false, err.message);
    }
  }
  check('temp dir', true, os.tmpdir());

  /* --------------------------------------------------------- cloudinary */
  section('-- cloudinary');
  try {
    const cld = require('../src/cloudinary');
    if (!cld.isConfigured()) {
      check('Cloudinary configured', false, 'env vars missing');
    } else {
      check('Cloudinary configured', true, process.env.CLOUDINARY_CLOUD_NAME);
      try {
        await cld.listCertificates();
        check('Cloudinary API reachable', true, 'list ok');
      } catch (err) {
        check('Cloudinary API reachable', false, err.message);
      }
    }
  } catch (err) {
    check('Cloudinary module', false, err.message);
  }

  /* -------------------------------------------------------------- print */
  section('-- summary');
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`);
  }

  if (base) {
    console.log(`\nQR target example: ${base}/v/90012345`);
  }
  console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('doctor crashed:', e);
  process.exit(1);
});
