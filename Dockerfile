# ============================================================
# Tringlo AI — production image
# ============================================================
# A single long-running Node process serves the app, the webhook endpoints and
# the in-process scheduler together (Next's instrumentation starts the scheduler
# on boot). The database is data/database.json under the working directory, so
# production MUST mount a persistent volume at /app/data and run ONE instance —
# the process owns the database cache, and a second instance would corrupt it.
# This is why the app belongs on a persistent-disk host (Render/Railway/Fly/a
# VPS), not on ephemeral serverless.
# ============================================================

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
# Next reads PORT from the environment; the host injects it.
ENV PORT=3000
COPY --from=build /app ./
# data/ is a mounted persistent volume in production; nothing is baked in.
EXPOSE 3000
CMD ["npm", "run", "start"]
