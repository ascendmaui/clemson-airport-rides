# Image is built in GitHub Actions and pulled on the VPS.
# Do not run `vite build` or `npm ci` on the Hostinger box: it has about
# 1.5 GB free and no swap, and a build can OOM-kill the other stacks.
# Public VITE_* values are build args because Vite inlines them into dist/.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_APP_URL
ARG GIT_SHA=unknown
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY \
    VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY \
    VITE_APP_URL=$VITE_APP_URL
RUN npm run build

FROM node:22-alpine AS proddeps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
RUN addgroup -S clemson && adduser -S -G clemson clemson
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/api ./api
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/shared ./shared
COPY --from=build /app/packages ./packages
COPY --from=build /app/vercel.json ./vercel.json
COPY --from=build /app/package.json ./package.json
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
USER clemson
EXPOSE 3000
# Traefik's Docker provider (allowEmptyServices defaults false) ignores this
# container until Docker reports healthy. Keep the probe short so a new
# backend joins the router within a few seconds of listening.
HEALTHCHECK --interval=2s --timeout=3s --start-period=15s --retries=20 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
