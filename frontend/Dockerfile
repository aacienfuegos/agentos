FROM node:26-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --frozen-lockfile

COPY . .
RUN npm run build

FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk upgrade --no-cache \
    && npm install -g npm@latest \
    && mkdir /tmp/undici-fix && cd /tmp/undici-fix \
    && npm install undici@6.27.0 \
    && cp -rf node_modules/undici "$(npm root -g)/npm/node_modules/" \
    && cd / && rm -rf /tmp/undici-fix

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
