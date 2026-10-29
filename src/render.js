/**
 * render.js — HTML -> PDF + PNG using one headless Chromium.
 * The HTML template itself lives in template.js (pixel-matched to the original PDF).
 */
const fs = require('fs');
const path = require('path');

const PAGE = { width: 794, height: 1123 }; // A4 @96dpi

async function launchBrowser() {
  const isVercel = Boolean(process.env.VERCEL);
  // Locally you may point CHROME_PATH at any Chrome/Chromium build.
  // On Vercel the serverless-friendly binary is used.
  const puppeteer = require('puppeteer-core');

  let executablePath = process.env.CHROME_PATH || '';
  let args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--font-render-hinting=none',
    '--hide-scrollbars',
  ];

  if (isVercel) {
    const chromium = require('@sparticuz/chromium');
    executablePath = await chromium.executablePath();
    args = chromium.args;
  }

  if (!executablePath) {
    throw new Error(
      'Chrome executable missing. Locally set CHROME_PATH (e.g. C:/Program Files/Google/Chrome/Application/chrome.exe).'
    );
  }

  return puppeteer.launch({ executablePath, headless: true, args });
}

async function preparePage(browser, html) {
  const page = await browser.newPage();
  await page.setViewport({ ...PAGE, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluateHandle('document.fonts.ready');
  // Fonts are embedded as data URIs, so a small settle is enough.
  await new Promise((r) => setTimeout(r, 120));
  return page;
}

/** Render the certificate to PDF (raw, upload-ready) and PNG (what phones display). */
async function renderCertificate(html, { pdfPath, pngPath }) {
  const browser = await launchBrowser();
  try {
    const page = await preparePage(browser, html);

    await page.pdf({
      path: pdfPath,
      width: '210mm',
      height: '297mm',
      printBackground: true,
      pageRanges: '1',
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    if (pngPath) {
      fs.mkdirSync(path.dirname(pngPath), { recursive: true });
      await page.screenshot({
        path: pngPath,
        type: 'png',
        clip: { x: 0, y: 0, width: PAGE.width, height: PAGE.height },
        captureBeyondViewport: false,
      });
    }

    return { pdfPath, pngPath: pngPath || null };
  } finally {
    await browser.close();
  }
}

module.exports = { renderCertificate, PAGE };
