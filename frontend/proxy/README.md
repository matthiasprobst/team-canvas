# Patched Caddy proxy build

This build includes only Caddy's HTTP modules used by `deploy/Caddyfile` and
the Kubernetes/Helm variants. It pins go-jose v4 to 4.1.6.

The local `go-jose-v3` directory is the upstream v3.0.5 module source (Apache
2.0). Its `jwk.go` includes the RSA JWK size and prime checks backported from
the upstream [v4 fix](https://github.com/go-jose/go-jose/commit/a0111f82742fa92bceec9ede40845e73319e6230)
for CVE-2026-116587. Upstream has no patched v3 release. The added
`jwk_security_test.go` covers the limits. Keep this replacement until Caddy's
dependencies no longer use v3, then remove the local copy.
