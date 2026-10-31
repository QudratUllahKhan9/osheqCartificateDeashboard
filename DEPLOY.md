# OSHEQ Certificate Backend — Server par deploy karne ka tareeqa

Ye backend **Node 20+** par chalta hai, kisi bhi Linux VPS (Ubuntu/Debian), Docker,
ya managed platform par. Chromium PDF banata hai, Cloudinary file rakhta hai,
aur QR scan karne par `/v/<certNo>` page certificate dikhata hai.

---

## 0. Pehle: 3 cheezein jo zaroori hain

| Cheez | Kyun zaroori | Kahan se |
|---|---|---|
| Cloudinary keys (3) | PDF + preview permanent storage | dashboard.cloudinary.com → Settings → API Keys |
| `PUBLIC_BASE_URL` | **QR me yahi URL print hota hai** | aapka domain, `https://...` |
| Chromium | PDF render ke liye | `apt install chromium` (Docker me pehle se) |

> ⚠️ `PUBLIC_BASE_URL` me `localhost` ya koi IP na rakhein. Phone ka localhost usi ka
> apna device hota hai — QR kabhi nahi khulega. Sirf public `https://` domain.

---

## 1. Ubuntu 22.04 / 24.04 VPS — step by step

### 1.1 Node.js 20 install

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v      # v20.x ya v22.x aana chahiye
```

### 1.2 Chromium + uske shared libraries

Ye sabse ahem step hai. Sirf `chromium` package kaafi nahi — headless render ke
liye ye libraries chahiye:

```bash
sudo apt-get update
sudo apt-get install -y chromium \
  fonts-liberation fonts-dejavu-core fonts-noto-core \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
  ca-certificates curl unzip

chromium --version    # version print ho -> theek hai
```

> Ubuntu 24.04 par package naam `libatk1.0-0t64`, `libcups2t64` ho sakte hain —
> `apt` khud sahi naam suggest kar dega.

### 1.3 Code upload + install

```bash
sudo mkdir -p /var/www/osheq-certificates
sudo chown -R $USER:$USER /var/www/osheq-certificates

# apna zip upload karein (scp) ya git clone karein
cd /var/www/osheq-certificates
unzip osheq-server-ready.zip

cd backend
npm ci --omit=dev
```

### 1.4 `.env` banayein

```bash
cp .env.example .env
nano .env
```

Minimum ye bharein:

```ini
PORT=4000
NODE_ENV=production
PUBLIC_BASE_URL=https://certificates.your-domain.com

CLOUDINARY_CLOUD_NAME=xxxx
CLOUDINARY_API_KEY=xxxx
CLOUDINARY_API_SECRET=xxxx

WORK_DIR=/var/lib/osheq/work
# Linux par CHROME_PATH khali chhod dein (auto-detect ho jata hai)
CHROME_PATH=
```

Permissions tight karein (secret file hai):

```bash
chmod 600 .env
sudo mkdir -p /var/lib/osheq/work
sudo chown -R $USER:$USER /var/lib/osheq
```

### 1.5 Doctor chalayein (deploy se pehle)

```bash
npm run doctor
```

Ye batata hai: env vars theek hain? Chromium mila? folders writable? Cloudinary
reachable? QR URL kya print hoga. Sab `PASS` ho tab aage barhein.

### 1.6 Manual test

```bash
npm start
```

Doosri terminal:

```bash
curl -s http://127.0.0.1:4000/api/health        # {"ok":true}
curl -s http://127.0.0.1:4000/api/status        # cloudinaryConfigured: true hona chahiye

curl -s -X POST http://127.0.0.1:4000/api/certificates \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test User","course":"Safety Training","provider":"Safety Solution Pvt Ltd.","date":"2026-10-29","certNo":"90012345"}'
```

Response me `savedToCloudinary: true` aur `verifyUrl` aana chahiye.
Phir browser me `verifyUrl` kholein — certificate preview nazar aayega.

### 1.7 PM2 par daalein (24/7 chale)

```bash
sudo npm install -g pm2
mkdir -p logs
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup        # jo command print ho, wo copy-paste karein
pm2 logs osheq-certificates --lines 50
```

Crash ho to PM2 khud restart karega; server reboot par bhi uth jayega.

### 1.8 Nginx reverse proxy

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/osheq-certificates
sudo nano /etc/nginx/sites-available/osheq-certificates   # server_name apna domain
sudo ln -s /etc/nginx/sites-available/osheq-certificates /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 1.9 Free SSL (Let's Encrypt)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d certificates.your-domain.com
sudo systemctl status certbot.timer     # auto-renew
```

Certbot khud `nginx.conf` me SSL lines daal dega aur HTTP→HTTPS redirect laga dega.

### 1.10 DNS

Domain ke A record me VPS ka IP daalein. Check:

```bash
curl -s https://certificates.your-domain.com/api/status
```

`publicBaseUrl` me aapka https domain aana chahiye, aur `warnings: []` (khali).

**Ab QR kisi bhi phone se scan karein — Cloudinary se certificate show hoga.**

---

## 2. Docker (recommended — sab dependencies pehle se)

```bash
cd backend
cp .env.example .env && nano .env       # PUBLIC_BASE_URL + Cloudinary keys

docker build -t osheq-certificates .
docker run -d --name osheq-cert \
  --restart unless-stopped \
  -p 127.0.0.1:4000:4000 \
  --env-file .env \
  -v /var/lib/osheq:/var/lib/osheq \
  osheq-certificates

curl -s http://127.0.0.1:4000/api/health
docker logs -f osheq-cert
```

Image me Chromium + fonts + dumb-init already hain, is liye `apt` ka jhanjhat nahi.
Healthcheck bhi built-in hai.

---

## 3. Render / Railway / Fly.io (managed)

- **Build command:** `npm ci --omit=dev`
- **Start command:** `npm start`
- **Env vars:** wahi 5 (`PORT`, `PUBLIC_BASE_URL`, Cloudinary ×3)
- **Chromium:** agar platform par pehle se nahi hai, `postinstall` me:
  `npx puppeteer browsers install chrome`
  aur `CHROME_PATH` set karein us path par (ya khali chhorein — resolver khud dhoondh lega).
- Health check path: `/api/health`

---

## 4. Windows Server (agar VPS Windows ho)

```ini
CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe
```

Auto-detect bhi chalta hai (Chrome → Edge). Phir:

```powershell
npm ci --omit=dev
npm start
```

24/7 ke liye `pm2-windows-service` ya NSSM use karein.

---

## 5. Vercel (jo aap ka current deployment hai)

- Root Directory = `backend`
- Env vars: Cloudinary ×3 + `PUBLIC_BASE_URL=https://osheq-cartificates-final.vercel.app`
- Chromium `@sparticuz/chromium` se automatically aata hai
- Redeploy zaroori hai — env vars purane build par nahi lagte

---

## 6. Firewall / ports

Sirf 2 ports public rakhein:

```bash
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP (certbot)
sudo ufw allow 443/tcp     # HTTPS
sudo ufw enable
```

Port **4000 public na kholein** — Nginx usi ko proxy karta hai.

---

## 7. Troubleshooting

| Problem | Wajah | Hal |
|---|---|---|
| `Chromium/Chrome nahi mila` | binary install nahi | `sudo apt install chromium` ya Docker use karein |
| `libatk-1.0.so.0: cannot open` | shared libs missing | step 1.2 ki libraries install karein |
| QR scan par "Certificate not found" | Cloudinary keys missing / `savedToCloudinary: false` | `/api/status` dekhein, keys add karke restart |
| QR phone par nahi khulta | `PUBLIC_BASE_URL` me localhost/IP | public https domain daalein |
| PDF download 401 | Cloudinary raw PDF public block | known — backend signed URL use karta hai, `/api/pdf/<id>` |
| `npm run doctor` fail | upar ki rows | output me exact missing item likha hota hai |

Logs dekhein:

```bash
pm2 logs osheq-certificates --lines 100     # PM2
docker logs -f osheq-cert                   # Docker
sudo tail -f /var/log/nginx/osheq-cert.error.log
```

---

## 8. Endpoints (server par ye khulenge)

| Method | Route | Kaam |
|---|---|---|
| GET | `/api/health` | liveness (nginx/Docker healthcheck) |
| GET | `/api/status` | Cloudinary + QR base URL + warnings |
| POST | `/api/certificates` | PDF + PNG render → Cloudinary → QR |
| GET | `/api/certificates` | list (Cloudinary se) |
| GET | `/v/:id` | **QR scan target** |
| GET | `/api/pdf/:id` | signed PDF download |
| GET | `/api/qr/:id` | QR PNG (print ke liye) |
| GET | `/api/verify/:id` | purane QR → `/v/:id` redirect |

---

## 9. Security checklist

- `.env` git me **na** jaye (`.gitignore` me already hai, `chmod 600`)
- Cloudinary secret rotate karein agar kabhi share hua ho
- HTTPS lazmi (QR `https://` par jata hai)
- `CORS` abhi open (`*`) hai — apne dashboard domain par lock karna behter:
  `app.use(cors({ origin: ['https://dashboard.your-domain.com'] }))`
- Server par `ufw` + fail2ban (bonus)
