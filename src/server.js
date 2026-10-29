
/**
 * OSHEQ Certificate Backend
 * -------------------------
 *
 * POST /api/certificates
 * GET  /api/certificates
 * GET  /api/verify/:id
 * GET  /api/cloudinary-status
 * GET  /pdfs/:file
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const { renderHtml, formatDate } = require('./template');
const db = require('./db');
const cloudinary = require('./cloudinary');

const app = express();

app.use(cors());

app.use(express.json({
  limit: '2mb',
}));

const PORT = process.env.PORT || 4000;

const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${PORT}`)
).replace(/\/$/, '');

// Vercel's deployment filesystem is read-only; only /tmp is writable.
const PDF_DIR = process.env.VERCEL
  ? path.join(require('os').tmpdir(), 'osheq-pdfs')
  : path.join(__dirname, '..', 'pdfs');

fs.mkdirSync(PDF_DIR, { recursive: true });


/* -------------------------------------------------------
   Local PDF folder
------------------------------------------------------- */

app.use(
  '/pdfs',
  express.static(PDF_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.pdf')) {
        res.setHeader(
          'Content-Disposition',
          'attachment'
        );
      }
    },
  })
);


/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */

async function makeQrDataUrl(text) {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 0,
    width: 512,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });
}


async function htmlToPdf(html, outPath) {
  // On Vercel, use the bundled Linux Chromium. Locally, CHROME_PATH can point
  // to the installed Windows Chrome executable.
  const isVercel = Boolean(process.env.VERCEL);
  const executablePath = process.env.CHROME_PATH ||
    (isVercel ? await chromium.executablePath() : null);

  if (!executablePath) {
    throw new Error(
      'Chrome executable not configured. Set CHROME_PATH in .env for local Windows development.'
    );
  }

  const launchOpts = {
    executablePath,
    headless: true,
    args: isVercel ? chromium.args : [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
    ],
  };

  const browser = await puppeteer.launch(launchOpts);

  try {
    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: 'networkidle0',
    });

    await page.evaluateHandle(
      'document.fonts.ready'
    );

    await page.pdf({
      path: outPath,
      width: '210mm',
      height: '297mm',
      printBackground: true,
      pageRanges: '1',
    });
  } finally {
    await browser.close();
  }
}


function autoCertNo() {
  return String(
    Math.floor(
      10000000 +
      Math.random() * 89999999
    )
  );
}


/* -------------------------------------------------------
   Health
------------------------------------------------------- */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    cloudinary: cloudinary.isConfigured(),
  });
});


/* -------------------------------------------------------
   Cloudinary status
------------------------------------------------------- */

app.get('/api/cloudinary-status', (req, res) => {
  res.json({
    configured: cloudinary.isConfigured(),
    qrMode: process.env.QR_MODE || 'verify',
  });
});


/* -------------------------------------------------------
   Certificates list
------------------------------------------------------- */

app.get('/api/certificates', async (req, res) => {
  try {
    // Cloudinary is the persistent source of truth on Vercel.
    if (process.env.VERCEL && cloudinary.isConfigured()) {
      return res.json(await cloudinary.listPdfs());
    }
    return res.json(db.list());
  } catch (err) {
    console.error('Certificate list error:', err);
    return res.status(500).json({ error: 'Could not load certificates' });
  }
});


/* -------------------------------------------------------
   Generate Certificate
------------------------------------------------------- */

app.post('/api/certificates', async (req, res) => {
  try {
    const {
      name,
      course = '',
      provider = 'Safety Solution Pvt Ltd.',
      date = '',
      certNo: certNoIn = '',
      saveToCloudinary = true,
    } = req.body || {};


    /* -----------------------------------------------
       Validate
    ------------------------------------------------ */

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        error: 'Participant name is required',
      });
    }


    /* -----------------------------------------------
       Certificate number
    ------------------------------------------------ */

    const certNo = (
      certNoIn ||
      autoCertNo()
    ).trim();


    const dateText = formatDate(date);


    const safeNo = certNo
      .replace(/[^A-Za-z0-9_-]/g, '_');


    /*
     * This ID is generated BEFORE PDF creation.
     *
     * QR can therefore point to:
     *
     * https://your-domain.com/api/verify/local-id
     */

    const localId =
      `${Date.now()}-${safeNo}`;


    /* -----------------------------------------------
       QR verification URL
    ------------------------------------------------ */

    const verifyUrl =
      `${PUBLIC_BASE_URL}/api/verify/${localId}`;


    /* -----------------------------------------------
       QR
    ------------------------------------------------ */

    const qrDataUrl =
      await makeQrDataUrl(verifyUrl);


    /* -----------------------------------------------
       HTML
    ------------------------------------------------ */

    if (process.env.VERCEL && !cloudinary.isConfigured()) {
      return res.status(503).json({
        error: 'Cloudinary must be configured on Vercel so generated PDFs persist after the request ends.',
      });
    }
    if (process.env.VERCEL && !saveToCloudinary) {
      return res.status(400).json({
        error: 'Vercel deployments require saveToCloudinary=true so the PDF and QR verification link remain available.',
      });
    }

    const html = renderHtml({
      name: String(name).trim(),
      course,
      provider,
      dateText,
      certNo,
      qrDataUrl,
    });


    /* -----------------------------------------------
       Local PDF
    ------------------------------------------------ */

    const pdfPath = path.join(
      PDF_DIR,
      `${localId}.pdf`
    );


    await htmlToPdf(
      html,
      pdfPath
    );


    const displayName =
      `${safeNo}.pdf`;


    /* -----------------------------------------------
       Cloudinary upload
    ------------------------------------------------ */

    let cloudinaryUrl = null;
    let secureUrl = null;
    let cloudinaryPublicId = null;


    if (
      cloudinary.isConfigured() &&
      saveToCloudinary
    ) {
      const uploaded =
        await cloudinary.uploadPdf(
          pdfPath,
          localId,
          {
            certNo,
            name: String(name).trim(),
            course,
            provider,
            dateText,
            verifyUrl,
          }
        );


      cloudinaryUrl =
        uploaded.url || null;


      secureUrl =
        uploaded.secure_url || null;


      cloudinaryPublicId =
        uploaded.public_id || null;
    }


    /* -----------------------------------------------
       Final download URL
    ------------------------------------------------ */

    const downloadLink =
      secureUrl ||
      cloudinaryUrl ||
      `${PUBLIC_BASE_URL}/pdfs/${localId}.pdf`;


    /* -----------------------------------------------
       Save database record
    ------------------------------------------------ */

    const record = {
      id: localId,

      certNo,

      name: String(name).trim(),

      course,

      provider,

      dateText,

      localId,

      cloudinaryUrl,

      secureUrl,

      cloudinaryPublicId,

      downloadLink,

      verifyUrl,

      qrText: verifyUrl,

      qrDataUrl,

      createdAt:
        new Date().toISOString(),
    };


    db.save(record);


    /* -----------------------------------------------
       Response
    ------------------------------------------------ */

    res.json(record);

  } catch (err) {

    console.error(
      'Certificate generation error:',
      err
    );

    res.status(500).json({
      error:
        err.message ||
        'Failed to generate certificate',
    });
  }
});


/* -------------------------------------------------------
   QR Verification
------------------------------------------------------- */

app.get(
  '/api/verify/:id',
  async (req, res) => {

    try {

      const localId = String(req.params.id || '');
      let rec = db.get(localId);

      // A Vercel serverless instance may not have the JSON record from the
      // request that generated the certificate. Look up the persistent PDF.
      if (!rec && cloudinary.isConfigured()) {
        const asset = await cloudinary.getPdf(localId);
        if (asset) {
          return res.redirect(302, asset.secure_url || asset.url);
        }
      }

      if (!rec) {
        return res.status(404).send(`
          <!doctype html><html><head><meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>Certificate not found</title></head>
          <body style="font-family:sans-serif;text-align:center;padding:40px">
            <h2>❌ Certificate not found</h2>
            <p>This certificate could not be verified.</p>
          </body></html>
        `);
      }

      if (rec.secureUrl || rec.cloudinaryUrl) {
        return res.redirect(302, rec.secureUrl || rec.cloudinaryUrl);
      }


      /* -------------------------------------------
         Local PDF fallback
      ------------------------------------------- */

      if (
        req.accepts('html')
      ) {

        return res.send(`
          <html>
            <head>
              <meta charset="utf-8">
              <meta
                name="viewport"
                content="width=device-width,initial-scale=1"
              >
              <title>Certificate Verification</title>
            </head>

            <body
              style="
                font-family:sans-serif;
                padding:30px;
                text-align:center;
              "
            >

              <h2>
                ✅ Valid Certificate
              </h2>

              <p>
                Certificate No:
                <b>${escapeHtml(rec.certNo)}</b>
              </p>

              <p>
                Name:
                <b>${escapeHtml(rec.name)}</b>
              </p>

              <p>
                Course:
                ${escapeHtml(rec.course || '—')}
              </p>

              <p>
                Provider:
                ${escapeHtml(rec.provider)}
              </p>

              <p>
                Date:
                ${escapeHtml(rec.dateText)}
              </p>

              ${
                rec.downloadLink
                  ? `
                    <p>
                      <a
                        href="${rec.downloadLink}"
                        target="_blank"
                      >
                        Download Certificate PDF
                      </a>
                    </p>
                  `
                  : ''
              }

            </body>
          </html>
        `);

      }


      return res.json(rec);

    } catch (err) {

      console.error(
        'Verify error:',
        err
      );

      res.status(500).json({
        error:
          err.message ||
          'Verification failed',
      });
    }
  }
);


/* -------------------------------------------------------
   Escape HTML
------------------------------------------------------- */

function escapeHtml(value) {

  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


/* -------------------------------------------------------
   Start Server
------------------------------------------------------- */

// Vercel imports the Express app as a serverless function. Local development
// still starts a normal HTTP server.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log('');
    console.log('==========================================');
    console.log('✅ OSHEQ Certificate Backend');
    console.log(`🚀 Running: ${PUBLIC_BASE_URL}`);
    console.log(`☁️ Cloudinary: ${cloudinary.isConfigured() ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    console.log('==========================================');
  });
}

module.exports = app;