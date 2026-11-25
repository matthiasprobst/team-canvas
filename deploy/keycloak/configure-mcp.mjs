import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Update only the bundled development MCP client; never reimport the realm.
const repository = fileURLToPath(new URL("../../", import.meta.url));
const realm = JSON.parse(readFileSync(new URL("team-canvas-realm.json", import.meta.url), "utf8"));

function container(args, input) {
  return execFileSync("docker", ["compose", "exec", "-T", "keycloak", ...args], {
    cwd: repository, encoding: "utf8", input, timeout: 60_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

let directory;
try {
  const origin = container(["printenv", "PUBLIC_ORIGIN"]).replace(/\/$/, "");
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
    throw new Error("The running Keycloak PUBLIC_ORIGIN must be an HTTP(S) origin without a path.");
  }
  directory = container(["mktemp", "-d", "/tmp/team-canvas-mcp.XXXXXXXX"]);
  if (!/^\/tmp\/team-canvas-mcp\.[A-Za-z0-9]+$/.test(directory)) {
    throw new Error("Unexpected temporary configuration directory.");
  }
  const config = `${directory}/kcadm.config`;
  container(["/bin/bash", "-c", [
    'exec /opt/keycloak/bin/kcadm.sh config credentials --config "$1"',
    '--server http://localhost:8080/auth --realm master',
    '--user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"',
  ].join(" "), "configure-mcp", config]);

  function admin(method, path, body, ...options) {
    const output = container(["/opt/keycloak/bin/kcadm.sh", method, path,
      "--config", config, "-r", realm.realm, ...options,
      ...(body === undefined ? [] : ["-f", "-"])],
    body === undefined ? undefined : JSON.stringify(body));
    return method === "get" ? JSON.parse(output) : output;
  }

  // Existing standard scopes and their mappers belong to the realm operator.
  // Add missing definitions, and repair token inclusion for our two scopes only.
  const scopes = new Map(admin("get", "client-scopes").map(scope => [scope.name, scope]));
  const template = realm.clients.find(client => client.clientId === "team-canvas-mcp");
  for (const name of template.defaultClientScopes) {
    const definition = realm.clientScopes.find(scope => scope.name === name);
    if (!scopes.has(name)) {
      admin("create", "client-scopes", definition);
    } else if (name.startsWith("canvas:")) {
      const existing = scopes.get(name);
      admin("update", `client-scopes/${existing.id}`, {
        name, protocol: definition.protocol,
        attributes: { ...existing.attributes, ...definition.attributes },
      });
    }
  }

  const existing = admin("get", "clients", undefined, "-q", "clientId=team-canvas-mcp")[0];
  const { defaultClientScopes, protocolMappers, ...settings } = template;
  if (existing) {
    admin("update", `clients/${existing.id}`, {
      ...settings,
      redirectUris: [...new Set([...(existing.redirectUris ?? []), ...settings.redirectUris])],
      attributes: { ...existing.attributes, ...settings.attributes },
    });
  } else {
    admin("create", "clients", settings);
  }
  const client = admin("get", "clients", undefined, "-q", "clientId=team-canvas-mcp")[0];
  const available = new Map(admin("get", "client-scopes").map(scope => [scope.name, scope.id]));
  const assigned = new Set(admin("get", `clients/${client.id}/default-client-scopes`).map(scope => scope.name));
  for (const name of defaultClientScopes) {
    if (!assigned.has(name)) {
      admin("update", `clients/${client.id}/default-client-scopes/${available.get(name)}`);
    }
  }
  const mappers = admin("get", `clients/${client.id}/protocol-mappers/models`);
  for (const definition of protocolMappers) {
    const mapper = {
      ...definition,
      config: { ...definition.config, "included.custom.audience": `${origin}/mcp` },
    };
    const previous = mappers.find(item => item.name === mapper.name);
    if (previous) {
      admin("update", `clients/${client.id}/protocol-mappers/models/${previous.id}`, { ...mapper, id: previous.id });
    } else {
      admin("create", `clients/${client.id}/protocol-mappers/models`, mapper);
    }
  }
  console.log(`Configured team-canvas-mcp for ${origin}/mcp; existing users and browser client retained.`);
} catch (error) {
  console.error("Could not configure development MCP access:", error.stderr?.trim() || error.message);
  console.error("Check that Compose Keycloak is running and its bootstrap admin credentials are still valid.");
  process.exitCode = 1;
} finally {
  if (directory && /^\/tmp\/team-canvas-mcp\.[A-Za-z0-9]+$/.test(directory)) {
    try {
      container(["rm", "-rf", "--", directory]);
    } catch {
      console.error(`Could not remove temporary admin credentials at ${directory}.`);
      process.exitCode = 1;
    }
  }
}
