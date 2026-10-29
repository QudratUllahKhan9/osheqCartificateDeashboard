/**
 * cloudinary.js — Cloudinary persistence layer (PDF + preview image + metadata)
 * ---------------------------------------------------------------------------
 * WHY THIS FILE MATTERS
 * The QR code is printed INSIDE the certificate, but the certificate is only
 * uploaded to Cloudinary AFTER the PDF is rendered. So the QR can never contain
 * the Cloudinary URL itself (it does not exist yet at render time).
 *
 * Solution: every certificate gets a deterministic public_id built from the
 * localId that is generated BEFORE the PDF is rendered:
 *
 *    PDF      ->  osheq-certificates/pdf/<localId>.pdf      (resource_type: raw)
 *    Preview  ->  osheq-certificates/preview/<localId>.png  (resource_type: image)
 *
 * Because the id is deterministic, /v/<localId> already knows where the file
 * WILL be, and the mock/actual upload both land on the same path. Overwrites
 * are harmless (overwrite: true), which makes generation idempotent.
 *
 * The preview PNG is what gets shown when someone scans the QR on a phone:
 * raw PDFs are served as octet-stream and trigger a download instead of
 * rendering, so a real PNG is the only reliable "show the certificate" path.
 */
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const PDF_ROOT = 'osheq-certificates/pdf';
const IMG_ROOT = 'osheq-certificates/preview';

function isConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

function pdfPublicId(localId) {
  return `${PDF_ROOT}/${localId}.pdf`;
}

function imgPublicId(localId) {
  return `${IMG_ROOT}/${localId}`;
}

/** public_id must be a safe token — never let a crafted id escape the folder. */
function isValidId(localId) {
  return /^[A-Za-z0-9_-]{4,120}$/.test(String(localId || ''));
}

function contextFor(metadata = {}) {
  return {
    localId: String(metadata.localId || ''),
    certNo: String(metadata.certNo || ''),
    name: String(metadata.name || ''),
    course: String(metadata.course || ''),
    provider: String(metadata.provider || ''),
    dateText: String(metadata.dateText || ''),
    verifyUrl: String(metadata.verifyUrl || ''),
    issuedAt: String(metadata.issuedAt || ''),
  };
}

function streamUpload(filePath, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      return resolve(result);
    });
    fs.createReadStream(filePath).pipe(stream);
  });
}

/** Upload the certificate PDF (raw resource => always downloadable, never re-encoded). */
async function uploadPdf(pdfPath, localId, metadata = {}) {
  if (!isConfigured()) {
    throw new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET.');
  }
  if (!isValidId(localId)) throw new Error('Invalid certificate id for Cloudinary upload.');

  return streamUpload(pdfPath, {
    resource_type: 'raw',
    type: 'upload',
    public_id: pdfPublicId(localId),
    overwrite: true,
    invalidate: true,
    context: contextFor({ ...metadata, localId }),
  });
}

/** Upload the preview PNG that the QR verification page displays on phones. */
async function uploadPreview(pngPath, localId, metadata = {}) {
  if (!isConfigured()) {
    throw new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET.');
  }
  if (!isValidId(localId)) throw new Error('Invalid certificate id for Cloudinary upload.');

  return streamUpload(pngPath, {
    resource_type: 'image',
    type: 'upload',
    public_id: imgPublicId(localId),
    format: 'png',
    overwrite: true,
    invalidate: true,
    context: contextFor({ ...metadata, localId }),
  });
}

/** Look up a single certificate asset (used by /v/:id when the instance is cold). */
async function getPdf(localId) {
  if (!isConfigured() || !isValidId(localId)) return null;

  const candidates = [pdfPublicId(localId), `${PDF_ROOT}/${localId}`];
  for (const publicId of candidates) {
    try {
      return await cloudinary.api.resource(publicId, { resource_type: 'raw', type: 'upload' });
    } catch (_) {
      /* try next candidate */
    }
  }
  return null;
}

async function getPreview(localId) {
  if (!isConfigured() || !isValidId(localId)) return null;
  try {
    return await cloudinary.api.resource(imgPublicId(localId), {
      resource_type: 'image',
      type: 'upload',
    });
  } catch (_) {
    return null;
  }
}

/** Generated PNG -> responsive web URL (Cloudinary transforms, no extra storage). */
function previewDisplayUrl(publicId) {
  if (!publicId) return null;
  return cloudinary.url(publicId, {
    resource_type: 'image',
    secure: true,
    transformation: [{ width: 900, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
  });
}

/**
 * CRITICAL: Cloudinary blocks public delivery of raw PDFs by default
 * (verified: plain secure_url -> HTTP 401). A SIGNED download URL works and
 * returns application/pdf, so every PDF link must be signed, not plain.
 * Signed URLs expire, so we mint a fresh one at click time via /api/pdf/:id.
 */
function signedPdfUrl(localId, { attachment = true, expiresInSeconds = 3600 } = {}) {
  if (!isConfigured() || !isValidId(localId)) return null;
  try {
    return cloudinary.utils.private_download_url(pdfPublicId(localId), 'pdf', {
      resource_type: 'raw',
      type: 'upload',
      attachment,
      expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    });
  } catch (_) {
    return null;
  }
}

/** Keep the historical name but always return something that actually opens. */
function pdfDownloadUrl(secureUrl, localId) {
  if (localId) {
    const signed = signedPdfUrl(localId);
    if (signed) return signed;
  }
  return secureUrl || null;
}

/** List every certificate straight from Cloudinary (source of truth on Vercel). */
async function listCertificates() {
  if (!isConfigured()) return [];

  const out = [];
  let nextCursor = null;

  do {
    /* eslint-disable no-await-in-loop */
    const page = await cloudinary.api.resources({
      resource_type: 'raw',
      type: 'upload',
      prefix: `${PDF_ROOT}/`,
      max_results: 500,
      next_cursor: nextCursor || undefined,
      context: true,
    });

    for (const item of page.resources || []) {
      const ctx = (item.context && (item.context.custom || item.context)) || {};
      const publicId = item.public_id || '';
      const idFromPath = publicId
        .replace(new RegExp(`^${PDF_ROOT}/`), '')
        .replace(/\.pdf$/i, '');

      const localId = ctx.localId || idFromPath;
      out.push({
        id: localId,
        localId,
        certNo: ctx.certNo || idFromPath,
        name: ctx.name || '',
        course: ctx.course || '',
        provider: ctx.provider || '',
        dateText: ctx.dateText || '',
        verifyUrl: ctx.verifyUrl || null,
        pdfUrl: item.secure_url || item.url || null,
        downloadLink: pdfDownloadUrl(item.secure_url || item.url || null, localId),
        previewUrl: previewDisplayUrl(imgPublicId(localId)),
        cloudinaryPublicId: publicId,
        createdAt: item.created_at || null,
      });
    }

    nextCursor = page.next_cursor || null;
  } while (nextCursor);

  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Remove a certificate's assets (used by tests, and by an admin "regenerate" flow). */
async function destroyTestAssets(localId) {
  if (!isConfigured() || !isValidId(localId)) return false;
  const results = await Promise.allSettled([
    cloudinary.uploader.destroy(pdfPublicId(localId), { resource_type: 'raw', invalidate: true }),
    cloudinary.uploader.destroy(imgPublicId(localId), { resource_type: 'image', invalidate: true }),
  ]);
  return results.every((r) => r.status === 'fulfilled');
}

module.exports = {
  isConfigured,
  destroyTestAssets,
  isValidId,
  uploadPdf,
  uploadPreview,
  getPdf,
  getPreview,
  previewDisplayUrl,
  pdfDownloadUrl,
  signedPdfUrl,
  imgPublicId,
  pdfPublicId,
  listCertificates,
};
