/**
 * config.js — single place for URLs + environment checks.
 *
 * THE #1 REASON QR CODES "DON'T WORK":
 * the base URL is localhost / 192.168.x.x. A phone scanning the QR is a
 * DIFFERENT device — it has no idea what "localhost" means. The QR must point
 * at a public HTTPS host. We detect that here and expose a warning to the UI.
 */
const os = require('os');

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

function resolvePublicBaseUrl(port) {
  const explicit = (process.env.PUBLIC_BASE_URL || '').trim();
  const vercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '').trim();

  const raw =
    explicit ||
    (vercel ? `https://${vercel.replace(/^https?:\/\//, '')}` : `http://localhost:${port}`);

  return raw.replace(/\/+$/, '');
}

function buildConfig(port) {
  const publicBaseUrl = resolvePublicBaseUrl(port);
  const warnings = [];

  if (!/^https:\/\//i.test(publicBaseUrl)) {
    warnings.push(
      'PUBLIC_BASE_URL HTTPS nahi hai. QR sirf usi device par khulega jahan backend chal raha hai — ' +
        'kisi doosre phone par scan karne ke liye HTTPS domain (Vercel / ngrok) set karein.'
    );
  }
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(publicBaseUrl)) {
    warnings.push(
      'QR me "localhost" hai. Doosre phone ka browser ise nahi kholega. Deploy karke ' +
        'PUBLIC_BASE_URL=https://<your-domain> rakhein.'
    );
  }

  return {
    port,
    publicBaseUrl,
    warnings,
    lanIps: detectLanIps(),
    isVercel: Boolean(process.env.VERCEL),
    qrTarget: (localId) => `${publicBaseUrl}/v/${encodeURIComponent(localId)}`,
  };
}

module.exports = { buildConfig, resolvePublicBaseUrl, detectLanIps };
