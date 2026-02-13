FROM node:25-alpine

WORKDIR /app

# Needed for extracting MaxMind tarballs (busybox tar exists, but keep explicit)
RUN apk add --no-cache ca-certificates tzdata

COPY package.json package-lock.json eslint.config.js ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY tests ./tests

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    SQLITE_PATH=/data/app.sqlite \
    GEOIP_DB_DIR=/data/geoip

EXPOSE 3000

CMD ["node", "src/server.js"]
