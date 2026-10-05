#!/bin/bash
# Pull a prebuilt GHCR image and swap this compose project only.
# Never prints env values. Never runs `docker system prune`.
# Never touches other compose projects or Traefik's config.
set -euo pipefail
set +x

IMAGE="ghcr.io/ascendmaui/clemson-airport-rides"
REPO="/opt/clemson-rides/src"
COMPOSE="$REPO/deploy/docker-compose.yml"
STATE="/opt/clemson-rides"
TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
TARGET="${TARGET:-production}"

if [ "$TARGET" != "production" ] && [ "$TARGET" != "staging" ]; then
  echo "TARGET must be production or staging" >&2
  exit 2
fi

mkdir -p "$STATE"
if [ "$TARGET" = "staging" ]; then
  PREV_FILE="$STATE/current-staging-sha"
else
  PREV_FILE="$STATE/current-sha"
fi
PREV=""
if [ -f "$PREV_FILE" ]; then
  PREV="$(tr -d '[:space:]' < "$PREV_FILE")"
fi

if [ -d "$REPO/.git" ]; then
  git -C "$REPO" fetch --depth 1 origin "$TAG"
  git -C "$REPO" checkout --detach FETCH_HEAD
fi

export IMAGE_TAG="$TAG"
export STAGING_IMAGE_TAG="$TAG"
export CLEMSON_NETWORK="${CLEMSON_NETWORK:-clemson_rides_net}"
export STAGING_HOST="${STAGING_HOST:-staging.clemsonrides.com}"
export TRAEFIK_ENTRYPOINT="${TRAEFIK_ENTRYPOINT:-websecure}"
export TRAEFIK_CERTRESOLVER="${TRAEFIK_CERTRESOLVER:-letsencrypt}"

compose() {
  docker compose -f "$COMPOSE" --project-name clemson-rides "$@"
}

if [ "$TARGET" = "staging" ]; then
  SERVICE="staging"
  HEALTH_URL="http://127.0.0.1:3081/api/healthz"
  compose --profile staging pull "$SERVICE"
  compose --profile staging up -d --no-build --no-deps "$SERVICE"
else
  SERVICE="web"
  HEALTH_URL="http://127.0.0.1:3080/api/healthz"
  compose pull "$SERVICE"
  compose up -d --no-build --no-deps "$SERVICE"
fi

ok=0
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" | grep -q "\"sha\":\"$TAG\""; then
    ok=1
    break
  fi
  sleep 2
done

if [ "$ok" != 1 ]; then
  echo "health check failed for $TARGET" >&2
  if [ -n "$PREV" ] && [ "$PREV" != "$TAG" ]; then
    echo "rolling back to $PREV" >&2
    if [ "$TARGET" = "staging" ]; then
      docker tag "$IMAGE:$PREV" "$IMAGE:staging" || true
    else
      docker tag "$IMAGE:$PREV" "$IMAGE:prod" || true
    fi
    export IMAGE_TAG="$PREV"
    export STAGING_IMAGE_TAG="$PREV"
    if [ "$TARGET" = "staging" ]; then
      compose --profile staging up -d --no-build --no-deps staging
    else
      compose up -d --no-build --no-deps web
    fi
  else
    echo "no previous SHA to roll back to" >&2
  fi
  exit 1
fi

printf '%s\n' "$TAG" > "$PREV_FILE"
if [ -n "$PREV" ]; then
  if [ "$TARGET" = "staging" ]; then
    printf '%s\n' "$PREV" > "$STATE/previous-staging-sha"
  else
    printf '%s\n' "$PREV" > "$STATE/previous-sha"
  fi
fi

# Drop old tags of this image only. Always keep prod, staging, the SHAs
# this deploy just ran, and whatever web/staging containers are running,
# plus the five newest other tags. Never prune other projects.
declare -A keep=()
keep[prod]=1
keep[staging]=1
keep["$TAG"]=1
if [ -n "$PREV" ]; then keep["$PREV"]=1; fi
for container in clemson-rides-web clemson-rides-staging; do
  running="$(docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null || true)"
  running_tag="${running##*:}"
  if [ -n "$running_tag" ] && [ "$running_tag" != "$running" ]; then
    keep["$running_tag"]=1
  fi
done
kept_extra=0
mapfile -t rows < <(docker images "$IMAGE" --format '{{.CreatedAt}}|{{.Tag}}' | sort -r)
for row in "${rows[@]}"; do
  tag="${row##*|}"
  [ -n "$tag" ] && [ "$tag" != "<none>" ] || continue
  if [ -n "${keep[$tag]:-}" ]; then
    continue
  fi
  if [ "$kept_extra" -lt 5 ]; then
    kept_extra=$((kept_extra + 1))
    continue
  fi
  docker rmi "$IMAGE:$tag" >/dev/null 2>&1 || true
done

echo "deployed $TARGET $TAG"
