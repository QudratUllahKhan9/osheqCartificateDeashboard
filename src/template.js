/**
 * Certificate HTML template — pixel-matched to the original OSHEQ PDF.
 * Exact values were extracted from the PDF itself (PyMuPDF):
 *
 *   CERTIFICATE OF COMPLETION   Garamond-Bold      15.21pt  #06446B
 *   PRESENTED TO line           Montserrat-Regular 12.08pt  #000000
 *   Name (e.g. Ahmad)           Garamond-Bold      28.69pt  #15986A
 *   Paragraph                   Montserrat-Medium  11.00pt  #000000  lh 17pt
 *   IN ASSOCIATION WITH ...     Montserrat-Regular 12.00pt  #000000
 *   Safety Solution Pvt Ltd.    Montserrat-SemiBold 16.23pt #000000
 *   DATED: / CERTIFICATE NO:    Montserrat-Medium  11.44pt  #000000
 *   EDWARD COLLINS WRIGHT       Montserrat-SemiBold 10.41pt #000000   (static)
 *   DIRECTOR TRAINING           ArialMT             7.69pt  #000000   (static)
 *   QR caption / bottom bar     ArialMT 7.22pt / Montserrat 7.87pt #FFFFFF (static)
 *
 * Page: A4 794x1123 px @96dpi. pt -> px = *4/3.
 */
const fs = require('fs');
const path = require('path');

const BG_PATH = path.join(__dirname, '..', 'assets', 'bg_clean2.jpg');
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');

function dataUri(filePath, mime) {
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

/**
 * @param {object} p
 * @param {string} p.name        participant name
 * @param {string} p.course      course / program name (new line above association)
 * @param {string} p.provider    default "Safety Solution Pvt Ltd."
 * @param {string} p.dateText    formatted "05-Oct-2026" or "00-Apr-0000"
 * @param {string} p.certNo      certificate number
 * @param {string} p.qrDataUrl   QR code image (data URI) pointing to the verify link
 */
function renderHtml({ name, course, provider, dateText, certNo, qrDataUrl }) {
  const bg = dataUri(BG_PATH, 'image/jpeg');
  const montserrat = dataUri(path.join(FONT_DIR, 'Montserrat.ttf'), 'font/ttf');
  const garamond = dataUri(path.join(FONT_DIR, 'EBGaramond.ttf'), 'font/ttf');

  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family:'Montserrat'; src:url('${montserrat}') format('truetype'); font-weight:100 900; }
@font-face { font-family:'GaramondCert'; src:url('${garamond}') format('truetype'); font-weight:400 800; }
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:794px; height:1123px; overflow:hidden; }
.cert { position:relative; width:794px; height:1123px; background:#fff; font-family:'Montserrat',sans-serif; }
.bg { position:absolute; inset:0; width:794px; height:1123px; }
/* NOTE: title, presented-to, paragraph, association line, logo, signature,
   QR frame & captions are STATIC and already baked into bg_clean2.jpg —
   only dynamic fields are rendered here. */
.name    { position:absolute; top:411px; left:0; right:0; text-align:center;
           font-family:'GaramondCert',Garamond,serif; font-weight:700; font-size:28.69pt; color:#15986A; }
.course  { position:absolute; top:624px; left:0; right:0; text-align:center;
           font-size:13pt; font-weight:600; color:#000; }
.provider{ position:absolute; top:683px; left:0; right:0; text-align:center;
           font-size:16.23pt; font-weight:600; color:#000; }
.dated   { position:absolute; top:751px; left:0; right:0; text-align:center;
           font-size:11.44pt; font-weight:500; color:#000; }
.certno  { position:absolute; top:799px; left:0; right:0; text-align:center;
           font-size:11.44pt; font-weight:500; color:#000; }
.qr      { position:absolute; left:49px; top:929px; width:105px; height:105px; padding:3px; background:#fff; }
.qr img  { width:100%; height:100%; display:block; }
</style></head>
<body>
  <div class="cert">
    <img class="bg" src="${bg}" />
    <div class="name">${esc(name)}</div>
    <div class="course">${esc(course)}</div>
    <div class="provider">${esc(provider || 'Safety Solution Pvt Ltd.')}</div>
    <div class="dated">DATED: ${esc(dateText)}</div>
    <div class="certno">CERTIFICATE NO: ${esc(certNo)}</div>
    <div class="qr"><img src="${qrDataUrl}" /></div>
  </div>
</body></html>`;
}

/** Format an ISO date (2026-10-05) as 05-Oct-2026; empty -> 00-Apr-0000 */
function formatDate(iso) {
  if (!iso) return '00-Apr-0000';
  const [y, m, d] = iso.split('-').map(Number);
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (!y || !m || !d) return '00-Apr-0000';
  return `${String(d).padStart(2, '0')}-${M[m - 1]}-${y}`;
}

module.exports = { renderHtml, formatDate };
