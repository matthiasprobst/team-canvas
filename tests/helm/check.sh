#!/usr/bin/env bash
set -euo pipefail
chart=deploy/helm/team-canvas
fixture=tests/helm/values.yaml
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
helm lint "$chart" -f "$fixture"
helm template canvas "$chart" -f "$fixture" > "$work/default.yaml"
if grep -q 'name: canvas-metrics' "$work/default.yaml"; then
  echo 'Disabled monitoring unexpectedly opened access' >&2
  exit 1
fi
helm template canvas "$chart" -f "$fixture" \
  --set monitoring.enabled=true \
  --set monitoring.namespaceLabels.monitoring=enabled \
  --set monitoring.podLabels.app=prometheus > "$work/monitoring.yaml"
grep -q 'name: canvas-metrics' "$work/monitoring.yaml"
grep -q 'monitoring: enabled' "$work/monitoring.yaml"
grep -q 'app: prometheus' "$work/monitoring.yaml"
if helm template canvas "$chart" -f "$fixture" --set monitoring.enabled=true > /dev/null 2>&1; then
  echo 'Enabled monitoring accepted empty selectors' >&2
  exit 1
fi
if helm template canvas "$chart" -f "$fixture" --set monitoring.enabled=true \
  --set monitoring.namespaceLabels.monitoring=enabled > /dev/null 2>&1; then
  echo 'Enabled monitoring accepted an empty pod selector' >&2
  exit 1
fi
if helm template canvas "$chart" -f "$fixture" --set monitoring.enabled=true \
  --set monitoring.podLabels.app=prometheus > /dev/null 2>&1; then
  echo 'Enabled monitoring accepted an empty namespace selector' >&2
  exit 1
fi
if helm template canvas "$chart" -f "$fixture" --set images.backend=registry.test/backend:latest > /dev/null 2>&1; then
  echo 'Mutable image reference accepted' >&2
  exit 1
fi
