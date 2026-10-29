/**
 * cloudinary-check.js — fallback end-to-end proof that runs WITHOUT a headless
 * browser: uploads real assets to Cloudinary with the deterministic public_id
 * used by the backend, then verifies that /v/:id rebuilds the certificate
 * purely from Cloudinary metadata and that the stored URLs are fetchable.
 *
 * This proves the exact chain the QR relies on:
 *   QR text -> /v/<localId> -> Cloudinary metadata -> secure_url + preview
 */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const PORT = Number(process.env.TEST_PORT || 4556);
const BASE = process.env.TEST_BASE_URL || 'https://osheq-cert.vercel.app';
process.env.PUBLIC_BASE_URL = BASE;
process.env.PORT = String(PORT);

const ID = 'CLOUDTEST01';
const VERIFY = `${BASE}/v/${ID}`;
const out = { mode: 'cloudinary-only', base: BASE, id: ID, qrTarget: VERIFY };

const api = (p, init) => fetch(`http://127.0.0.1:${PORT}${p}`, init);

/** Minimal but valid single-page PDF (no browser needed). */
function minimalPdf(text) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 18 Tf 60 760 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

async function waitForServer(tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      if ((await api('/api/health')).ok) return;
    } catch (_) {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start');
}

async function main() {
  require('../src/server');
  const cld = require('../src/cloudinary');
  await waitForServer();

  if (!cld.isConfigured()) throw new Error('Cloudinary env vars missing — cannot run this check.');

  const tmp = path.join(__dirname, '..', 'work', 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const pdfPath = path.join(tmp, `${ID}.pdf`);
  const pngPath = path.join(tmp, `${ID}.png`);
  fs.writeFileSync(pdfPath, minimalPdf('OSHEQ CLOUDINARY RESOLUTION TEST'));
  await QRCode.toFile(pngPath, VERIFY, { width: 640, margin: 1, errorCorrectionLevel: 'M' });

  const meta = {
    localId: ID,
    certNo: 'CLOUDTEST01',
    name: 'CLOUDINARY CHAIN TEST',
    course: 'Occupational Safety Health Environment & Quality',
    provider: 'Safety Solution Pvt Ltd.',
    dateText: '29-Oct-2026',
    verifyUrl: VERIFY,
    issuedAt: new Date().toISOString(),
  };

  const pdf = await cld.uploadPdf(pdfPath, ID, meta);
  const png = await cld.uploadPreview(pngPath, ID, meta);

  out.uploaded = {
    pdfPublicId: pdf.public_id,
    pdfSecureUrl: pdf.secure_url,
    pngPublicId: png.public_id,
    pngSecureUrl: png.secure_url,
  };

  // Cold-instance simulation: no JSON cache entry exists for this id at all.
  const page = await api(`/v/${ID}`);
  const html = await page.text();
  out.verifyPage = {
    status: page.status,
    showsValidBadge: /VERIFIED CERTIFICATE/.test(html),
    embedsCloudinaryPreview: /res\.cloudinary\.com/.test(html),
    hasDownloadButton: /Download PDF/.test(html),
    showsNameFromMetadata: /CLOUDINARY CHAIN TEST/.test(html),
  };

  const pdfHead = await fetch(pdf.secure_url, { method: 'HEAD' });
  out.pdfFetch = { status: pdfHead.status, type: pdfHead.headers.get('content-type') };
  const pngHead = await fetch(png.secure_url, { method: 'HEAD' });
  out.previewFetch = { status: pngHead.status, type: pngHead.headers.get('content-type') };

  const list = await (await api('/api/certificates')).json();
  out.listHasCert = Array.isArray(list) && list.some((c) => c.id === ID);

  // What the printed QR actually decodes to, read straight from the PNG bytes
  // is verified separately with pyzbar; here we confirm the encoder input.
  out.qrEncodesPublicHttpsUrl = /^https:\/\//.test(VERIFY);

  await cld.destroyTestAssets(ID);
  out.cleanup = 'destroyed';

  console.log('RESULT_JSON_START');
  console.log(JSON.stringify(out, null, 2));
  console.log('RESULT_JSON_END');
  process.exit(0);
}

main().catch((e) => {
  console.error('CHECK_FAILED:', e.message);
  console.log('RESULT_JSON_START');
  console.log(JSON.stringify({ ...out, error: e.message }, null, 2));
  console.log('RESULT_JSON_END');
  process.exit(1);
});
