/**
 * render.js — HTML -> PDF + PNG (production portable)
 *
 * BROWSER LOOKUP ORDER (no hardcoded machine paths):
 *   1. CHROME_PATH / PUPPETEER_EXECUTABLE_PATH   (only if the file EXISTS)
 *   2. Vercel / AWS Lambda -> @sparticuz/chromium
 *   3. Docker / VPS Linux   -> /usr/bin/chromium, google-chrome, /root/.cache/puppeteer/...
 *   4. Local puppeteer bundle (if the `puppeteer` package is installed)
 *   5. win32 / darwin well-known install locations
 *
 * A wrong CHROME_PATH never crashes the request; it is skipped and the next
 * candidate is tried. The final error lists every path that was attempted.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const PAGE = { width: 794, height: 1123 }; // A4 @96dpi

function exists(p) {
  try {
    return Boolean(p) && fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Chromium/Puppeteer cache locations created by `npx puppeteer browsers install`. */
function puppeteerCachePaths() {
  const roots = [];
  if (process.env.PUPPETEER_CACHE_DIR) roots.push(process.env.PUPPETEER_CACHE_DIR);
  roots.push(path.join(os.homedir(), '.cache', 'puppeteer'));
  roots.push(path.join(os.homedir(), '.cache', 'puppeteer-core'));
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'puppeteer'));

  const out = [];
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      for (const dir of fs.readdirSync(root)) {
        const base = path.join(root, dir);
        // chrome/linux-131.0.0/chrome-linux64/chrome
        for (const inner of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-win64/chrome.exe', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
          const candidate = path.join(base, inner);
          if (exists(candidate)) out.push(candidate);
        }
        // one level deeper (chrome/<version>/chrome-linux64/chrome)
        try {
          for (const sub of fs.readdirSync(base)) {
            for (const inner of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-win64/chrome.exe']) {
              const candidate = path.join(base, sub, inner);
              if (exists(candidate)) out.push(candidate);
            }
          }
        } catch (_) {
          /* ignore */
        }
      }
    } catch (_) {
      /* ignore unreadable cache dir */
    }
  }
  return out;
}

function candidatePaths() {
  const out = [];
  const env = (process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();
  if (env) out.push(env);

  const platform = process.platform;

  if (platform === 'win32') {
    const roots = [
      process.env['PROGRAMFILES'] || 'C:\\Program Files',
      process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
      process.env['LOCALAPPDATA'] || '',
    ].filter(Boolean);
    for (const root of roots) {
      out.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      out.push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      out.push(path.join(root, 'Chromium', 'Application', 'chrome.exe'));
      out.push(path.join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
    }
  } else if (platform === 'darwin') {
    [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ].forEach((p) => out.push(p));
  } else {
    /* Linux: VPS / Docker / Debian / Alpine / Amazon Linux */
    [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/local/bin/chromium',
      '/usr/local/bin/chrome',
      '/opt/google/chrome/chrome',
      '/snap/bin/chromium',
      '/usr/lib/chromium/chromium',
      '/usr/lib/chromium-browser/chromium-browser',
    ].forEach((p) => out.push(p));
  }

  return [...new Set(out.filter(Boolean))];
}

/** puppeteer/puppeteer-core bundled download, if that package is present. */
function bundledPuppeteerPath() {
  for (const mod of ['puppeteer', 'puppeteer-core']) {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const p = require(mod);
      if (typeof p.executablePath === 'function') {
        const found = p.executablePath();
        if (exists(found)) return found;
      }
    } catch (_) {
      /* package not installed */
    }
  }
  return null;
}

async function resolveExecutablePath() {
  // Serverless platforms ship their own binary.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = require('@sparticuz/chromium');
    return { executablePath: await chromium.executablePath(), args: chromium.args };
  }

  const tried = [];
  for (const p of [...candidatePaths(), ...puppeteerCachePaths()]) {
    tried.push(p);
    if (exists(p)) return { executablePath: p, args: null };
  }

  const bundled = bundledPuppeteerPath();
  if (bundled) return { executablePath: bundled, args: null };

  throw new Error(
    'Chromium/Chrome nahi mila.\n' +
      'Linux VPS:  sudo apt-get install -y chromium   (ya: npx puppeteer browsers install chrome)\n' +
      'Docker:     image me chromium pehle se install hai\n' +
      'Windows:    CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe\n' +
      'Phir service restart/redeploy karein. Try kiye gaye paths:\n  - ' +
      tried.join('\n  - ')
  );
}

function launchArgs() {
  const base = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--font-render-hinting=none',
    '--hide-scrollbars',
    '--mute-audio',
  ];
  if (process.env.CHROME_EXTRA_ARGS) {
    base.push(...String(process.env.CHROME_EXTRA_ARGS).split(/\s+/).filter(Boolean));
  }
  return base;
}

async function launchBrowser() {
  const puppeteer = require('puppeteer-core');
  const { executablePath, args } = await resolveExecutablePath();

  return puppeteer.launch({
    executablePath,
    headless: true,
    args: args || launchArgs(),
    timeout: Number(process.env.CHROME_LAUNCH_TIMEOUT || 60000),
    protocolTimeout: 120000,
  });
}

async function preparePage(browser, html) {
  const page = await browser.newPage();
  await page.setViewport({ ...PAGE, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluateHandle('document.fonts.ready');
  await new Promise((r) => setTimeout(r, 120));
  return page;
}

/** Render the certificate to PDF (raw, upload-ready) and PNG (what phones show). */
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

module.exports = { renderCertificate, resolveExecutablePath, candidatePaths, PAGE };
