/**
 * server.js — OSHEQ Certificate engine (HTTP API)
 * ------------------------------------------------
 * Routes
 *   GET  /api/status                  -> config + Cloudinary check (+ QR warnings)
 *   POST /api/certificates            -> PDF render + Cloudinary upload + QR
 *   GET  /api/certificates            -> list (Cloudinary = source of truth)
 *   GET  /v/:id                       -> QR target: verified certificate page
 *   GET  /api/verify/:id              -> old QR links -> redirect to /v/:id
 *   GET  /api/qr/:id                  -> PNG of the QR (print/download)
 *   GET  /pdfs/:file                  -> local PDF copy (dev)
 *   GET  /api/health                  -> liveness
 *
 * THE ORDERING TRICK (why the QR always works):
 *   localId (= sanitized certificate number) is created BEFORE the PDF is
 *   rendered, and Cloudinary's public_id is derived from it:
 *      osheq-certificates/pdf/<localId>.pdf
 *      osheq-certificates/preview/<localId>
 *   So the QR encodes  <PUBLIC_BASE_URL>/v/<localId>  — a public URL that is
 *   already valid at render time and stays valid after the upload lands.
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');

const { buildConfig } = require('./config');
const { renderHtml, formatDate } = require('./template');
const { renderCertificate } = require('./render');
const { renderVerifyPage, renderNotFoundPage, esc } = require('./verifyPage');
const db = require('./db');
const cld = require('./cloudinary');

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT || 4000);
const cfg = buildConfig(PORT);

const WORK_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'osheq-work')
  : path.join(__dirname, '..', 'work');
const PDF_DIR = path.join(WORK_DIR, 'pdf');
const PNG_DIR = path.join(WORK_DIR, 'png');
fs.mkdirSync(PDF_DIR, { recursive: true });
fs.mkdirSync(PNG_DIR, { recursive: true });

app.use('/pdfs', express.static(PDF_DIR));
app.use('/previews', express.static(PNG_DIR));

/* ------------------------------------------------------------------ helpers */

async function makeQrDataUrl(text) {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 0,
    width: 512,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}

function autoCertNo() {
  return String(Math.floor(10000000 + Math.random() * 89999999));
}

/** Certificate number -> safe, deterministic id (same cert no = same file). */
function toLocalId(certNo) {
  const safe = String(certNo || '').trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
  if (!safe) return `cert-${Date.now()}`;
  return safe.length >= 4 ? safe : `cert-${safe}`;
}

/* -------------------------------------------------------------------- status */

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/status', async (req, res) => {
  let cloudinaryOk = false;
  let cloudinaryError = null;
  if (cld.isConfigured()) {
    try {
      await cld.getPreview('__ping__');
      cloudinaryOk = true;
    } catch (err) {
      cloudinaryError = err.message;
    }
  }
  res.json({
    ok: true,
    cloudinaryConfigured: cld.isConfigured(),
    cloudinaryReachable: cloudinaryOk,
    cloudinaryError,
    publicBaseUrl: cfg.publicBaseUrl,
    qrTargetExample: `${cfg.publicBaseUrl}/v/CERT-NUMBER`,
    warnings: cfg.warnings,
    lanIps: cfg.lanIps,
    isVercel: cfg.isVercel,
  });
});

/* -------------------------------------------------------------------- create */

app.post('/api/certificates', async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const course = String(body.course || '').trim();
  const provider = String(body.provider || 'Safety Solution Pvt Ltd.').trim();
  const replace = body.replace === true || body.replace === 'true';

  if (!name) return res.status(400).json({ error: 'Participant ka naam zaroori hai.' });

  if (cfg.isVercel && !cld.isConfigured()) {
    return res.status(503).json({
      error:
        'Cloudinary env vars missing hain. Vercel par generated PDF persist nahi hoti, ' +
        'is liye CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET add karna zaroori hai.',
    });
  }

  const certNo = String(body.certNo || '').trim() || autoCertNo();
  const localId = toLocalId(certNo);

  const existing = db.get(localId);
  if (existing && !replace) {
    return res.status(409).json({
      error: `Certificate number "${certNo}" pehle se maujood hai. Naya number dein ya dobara generate karke update karein.`,
      code: 'DUPLICATE_CERT_NO',
      existing: { id: existing.id, certNo: existing.certNo, name: existing.name, verifyUrl: existing.verifyUrl },
    });
  }

  const dateText = formatDate(body.date || '');
  const verifyUrl = `${cfg.publicBaseUrl}/v/${encodeURIComponent(localId)}`;
  const issuedAt = new Date().toISOString();

  try {
    /* 1. QR is generated from a URL that is valid NOW and AFTER upload */
    const qrDataUrl = await makeQrDataUrl(verifyUrl);

    /* 2. Render PDF + preview PNG with one Chromium */
    const html = renderHtml({ name, course, provider, dateText, certNo, qrDataUrl });
    const pdfPath = path.join(PDF_DIR, `${localId}.pdf`);
    const pngPath = path.join(PNG_DIR, `${localId}.png`);
    await renderCertificate(html, { pdfPath, pngPath });

    /* 3. Upload both to Cloudinary (deterministic public_id) */
    let pdfUrl = null;
    let previewUrl = null;
    let previewDisplay = null;
    let uploadError = null;

    if (cld.isConfigured()) {
      const meta = { localId, certNo, name, course, provider, dateText, verifyUrl, issuedAt };
      try {
        const pdf = await cld.uploadPdf(pdfPath, localId, meta);
        pdfUrl = pdf.secure_url || pdf.url || null;
        const png = await cld.uploadPreview(pngPath, localId, meta);
        previewUrl = png.secure_url || png.url || null;
        previewDisplay = cld.previewDisplayUrl(png.public_id);
      } catch (err) {
        uploadError = err.message;
        console.error('[cloudinary] upload failed:', err.message);
      }
    }

    const isLocal = !cld.isConfigured() || uploadError;

    const signedPdf = pdfUrl ? cld.signedPdfUrl(localId) : null;

    const record = {
      id: localId,
      localId,
      certNo,
      name,
      course,
      provider,
      dateText,
      verifyUrl,
      qrTarget: verifyUrl,
      qrDataUrl,
      pdfUrl: pdfUrl || `${cfg.publicBaseUrl}/pdfs/${localId}.pdf`,
      previewUrl: previewDisplay || previewUrl || `${cfg.publicBaseUrl}/previews/${localId}.png`,
      // Cloudinary blocks plain raw-PDF delivery (verified 401); signed URL opens.
      downloadLink: signedPdf || `${cfg.publicBaseUrl}/pdfs/${localId}.pdf`,
      pdfEndpoint: `${cfg.publicBaseUrl}/api/pdf/${encodeURIComponent(localId)}`,
      storage: isLocal ? 'local' : 'cloudinary',
      savedToCloudinary: Boolean(pdfUrl && !uploadError),
      uploadError,
      issuedAt,
      createdAt: issuedAt,
      // aliases kept so older frontend code keeps working
      secureUrl: pdfUrl,
      cloudinaryUrl: pdfUrl,
    };

    db.upsert(record);

    if (uploadError) {
      return res.status(502).json({
        error:
          `PDF ban gaya lekin Cloudinary upload fail hua — is QR se certificate nahi khulega. ` +
          `Error: ${uploadError}`,
        record,
      });
    }

    return res.json(record);
  } catch (err) {
    console.error('[create] failed:', err);
    return res.status(500).json({ error: err.message || 'Certificate generate nahi hua.' });
  }
});

/* ---------------------------------------------------------------------- list */

app.get('/api/certificates', async (req, res) => {
  try {
    const local = db.all();
    const localById = new Map(local.map((r) => [r.id, r]));

    if (!cld.isConfigured()) return res.json(local);

    let remote = [];
    try {
      remote = await cld.listCertificates();
    } catch (err) {
      console.warn('[list] cloudinary unavailable:', err.message);
      return res.json(local);
    }

    // Cloudinary is the truth; merge local-only rows (e.g. failed uploads).
    const merged = remote.map((r) => {
      const cached = localById.get(r.id) || {};
      localById.delete(r.id);
      return {
        ...cached,
        ...r,
        qrDataUrl: cached.qrDataUrl || null,
        savedToCloudinary: true,
        storage: 'cloudinary',
      };
    });

    return res.json([...merged, ...localById.values()]);
  } catch (err) {
    console.error('[list] failed:', err);
    return res.status(500).json({ error: 'Certificates load nahi hue.' });
  }
});

/* ----------------------------------------------------- QR target (the page) */

async function resolveRecord(id) {
  const cached = db.get(id);
  if (cached) return { rec: cached, from: 'cache' };

  // Cold serverless instance: rebuild the record from Cloudinary metadata.
  if (!cld.isConfigured()) return null;

  const [pdf, img] = await Promise.all([cld.getPdf(id), cld.getPreview(id)]);
  if (!pdf && !img) return null;

  const ctx = (asset) => {
    const c = (asset && asset.context && (asset.context.custom || asset.context)) || {};
    return c;
  };
  const meta = { ...ctx(pdf), ...ctx(img) };
  const resource = pdf || img;

  return {
    from: 'cloudinary',
    rec: {
      id,
      localId: id,
      certNo: meta.certNo || String(id).replace(/^cert-/, ''),
      name: meta.name || '',
      course: meta.course || '',
      provider: meta.provider || 'Safety Solution Pvt Ltd.',
      dateText: meta.dateText || '',
      verifyUrl: meta.verifyUrl || `${cfg.publicBaseUrl}/v/${encodeURIComponent(id)}`,
      issuedAt: meta.issuedAt || resource.created_at || null,
      createdAt: resource.created_at || null,
      pdfUrl: pdf ? pdf.secure_url || pdf.url : null,
      previewUrl: img ? cld.previewDisplayUrl(img.public_id) : null,
      // Signed at click time — plain raw PDF URLs are blocked (HTTP 401).
      downloadLink: pdf ? `${cfg.publicBaseUrl}/api/pdf/${encodeURIComponent(id)}` : null,
      savedToCloudinary: true,
      storage: 'cloudinary',
    },
  };
}

app.get('/v/:id', async (req, res) => {
  const id = String(req.params.id || '').slice(0, 120);

  try {
    const found = await resolveRecord(id);
    if (!found) {
      return res.status(404).type('html').send(renderNotFoundPage(id));
    }

    const { rec } = found;

    if (req.query.format === 'json') return res.json(rec);

    const previewSrc =
      rec.previewUrl ||
      (rec.savedToCloudinary && cld.isConfigured() ? cld.previewDisplayUrl(cld.imgPublicId(rec.id)) : null) ||
      (rec.id ? `${cfg.publicBaseUrl}/previews/${rec.id}.png` : null);

    return res.type('html').send(
      renderVerifyPage({
        rec,
        previewSrc,
        // Always route through our own endpoint: it mints a fresh signed
        // Cloudinary download URL, because the plain one returns 401.
        pdfHref: rec.downloadLink && /cloudinary/.test(String(rec.downloadLink))
          ? `${cfg.publicBaseUrl}/api/pdf/${encodeURIComponent(rec.id)}`
          : rec.downloadLink || rec.pdfUrl || null,
        issuedAt: rec.issuedAt || rec.createdAt,
        warning: cfg.warnings[0] || null,
      })
    );
  } catch (err) {
    console.error('[verify] failed:', err);
    return res.status(500).type('html').send(renderNotFoundPage(id));
  }
});

/* Old QR codes (already printed) pointed at /api/verify/:id — keep them alive. */
app.get('/api/verify/:id', (req, res) => {
  const id = String(req.params.id || '');
  return res.redirect(302, `${cfg.publicBaseUrl}/v/${encodeURIComponent(id)}`);
});

/* ------------------------------------------------------- PDF download (signed)
 * Cloudinary refuses public delivery of raw PDFs (HTTP 401) unless the account
 * enables PDF/ZIP delivery. A SIGNED url returns 200 application/pdf, so we
 * mint one per request and redirect. This is what the QR page links to.
 */
app.get('/api/pdf/:id', async (req, res) => {
  const id = String(req.params.id || '');
  try {
    if (cld.isConfigured()) {
      const signed = cld.signedPdfUrl(id, { attachment: req.query.inline !== '1' });
      if (signed) {
        const head = await fetch(signed, { method: 'HEAD' }).catch(() => null);
        if (!head || head.status < 400) return res.redirect(302, signed);
      }
    }
    const local = path.join(PDF_DIR, `${id}.pdf`);
    if (fs.existsSync(local)) return res.sendFile(local);
    return res.status(404).json({ error: 'PDF uplabdh nahi hai.' });
  } catch (err) {
    console.error('[pdf] failed:', err.message);
    return res.status(500).json({ error: 'PDF download fail hua.' });
  }
});

/* QR PNG for printing / manual sharing */app.get('/api/qr/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const cached = db.get(id);
    let target = cached ? cached.verifyUrl : `${cfg.publicBaseUrl}/v/${encodeURIComponent(id)}`;

    if (req.query.target) target = String(req.query.target);

    const buf = await QRCode.toBuffer(target, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 720,
      type: 'png',
    });
    res.type('png').set('Cache-Control', 'public, max-age=3600').send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------- dev start */

app.get('/', (req, res) =>
  res.json({
    service: 'OSHEQ Certificate Backend',
    publicBaseUrl: cfg.publicBaseUrl,
    routes: ['/api/status', '/api/certificates', '/v/:id', '/api/qr/:id'],
  })
);

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log('');
    console.log('=================================================');
    console.log('✅ OSHEQ Certificate Backend');
    console.log(`🚀 ${cfg.publicBaseUrl}`);
    console.log(`☁️  Cloudinary: ${cld.isConfigured() ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    if (cfg.lanIps.length) console.log(`📱 LAN: ${cfg.lanIps.map((ip) => `http://${ip}:${PORT}`).join(' , ')}`);
    cfg.warnings.forEach((w) => console.log(`⚠️  ${w}`));
    console.log('=================================================');
  });
}

module.exports = app;
module.exports.esc = esc;
