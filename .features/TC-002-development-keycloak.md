# TC-002: Provide Keycloak sign-in for local development and WLAN testing

Status: In progress

Dependencies: None

Feature: [User dashboard and Keycloak sign-in](README.md)

## User story

As a developer, I want a reproducible local identity provider so I can test the same authentication flow used in the company deployment.

## Implementation checklist

- [x] Add a development-only Keycloak Compose setup with a dedicated Team Canvas realm, confidential web client, and two test accounts. Pin the container version and keep real production credentials out of the repository.
- [x] Provide example configuration for development account/client credentials and persistent Keycloak storage. Keep development bootstrap settings out of production manifests.
- [x] Use an explicit public application/issuer URL for browser redirects and an internally reachable Keycloak endpoint for backend token and key retrieval. Configure exact redirect and post-logout URLs.
- [x] Make the setup work for localhost and a configured WLAN host address. Browser redirects must never point to Docker service names, and backend requests must not assume browser localhost is reachable inside its container.
- [x] Define the HTTP-only development cookie exception explicitly; production keeps HTTPS and secure cookies.
- [x] Remove the guest-mode Compose defaults as part of the authentication rollout. Provide the configuration contract needed by TC-003 and document the startup sequence without adding a second active backend.

## Acceptance criteria

- [ ] The development realm and two distinct accounts are reproducible from the documented configuration.
- [ ] Browser authorization redirects and backend token/JWKS requests use reachable URLs with consistent issuer validation.
- [ ] Both localhost and configured WLAN sign-in URLs work without permissive wildcard production redirect settings.
- [ ] Development credentials and bootstrap configuration are clearly isolated from the company Keycloak deployment.
- [ ] Keycloak state survives a normal stop/start; no automatic reset deletes application boards.

## Validation

Check Compose configuration, realm import, OIDC discovery/endpoints, and redirect settings. Complete end-to-end login/logout verification together with TC-003 using both test accounts and a second WLAN browser.

## Completion notes

Added pinned development Keycloak, persistent keycloakdata, a confidential PKCE client, two demo accounts, and exact callback/logout configuration. PUBLIC_ORIGIN controls browser URLs; backend token/JWKS calls use the internal service. Compose configuration passes. Realm import, persistence across restart, and localhost/WLAN sign-in await Docker access.

See [validation evidence and remaining checks](validation.md). Status remains In progress pending runtime acceptance; unchecked criteria are not represented as verified.
