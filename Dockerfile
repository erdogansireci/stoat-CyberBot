FROM node:22-slim

# yt-dlp (python3 ile çalışır). YouTube çözümü için JS çalışma ortamı olarak node kullanılır.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl python3 \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && echo "--js-runtimes node" > /etc/yt-dlp.conf \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# npm yerine node: docker stop'un SIGTERM'i doğrudan bota gelsin, bot ses kanalından çıkıp kapansın.
CMD ["node", "src/index.js"]
