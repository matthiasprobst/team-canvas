#!/bin/sh
set -eu
if [ "${1:-}" = migrate ]; then
  exec java -cp '/work/app/*:/work/lib/main/*:/work/lib/boot/*' dev.teamcanvas.MigrationMain
fi
if [ "${1:-}" = maintenance ]; then
  shift
  exec java -cp '/work/app/*:/work/lib/main/*:/work/lib/boot/*' dev.teamcanvas.MaintenanceMain "$@"
fi
exec java ${JAVA_OPTS:-} -jar /work/quarkus-run.jar
