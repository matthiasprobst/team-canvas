# Team Canvas

A self-hosted whiteboard for team workshops, retrospectives, and architecture discussions. Draw together in real time, organize work across pages, and reuse layouts as templates. Poker mode lets everyone contribute privately before revealing their saved work together.

## Start using Team Canvas

If your organization already runs Team Canvas, open its app URL or a colleague’s invitation link. You need an account in your organization’s SSO; no local installation is required.

1. Choose **Login with SSO** and sign in.
2. Choose **New canvas** on the dashboard and give it a name. If you followed an invitation link, choose **Accept invitation** instead.
3. Draw, add text, sticky notes, or images. Changes save automatically; wait for **Saved** before leaving.
4. As the owner, choose **Share → Create invitation link** and send it to your colleagues. They sign in and accept the invitation to edit with you.
5. Return to the dashboard to reopen your work under **My canvases** or **Shared with me**.

See the [user guide](docs/user-guide.md) for pages, templates, poker rounds, sharing, and recovering unsaved work.

## What you can do

| Workflow | How it works |
| --- | --- |
| Draw together | Shared shapes, text, sticky notes, images, and live cursors. |
| Display ticket details | Add a Markdown note with rendered headings, tables, task lists, links, and code blocks; edit its source with a live preview. |
| Organize a workshop | Add blank pages or copy a page. Everyone follows the same selected page. |
| Collect ideas privately | **Start poker**, contribute, then **Stop poker and reveal**. Any member can reveal saved contributions. This is not numeric estimation poker. |
| Reuse a layout | Mark a canvas as a template; **Start template** creates an independent copy of all its pages. |
| Find and share work | Search by name or tags, reopen saved canvases, and manage editing membership. |
| Ask an AI assistant | Use the bottom-right chat to count objects, read note text, and propose editable notes, shapes, text, and connections. Requires a configured AI service. |
| Connect external assistants | Codex, OpenCode, and Claude Code can inspect saved shared content and submit proposals through the authenticated MCP endpoint. |

Everyone must sign in, and invitations grant editing access. A **public template** is available to all signed-in users of your deployment. Private poker contributions stay hidden from other members, including the owner, until reveal; infrastructure administrators can access stored data. There is no read-only sharing role or revision history.

## Try it locally

Install Docker with the Compose plugin and run these commands from the repository root. This starts a development instance with its own Keycloak sign-in service.

```sh
test -f .env || cp .env.example .env
openssl rand -hex 24
```

On first setup, put the generated password into `.env` as `DB_PASSWORD`, then start the stack. If you already have a database, keep its existing password.

```sh
docker compose up --build -d --wait --wait-timeout 300
```

Open **http://localhost:8088**, choose **Login with SSO**, and use one of the development accounts:

| Username | Default development password |
| --- | --- |
| `alice` | `alice-dev-only` |
| `bob` | `bob-dev-only` |

Use separate browser profiles to try sharing between Alice and Bob. Passwords can be configured before the first start; see [local setup and checks](docs/local-development.md) for details, WLAN access, and troubleshooting.

Data survives `docker compose down`. **`docker compose down -v` deletes the development database and Keycloak data.** The bundled setup and demo accounts are for development; use the [operator handover](docs/operator-handover.md) before admitting retained company data. For an existing database, read the [upgrade notes](docs/upgrading.md).

## Markdown notes

Choose **Markdown note** in a canvas toolbar, paste or write your Markdown, review the live preview, and choose **Save Markdown note**. Notes support headings, emphasis, lists, task lists, tables, links, and code blocks. Task checkboxes are read-only in the rendered note; change them in the source editor.

Select a note and choose **Edit Markdown**, or activate it with a double-click and use its **Edit** button. Double-click also enables scrolling and links inside a note. Move, resize, duplicate, delete, and connect it with arrows using the drawing tools. Changes synchronize with collaborators and support the editor's undo/redo controls.

Ask the embedded chat or an external assistant to create or refine a Markdown ticket. MCP represents it as one note with `format: "markdown"` and its source in `text`; `create_markdown` proposes a new note, and `update_text` refines its source. Connections reference the note's element ID as usual. Poker drafts follow the same privacy and reveal rules as other drawings.

Markdown notes render locally without loading external pages. Raw HTML is ignored, images show their alt text, and links allow HTTP, HTTPS, mailto, or in-document anchors. Notes contain up to 10,000 characters. **Image exports currently show an embedded-content placeholder**; the editable source remains saved in the canvas and draft exports.

## Work with the canvas through chat

Use the embedded **AI assistant**, or connect **Codex**, **OpenCode**, or **Claude Code** through MCP. All four can ask about saved objects and text, count notes, suggest relationships, and propose notes, shapes, text, and labelled connections. External assistants use their own model service; they do not need the embedded chat's API key.

### Embedded chat: OpenAI or an OpenAI-compatible service

For the local Docker stack, edit the existing root `.env`, preserving its database and sign-in settings. For OpenAI, [create an API key](https://platform.openai.com/api-keys) and ensure your API organization has [billing or credits enabled](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform), then set:

```dotenv
TEAM_CANVAS_AI_BASE_URL=https://api.openai.com/v1
TEAM_CANVAS_AI_API_KEY=your-api-key-here
TEAM_CANVAS_AI_MODEL=gpt-5.4-mini
```

[GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) supports Chat Completions and function calling. For another provider or a local model service, substitute its base URL, model ID, and key; the model must support function calls and tool-result messages. The base URL excludes `/chat/completions`. A key is optional for services that do not require authentication. The app currently uses a shared backend credential, rather than an OpenAI account sign-in button. Keep keys in `.env` or your secret manager.

**Open WebUI** is also supported through its OpenAI-compatible API. Instead of the OpenAI values above, set:

```dotenv
TEAM_CANVAS_AI_BASE_URL=https://openwebui.example.com/api
TEAM_CANVAS_AI_API_KEY=your-openwebui-api-key
TEAM_CANVAS_AI_MODEL=your-openwebui-model-id
```

Replace the example hostname with your instance. Generate the key in Open WebUI under **Settings → Account**; an administrator may need to enable API keys and grant your account permission. Use a model ID available to that account, as returned by Open WebUI's `GET /api/models`, and choose a model that supports native function calling. The key belongs to Open WebUI; no OpenAI key is required by Team Canvas when using this provider. See [Open WebUI's API documentation](https://docs.openwebui.com/reference/api-endpoints/).

The backend appends `/chat/completions`, so the Open WebUI base URL ends in `/api`. For generic providers, use the API root appropriate to that service, excluding `/chat/completions`. Credentials are sent as `Authorization: Bearer <key>` without requiring an OpenAI key format. Team Canvas supplies and executes the canvas tools; Open WebUI forwards those tool definitions to its model and returns the tool calls to Team Canvas. Use native function calling for that model, and leave Open WebUI's server-side tools out of this integration. See [Open WebUI's tool-calling behavior](https://docs.openwebui.com/reference/server-side-tool-calling/).

When Team Canvas runs in Docker, the provider URL must be reachable **from the backend container**. `localhost` inside that container refers to the backend itself. For a locally hosted Open WebUI, use a reachable host address or a shared Docker network and the Open WebUI service's internal address and port.

Build and recreate the application services to load the configuration and latest UI:

```sh
docker compose up -d --build backend frontend
```

Open a canvas at **http://localhost:8088**, wait for **Saved**, and open **AI assistant** at the bottom right. Choose **Current page** or **Selected objects** and send your request. For host-run Quarkus, export these variables before starting the backend; Maven does not load `.env` automatically.

### Before connecting an external assistant

Run the app and the assistant on the same computer for the local examples below. The MCP URL is **http://localhost:8088/mcp**. For another deployment, replace it with `<PUBLIC_ORIGIN>/mcp`; the assistant must be able to reach both the app and its sign-in service. For Vite development, use the configured origin, usually `http://localhost:5173/mcp`.

Sign in with your **Team Canvas account** during MCP authorization. You must own the canvas or be an active member. The bundled development OAuth client is `team-canvas-mcp`, with `canvas:read` and `canvas:propose` scopes. Company deployments need an approved client configured by their operator.

**Existing local installations need an identity-provider update:** Keycloak's startup realm import does not update an existing realm. With the bundled Compose stack running, run the following from the repository root (requires Node.js 22+ and Docker access):

```sh
node deploy/keycloak/configure-mcp.mjs
```

This adds the MCP client, scopes, and audience mapper while retaining existing users and data. See [existing-realm setup](docs/local-development.md#add-mcp-access-to-an-existing-development-realm) for details or manual setup. If Keycloak shows **Client not found**, complete this step, then retry the assistant login.

### Codex

Run these commands with a current Codex CLI:

```sh
codex mcp add team_canvas --url http://localhost:8088/mcp --oauth-client-id team-canvas-mcp
codex mcp login team_canvas --scopes canvas:read,canvas:propose
```

Complete the browser sign-in, start a new Codex session, and run `/mcp` to check the connection. Then ask Codex to use `team_canvas`. See the [Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). If `--oauth-client-id` is unavailable, upgrade the client.

### OpenCode

For OpenCode V2, merge the following into your project's `opencode.jsonc`, preserving any existing settings:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "team_canvas": {
        "type": "remote",
        "url": "http://localhost:8088/mcp",
        "oauth": {
          "client_id": "team-canvas-mcp",
          "scope": "canvas:read canvas:propose"
        }
      }
    }
  }
}
```

Open OpenCode, run `/mcps`, select `team_canvas`, and complete sign-in. Run `opencode mcp list` to check that it is connected. OpenCode V1 uses a different configuration layout (`mcp.team_canvas` and OAuth `clientId`); upgrade to V2 for the example above or consult your version's schema. See the [OpenCode MCP guide](https://opencode.ai/docs/mcp-servers/).

### Claude Code

Use a current Claude Code release with pre-registered OAuth client support:

```sh
claude mcp add --transport http --client-id team-canvas-mcp team_canvas http://localhost:8088/mcp
```

Start Claude Code from the same directory, run `/mcp`, select `team_canvas`, and authenticate. This is a public OAuth client, so no client secret is needed. If `claude mcp add --help` does not list `--client-id`, upgrade Claude Code before using this flow. See the [Claude Code MCP guide](https://code.claude.com/docs/en/mcp).

### Questions, creation, and feature refinement

The embedded chat supports `/new` for a fresh conversation and `/compact` for a model-generated summary retained in later turns. Both leave canvas content and saved proposals intact. Page or round changes still clear conversation context.

After signing in again, **Saved proposal activity** restores retained proposals rather than a full chat transcript. `/compact` includes this activity, so you can resume from pending and applied changes without first starting a new exchange.

For external assistants, name the server, canvas, and page so they can inspect the correct saved content first. Example prompts:

- "Use team_canvas to list my canvases and the pages in 'Feature planning'."
- "On the 'Overview' page of 'Feature planning', how many notes and shapes are there? Summarize the note text."
- "Which notes are already connected? Suggest missing connections and explain why."
- "Propose three notes: Research, Design, Build. Connect them in that order with labelled arrows."
- "Read the notes connected to 'Authentication'. Ask me about missing requirements, then propose refined note text and connections."
- "Arrange the existing notes as a flow, following their connections."
- "Arrange these objects in a grid and label the existing connections with meaningful relationships."

Layout proposals support up to 12 existing notes, shapes, or texts at a time, with spacing computed from their saved dimensions. Flow follows directed connections and uses a grid for cycles; this is a basic layout rather than a crossing-minimization engine. MCP clients can use `arrange_objects` with `ids` and `layout: "flow"` or `"grid"`, and `label_connection` with an existing bound arrow's `id` and label `text`. Existing arrows retain their identity and bindings.

Creation and refinement produce **proposals**. Open the relevant canvas and page, then its bottom-right assistant to review them. Choose **Add to canvas** or **Dismiss**, and wait for **Added to canvas** and **Saved**. Applied objects remain editable, and the editor's undo/redo controls work normally. External proposals can be reviewed even when the embedded model service is unconfigured.

Choose **Preview** for a read-only **Before / After** view before approval; the live scene remains untouched until you approve. If collaborators change the canvas, refresh the preview before approving. The **Changes** selector also offers **Auto-accept new chat changes**. This is an explicit choice for new proposals generated by the open chat; older or external proposals remain manual. Closing the chat, `/new`, page/round changes, reload, or an error resets auto-accept to manual review.

External assistants can read saved shared content and submit proposals while the canvas is closed. They cannot read private poker drafts or submit proposals during poker. Counts combine bound text with its note or shape; text inside uploaded images is not read. Proposals expire after one day and can become stale when the page, round, or affected objects change. See the [user guide](docs/user-guide.md#ask-about-the-canvas-and-create-content) for context and privacy details, and [MCP troubleshooting](docs/local-development.md#mcp-connection-troubleshooting) for connection errors.

## Develop locally

For live reload of both the UI and API, use JDK 21, Maven 3.9+, Node.js 24 with npm 11.19.1, and Docker with Compose. Run the following commands from the repository root. First create `.env` as shown in [Try it locally](#try-it-locally), set a random `DB_PASSWORD`, and set `PUBLIC_ORIGIN=http://localhost:5173` **before Keycloak's first start**. Then start only the database and development identity provider:

```sh
docker compose up -d --wait db keycloak
```

In one terminal, load `.env` and start Quarkus:

```sh
set -a
. ./.env
set +a
export JDBC_URL="jdbc:postgresql://localhost:${DB_PORT:-5432}/board"
export OIDC_ISSUER="${KEYCLOAK_PUBLIC_URL}/realms/team-canvas"
export OIDC_CLIENT_ID=team-canvas
export OIDC_CLIENT_SECRET="$DEV_OIDC_CLIENT_SECRET"
export OIDC_SESSION_SECRET="$DEV_OIDC_SESSION_SECRET"
export TEAM_CANVAS_ALLOWED_ORIGINS=http://localhost:5173
export QUARKUS_OIDC_AUTHENTICATION_COOKIE_FORCE_SECURE=false
(cd backend && mvn quarkus:dev)
```

In another terminal, start Vite. It proxies `/api` and `/ws` to Quarkus on port `8080`:

```sh
npm ci --prefix frontend
npm run dev --prefix frontend
```

Open **http://localhost:5173** and sign in with `alice` / `alice-dev-only` or `bob` / `bob-dev-only`. If you previously started the full Compose stack, stop its `backend` and `frontend` services before starting Quarkus, and update the existing Keycloak `team-canvas` client's redirect URI to `http://localhost:5173/api/login`, post-logout URI to `http://localhost:5173/login`, and web origin to `http://localhost:5173`; changing `.env` alone does not update an imported realm. See [local development and checks](docs/local-development.md#development-and-checks) for tests and troubleshooting. Do not run the host and Compose backends against the same database.

## Documentation

| I want to… | Read |
| --- | --- |
| Use the app or run a workshop | [User guide](docs/user-guide.md) |
| Configure chat or connect Codex, OpenCode, or Claude Code | [Chat setup and examples](#work-with-the-canvas-through-chat) → [MCP configuration and troubleshooting](docs/local-development.md#ai-chat-and-external-assistants) |
| Run locally, develop, or test | [Local development and checks](docs/local-development.md) |
| Deploy for my organization | [Operator handover](docs/operator-handover.md) → [production readiness](docs/production-readiness.md) |
| Upgrade, back up, restore, or offboard users | [Operations runbook](docs/operations-runbook.md) and [upgrade notes](docs/upgrading.md) |
| Understand permissions and implementation | [Security model](docs/security-model.md) and [architecture](docs/architecture.md) |
| Review documentation work | [Compact documentation plan](docs/documentation-plan.md) |

The app uses React/TypeScript with Excalidraw, Kotlin/Quarkus, PostgreSQL, and Keycloak. It supports **one active backend per database**. The default limit is 30 connections per canvas, including extra tabs; operators can configure it. The company chooses its hosting platform; [Helm](deploy/helm/README.md) is an optional reference. Production acceptance remains environment-specific; see the [local qualification record](docs/local-qualification-2026-10-25.md).

## Contributing

The UI lives in [frontend/](frontend/), the API and persistence in [backend/](backend/), and cross-session checks in [tests/](tests/). See [development and checks](docs/local-development.md#development-and-checks) for setup and validation commands, and the [implementation backlog](.features/company-readiness/README.md) for feature history.

Include reproduction steps, expected behavior, relevant checks, and screenshots for UI changes. Synchronization and poker changes need coverage for privacy, permissions, reconnects, and multiple sessions. Never commit `.env`, tokens, invitation secrets, or deployment credentials.

## License

[MIT](LICENSE). Third-party libraries, images, and fonts retain their own licenses and notices.
