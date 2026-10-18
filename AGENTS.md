# Repository Guidelines

## Project Structure & Module Organization

- `frontend/src/`: React/TypeScript UI, Excalidraw integration, API client, WebSocket types (`protocol.ts`), reconciliation helpers (`syncCore.ts`), and styles (`style.css`).
- `backend/src/main/kotlin/dev/teamcanvas/`: Quarkus REST endpoints, WebSocket handling, persistence, and validation.
- `backend/src/main/resources/db/migration/`: Flyway SQL migrations; follow `V1__board.sql` naming with increasing versions.
- `backend/src/test/kotlin/dev/teamcanvas/`: backend unit tests. `tests/`: Node reconciliation tests and WebSocket smoke tests.
- `deploy/Caddyfile` and `docker-compose.yml`: reverse proxy and local stack. Uploaded images persist in PostgreSQL.

## Build, Test, and Development Commands

Use JDK 21, Maven 3.9+, Node.js 22+, and PostgreSQL 17.

- Copy `.env.example` to `.env` if absent and set a random `DB_PASSWORD`.
- `docker compose up --build -d`: build and start the stack at `http://localhost:8088`.
- `docker compose up -d db`: start only PostgreSQL.
- From `backend/`, run `mvn quarkus:dev` with database environment variables exported; `mvn package` builds the backend.
- From `frontend/`, run `npm install`, then `npm run dev` for Vite at `http://localhost:5173`; `npm run build` type-checks and builds production assets.

## Coding Style & Naming Conventions

Match existing code: two-space indentation in TypeScript, four spaces in Kotlin. TypeScript uses double quotes and semicolons; Kotlin omits semicolons. Use PascalCase for components, types, and classes; camelCase for functions and variables. Keep protocol types and backend messages aligned. TypeScript enables strict and unused-symbol checks; no dedicated formatter or lint script is configured.

## Testing Guidelines

Run backend JUnit tests with `cd backend && mvn test`. Name Kotlin test classes `*Test`; use descriptive behavior names. Node tests use `node:test` and `*.test.mjs`. From the repository root after frontend dependency installation:

```sh
frontend/node_modules/.bin/tsc --target es2022 --module commonjs --moduleResolution node --skipLibCheck --outDir .test-build frontend/src/protocol.ts frontend/src/syncCore.ts
node --test tests/syncCore.test.mjs
node tests/smoke.mjs
```

The smoke test requires the running stack. Cover synchronization, privacy, locking, and permissions when changing those behaviors. No coverage threshold is configured. Validate UI changes in multiple browser sessions.

## Commit & Pull Request Guidelines

Git history is unavailable in this checkout. Use concise, imperative commit subjects. PRs should describe behavior changes, link relevant issues, report validation, and include screenshots for UI changes.

## Architecture & Configuration

Preserve server-enforced ownership, poker privacy, and the ten-connection limit. The backend assumes one instance and uses object-level last-writer-wins synchronization. Never commit `.env`, tokens, or host keys.
