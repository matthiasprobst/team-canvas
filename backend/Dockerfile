FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /app
COPY pom.xml .
RUN mvn -B dependency:go-offline
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /work
COPY --from=builder /app/target/quarkus-app/ /work/
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75"
EXPOSE 8080
USER 1001
COPY --chmod=755 entrypoint.sh /work/entrypoint.sh
ENTRYPOINT ["/work/entrypoint.sh"]
