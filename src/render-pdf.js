/**
 * render-pdf.js — certificate renderer, pure JavaScript only.
 *
 *   PDF -> pdf-lib (+ @pdf-lib/fontkit, so our own TTFs are embedded/subset)
 *   PNG -> pureimage (pure JS canvas: decodes bg_clean2.jpg + the QR png)
 *
 * Nothing native is loaded and no external binary is executed, so this works
 * on any Node 20+ host: Vercel, Lambda, Docker, or a plain VPS.
 *
 * Geometry is copied 1:1 from src/template.js (A4 794x1123 px @96dpi).
 * px -> pt = * 0.75   (794px = 595.5pt, 1123px = 842.25pt)
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const PImage = require('pureimage');

const ASSETS = path.join(__dirname, '..', 'assets');
const BG_PATH = path.join(ASSETS, 'bg_clean2.jpg');
const FONT_DIR = path.join(ASSETS, 'fonts');

const PAGE_W = 794;              // px
const PAGE_H = 1123;             // px
const PX2PT = 0.75;

/* ascent ratios straight from the font tables (verified: Montserrat 968/1000,
   EBGaramond 1007/1000) so text sits where CSS `top:` would put it. */
const FIELDS = [
  { key: 'name',     top: 411, size: 28.69, font: 'garamond',  weight: 'bold',   color: '#15986A', ascent: 1.007 },
  { key: 'course',   top: 624, size: 13.00, font: 'montserrat', weight: 'semibold', color: '#000000', ascent: 0.968 },
  { key: 'provider', top: 683, size: 16.23, font: 'montserrat', weight: 'semibold', color: '#000000', ascent: 0.968 },
  { key: 'dated',    top: 751, size: 11.44, font: 'montserrat', weight: 'medium', color: '#000000', ascent: 0.968, prefix: 'DATED: ' },
  { key: 'certno',   top: 799, size: 11.44, font: 'montserrat', weight: 'medium', color: '#000000', ascent: 0.968, prefix: 'CERTIFICATE NO: ' },
];
const QR = { left: 49, top: 929, size: 105, pad: 3 };

const hex = h => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

let pdfFonts = null;   // cached embedded fonts
let imgCache = null;   // cached bg / qr bitmaps for the PNG path

async function loadPdfFonts(doc) {
  doc.registerFontkit(fontkit);
  return {
    montserrat: await doc.embedFont(fs.readFileSync(path.join(FONT_DIR, 'Montserrat.ttf')), { subset: true }),
    garamond: await doc.embedFont(fs.readFileSync(path.join(FONT_DIR, 'EBGaramond.ttf')), { subset: true }),
  };
}

/** Build the certificate PDF buffer. */
async function buildPdf({ name, course, provider, dateText, certNo, qrDataUrl }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`OSHEQ Certificate ${certNo}`);
  doc.setAuthor('Safety Solution Pvt Ltd.');
  doc.setSubject(course || 'Certificate of Completion');

  const page = doc.addPage([PAGE_W * PX2PT, PAGE_H * PX2PT]);
  const fonts = await loadPdfFonts(doc);

  // background art (title, paragraph, logo, signature, QR frame are baked in)
  const bg = await doc.embedJpg(fs.readFileSync(BG_PATH));
  page.drawImage(bg, { x: 0, y: 0, width: PAGE_W * PX2PT, height: PAGE_H * PX2PT });

  const values = {
    name: name || '',
    course: course || '',
    provider: provider || 'Safety Solution Pvt Ltd.',
    dated: dateText || '00-Apr-0000',
    certno: certNo || '',
  };

  for (const f of FIELDS) {
    let text = String(values[f.key] || '');
    if (f.prefix) text = f.prefix + text;
    if (!text.trim()) continue;
    const font = fonts[f.font];
    const sizePt = f.size;
    const widthPt = font.widthOfTextAtSize(text, sizePt);
    const x = (PAGE_W * PX2PT - widthPt) / 2;
    const baselineY = PAGE_H * PX2PT - f.top * PX2PT - f.ascent * sizePt;
    page.drawText(text, { x, y: baselineY, size: sizePt, font, color: hex(f.color) });
  }

  // QR (verify link) — data URI -> bytes
  const qrB64 = String(qrDataUrl).replace(/^data:image\/png;base64,/, '');
  const qrPng = await doc.embedPng(Buffer.from(qrB64, 'base64'));
  const q = QR;
  page.drawRectangle({
    x: q.left * PX2PT, y: PAGE_H * PX2PT - (q.top + q.size) * PX2PT,
    width: q.size * PX2PT, height: q.size * PX2PT, color: rgb(1, 1, 1),
  });
  page.drawImage(qrPng, {
    x: (q.left + q.pad) * PX2PT,
    y: PAGE_H * PX2PT - (q.top + q.size - q.pad) * PX2PT,
    width: (q.size - q.pad * 2) * PX2PT,
    height: (q.size - q.pad * 2) * PX2PT,
  });

  return Buffer.from(await doc.save());
}

/** Build the preview PNG (used by the /v/:id page). */
async function buildPng({ name, course, provider, dateText, certNo, qrDataUrl }) {
  if (!imgCache) {
    // pureimage's getKerningValue breaks on these TTFs ("h[d] is not a function"):
    // the kern table uses a subtable format it doesn't implement. Kerning off = safe.
    const regs = [
      PImage.registerFont(path.join(FONT_DIR, 'Montserrat.ttf'), 'Montserrat').loadSync(),
      PImage.registerFont(path.join(FONT_DIR, 'EBGaramond.ttf'), 'GaramondCert').loadSync(),
    ];
    for (const r of regs) {
      if (r && r.font) r.font.getKerningValue = function () { return 0; };
    }
    imgCache = { kerning: 'disabled' };
  }
  const img = PImage.make(PAGE_W, PAGE_H);
  const ctx = img.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  const bgBitmap = await PImage.decodeJPEGFromStream(fs.createReadStream(BG_PATH));
  ctx.drawImage(bgBitmap, 0, 0, PAGE_W, PAGE_H);

  const values = {
    name: name || '',
    course: course || '',
    provider: provider || 'Safety Solution Pvt Ltd.',
    dated: dateText || '00-Apr-0000',
    certno: certNo || '',
  };

  for (const f of FIELDS) {
    let text = String(values[f.key] || '');
    if (f.prefix) text = f.prefix + text;
    if (!text.trim()) continue;
    const family = f.font === 'garamond' ? 'GaramondCert' : 'Montserrat';
    const sizePx = f.size * (4 / 3);
    ctx.font = `${sizePx.toFixed(2)}pt ${family}`;
    ctx.fillStyle = f.color;
    let w = 0;
    try { w = PImage.measureText(ctx, text).width; } catch (_) { w = 0; }
    const x = (PAGE_W - w) / 2;
    const baseline = f.top + f.ascent * sizePx;
    ctx.fillText(text, x, baseline);
  }

  const qrBuf = Buffer.from(String(qrDataUrl).replace(/^data:image\/png;base64,/, ''), 'base64');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(QR.left, QR.top, QR.size, QR.size);
  const qrBitmap = await PImage.decodePNGFromStream(require('stream').Readable.from(qrBuf));
  ctx.drawImage(qrBitmap, QR.left + QR.pad, QR.top + QR.pad, QR.size - QR.pad * 2, QR.size - QR.pad * 2);

  const { PassThrough } = require('stream');
  const out = new PassThrough();
  const chunks = [];
  out.on('data', c => chunks.push(c));
  const done = new Promise((res, rej) => { out.on('end', res); out.on('error', rej); });
  await PImage.encodePNGToStream(img, out);
  await done;
  return Buffer.concat(chunks);
}

/**
 * @param {object} data { name, course, provider, dateText, certNo, qrDataUrl }
 * @param {object} out  { pdfPath, pngPath }
 */
async function renderCertificate(data, { pdfPath, pngPath }) {
  const pdf = await buildPdf(data);
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
  fs.writeFileSync(pdfPath, pdf);
  let pngBytes = 0;
  if (pngPath) {
    const png = await buildPng(data);
    fs.mkdirSync(path.dirname(pngPath), { recursive: true });
    fs.writeFileSync(pngPath, png);
    pngBytes = png.length;
  }
  return { engine: 'pdf-lib+pureimage', pdfBytes: pdf.length, pngBytes };
}

function browserDiagnostics() {
  return {
    mode: 'pure-js',
    engine: 'pdf-lib + @pdf-lib/fontkit + pureimage',
    browserRequired: false,
    note: 'PDF and PNG are built in plain JavaScript; no external process is run.',
    nodeVersion: process.version,
  };
}

module.exports = { renderCertificate, buildPdf, buildPng, browserDiagnostics, FIELDS };
