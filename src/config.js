/**
 * config.js — URL configuration for TWO different domains.
 *
 * IMPORTANT: ye backend do tarah ke links banata hai, aur dono ka domain alag hai.
 *
 *   PUBLIC_BASE_URL   = FRONTEND dashboard ka URL  (React app)
 *                       -> CORS allow-list, /api/status me frontendBaseUrl,
 *                          UI ke share/verify links
 *
 *   BACKEND_BASE_URL  = BACKEND ka public URL      (ye service)
 *                       -> QR ka target  /v/<id>
 *                       -> /api/pdf/<id>, /api/qr/<id>, /previews/<file>
 *
 * KYUN ALAG?  QR ke andar jo URL print hota hai wo BACKEND ka route hai
 * (`/v/<certNo>` server-rendered page hai). Agar usme frontend ka domain daala
 * jaye to React app us path par 404 dega — QR scan karte hi "Not Found".
 *
 * BACKEND_BASE_URL khaali chhoren to request ke host se khud nikal liya jata hai
 * (Vercel: x-forwarded-host), jo sabse reliable hai.
 */
const os = require('os');

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function stripProtocol(value) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function isLocalish(url) {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|::1|192\.168\.|10\.\d+\.|169\.254\./i.test(String(url || ''));
}

function detectLanIps() {
  const out = [];
  const nets = os.networkInterfaces() || {};
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

/** FRONTEND dashboard URL (React). Used for CORS + UI links. */
function resolveFrontendBaseUrl() {
  return normalizeUrl(process.env.PUBLIC_BASE_URL);
}

/** BACKEND public URL — static fallback when the request host is unavailable. */
function resolveBackendBaseUrl(port) {
  const explicit = normalizeUrl(process.env.BACKEND_BASE_URL);
  if (explicit) return explicit;

  const vercel = stripProtocol(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL);
  if (vercel) return `https://${vercel}`;

  return `http://localhost:${port}`;
}

/**
 * Per-request backend base URL.
 * Priority: explicit BACKEND_BASE_URL -> request headers -> env fallback.
 * The request host is the safest source on Vercel preview/custom domains.
 */
function resolveBackendBaseForRequest(req, port) {
  const explicit = normalizeUrl(process.env.BACKEND_BASE_URL);
  if (explicit) return explicit;

  try {
    const proto = String(
      (req.headers['x-forwarded-proto'] || '').split(',')[0] || (req.secure ? 'https' : 'http')
    ).trim() || 'http';
    const host = String(
      (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0] || ''
    ).trim();
    if (host) return `${proto}://${host}`;
  } catch (_) {
    /* fall through */
  }

  return resolveBackendBaseUrl(port);
}

/** CORS: frontend origin(s) + local dev. No PUBLIC_BASE_URL -> allow all. */
function resolveCorsOrigins() {
  const frontend = resolveFrontendBaseUrl();
  const origins = [];
  if (frontend) origins.push(frontend);

  // Local development always allowed.
  origins.push(
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://localhost:5173'
  );

  return [...new Set(origins)];
}


/**
 * Per-request warnings. The boot-time value cannot know the real host (on
 * Vercel BACKEND_BASE_URL is empty by design), so it produced a false
 * "localhost" warning on every production request. Always compute from req.
 */
function warningsForRequest(req, port) {
  const out = [];
  const backend = resolveBackendBaseForRequest(req, port);
  const frontend = resolveFrontendBaseUrl();

  if (!frontend) {
    out.push(
      'PUBLIC_BASE_URL (frontend) set nahi hai — CORS sabhi origins ko allow kar raha hai. ' +
        'Dashboard ka URL daalein.'
    );
  }
  if (!/^https:\/\//i.test(backend)) {
    out.push(
      'Backend ka URL HTTPS nahi hai — QR sirf usi device par khulega. ' +
        'BACKEND_BASE_URL=https://<backend-domain> set karein.'
    );
  }
  if (isLocalish(backend)) {
    out.push(
      'QR ke andar localhost/LAN address hai — doosre phone par nahi khulega. ' +
        'Backend ko public HTTPS domain par deploy karein.'
    );
  }
  return out;
}

function buildConfig(port) {
  const frontendBaseUrl = resolveFrontendBaseUrl();
  const backendBaseUrl = resolveBackendBaseUrl(port);
  const warnings = [];

  if (!frontendBaseUrl) {
    warnings.push(
      'PUBLIC_BASE_URL (frontend) set nahi hai — CORS sabhi origins ko allow kar raha hai. ' +
        'Deploy ke baad frontend ka URL daalein.'
    );
  }

  if (!/^https:\/\//i.test(backendBaseUrl) && !process.env.VERCEL) {
    warnings.push(
      'BACKEND_BASE_URL HTTPS nahi hai — QR sirf usi device par khulega jahan backend chal raha hai. ' +
        'Kisi doosre phone par scan karne ke liye HTTPS domain set karein.'
    );
  }
  if (isLocalish(backendBaseUrl)) {
    warnings.push(
      'QR ke andar localhost/LAN address hai. Doosre phone ka browser ise nahi kholega. ' +
        'BACKEND_BASE_URL=https://<backend-domain> rakhein.'
    );
  }

  return {
    port,
    frontendBaseUrl,
    backendBaseUrl,
    frontendBaseFor: () => frontendBaseUrl,
    backendBaseFor: (req) => resolveBackendBaseForRequest(req, port),
    verifyUrlFor: (req, localId) =>
      `${resolveBackendBaseForRequest(req, port)}/v/${encodeURIComponent(localId)}`,
    pdfUrlFor: (req, localId) =>
      `${resolveBackendBaseForRequest(req, port)}/api/pdf/${encodeURIComponent(localId)}`,
    qrPngUrlFor: (req, localId) =>
      `${resolveBackendBaseForRequest(req, port)}/api/qr/${encodeURIComponent(localId)}`,
    warnings,
    lanIps: detectLanIps(),
    isVercel: Boolean(process.env.VERCEL),
  };
}

module.exports = {
  buildConfig,
  warningsForRequest,
  resolveFrontendBaseUrl,
  resolveBackendBaseUrl,
  resolveBackendBaseForRequest,
  resolveCorsOrigins,
  detectLanIps,
};
