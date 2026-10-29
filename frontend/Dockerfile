FROM node:24-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install --global npm@11.19.1 && npm ci --no-audit --no-fund
COPY frontend/ ./
# Excalidraw fonts must be bundled locally (no external CDN dependency).
RUN mkdir -p public/fonts && cp -r node_modules/@excalidraw/excalidraw/dist/prod/fonts/. public/fonts/
RUN npm run build

# Build the HTTP modules used by this proxy. Caddy's standard bundle includes
# certificate authority modules that bring in unpatched go-jose v3.
FROM golang:1.27.3-alpine AS proxy-build
WORKDIR /src
COPY frontend/proxy/ ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    cd go-jose-v3 && go test -run 'TestOversizedRSAJWKRejectedBeforeValidation|TestInvalidRSAPrimesRejectedBeforeValidation' .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download && go mod verify && CGO_ENABLED=0 go build -mod=readonly -o /caddy .

# The proxy is statically linked; the runtime only needs its binary, assets,
# config, and trust store. No package manager or file capability is needed.
FROM scratch
ENV XDG_CONFIG_HOME=/config XDG_DATA_HOME=/data
COPY --from=proxy-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=proxy-build /caddy /usr/bin/caddy
COPY --from=build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
