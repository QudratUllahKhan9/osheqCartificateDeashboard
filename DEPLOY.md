# OSHEQ Certificate Backend — deployment guide

Certificate PDF aur preview PNG **pure JavaScript** se bante hain.
Koi headless browser nahi, koi native library nahi, koi `apt install` nahi.
Is liye Vercel / Lambda / Docker / VPS — sab par same tarah chalta hai.

| Cheez | Kaam |
|---|---|
| `pdf-lib` + `@pdf-lib/fontkit` | PDF banata hai (fonts embed) |
| `pureimage` | preview PNG banata hai |
| `qrcode` | verify QR |
| Cloudinary | PDF + PNG ka permanent storage |

## Environment variables

```
PORT=4000                                     # local only
PUBLIC_BASE_URL=https://<frontend-domain>     # frontend ka domain (CORS + links)
BACKEND_BASE_URL=https://<backend-domain>     # QR/verify ka domain (khaali chhod sakte hain)
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
WORK_DIR=/tmp/osheq-work                      # optional
```

`BACKEND_BASE_URL` khaali ho to backend `x-forwarded-host` se khud nikal leta hai.
`PUBLIC_BASE_URL` me frontend ka domain rakhein — QR me **kabhi** frontend domain nahi jaata,
kyunki `/v/<id>` route backend par hai.

## Vercel

1. Repo ka `backend/` folder hi project root rakhein.
2. `package-lock.json` **delete** karke push karein (purane lock me browser packages ho sakte hain).
3. Env vars (Production + Preview) set karein.
4. Redeploy — **"Use existing Build Cache" uncheck**.
5. Verify:
   ```bash
   curl -s https://<backend-domain>/api/status
   ```
   Expected:
   ```json
   "browser": { "mode": "pure-js", "browserRequired": false }
   ```

## Docker / VPS

```bash
docker build -t osheq-cert .
docker run -p 4000:4000 --env-file .env osheq-cert
```

ya PM2:

```bash
npm ci --omit=dev
pm2 start ecosystem.config.js
```

## API

| Method | Path | Kaam |
|---|---|---|
| POST | `/api/certificates` | certificate banata hai (`name`, `course`, `provider`, `date`, `certNo`) |
| GET | `/api/certificates` | list |
| GET | `/v/:id` | verify page (QR yahan khulta hai) |
| GET | `/api/pdf/:id` | signed PDF download |
| GET | `/api/qr/:id` | QR PNG |
| GET | `/api/status` | config + renderer diagnostics |
| GET | `/api/health` | uptime probe |

## Troubleshooting

- **`/api/status` me `mode: "pure-js"` na dikhe** → redeploy nahi hua. "Use existing Build Cache" uncheck karke dobara deploy karein.
- **`Cloudinary env vars missing`** → teeno Cloudinary keys Vercel env me add karein.
- **QR khulta hai lekin PDF 401** → normal hai: Cloudinary raw PDF plain URL block karta hai, `/api/pdf/:id` signed URL deta hai.
