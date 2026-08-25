#!/bin/sh
set -eu

IMAGE=${1:?Usage: deploy.sh IMAGE [COMPOSE_FILE]}
SERVICE_VERSION=${SERVICE_VERSION:-${IMAGE##*:}}
COMPOSE_FILE=${2:-compose.yml}
SERVICE=gateway-service
CONTAINER=chat-web-gateway-service
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-180}
PULL_ATTEMPTS=${PULL_ATTEMPTS:-8}
deployment_started=0

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "Compose file not found: $COMPOSE_FILE" >&2
    exit 1
fi

if [ ! -f .env ]; then
    echo "Missing $(pwd)/.env; create it from deploy/.env.example before the first deployment." >&2
    exit 1
fi

temporary_env=$(mktemp .env.XXXXXX)
if ! awk '
    /^OTEL_/ { next }
    /^NODE_OPTIONS=.*@opentelemetry\/auto-instrumentations-node\/register/ { next }
    { print }
' .env > "$temporary_env"; then
    rm -f "$temporary_env"
    exit 1
fi
chmod 600 "$temporary_env"
mv "$temporary_env" .env

old_image=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)

compose() {
    IMAGE="$IMAGE" SERVICE_VERSION="$SERVICE_VERSION" docker compose -f "$COMPOSE_FILE" "$@"
}

rollback() {
    echo "Deployment failed; showing the latest container logs." >&2
    docker logs --tail 100 "$CONTAINER" 2>&1 || true

    if [ -n "$old_image" ] && [ "$old_image" != "$IMAGE" ]; then
        echo "Rolling back to $old_image" >&2
        IMAGE="$old_image" SERVICE_VERSION="${old_image##*:}" docker compose -f "$COMPOSE_FILE" up -d --no-deps "$SERVICE"
    else
        echo "No previous image is available for rollback." >&2
    fi
}

handle_interrupt() {
    trap - HUP INT TERM
    echo "Deployment interrupted by a newer version." >&2
    if [ "$deployment_started" -eq 1 ]; then
        rollback
    fi
    exit 130
}

trap handle_interrupt HUP INT TERM

pull_image() {
    attempt=1
    while ! docker pull "$IMAGE"; do
        if [ "$attempt" -ge "$PULL_ATTEMPTS" ]; then
            echo "Failed to pull $IMAGE after $PULL_ATTEMPTS attempts." >&2
            return 1
        fi

        delay=$((attempt * 5))
        echo "Image pull attempt $attempt failed; retrying in ${delay}s." >&2
        sleep "$delay"
        attempt=$((attempt + 1))
    done
}

echo "Pulling $IMAGE (up to $PULL_ATTEMPTS attempts)"
pull_image

echo "Starting $SERVICE"
deployment_started=1
if ! compose up -d --no-deps "$SERVICE"; then
    rollback
    exit 1
fi

elapsed=0
while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ]; do
    state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER" 2>/dev/null || true)
    case "$state" in
        healthy)
            echo "Deployment succeeded: $IMAGE"
            trap - HUP INT TERM
            docker image prune -f >/dev/null 2>&1 || true
            exit 0
            ;;
        exited|dead|unhealthy)
            echo "Container state: $state" >&2
            rollback
            exit 1
            ;;
    esac

    sleep 5
    elapsed=$((elapsed + 5))
done

echo "Health check timed out after ${HEALTH_TIMEOUT}s." >&2
rollback
exit 1
