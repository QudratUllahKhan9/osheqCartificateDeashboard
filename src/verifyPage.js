/**
 * verifyPage.js — the page a phone sees after scanning the QR.
 * Server-rendered so it works with zero JS, on any phone, even on a cold
 * serverless instance (all data comes from the Cloudinary metadata context).
 */

const NAVY = '#06446B';
const GREEN = '#15986A';

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[c]));
}

function row(label, value) {
  if (!value) return '';
  return `<div class="row"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`;
}

function shell(title, body) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
  :root { --navy:${NAVY}; --green:${GREEN}; }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
       background:#eef3f6;color:#12212b;padding:18px;min-height:100vh}
  .wrap{max-width:560px;margin:0 auto}
  .head{background:linear-gradient(135deg,var(--navy),#0b5b86);color:#fff;
        border-radius:16px 16px 0 0;padding:22px 20px;text-align:center}
  .badge{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.14);
         border:1px solid rgba(255,255,255,.25);padding:6px 14px;border-radius:999px;
         font-size:12px;font-weight:700;letter-spacing:.4px}
  .head h1{font-size:19px;margin-top:12px;font-weight:700}
  .head p{font-size:12px;opacity:.85;margin-top:6px}
  .card{background:#fff;border-radius:0 0 16px 16px;padding:18px;box-shadow:0 10px 30px rgba(6,68,107,.10)}
  .cert-frame{border:1px solid #dbe6ec;border-radius:10px;overflow:hidden;background:#f7fafb}
  .cert-frame img{display:block;width:100%;height:auto}
  .rows{margin-top:14px;border-top:1px solid #e6eef2}
  .row{display:flex;justify-content:space-between;gap:14px;padding:10px 0;border-bottom:1px solid #eef4f7;font-size:13px}
  .label{color:#6b8794;font-weight:600}
  .value{text-align:right;font-weight:700;color:#12212b;word-break:break-word}
  .actions{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}
  .btn{flex:1 1 140px;display:block;text-align:center;text-decoration:none;padding:12px 14px;
       border-radius:10px;font-size:13px;font-weight:700}
  .btn-primary{background:var(--green);color:#fff}
  .btn-ghost{background:#fff;color:var(--navy);border:1.5px solid var(--navy)}
  .foot{text-align:center;font-size:11px;color:#7b95a1;margin-top:16px;line-height:1.6}
  .warn{background:#fff7e6;border:1px solid #ffe0a3;color:#8a5a00;padding:10px 12px;
        border-radius:10px;font-size:12px;margin-top:12px}
</style></head>
<body><div class="wrap">${body}</div></body></html>`;
}

/** Valid certificate page. */
function renderVerifyPage({ rec, previewSrc, pdfHref, issuedAt, warning }) {
  const preview = previewSrc
    ? `<div class="cert-frame"><img src="${esc(previewSrc)}" alt="Certificate preview"></div>`
    : `<div class="warn">Preview image uplabdh nahi hai — neeche "Download PDF" se certificate kholein.</div>`;

  const body = `
  <div class="head">
    <span class="badge">✅ VERIFIED CERTIFICATE</span>
    <h1>OSHEQ — Safety Solution Pvt Ltd.</h1>
    <p>Yeh certificate officially issued aur verified hai.</p>
  </div>
  <div class="card">
    ${preview}
    <div class="rows">
      ${row('Certificate No', rec.certNo)}
      ${row('Participant', rec.name)}
      ${row('Course / Program', rec.course)}
      ${row('Training Provider', rec.provider)}
      ${row('Date', rec.dateText)}
      ${row('Issued', issuedAt ? new Date(issuedAt).toLocaleString('en-GB') : '')}
    </div>
    <div class="actions">
      ${pdfHref ? `<a class="btn btn-primary" href="${esc(pdfHref)}" target="_blank" rel="noreferrer">⬇ Download PDF</a>` : ''}
      <a class="btn btn-ghost" href="javascript:history.back()">← Back</a>
    </div>
    ${warning ? `<div class="warn">${esc(warning)}</div>` : ''}
    <p class="foot">Verification ID: ${esc(rec.id)}<br>
      Is page ka link hi certificate ka official verification source hai.</p>
  </div>`;

  return shell(`Certificate ${rec.certNo} — Verified`, body);
}

function renderNotFoundPage(id) {
  const body = `
  <div class="head" style="background:linear-gradient(135deg,#7a2222,#a63a3a)">
    <span class="badge">❌ NOT FOUND</span>
    <h1>Certificate verify nahi ho saka</h1>
    <p>Is ID ke sath koi certificate record nahi mila.</p>
  </div>
  <div class="card">
    <div class="rows">
      <div class="row"><span class="label">Scanned ID</span><span class="value">${esc(id)}</span></div>
    </div>
    <p class="foot">Certificate number / QR link check karein. Agar certificate abhi generate hua hai
      to 1 minute baad dobara scan karein.</p>
  </div>`;
  return shell('Certificate not found', body);
}

module.exports = { renderVerifyPage, renderNotFoundPage, esc };
