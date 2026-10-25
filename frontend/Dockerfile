FROM node:24-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install --global npm@11.19.1 && npm ci --no-audit --no-fund
COPY frontend/ ./
# Excalidraw fonts must be bundled locally (no external CDN dependency).
RUN mkdir -p public/fonts && cp -r node_modules/@excalidraw/excalidraw/dist/prod/fonts/. public/fonts/
RUN npm run build

# Build Caddy with a patched Go toolchain and networking/router dependencies.
# The upstream runtime image still supplies the small Alpine runtime filesystem.
FROM golang:1.27.3-alpine AS proxy-build
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7
WORKDIR /src
RUN xcaddy build v2.11.7 \
    --replace golang.org/x/net=golang.org/x/net@v0.60.0 \
    --replace github.com/go-chi/chi/v5=github.com/go-chi/chi/v5@v5.4.0

FROM caddy:2.11.7-alpine
# Kubernetes runs Caddy on 8080 with all capabilities dropped. Remove the base
# image's file capability so exec also works with an empty capability bounding set.
# Refresh Alpine packages as well; the base tag can retain older runtime libraries.
RUN apk upgrade --no-cache && setcap -r /usr/bin/caddy
COPY --from=proxy-build /src/caddy /usr/bin/caddy
COPY --from=build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
