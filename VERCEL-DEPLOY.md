# Vercel par deploy — OSHEQ Certificate Backend

Ye backend Vercel ke serverless model ke liye adjust kiya gaya hai. **Sirf
`backend` folder** Vercel par upload karein (React dashboard alag project hai).

---

## Vercel par kya kya chalega / nahi chalega

| Cheez | Vercel par | Hal (code me already) |
|---|---|---|
| `app.listen()` | ❌ allowed nahi | `if (!process.env.VERCEL)` guard — Vercel par skip hota hai |
| Writable disk | ❌ sirf `/tmp`, aur wo bhi request ke baad gayab | PDF/PNG `/tmp` me, phir **Cloudinary** par permanent |
| `data/db.json` | ❌ persist nahi hota | Cloudinary metadata = source of truth, JSON sirf cache |
| Chrome binary | ❌ image me nahi hota | `@sparticuz/chromium` (Vercel branch in `render.js`) |
| `.env` file | ❌ kaam nahi karegi | **Dashboard → Environment Variables** |
| `assets/` fonts + bg | ⚠️ bundle karna padta hai | `vercel.json` → `includeFiles: ["assets/**"]` |
| Request timeout | Hobby: 60s / default 300s | `maxDuration: 60` set |

> Aap ka current live deployment (`osheq-cartificates-final.vercel.app`) pehle se
> chal raha hai — `/api/status` 200 deta hai. Bas **Cloudinary env vars** missing
> the (`cloudinaryConfigured: false`) aur **assets bundling** add karni hai.

---

## Tarika 1 — GitHub se (recommended)

### 1. Sirf backend folder push karein

```bash
cd backend
git init
git add .
git commit -m "OSHEQ certificate backend"
git branch -M main
git remote add origin https://github.com/<your-username>/osheq-certificates.git
git push -u origin main
```

`backend/.gitignore` me `.env`, `node_modules`, `work/` already excluded hain —
phir bhi push se pehle confirm karein:

```bash
git status --short | grep -E "\.env|node_modules" || echo "clean — koi secret nahi ja raha"
```

### 2. Vercel par import

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository**
2. Repo select karein
3. **Root Directory**: agar repo me sirf backend hai to `.` rakhein; agar
   monorepo hai to **`backend`** select karein
4. **Framework Preset**: `Other`
5. **Build Command**: khali chhod dein (koi build nahi)
6. **Output Directory**: khali chhod dein
7. **Install Command**: `npm ci` (default theek hai)

### 3. Environment Variables (zaroori — ye 4)

Project → **Settings → Environment Variables** → har ek add karein
(Production **aur** Preview dono tick karein):

| Key | Value | Kya karta hai |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | aap ka cloud name | storage |
| `CLOUDINARY_API_KEY` | API key | storage |
| `CLOUDINARY_API_SECRET` | API secret | storage |
| `PUBLIC_BASE_URL` | `https://aapka-frontend.vercel.app` | **FRONTEND** — CORS + UI links |
| `BACKEND_BASE_URL` | khali chhod dein | **BACKEND** — QR target (host se auto) |

#### Do domain ka farq (ye ghalatfehmi sabse aam hai)

| Variable | Domain | Kahan use hota hai |
|---|---|---|
| `PUBLIC_BASE_URL` | **FRONTEND** dashboard | CORS allow-list, UI ke verify/share links |
| `BACKEND_BASE_URL` | **BACKEND** (ye service) | QR ka target `/v/<certNo>`, `/api/pdf/<id>`, `/api/qr/<id>` |

QR ke andar jo link print hota hai wo `/v/<certNo>` hai — ye **backend ka route**
(server-rendered certificate page). Agar QR me frontend ka domain chala jaye to
React app us path par **404** dega aur certificate kabhi nahi khulega. Isi liye
dono alag hain.

`BACKEND_BASE_URL` **khali chhod dein** — backend request ke `x-forwarded-host` se
apna URL khud bana leta hai. Ye Vercel preview domains par bhi sahi rehta hai.

> `VERCEL` env var Vercel khud deta hai — use add **na** karein.
> `CHROME_PATH` **na** daalein — Vercel par `@sparticuz/chromium` use hota hai.

### 4. Redeploy (lazmi)

Environment variables purane build par **nahi** lagte:

**Deployments** → sabse upar wala deployment → **⋯** → **Redeploy** → (Optional:
"Use existing Build Cache" untick karein).

### 5. Verify — 3 commands

```bash
BASE=https://osheq-cartificates-final.vercel.app

curl -s $BASE/api/health        # {"ok":true}
curl -s $BASE/api/status        # cloudinaryConfigured:true, warnings:[]
curl -s $BASE/api/certificates  # [] ya list
```

`/api/status` me ye 3 fields dekhein:

- `frontendBaseUrl` → aap ka **frontend** URL (PUBLIC_BASE_URL)
- `backendBaseUrl` → `https://osheq-cartificates-final.vercel.app`
- `qrTargetExample` → `https://osheq-cartificates-final.vercel.app/v/CERT-NUMBER`

`qrTargetExample` me **backend** ka domain hona chahiye, frontend ka nahi.

Agar `cloudinaryConfigured` abhi bhi `false` hai to env vars save nahi hue ya
redeploy nahi hua.

### 6. Asli test — certificate generate karein

```bash
curl -s -X POST $BASE/api/certificates \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test User","course":"Safety Training","provider":"Safety Solution Pvt Ltd.","date":"2026-10-29","certNo":"90012345"}'
```

Response me ye 3 cheezein honi chahiye:

```json
{
  "certNo": "90012345",
  "savedToCloudinary": true,
  "verifyUrl": "https://osheq-cartificates-final.vercel.app/v/90012345"
}
```

`verifyUrl` mobile browser me kholein → certificate preview + Download PDF.
Phir **asli QR** phone se scan karein — wahi page khulega.

---

## Tarika 2 — Vercel CLI se

```bash
npm i -g vercel
cd backend
vercel login
vercel                 # preview deployment (pehli baar project setup poochhega)
vercel --prod          # production
```

Root Directory `.` rakhein (aap `backend` folder ke andar hain).

Env vars CLI se:

```bash
vercel env add CLOUDINARY_CLOUD_NAME production
vercel env add CLOUDINARY_API_KEY production
vercel env add CLOUDINARY_API_SECRET production
vercel env add PUBLIC_BASE_URL production     # value: https://osheq-cartificates-final.vercel.app
vercel --prod                                  # env add ke baad redeploy
```

---

## Vercel limits jo aap ko pata hone chahiye

| Limit | Value | Asar |
|---|---|---|
| Function duration | Hobby **60s** (naya default 300s tak) | Ek certificate ≈ 5–15s (Chromium cold start). Pehla request slow, phir warm |
| Memory | Hobby **2 GB**, plan par 1 GB bhi chal jata hai | `memory: 1024` set hai — Chromium ke liye kaafi |
| Uncompressed bundle | **250 MB** (Hobby) | hamara bundle ~30 MB — theek |
| `/tmp` | Request ke baad **mit jata hai** | is liye PDF Cloudinary par |
| Cold start | ~1–3s (Chromium launch extra) | pehla certificate thoda slow |
| Concurrent | plan ke hisaab se | har render ek Chromium instance — heavy load par limit |

**Sabse ahem:** Vercel par **koi persistent database nahi**. Isi liye certificate
list Cloudinary ke `context` metadata se banti hai (`listCertificates()`), JSON
file sirf usi instance ka cache hai. Cold start par `/v/:id` Cloudinary se record
dobara bana leta hai — is liye QR 3 din baad bhi kaam karega.

---

## Common Vercel errors aur unka hal

| Error | Wajah | Hal |
|---|---|---|
| `519` / `FUNCTION_INVOCATION_FAILED` | Chromium boot fail ya memory kam | Memory 1024 confirm karein; `@sparticuz/chromium` version check |
| `504 FUNCTION_INVOCATION_TIMEOUT` | 60s se zyada | `maxDuration` 60 hai; Chromium cold start + render ≈ 15s, normally safe |
| `503` "Cloudinary env vars missing" | keys nahi hain | Step 3 + Redeploy |
| PDF blank / fonts missing | `assets/` bundle nahi hua | `vercel.json` me `includeFiles: ["assets/**"]` hona chahiye |
| QR scan par "Certificate not found" | upload fail (`savedToCloudinary: false`) | `/api/status` dekhein, Cloudinary keys check karein |
| QR phone par nahi khulta | `BACKEND_BASE_URL` / `PUBLIC_BASE_URL` me localhost | backend ka https domain daalein |
| QR khulta hai lekin 404 | QR me **frontend** ka domain aa gaya | `BACKEND_BASE_URL` khali karein, redeploy |
| CORS error dashboard me | `PUBLIC_BASE_URL` frontend URL se match nahi | frontend ka exact origin daalein |
| PDF download 401 | Cloudinary raw PDF public block | normal — backend `/api/pdf/<id>` se **signed** URL deta hai |

Logs: Vercel → **Deployments** → deployment → **Functions** tab → `api/index.js`
→ real-time logs.

---

## Deploy ke baad checklist

- [ ] `/api/health` → `{"ok":true}`
- [ ] `/api/status` → `cloudinaryConfigured: true`, `warnings: []`
- [ ] `qrTargetExample` me **backend** ka domain hai (frontend ka nahi)
- [ ] `frontendBaseUrl` me aap ka dashboard URL hai
- [ ] Ek certificate generate → `savedToCloudinary: true`
- [ ] `verifyUrl` mobile browser me khulta hai (certificate preview dikhta hai)
- [ ] Asli QR phone se scan → wahi page
- [ ] `PUBLIC_BASE_URL` me trailing slash nahi hai
- [ ] `.env` GitHub par push nahi hui
- [ ] Cloudinary secret rotate ho chuka (purana share ho gaya tha)

---

## React dashboard se connect karna

Dashboard alag deploy hota hai, is liye uske `.env.production` me backend URL:

```ini
REACT_APP_API_URL=https://osheq-cartificates-final.vercel.app
```

`src/api.js` isi se API base leta hai, aur QR bhi **API ke domain** par banata hai
(dashboard ke domain par nahi) — warna `/v/` route wahan 404 deta.
