FROM node:24-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Excalidraw fonts must be bundled locally (no external CDN dependency).
RUN mkdir -p public/fonts && cp -r node_modules/@excalidraw/excalidraw/dist/prod/fonts/. public/fonts/
RUN npm run build

FROM caddy:2-alpine
# Kubernetes runs Caddy on 8080 with all capabilities dropped. Remove the base
# image's file capability so exec also works with an empty capability bounding set.
RUN setcap -r /usr/bin/caddy
COPY --from=build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
