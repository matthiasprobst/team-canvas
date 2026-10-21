#!/bin/sh
set -eu
if [ "${1:-}" = migrate ]; then
  exec java -cp '/work/app/*:/work/lib/main/*' dev.teamcanvas.MigrationMain
fi
exec java ${JAVA_OPTS:-} -jar /work/quarkus-run.jar
