# Runtime image scan report

Scanned on 2026-10-22 with Trivy 0.76.1 (`vuln,secret`) after rebuilding the images. No vulnerability exceptions are approved.

| Image digest | HIGH / CRITICAL | Other findings | Secrets |
| --- | ---: | --- | ---: |
| Backend `sha256:3d3edd3e0f1b33d3b689f34a2870b4ae30e113820b3ff25b07d1bcfae559d54e` | 0 | 27 MEDIUM, 4 LOW | 0 |
| Frontend `sha256:6476b3e989e69a4ecf13e8914097889ac890af00e159c4b2259579e3f2ca7b10` | 0 | 1 UNKNOWN | 0 |

## Backend findings

All findings below are from the Ubuntu Noble runtime packages. Trivy reported no fixed version in the database for these entries.

| Severity | Package and installed version | Vulnerability IDs |
| --- | --- | --- |
| MEDIUM | dash `0.5.12-6ubuntu5` | CVE-2026-102473, CVE-2026-102474 |
| MEDIUM | libc-bin, libc6, locales `2.39-0ubuntu8.9` | CVE-2026-18374, CVE-2026-89092 |
| MEDIUM | libexpat1 `2.6.1-2ubuntu0.6` | CVE-2025-66382 |
| MEDIUM | libgnutls30t64 `3.8.3-1.1ubuntu3.6` | CVE-2026-67693, CVE-2026-88647, CVE-2026-95184, CVE-2026-95209, CVE-2026-95210 |
| MEDIUM | libpcre2-8-0 `10.42-4ubuntu2.1` | CVE-2026-103111, CVE-2026-86145, CVE-2026-89156, CVE-2026-89157, CVE-2026-89158, CVE-2026-89160, CVE-2026-89161 |
| MEDIUM | libsasl2-2, libsasl2-modules-db `2.1.28+dfsg1-5ubuntu3.1` | CVE-2026-107161 |
| MEDIUM | tar `1.35+dfsg-3ubuntu0.4` | CVE-2026-18477, CVE-2026-18508 |
| MEDIUM | wget `1.21.4-1ubuntu4.5` | CVE-2021-31879 |
| MEDIUM | zlib1g `1:1.3.dfsg-3.1ubuntu2.2` | CVE-2026-85091 |
| LOW | libsystemd0, libudev1 `255.4-1ubuntu8.17` | CVE-2026-40228 |
| LOW | login, passwd `1:4.13+dfsg1-4ubuntu3.2` | CVE-2024-56433 |

## Frontend finding

Trivy reports `GO-2026-5932` for `golang.org/x/crypto` v0.57.0, affecting the unmaintained `openpgp/s2k` package. The inventory does not establish that Caddy uses that package. This remains UNKNOWN and needs security review; it is not recorded as an approved exception. See the [Go vulnerability entry](https://pkg.go.dev/vuln/GO-2026-5932) and the [Trivy package matching discussion](https://github.com/aquasecurity/trivy/discussions/10944).

## Disposition

The previous HIGH findings in the backend Go binary and Caddy Go binary are absent from these rebuilt images. No findings are waived. The MEDIUM, LOW and UNKNOWN entries remain for the release owner to assess against the actual deployment and scanner policy. Re-scan and regenerate the SBOMs for the final published image digests.
