#!/usr/bin/env bash
#
# Cold-machine first-run test, layer 1: the LCS image on a machine that has
# Docker and nothing else.
#
# The thing that makes a first run different is not the operating system, it is
# an empty Docker image cache. A developer machine has months of accumulated
# layers, so every "works here" is measured against a cache a new user does not
# have. This script runs LCS against a Docker daemon that has never pulled
# anything, so first-use pulls are real pulls.
#
# It does that with a nested daemon (docker:dind) rather than by pruning the
# host, so running it never destroys images you still want.
#
#   ./cold-image.sh tar      load lcs-image.tar, as the installers do
#   ./cold-image.sh build    build from this checkout, as a repo clone does
#   ./cold-image.sh pull     docker pull, as a published registry would
#
# Exit status is the number of failed checks.

set -uo pipefail

CHANNEL="${1:-tar}"
DAEMON="${COLD_DAEMON:-lcs-cold-daemon}"
CONTAINER='lcs'
IMAGE="${COLD_IMAGE:-mkarjun/lcs:latest}"
HOST_PORT="${COLD_HOST_PORT:-14566}"
# What the tar channel exports when it has to build the tar itself. This is the
# tag the local build produces; the bundle is made from it.
SOURCE_IMAGE="${COLD_SOURCE_IMAGE:-floci:full}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK_DIR="${COLD_WORK_DIR:-${TMPDIR:-/tmp}/lcs-coldstart}"
TAR="$WORK_DIR/lcs-image.tar"
REPORT="$WORK_DIR/cold-image-report.txt"

# Git Bash rewrites anything that looks like an absolute path before it reaches
# docker.exe, which turns /var/run/docker.sock into a Windows path. Every docker
# call below goes through these wrappers so the disabling is in one place.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'
C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_OFF=$'\033[0m'

FAILURES=0
CHECKS=0

step() { printf '\n%s==> %s%s\n' "$C_CYAN" "$1" "$C_OFF"; }
info() { printf '    %s\n' "$1"; }
dim()  { printf '    %s%s%s\n' "$C_DIM" "$1" "$C_OFF"; }
warn() { printf '    %s%s%s\n' "$C_YELLOW" "$1" "$C_OFF"; }

# A check that is recorded, not just printed. Anything asserted here is
# something a cold machine could plausibly get wrong.
pass() { CHECKS=$((CHECKS + 1)); printf '    %sPASS%s  %s\n' "$C_GREEN" "$C_OFF" "$1"; echo "PASS  $1" >>"$REPORT"; }
fail() { CHECKS=$((CHECKS + 1)); FAILURES=$((FAILURES + 1)); printf '    %sFAIL%s  %s\n' "$C_RED" "$C_OFF" "$1"; echo "FAIL  $1" >>"$REPORT"; }
note() { echo "NOTE  $1" >>"$REPORT"; dim "$1"; }

# docker against the host daemon; dind against the nested, cold one.
dind() { docker exec "$DAEMON" docker "$@"; }

seconds_since() { echo $(($(date +%s) - $1)); }

require_host_docker() {
    if ! docker info >/dev/null 2>&1; then
        printf '%sThe host Docker daemon is not responding; nothing to nest inside.%s\n' "$C_RED" "$C_OFF" >&2
        exit 1
    fi
}

# ── The cold daemon ───────────────────────────────────────────────────────────

start_cold_daemon() {
    step "Starting a Docker daemon with an empty cache"

    docker rm -f "$DAEMON" >/dev/null 2>&1

    # The host side is pinned to loopback deliberately. LCS has no
    # authentication and accepts any credentials, so a 0.0.0.0 publish would put
    # a fully drivable AWS emulator on the local network. Inside the nested
    # daemon the publish has to be 0.0.0.0, because the host mapping lands on
    # the dind container's interface rather than its loopback -- that one
    # deviation from a real first run is an artifact of nesting, not of LCS.
    if ! docker run -d --privileged --name "$DAEMON" \
        -p "127.0.0.1:${HOST_PORT}:4566" \
        -e DOCKER_TLS_CERTDIR= \
        docker:28-dind >/dev/null; then
        fail 'could not start the nested daemon'
        exit 1
    fi

    local waited=0
    until dind info >/dev/null 2>&1; do
        waited=$((waited + 1))
        if [[ $waited -gt 60 ]]; then
            fail 'the nested daemon never became ready'
            docker logs "$DAEMON" 2>&1 | tail -20
            exit 1
        fi
        sleep 1
    done

    local images
    images="$(dind images -q | wc -l | tr -d ' ')"
    if [[ "$images" == '0' ]]; then
        pass "nested daemon is up with an empty image cache (${waited}s)"
    else
        fail "nested daemon started with $images images already cached"
    fi
}

# ── Getting the image in, by channel ──────────────────────────────────────────

acquire_tar() {
    step "Channel: load $IMAGE from lcs-image.tar"

    if [[ ! -f "$TAR" ]]; then
        info "No tar yet; exporting $SOURCE_IMAGE the way make-bundle does."
        if ! docker image inspect "$SOURCE_IMAGE" >/dev/null 2>&1; then
            fail "no $SOURCE_IMAGE on the host to export; build it or set COLD_SOURCE_IMAGE"
            return 1
        fi
        # make-bundle.ps1 exports the launcher's tag, not the build tag, so the
        # tar a user receives already carries the name the launcher will run.
        docker tag "$SOURCE_IMAGE" "$IMAGE" || { fail 'could not tag the source image'; return 1; }
        docker save "$IMAGE" -o "$TAR" || { fail 'docker save failed'; return 1; }
    fi

    local size_mb start
    size_mb=$(( $(wc -c <"$TAR") / 1024 / 1024 ))
    info "lcs-image.tar is ${size_mb}MB"

    start=$(date +%s)
    if ! docker exec -i "$DAEMON" docker load <"$TAR" >/dev/null 2>&1; then
        fail 'docker load of lcs-image.tar failed'
        return 1
    fi
    pass "loaded lcs-image.tar into a cold daemon in $(seconds_since "$start")s"
    note "a cold install pays ${size_mb}MB of image load before anything starts"

    # The tar carries whatever tag it was saved under. The installers all run
    # lcs/lcs:merged, so a bundle whose tag does not match is a first-run
    # failure -- exactly the class of thing this test exists to catch.
    if dind image inspect "$IMAGE" >/dev/null 2>&1; then
        pass "the loaded image is tagged $IMAGE, which is what the launcher runs"
    else
        local loaded
        loaded="$(dind images --format '{{.Repository}}:{{.Tag}}' | head -1)"
        fail "the tar is tagged '$loaded' but every launcher defaults to '$IMAGE'"
        note "retagging locally so the rest of the run can proceed"
        dind tag "$loaded" "$IMAGE" >/dev/null 2>&1
    fi
}

acquire_build() {
    step "Channel: build $IMAGE from this checkout"

    local start
    start=$(date +%s)
    # The build context is the whole repo, which has to cross into the nested
    # daemon. Streaming a tar of the checkout is what a clone would have on disk.
    if ! (cd "$REPO_ROOT" && git archive --format=tar HEAD) \
        | docker exec -i "$DAEMON" docker build -f docker/Dockerfile -t "$IMAGE" - >/dev/null 2>&1; then
        fail 'docker build from a clean checkout failed'
        note 'this is the channel a "clone the repo" user takes; a failure here blocks that path'
        return 1
    fi
    pass "built $IMAGE from a clean checkout in $(seconds_since "$start")s"
}

acquire_pull() {
    step "Channel: docker pull $IMAGE"

    if dind pull "$IMAGE" >/dev/null 2>&1; then
        pass "pulled $IMAGE from a registry"
    else
        fail "docker pull $IMAGE failed -- no registry serves this tag"
        note 'the README Quick Start tells a cold user to run lcs/lcs:latest; nothing publishes it'
        return 1
    fi
}

# ── Running it the way the launcher does ──────────────────────────────────────

run_lcs() {
    step 'Starting LCS the way the launcher does'

    # Kept in step with tools/linux/lcs. The socket mount is what the
    # container-backed services need; -u root is what the launcher passes.
    if ! dind run -d \
        --name "$CONTAINER" \
        --restart unless-stopped \
        -p "0.0.0.0:4566:4566" \
        -e FLOCI_TLS_ENABLED=true \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -u root \
        "$IMAGE" >/dev/null 2>&1; then
        fail 'the LCS container would not start'
        dind logs "$CONTAINER" 2>&1 | tail -20
        return 1
    fi
    pass 'LCS container started'
}

wait_ready() {
    local budget="${COLD_READY_TIMEOUT:-300}"
    step "Waiting for a cold start to become usable (up to ${budget}s)"

    # Deadline is wall-clock. An earlier version counted loop iterations as if
    # each took a second; with two container round-trips per pass it gave up
    # long before the stated timeout and blamed the product for it.
    local start deadline console_at='' health_at='' host_at=''
    start=$(date +%s)
    deadline=$((start + budget))

    while [[ $(date +%s) -lt $deadline ]]; do
        # The image ships its own HEALTHCHECK (wget against /_floci/health).
        # Reading its verdict tests what Docker actually reports rather than a
        # probe of our own invention -- and the image has no curl, so a
        # curl-based probe silently never passes.
        if [[ -z "$health_at" ]] \
            && [[ "$(dind inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null)" == 'healthy' ]]; then
            health_at=$(seconds_since "$start")
        fi
        if [[ -z "$console_at" ]] \
            && dind exec "$CONTAINER" wget -q --spider http://localhost:4566/_lcs/ui/ >/dev/null 2>&1; then
            console_at=$(seconds_since "$start")
        fi
        # The published chain is what a browser uses, so it is asserted
        # separately from the in-container check.
        # Output is discarded with a shell redirect rather than `-o /dev/null`.
        # MSYS_NO_PATHCONV is set above so the Docker socket path survives, and
        # it also stops Git Bash rewriting /dev/null for curl's argument -- curl
        # then fails with a write error on every call and the wait looks like a
        # product hang.
        if [[ -z "$host_at" ]] \
            && curl -fsS --max-time 5 \
               "http://127.0.0.1:${HOST_PORT}/_lcs/ui/" >/dev/null 2>&1; then
            host_at=$(seconds_since "$start")
        fi

        [[ -n "$health_at" && -n "$console_at" && -n "$host_at" ]] && break

        if [[ "$(dind inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != 'true' ]]; then
            fail 'the LCS container exited during startup'
            dind logs "$CONTAINER" 2>&1 | tail -30
            return 1
        fi
        sleep 2
    done

    if [[ -n "$health_at" ]]; then
        pass "the image's own healthcheck reported healthy after ${health_at}s"
    else
        fail "the container never reported healthy within ${budget}s"
    fi

    if [[ -n "$console_at" ]]; then
        pass "console served inside the container after ${console_at}s"
    else
        fail "the console never answered inside the container within ${budget}s"
    fi

    if [[ -n "$host_at" ]]; then
        pass "console reachable from the host after ${host_at}s"
        note "cold time-to-console: ${host_at}s from docker run"
    else
        fail "the published port never answered from the host within ${budget}s"
    fi

    # The startup line the emulator prints is the product's own claim about when
    # it was ready; worth recording next to the measured numbers.
    local ready_line
    ready_line="$(dind logs "$CONTAINER" 2>&1 | grep -m1 'started in' | sed 's/.*floci/floci/')"
    [[ -n "$ready_line" ]] && note "emulator reports: $ready_line"

    [[ -z "$host_at" ]] && { dind logs "$CONTAINER" 2>&1 | tail -30; return 1; }
    return 0
}

# ── First use of the container-backed services ────────────────────────────────
#
# These are the services that start containers of their own. On a developer
# machine their backing images are already cached and first use looks instant.
# On a cold machine each one is a pull, and a wrong or unreachable tag only
# shows up here.

aws_in_cold() {
    dind run --rm --network container:"$CONTAINER" \
        -e AWS_ACCESS_KEY_ID=test \
        -e AWS_SECRET_ACCESS_KEY=test \
        -e AWS_DEFAULT_REGION=us-east-1 \
        -e AWS_ENDPOINT_URL=http://localhost:4566 \
        amazon/aws-cli:latest "$@" 2>&1
}

exercise_first_use() {
    step 'First use of the services that pull their own images'

    local before after start
    before="$(dind images --format '{{.Repository}}:{{.Tag}}' | sort)"

    start=$(date +%s)
    if dind pull amazon/aws-cli:latest >/dev/null 2>&1; then
        pass "pulled the AWS CLI image cold in $(seconds_since "$start")s"
    else
        fail 'could not pull amazon/aws-cli, which CloudShell also defaults to'
        return 1
    fi

    # S3 first, as the cheapest proof the signed-request path works at all.
    if aws_in_cold s3 mb s3://cold-start-check >/dev/null 2>&1; then
        pass 'S3 CreateBucket succeeded against a cold instance'
    else
        fail 'S3 CreateBucket failed against a cold instance'
    fi

    start=$(date +%s)
    if aws_in_cold dynamodb create-table \
        --table-name cold-check \
        --attribute-definitions AttributeName=pk,AttributeType=S \
        --key-schema AttributeName=pk,KeyType=HASH \
        --billing-mode PAY_PER_REQUEST >/dev/null 2>&1; then
        pass "DynamoDB CreateTable succeeded ($(seconds_since "$start")s)"
    else
        fail 'DynamoDB CreateTable failed against a cold instance'
    fi

    exercise_lambda

    after="$(dind images --format '{{.Repository}}:{{.Tag}}' | sort)"
    local pulled
    pulled="$(comm -13 <(echo "$before") <(echo "$after"))"
    if [[ -n "$pulled" ]]; then
        note 'images a cold machine had to pull during this run:'
        while IFS= read -r line; do [[ -n "$line" ]] && dim "  $line"; done <<<"$pulled"
    fi
}

# Lambda is the sharpest version of the cold-cache question: the first invoke
# has to pull a runtime image, and nothing on a developer machine ever shows
# that cost because the image is always already there.
exercise_lambda() {
    step 'Lambda: the first invoke on a machine with no runtime image cached'

    dind exec "$CONTAINER" true 2>/dev/null # no-op; keeps the daemon handle warm
    docker exec "$DAEMON" sh -c '
        mkdir -p /work && cd /work
        printf "def handler(event, context):\n    return {\"ok\": True}\n" > lambda_function.py
        command -v zip >/dev/null 2>&1 || apk add --no-cache zip >/dev/null 2>&1
        zip -q -o fn.zip lambda_function.py
    ' >/dev/null 2>&1

    if ! docker exec "$DAEMON" test -f /work/fn.zip 2>/dev/null; then
        fail 'could not build a Lambda deployment package inside the cold daemon'
        return 1
    fi

    if aws_in_cold_with_work lambda create-function \
        --function-name cold-fn --runtime python3.11 \
        --handler lambda_function.handler \
        --role arn:aws:iam::000000000000:role/lambda-role \
        --zip-file fileb:///work/fn.zip >/dev/null 2>&1; then
        pass 'Lambda CreateFunction succeeded on a cold instance'
    else
        fail 'Lambda CreateFunction failed on a cold instance'
        return 1
    fi

    local start cold warm
    start=$(date +%s)
    if aws_in_cold_with_work lambda invoke --function-name cold-fn /work/out.json >/dev/null 2>&1; then
        cold=$(seconds_since "$start")
        pass "first Lambda invoke succeeded in ${cold}s, pulling its runtime image"
    else
        fail 'the first Lambda invoke failed on a cold machine'
        return 1
    fi

    start=$(date +%s)
    if aws_in_cold_with_work lambda invoke --function-name cold-fn /work/out2.json >/dev/null 2>&1; then
        warm=$(seconds_since "$start")
        pass "second invoke took ${warm}s with the runtime image cached"
        note "Lambda first-invoke penalty on a cold machine: ${cold}s vs ${warm}s warm"
    fi
}

# Same as aws_in_cold, with /work mounted so a deployment package can be passed
# to the CLI as fileb://.
aws_in_cold_with_work() {
    dind run --rm --network container:"$CONTAINER" -v /work:/work \
        -e AWS_ACCESS_KEY_ID=test \
        -e AWS_SECRET_ACCESS_KEY=test \
        -e AWS_DEFAULT_REGION=us-east-1 \
        -e AWS_ENDPOINT_URL=http://localhost:4566 \
        amazon/aws-cli:latest "$@" 2>&1
}

report() {
    step 'Cold first-run summary'

    local disk
    disk="$(dind system df --format '{{.Type}} {{.Size}}' 2>/dev/null | tr '\n' '; ')"
    note "nested daemon disk after the run: $disk"

    printf '\n  %sChecks: %d, failures: %d%s\n' "$C_BOLD" "$CHECKS" "$FAILURES" "$C_OFF"
    printf '  %sFull report: %s%s\n\n' "$C_DIM" "$REPORT" "$C_OFF"

    if [[ $FAILURES -eq 0 ]]; then
        printf '  %sA machine with only Docker can run LCS through the %s channel.%s\n\n' \
            "$C_GREEN" "$CHANNEL" "$C_OFF"
    else
        printf '  %sA cold machine would hit %d failure(s) on the %s channel.%s\n\n' \
            "$C_RED" "$FAILURES" "$CHANNEL" "$C_OFF"
    fi
}

cleanup() {
    if [[ "${COLD_KEEP:-0}" == '1' ]]; then
        warn "Leaving $DAEMON running (COLD_KEEP=1). Remove it with: docker rm -f $DAEMON"
        return
    fi
    docker rm -f "$DAEMON" >/dev/null 2>&1
}

# ── Main ──────────────────────────────────────────────────────────────────────

require_host_docker
mkdir -p "$WORK_DIR"
: >"$REPORT"

printf '\n%s  LCS cold-machine first-run test - layer 1 (image on bare Docker)%s\n' "$C_BOLD" "$C_OFF"
printf '  %schannel: %s | image: %s | console: http://127.0.0.1:%s/_lcs/ui/%s\n' \
    "$C_DIM" "$CHANNEL" "$IMAGE" "$HOST_PORT" "$C_OFF"

trap cleanup EXIT

start_cold_daemon

case "$CHANNEL" in
    tar)   acquire_tar   || { report; exit $FAILURES; } ;;
    build) acquire_build || { report; exit $FAILURES; } ;;
    pull)  acquire_pull  || { report; exit $FAILURES; } ;;
    *)     echo "unknown channel '$CHANNEL' (expected tar, build or pull)" >&2; exit 2 ;;
esac

run_lcs   || { report; exit $FAILURES; }
wait_ready || { report; exit $FAILURES; }
exercise_first_use
report

exit $FAILURES
