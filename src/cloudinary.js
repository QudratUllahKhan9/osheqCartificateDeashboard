/**
 * Cloudinary persistence for certificate PDFs.
 * PDF files and their metadata live in Cloudinary, so verification still works
 * across Vercel serverless cold starts (where local disk is not persistent).
 */
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function isConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

async function uploadPdf(pdfPath, localId, metadata = {}) {
  if (!isConfigured()) {
    throw new Error(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in deployment environment variables.'
    );
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        public_id: `osheq-certificates/${localId}.pdf`,
        type: 'upload',
        overwrite: true,
        context: {
          localId: String(localId),
          certNo: String(metadata.certNo || ''),
          name: String(metadata.name || ''),
          course: String(metadata.course || ''),
          provider: String(metadata.provider || ''),
          dateText: String(metadata.dateText || ''),
          verifyUrl: String(metadata.verifyUrl || ''),
        },
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    fs.createReadStream(pdfPath).pipe(uploadStream);
  });
}

async function getPdf(localId) {
  if (!isConfigured()) return null;
  const id = String(localId || '');
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;

  // New uploads include .pdf in the raw public_id. The second lookup supports
  // certificates uploaded by the older version of this backend.
  for (const publicId of [
    `osheq-certificates/${id}.pdf`,
    `osheq-certificates/${id}`,
  ]) {
    try {
      return await cloudinary.api.resource(publicId, {
        resource_type: 'raw',
        type: 'upload',
      });
    } catch (_) {
      // Try the legacy public ID next.
    }
  }
  return null;
}

async function listPdfs() {
  if (!isConfigured()) return [];
  const response = await cloudinary.api.resources({
    resource_type: 'raw',
    type: 'upload',
    prefix: 'osheq-certificates/',
    max_results: 500,
  });
  return (response.resources || []).map((item) => {
    const ctx = item.context && (item.context.custom || item.context) || {};
    const publicId = item.public_id || '';
    const idFromPath = publicId.replace(/^osheq-certificates\//, '').replace(/\.pdf$/i, '');
    return {
      id: ctx.localId || idFromPath,
      localId: ctx.localId || idFromPath,
      certNo: ctx.certNo || idFromPath,
      name: ctx.name || '',
      course: ctx.course || '',
      provider: ctx.provider || '',
      dateText: ctx.dateText || '',
      cloudinaryUrl: item.url || null,
      secureUrl: item.secure_url || null,
      downloadLink: item.secure_url || item.url || null,
      verifyUrl: ctx.verifyUrl || null,
      createdAt: item.created_at || null,
      cloudinaryPublicId: publicId,
    };
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

module.exports = {
  isConfigured,
  uploadPdf,
  getPdf,
  listPdfs,
};
