# ==========================================================
#  OSHEQ Certificate Backend — production image
#  Chromium + all shared libs pre-installed so PDF render works out of the box.
#  Build:  docker build -t osheq-certificates .
#  Run:    docker run -d --name osheq-cert -p 4000:4000 --env-file .env \
#            -v /var/lib/osheq:/var/lib/osheq osheq-certificates
# ==========================================================
FROM node:20-bookworm-slim

# Chromium + fonts (certificate ke Montserrat/EB Garamond embedded hote hain,
# lekin system fonts fallback ke liye zaroori hain)
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-dejavu-core \
      fonts-noto-core \
      dumb-init \
      curl \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer ko batayein ke bundled download ki zaroorat nahi
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=4000 \
    WORK_DIR=/var/lib/osheq/work

WORKDIR /app

# Dependencies pehle (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App code
COPY . .

# Non-root user (Chromium ko --no-sandbox ke sath chalana padta hai container me)
RUN mkdir -p /var/lib/osheq/work \
    && chown -R node:node /app /var/lib/osheq
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/health || exit 1

# dumb-init => PID 1 signal handling (docker stop par clean shutdown)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
