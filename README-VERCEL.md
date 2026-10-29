# OSHEQ Certificate Backend — Vercel deployment

This project is configured for Vercel serverless functions and uses `@sparticuz/chromium` with `puppeteer-core` for PDF generation. Generated PDFs are uploaded to Cloudinary, which is necessary because Vercel's filesystem is temporary/read-only outside `/tmp`.

## Deploy

1. Upload/push this folder to a GitHub repository. Do **not** upload `.env` or secrets.
2. Import the repository in Vercel. Keep the Root Directory set to this backend folder (the folder containing `vercel.json` and `package.json`).
3. In **Project → Settings → Environment Variables**, add:
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
   - `PUBLIC_BASE_URL` = the public HTTPS deployment URL, e.g. `https://your-project.vercel.app`
   - optionally `QR_MODE=verify`
4. Redeploy after adding variables.
5. Test `https://your-project.vercel.app/api/health`. It should return JSON with `ok: true` and `cloudinary: true`.
6. Generate a certificate using `POST https://your-project.vercel.app/api/certificates` with JSON such as:
   `{"name":"Test User","course":"Safety Training","provider":"Safety Solution Pvt Ltd.","date":"2026-10-29"}`.
7. Scan the QR printed on the PDF. It points to `/api/verify/<certificate-id>` and the endpoint redirects to the PDF stored in Cloudinary.

## Local Windows development

Copy `.env.example` to `.env`, put your Cloudinary credentials in it, and set `CHROME_PATH` to a real local Chrome executable. Start with `npm install` and `npm start`.

## Important

- Vercel does not persist files written into the project directory between function calls. This build therefore uses Cloudinary for persistent PDFs and certificate metadata; the `/api/certificates` list on Vercel is read from Cloudinary.
- Cloudinary Admin API credentials must be valid because listing and verifying use its API.
- The certificate QR verification endpoint redirects directly to the uploaded PDF.
- Rotate any Cloudinary API secret that was previously shared or committed. Only put the replacement secret into Vercel environment variables; never commit `.env`.
