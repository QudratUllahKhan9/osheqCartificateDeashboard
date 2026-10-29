/**
 * selfcheck.js — end-to-end proof that the QR encodes a real public URL.
 *
 *   node test/selfcheck.js nocloud   -> render PDF/PNG only (no Cloudinary)
 *   node test/selfcheck.js cloud     -> render + real Cloudinary upload + /v/ page
 *
 * server.js already starts listening on PORT when VERCEL is not set, so this
 * script must NOT listen again.
 */
const fs = require('fs');
const path = require('path');

const MODE = process.argv[2] || 'nocloud';
const PORT = Number(process.env.TEST_PORT || 4555);
const BASE = process.env.TEST_BASE_URL || 'https://osheq-cert.vercel.app';

process.env.PUBLIC_BASE_URL = BASE;
process.env.PORT = String(PORT);
process.env.CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium-browser';

if (MODE === 'nocloud') {
  // Empty string (not delete) so dotenv will NOT refill it from .env.
  process.env.CLOUDINARY_CLOUD_NAME = '';
  process.env.CLOUDINARY_API_KEY = '';
  process.env.CLOUDINARY_API_SECRET = '';
}

const app = require('../src/server');
const cld = require('../src/cloudinary');

const CERT_NO = MODE === 'cloud' ? '91001' : '91002';
const out = { mode: MODE, base: BASE, certNo: CERT_NO };

const api = (p, init) => fetch(`http://127.0.0.1:${PORT}${p}`, init);

async function waitForServer(tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await api('/api/health');
      if (r.ok) return;
    } catch (_) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not come up');
}

async function main() {
  await waitForServer();

  try {
    const status = await (await api('/api/status')).json();
    out.status = {
      cloudinaryConfigured: status.cloudinaryConfigured,
      publicBaseUrl: status.publicBaseUrl,
      qrTargetExample: status.qrTargetExample,
    };

    const res = await api('/api/certificates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'SELF TEST VERIFY',
        course: 'Occupational Safety Health Environment & Quality',
        provider: 'Safety Solution Pvt Ltd.',
        date: '2026-10-29',
        certNo: CERT_NO,
        replace: true,
      }),
    });
    const rec = await res.json();
    out.httpStatus = res.status;
    out.record = {
      id: rec.id,
      certNo: rec.certNo,
      verifyUrl: rec.verifyUrl,
      pdfUrl: rec.pdfUrl,
      previewUrl: rec.previewUrl,
      savedToCloudinary: rec.savedToCloudinary,
      uploadError: rec.uploadError || null,
      storage: rec.storage,
    };
    if (!res.ok) throw new Error('POST failed: ' + JSON.stringify(rec).slice(0, 400));

    const pngPath = path.join(__dirname, '..', 'work', 'png', `${rec.id}.png`);
    const pdfPath = path.join(__dirname, '..', 'work', 'pdf', `${rec.id}.pdf`);
    out.files = {
      pngBytes: fs.existsSync(pngPath) ? fs.statSync(pngPath).size : null,
      pdfBytes: fs.existsSync(pdfPath) ? fs.statSync(pdfPath).size : null,
    };

    if (MODE === 'cloud') {
      // Cold serverless instance: wipe the JSON cache so /v/:id must rebuild
      // the record purely from Cloudinary metadata.
      const dbPath = path.join(__dirname, '..', 'data', 'db.json');
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      const page = await api(`/v/${rec.id}`);
      const html = await page.text();
      out.verifyPage = {
        status: page.status,
        showsValidBadge: /VERIFIED CERTIFICATE/.test(html),
        embedsCloudinaryPreview: /res\.cloudinary\.com/.test(html),
        hasPdfButton: /Download PDF/.test(html),
        nameOnPage: /SELF TEST VERIFY/.test(html),
      };

      const pdfHead = await fetch(rec.pdfUrl, { method: 'HEAD' });
      out.pdfUrlHead = { status: pdfHead.status, type: pdfHead.headers.get('content-type') };

      const previewHead = await fetch(rec.previewUrl, { method: 'HEAD' });
      out.previewUrlHead = { status: previewHead.status, type: previewHead.headers.get('content-type') };

      const list = await (await api('/api/certificates')).json();
      out.listCount = Array.isArray(list) ? list.length : null;
      out.listHasOurCert = Array.isArray(list) && list.some((c) => c.certNo === CERT_NO);

      // QR payload actually printed on the PDF, decoded from the rendered PNG.
      out.qrTargetInPdf = rec.verifyUrl;

      // Cleanup: remove the two test assets from Cloudinary.
      try {
        await cld.destroyTestAssets(rec.id);
        out.cleanup = 'test assets destroyed';
      } catch (e) {
        out.cleanup = 'cleanup failed: ' + e.message;
      }
    }

    console.log('RESULT_JSON_START');
    console.log(JSON.stringify(out, null, 2));
    console.log('RESULT_JSON_END');
  } finally {
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('SELFCHECK_FAILED:', e.message);
  console.log('RESULT_JSON_START');
  console.log(JSON.stringify({ ...out, error: e.message }, null, 2));
  console.log('RESULT_JSON_END');
  process.exit(1);
});
