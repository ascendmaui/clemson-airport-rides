#!/bin/bash
# Pull a prebuilt GHCR image and swap this compose project only.
# Never prints env values. Never runs `docker system prune`.
# Never touches other compose projects or Traefik's config.
#
# Swap is start-before-stop. Traefik's host-mode Docker provider removes the
# router while the only backend is down or still starting (that is the
# clemsonrides.com 404 / reset window). An overlap container with the same
# Traefik service labels is healthy and attached before the canonical
# container is recreated, then removed only after the new one is healthy.
set -euo pipefail
set +x

IMAGE="ghcr.io/ascendmaui/clemson-airport-rides"
REPO="/opt/clemson-rides/src"
STATE="/opt/clemson-rides"
TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
TARGET="${TARGET:-production}"
# Host-port polls run while the overlap container is still serving, so a long
# window does not extend the Traefik gap. 60 x 2s.
HEALTH_ATTEMPTS=60
HEALTH_SLEEP_SECONDS=2
# After Docker marks the new container healthy, Traefik still has to observe
# that event before the previous backend may leave.
TRAEFIK_SETTLE_SECONDS=10
LOCK_WAIT_SECONDS=900

if [ "$TARGET" != "production" ] && [ "$TARGET" != "staging" ]; then
  echo "TARGET must be production or staging" >&2
  exit 2
fi
# A branch push must pass TARGET=staging. BRANCH_PUSH=1 refuses production.
if [ "${BRANCH_PUSH:-}" = "1" ] && [ "$TARGET" != "staging" ]; then
  echo "a branch push deploys staging only" >&2
  exit 1
fi

mkdir -p "$STATE" "$STATE/incoming"
if [ "$TARGET" = "staging" ]; then
  PREV_FILE="$STATE/current-staging-sha"
  SERVICE="staging"
  OVERLAP_SERVICE="staging_next"
  CANONICAL_NAME="clemson-rides-staging"
  OVERLAP_NAME="clemson-rides-staging-next"
  HEALTH_URL="http://127.0.0.1:3081/api/healthz"
  PUBLIC_HEALTH_URL="https://clemson-staging.srv1090862.hstgr.cloud/api/healthz"
  PROFILE_ARGS=(--profile staging)
else
  PREV_FILE="$STATE/current-sha"
  SERVICE="web"
  OVERLAP_SERVICE="web_next"
  CANONICAL_NAME="clemson-rides-web"
  OVERLAP_NAME="clemson-rides-web-next"
  HEALTH_URL="http://127.0.0.1:3080/api/healthz"
  PUBLIC_HEALTH_URL="https://clemsonrides.com/api/healthz"
  PROFILE_ARGS=()
fi

PREV=""
if [ -f "$PREV_FILE" ]; then
  PREV="$(tr -d '[:space:]' < "$PREV_FILE")"
fi

if [ -n "${COMPOSE_FILE:-}" ] && [ -f "$COMPOSE_FILE" ]; then
  COMPOSE="$COMPOSE_FILE"
else
  COMPOSE="$REPO/deploy/docker-compose.yml"
fi

compose() {
  docker compose -f "$COMPOSE" --project-name clemson-rides "$@"
}

compose_target() {
  if [ "${#PROFILE_ARGS[@]}" -eq 0 ]; then
    compose "$@"
  else
    compose "${PROFILE_ARGS[@]}" "$@"
  fi
}

container_running() {
  local name="$1"
  local state
  state="$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)"
  [ "$state" = "true" ]
}

container_on_network() {
  local name="$1"
  local json
  json="$(docker inspect -f '{{json .NetworkSettings.Networks}}' "$name" 2>/dev/null || true)"
  case "$json" in
    *"\"${CLEMSON_NETWORK}\""*) return 0 ;;
    *) return 1 ;;
  esac
}

health_status() {
  local name="$1"
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || echo missing
}

# A running container with no healthcheck is still a Traefik backend.
# Unhealthy and "starting" containers are filtered when allowEmptyServices is false.
container_is_routable() {
  local name="$1"
  local status
  container_running "$name" || return 1
  container_on_network "$name" || return 1
  status="$(health_status "$name")"
  [ "$status" = "healthy" ] || [ "$status" = "none" ]
}

container_sha_ok() {
  local name="$1"
  docker exec -e EXPECT_SHA="$TAG" "$name" \
    node -e 'fetch("http://127.0.0.1:3000/api/healthz").then(async (r)=>{const body=await r.json(); if(!r.ok || body.sha!==process.env.EXPECT_SHA) process.exit(1)}).catch(()=>process.exit(1))'
}

wait_container_sha() {
  local name="$1"
  local i status
  for i in $(seq 1 "$HEALTH_ATTEMPTS"); do
    status="$(health_status "$name")"
    if [ "$status" = "unhealthy" ]; then
      return 1
    fi
    # "none" is an image with no healthcheck. It can still be the rollback
    # target. Do not treat "starting" as ready: Traefik ignores it.
    if [ "$status" = "healthy" ] || [ "$status" = "none" ]; then
      if container_sha_ok "$name"; then
        return 0
      fi
    fi
    sleep "$HEALTH_SLEEP_SECONDS"
  done
  return 1
}

http_sha_ok() {
  local url="$1"
  local body
  body="$(curl -fsS --max-time 5 "$url" 2>/dev/null || true)"
  case "$body" in
    *"\"sha\":\"${TAG}\""*) return 0 ;;
    *) return 1 ;;
  esac
}

wait_http_sha() {
  local url="$1"
  local i
  for i in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if http_sha_ok "$url"; then
      return 0
    fi
    sleep "$HEALTH_SLEEP_SECONDS"
  done
  return 1
}

# new | old | traefik404 | none. Does not print the response body.
classify_public_health() {
  local body
  body="$(curl -sS --max-time 5 "$PUBLIC_HEALTH_URL" 2>/dev/null || true)"
  if [ -z "$body" ]; then
    printf '%s\n' none
    return 0
  fi
  case "$body" in
    *"\"sha\":\"${TAG}\""*) printf '%s\n' new ;;
    *'"sha":'*) printf '%s\n' old ;;
    *'404 page not found'*) printf '%s\n' traefik404 ;;
    *) printf '%s\n' none ;;
  esac
}

# 0 = Traefik is serving this sha
# 1 = Traefik answered with a different sha
# 2 = Traefik's own 404 (router missing)
# 3 = no answer (hairpin or TLS); not proof the router is down
wait_until_traefik_has_new_sha() {
  local i kind
  local saw_old=0
  local saw_down=0
  for i in $(seq 1 12); do
    kind="$(classify_public_health)"
    case "$kind" in
      new) return 0 ;;
      old) saw_old=1 ;;
      traefik404) saw_down=1 ;;
    esac
    sleep 1
  done
  if [ "$saw_down" = 1 ]; then
    return 2
  fi
  if [ "$saw_old" = 1 ]; then
    return 1
  fi
  return 3
}

remove_overlap() {
  if docker inspect "$OVERLAP_NAME" >/dev/null 2>&1; then
    docker rm -f "$OVERLAP_NAME" >/dev/null
  fi
}

acquire_deploy_lock() {
  local waited=0
  if ! command -v flock >/dev/null 2>&1; then
    echo "flock is required so production and staging deploys do not rewrite one checkout" >&2
    exit 1
  fi
  exec 9>"$STATE/deploy.lock"
  echo "waiting for the clemson-rides VPS deploy lock"
  while ! flock -n 9; do
    if [ "$waited" -ge "$LOCK_WAIT_SECONDS" ]; then
      echo "timed out waiting for the other clemson-rides deploy" >&2
      exit 1
    fi
    sleep 15
    waited=$((waited + 15))
    echo "still waiting for the other clemson-rides deploy (${waited}s)"
  done
  echo "acquired the clemson-rides VPS deploy lock"
}

sync_checkout() {
  if [ ! -f "$COMPOSE" ] && [ ! -d "$REPO/.git" ]; then
    mkdir -p "$(dirname "$REPO")"
    git clone --depth 1 https://github.com/ascendmaui/clemson-airport-rides.git "$REPO"
  fi
  if [ -d "$REPO/.git" ]; then
    if git -C "$REPO" fetch --depth 1 origin "$TAG" && git -C "$REPO" checkout --detach --force FETCH_HEAD; then
      :
    elif [ -f "$COMPOSE" ]; then
      echo "git checkout of $TAG failed; using the compose file already copied for this deploy" >&2
    else
      echo "git checkout of $TAG failed and no compose file is available" >&2
      exit 1
    fi
  fi
  if [ ! -f "$COMPOSE" ]; then
    echo "missing $COMPOSE" >&2
    exit 1
  fi
  if ! grep -q "container_name: ${OVERLAP_NAME}" "$COMPOSE"; then
    echo "compose file has no ${OVERLAP_NAME}; refusing a recreate that would drop the only Traefik backend" >&2
    exit 1
  fi
}

attach_when_healthy() {
  local name="$1"
  echo "holding ${name} off ${CLEMSON_NETWORK} until ${TAG} answers /api/healthz"
  docker network disconnect "$CLEMSON_NETWORK" "$name" >/dev/null 2>&1 || true
  if ! wait_container_sha "$name"; then
    return 1
  fi
  if ! container_on_network "$name"; then
    docker network connect "$CLEMSON_NETWORK" "$name" || return 1
  fi
  container_on_network "$name"
}

start_fresh_overlap() {
  if docker inspect "$OVERLAP_NAME" >/dev/null 2>&1; then
    docker rm -f "$OVERLAP_NAME" >/dev/null
  fi
  echo "starting ${OVERLAP_NAME} before recreating ${CANONICAL_NAME}"
  if ! compose_target --profile overlap up -d --no-build --no-deps --force-recreate "$OVERLAP_SERVICE"; then
    echo "could not start ${OVERLAP_NAME}; leaving ${CANONICAL_NAME} in place" >&2
    remove_overlap
    exit 1
  fi
  if ! attach_when_healthy "$OVERLAP_NAME"; then
    echo "overlap ${OVERLAP_NAME} did not become healthy at ${TAG}; leaving ${CANONICAL_NAME} in place" >&2
    remove_overlap
    exit 1
  fi
  echo "overlap ${OVERLAP_NAME} is healthy; waiting ${TRAEFIK_SETTLE_SECONDS}s for Traefik"
  sleep "$TRAEFIK_SETTLE_SECONDS"
}

# Returns 0 when it is safe to take the previous container off the network.
drain_decision() {
  local probe
  set +e
  wait_until_traefik_has_new_sha
  probe=$?
  set -e
  case "$probe" in
    0)
      echo "Traefik is serving ${TAG}"
      return 0
      ;;
    1)
      echo "Traefik is still serving the previous sha; waiting ${TRAEFIK_SETTLE_SECONDS}s"
      sleep "$TRAEFIK_SETTLE_SECONDS"
      set +e
      wait_until_traefik_has_new_sha
      probe=$?
      set -e
      if [ "$probe" -eq 0 ]; then
        echo "Traefik is serving ${TAG}"
        return 0
      fi
      echo "refusing to detach ${CANONICAL_NAME}: Traefik has not served ${TAG}" >&2
      return 1
      ;;
    2)
      echo "Traefik returned 404 page not found; not detaching ${CANONICAL_NAME}" >&2
      return 1
      ;;
    *)
      echo "public health URL did not answer from this host; continuing because ${OVERLAP_NAME} is healthy on ${CLEMSON_NETWORK}"
      return 0
      ;;
  esac
}

recreate_canonical() {
  echo "recreating ${CANONICAL_NAME}"
  # Called from `if !`, which disables set -e for this function on bash.
  if ! compose_target up -d --no-build --no-deps --force-recreate "$SERVICE"; then
    echo "compose up failed for ${SERVICE}" >&2
    return 1
  fi
  if ! attach_when_healthy "$CANONICAL_NAME"; then
    echo "${CANONICAL_NAME} did not become healthy at ${TAG}" >&2
    return 1
  fi
  echo "waiting ${TRAEFIK_SETTLE_SECONDS}s for Traefik to add ${CANONICAL_NAME}"
  sleep "$TRAEFIK_SETTLE_SECONDS"
  if ! wait_http_sha "$HEALTH_URL"; then
    echo "health check failed for ${TARGET} on ${HEALTH_URL}" >&2
    return 1
  fi
}

rollback_previous() {
  if [ -z "$PREV" ] || [ "$PREV" = "$TAG" ]; then
    echo "no previous SHA to roll back to" >&2
    return 1
  fi
  echo "rolling back to ${PREV}" >&2
  if [ "$TARGET" = "staging" ]; then
    docker tag "$IMAGE:$PREV" "$IMAGE:staging" || true
  else
    docker tag "$IMAGE:$PREV" "$IMAGE:prod" || true
  fi
  export IMAGE_TAG="$PREV"
  export STAGING_IMAGE_TAG="$PREV"
  TAG="$PREV"
  # Leave the rolled-back container on the network. Detaching it here would
  # take down the only backend if the health wait fails.
  compose_target up -d --no-build --no-deps --force-recreate "$SERVICE" || true
  wait_container_sha "$CANONICAL_NAME" || true
  if ! container_on_network "$CANONICAL_NAME"; then
    docker network connect "$CLEMSON_NETWORK" "$CANONICAL_NAME" || true
  fi
}

record_success() {
  printf '%s\n' "$TAG" > "$PREV_FILE"
  if [ -n "$PREV" ]; then
    if [ "$TARGET" = "staging" ]; then
      printf '%s\n' "$PREV" > "$STATE/previous-staging-sha"
    else
      printf '%s\n' "$PREV" > "$STATE/previous-sha"
    fi
  fi
}

prune_old_tags() {
  # Drop old tags of this image only. Always keep prod, staging, the SHAs
  # this deploy just ran, and whatever web/staging containers are running,
  # plus the five newest other tags. Never prune other projects.
  local container running running_tag kept_extra row tag
  declare -A keep=()
  keep[prod]=1
  keep[staging]=1
  keep["$TAG"]=1
  if [ -n "$PREV" ]; then keep["$PREV"]=1; fi
  for container in clemson-rides-web clemson-rides-web-next clemson-rides-staging clemson-rides-staging-next; do
    running="$(docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null || true)"
    running_tag="${running##*:}"
    if [ -n "$running_tag" ] && [ "$running_tag" != "$running" ]; then
      keep["$running_tag"]=1
    fi
  done
  kept_extra=0
  mapfile -t rows < <(docker images "$IMAGE" --format '{{.CreatedAt}}|{{.Tag}}' | sort -r)
  for row in "${rows[@]+"${rows[@]}"}"; do
    [ -n "$row" ] || continue
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
}

if [ -n "${GHCR_TOKEN:-}" ]; then
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-github}" --password-stdin >/dev/null
  unset GHCR_TOKEN
fi

export IMAGE_TAG="$TAG"
export STAGING_IMAGE_TAG="$TAG"
export CLEMSON_NETWORK="${CLEMSON_NETWORK:-clemson_rides_net}"
export TRAEFIK_ENTRYPOINT="${TRAEFIK_ENTRYPOINT:-websecure}"
export TRAEFIK_CERTRESOLVER="${TRAEFIK_CERTRESOLVER:-letsencrypt}"

acquire_deploy_lock
sync_checkout

compose_target pull "$SERVICE"

if container_is_routable "$CANONICAL_NAME"; then
  start_fresh_overlap
  if ! drain_decision; then
    remove_overlap
    exit 1
  fi
  echo "detaching ${CANONICAL_NAME} from ${CLEMSON_NETWORK} before recreate"
  docker network disconnect "$CLEMSON_NETWORK" "$CANONICAL_NAME" || true
  sleep 2
elif container_is_routable "$OVERLAP_NAME"; then
  echo "keeping ${OVERLAP_NAME}; ${CANONICAL_NAME} is not a healthy backend on ${CLEMSON_NETWORK}"
else
  echo "no healthy ${TARGET} backend yet; starting ${CANONICAL_NAME} without overlapping a previous container"
fi

if ! recreate_canonical; then
  if container_is_routable "$OVERLAP_NAME"; then
    echo "${OVERLAP_NAME} is still serving ${TAG}. ${CANONICAL_NAME} was not promoted. Not rolling the image back over that overlap container." >&2
    exit 1
  fi
  rollback_previous || true
  exit 1
fi

if container_is_routable "$CANONICAL_NAME"; then
  remove_overlap
else
  echo "keeping ${OVERLAP_NAME} because ${CANONICAL_NAME} is not routable" >&2
  exit 1
fi

record_success
prune_old_tags
echo "deployed ${TARGET} ${TAG}"
