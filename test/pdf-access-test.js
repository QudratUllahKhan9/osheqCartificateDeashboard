/**
 * pdf-access-test.js — why did the raw PDF return 401?
 * Cloudinary blocks PDF/ZIP delivery unless the account setting
 * "Allow delivery of PDF and ZIP files" is enabled. Test the workarounds so the
 * QR download button works even on a locked-down account.
 */
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const ID = 'PDFACCESSTEST';

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
  offsets.forEach((o) => (pdf += `${String(o).padStart(10, '0')} 00000 n \n`));
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

async function tryFetch(label, url) {
  try {
    const r = await fetch(url);
    const type = r.headers.get('content-type');
    let bytes = 0;
    if (r.ok) bytes = (await r.arrayBuffer()).byteLength;
    return { label, status: r.status, type, bytes };
  } catch (e) {
    return { label, error: e.message };
  }
}

async function main() {
  const tmp = path.join(__dirname, '..', 'work', 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const p = path.join(tmp, `${ID}.pdf`);
  fs.writeFileSync(p, minimalPdf('PDF ACCESS TEST'));

  const up = await new Promise((resolve, reject) => {
    const s = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        type: 'upload',
        public_id: `osheq-certificates/pdf/${ID}.pdf`,
        overwrite: true,
        invalidate: true,
      },
      (e, r) => (e ? reject(e) : resolve(r))
    );
    fs.createReadStream(p).pipe(s);
  });

  const results = [];
  results.push(await tryFetch('plain secure_url', up.secure_url));

  const signed = cloudinary.utils.private_download_url(up.public_id, 'pdf', {
    resource_type: 'raw',
    type: 'upload',
    attachment: true,
  });
  results.push(await tryFetch('private_download_url(signed)', signed));

  results.push(await tryFetch('secure_url?fl_attachment', `${up.secure_url}?fl_attachment=true`));

  // Authenticated Admin API fetch: returns metadata, proves creds, not bytes.
  let adminOk = false;
  try {
    await cloudinary.api.resource(up.public_id, { resource_type: 'raw' });
    adminOk = true;
  } catch (_) {}

  // Image-resource upload of a PDF page (Cloudinary can rasterize PDFs as images).
  let pgImage = null;
  try {
    pgImage = await cloudinary.uploader.upload(p, {
      resource_type: 'image',
      public_id: `osheq-certificates/pdfpage/${ID}`,
      format: 'png',
      overwrite: true,
    });
    results.push(await tryFetch('pdf-as-image png', pgImage.secure_url));
  } catch (e) {
    results.push({ label: 'pdf-as-image png', error: e.message });
  }

  console.log('RESULT_JSON_START');
  console.log(JSON.stringify({ secureUrl: up.secure_url, signedUrl: signed, adminOk, results }, null, 2));
  console.log('RESULT_JSON_END');

  try {
    await cloudinary.uploader.destroy(up.public_id, { resource_type: 'raw', invalidate: true });
    if (pgImage) await cloudinary.uploader.destroy(pgImage.public_id, { invalidate: true });
  } catch (_) {}
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED', e.message);
  process.exit(1);
});
