#!/usr/bin/env bash
#
# Cold-machine first-run test, layer 2: install-lcs.sh on a Linux box that has
# nothing installed.
#
# Each distro gets a privileged container built from a stock base image -- no
# Docker, no LCS, no configuration -- and the installer is run in it exactly as
# a new user would run it. Privileged is required because the installer's whole
# point is to install and use Docker, and a Docker daemon needs it.
#
#   ./cold-installer.sh              every distro, install-only
#   ./cold-installer.sh ubuntu       one distro
#   COLD_FULL=1 ./cold-installer.sh ubuntu
#                                    also load the image and run `lcs up`
#
# WHAT A CONTAINER CANNOT PROVE. Read this before treating a pass as coverage:
#
#   * systemd. Stock containers have no init, so `systemctl enable --now docker`
#     cannot work and the installer takes its documented warning path instead.
#     The daemon is started by hand here. On a real machine, whether Docker
#     comes back after a reboot is untested by this script.
#   * The docker group. The installer adds the invoking user to it and warns
#     that a re-login is needed. Containers run as root, which is already
#     allowed to use the socket, so that branch never fires and the re-login
#     experience is untested.
#   * The desktop entry. The file being written is asserted; whether a desktop
#     environment then shows "Start LCS" in its menu is not.
#   * Reboot survival, and --restart unless-stopped actually restarting.
#
# Exit status is the number of failed checks.

set -uo pipefail

DISTROS_ALL='ubuntu debian fedora arch'
REQUESTED="${1:-$DISTROS_ALL}"
FULL="${COLD_FULL:-0}"
# `docker cp` needs a source path the Windows docker.exe can open, and
# MSYS_NO_PATHCONV below stops Git Bash converting one for us. `pwd -W` yields
# the native form (C:/...) where it exists and is a no-op elsewhere, so the same
# path works on Linux and under Git Bash.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && { pwd -W 2>/dev/null || pwd; })"
WORK_DIR="${COLD_WORK_DIR:-${TMPDIR:-/tmp}/lcs-coldstart}"
TAR="$WORK_DIR/lcs-image.tar"
REPORT="$WORK_DIR/cold-installer-report.txt"
IMAGE="${COLD_IMAGE:-lcs/lcs:merged}"

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'
C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_OFF=$'\033[0m'

FAILURES=0
CHECKS=0
CURRENT=''

step() { printf '\n%s==> %s%s\n' "$C_CYAN" "$1" "$C_OFF"; }
info() { printf '    %s\n' "$1"; }
dim()  { printf '    %s%s%s\n' "$C_DIM" "$1" "$C_OFF"; }
warn() { printf '    %s%s%s\n' "$C_YELLOW" "$1" "$C_OFF"; }

pass() { CHECKS=$((CHECKS+1)); printf '    %sPASS%s  %s\n' "$C_GREEN" "$C_OFF" "$1"; echo "PASS  [$CURRENT] $1" >>"$REPORT"; }
fail() { CHECKS=$((CHECKS+1)); FAILURES=$((FAILURES+1)); printf '    %sFAIL%s  %s\n' "$C_RED" "$C_OFF" "$1"; echo "FAIL  [$CURRENT] $1" >>"$REPORT"; }
note() { echo "NOTE  [$CURRENT] $1" >>"$REPORT"; dim "$1"; }
gap()  { echo "GAP   [$CURRENT] $1" >>"$REPORT"; warn "untestable here: $1"; }

base_image_for() {
    case "$1" in
        ubuntu) echo 'ubuntu:22.04' ;;
        debian) echo 'debian:12' ;;
        fedora) echo 'fedora:41' ;;
        arch)   echo 'archlinux:latest' ;;
        *)      echo '' ;;
    esac
}

# The stock images are deliberately minimal; the installer needs a shell,
# curl and sudo-or-root to do its job. Installing those first is not cheating:
# it is the baseline any real distro install already has.
bootstrap_for() {
    case "$1" in
        ubuntu|debian) echo 'apt-get update -qq && apt-get install -y -qq curl ca-certificates procps >/dev/null 2>&1' ;;
        fedora)        echo 'dnf install -y -q curl ca-certificates procps-ng >/dev/null 2>&1' ;;
        arch)          echo 'pacman -Sy --noconfirm --quiet curl ca-certificates procps-ng >/dev/null 2>&1' ;;
    esac
}

cname() { echo "lcs-cold-inst-$1"; }

run_distro() {
    local distro="$1"
    CURRENT="$distro"
    local base container
    base="$(base_image_for "$distro")"
    container="$(cname "$distro")"

    step "$distro - a machine with nothing installed ($base)"

    if [[ -z "$base" ]]; then
        fail "no base image mapped for '$distro'"
        return
    fi

    docker rm -f "$container" >/dev/null 2>&1
    # /var/lib/docker gets its own volume. Without it the inner dockerd tries to
    # stack overlay2 on the container's own overlay filesystem, and every
    # `docker run` inside fails with "mount: invalid argument" -- a property of
    # the test rig that looks exactly like a broken launcher.
    if ! docker run -d --privileged --name "$container" \
        -v "/var/lib/docker" \
        "$base" sleep infinity >/dev/null 2>&1; then
        fail "could not start a $base container"
        return
    fi

    # Prove the starting point really is bare. If docker were somehow already
    # present the whole run would be measuring the wrong thing.
    if docker exec "$container" sh -c 'command -v docker' >/dev/null 2>&1; then
        fail 'the base image already has docker; this is not a cold machine'
        docker rm -f "$container" >/dev/null 2>&1
        return
    fi
    pass 'starting from a base image with no docker'

    info 'installing curl/ca-certificates so the installer has its baseline...'
    docker exec "$container" sh -c "$(bootstrap_for "$distro")" >/dev/null 2>&1

    # Everything the installer expects to find beside itself. Staging failures
    # are reported here rather than swallowed: a copy that silently does nothing
    # shows up later as five unrelated-looking failures.
    docker exec "$container" mkdir -p /opt/lcs-install >/dev/null 2>&1
    local staged=1
    docker cp "$REPO_ROOT/tools/linux/install-lcs.sh" "$container:/opt/lcs-install/install-lcs.sh" >/dev/null 2>&1 || staged=0
    docker cp "$REPO_ROOT/tools/linux/lcs" "$container:/opt/lcs-install/lcs" >/dev/null 2>&1 || staged=0
    if ! docker exec "$container" test -f /opt/lcs-install/install-lcs.sh 2>/dev/null; then
        staged=0
    fi
    if [[ "$staged" == '0' ]]; then
        fail "could not stage the installer into the container from $REPO_ROOT"
        docker rm -f "$container" >/dev/null 2>&1
        return
    fi

    local with_image=0
    if [[ "$FULL" == '1' && -f "$TAR" ]]; then
        info "copying lcs-image.tar in (this is the bundled-installer channel)..."
        docker cp "$TAR" "$container:/opt/lcs-install/lcs-image.tar" >/dev/null 2>&1 && with_image=1
    fi

    # --no-start because there is no init to bring the daemon up; starting is
    # driven explicitly below so a failure there is attributable.
    info 'running install-lcs.sh --yes --no-start (installs Docker from the distro repos)...'
    local out rc start
    start=$(date +%s)
    out="$(docker exec "$container" bash /opt/lcs-install/install-lcs.sh --yes --no-start 2>&1)"
    rc=$?
    local elapsed=$(($(date +%s) - start))

    echo "$out" >"$WORK_DIR/installer-$distro.log"

    if [[ $rc -eq 0 ]]; then
        pass "the installer ran to completion in ${elapsed}s (exit 0)"
    else
        fail "the installer exited $rc"
        echo "$out" | tail -15 | while IFS= read -r l; do dim "  $l"; done
    fi

    # Distro detection is the branch most likely to be wrong on a machine the
    # author never tried, so assert it named the right one.
    if echo "$out" | grep -qiE "$distro|$(base_image_for "$distro" | cut -d: -f1)"; then
        pass 'the installer identified the distribution'
        dim "$(echo "$out" | grep -iE 'package manager' | head -1 | sed 's/^ *//')"
    else
        fail 'the installer did not name this distribution in its machine check'
    fi

    if docker exec "$container" sh -c 'command -v docker' >/dev/null 2>&1; then
        pass "Docker was installed by the installer ($(docker exec "$container" docker --version 2>/dev/null | head -1))"
    else
        fail 'Docker was not installed'
    fi

    if docker exec "$container" test -x /usr/local/bin/lcs 2>/dev/null; then
        pass 'the lcs launcher is installed at /usr/local/bin/lcs'
    else
        fail 'the lcs launcher was not installed to /usr/local/bin/lcs'
    fi

    # Per-user, under $HOME -- not /usr/share/applications.
    if docker exec "$container" sh -c 'test -f "$HOME/.local/share/applications/lcs.desktop"' 2>/dev/null; then
        pass 'the desktop entry was written to ~/.local/share/applications'
    else
        fail 'the desktop entry was not written'
    fi

    if [[ "$with_image" == '0' ]]; then
        # The path a user takes when they run the bare script with no bundle.
        # It must fail informatively rather than silently.
        if echo "$out" | grep -q 'not present, and no lcs-image.tar'; then
            pass 'with no image and no tar, the installer says so instead of failing silently'
        else
            fail 'the missing-image path did not produce its documented warning'
        fi
    fi

    gap 'systemctl enable --now docker (no init in a container)'
    gap 'docker-group membership and the re-login it requires (running as root)'
    gap 'whether a desktop environment shows the menu entry'
    gap 'reboot survival and --restart unless-stopped'

    if [[ "$FULL" == '1' ]]; then
        full_run "$distro" "$container" "$with_image"
    fi

    docker rm -f "$container" >/dev/null 2>&1
}

# Starting the daemon by hand stands in for the systemd unit the installer
# would have enabled. Everything after that point is the real launcher.
full_run() {
    local distro="$1" container="$2" with_image="$3"
    step "$distro - starting the daemon by hand and running the launcher"

    docker exec -d "$container" sh -c 'dockerd >/var/log/dockerd.log 2>&1' >/dev/null 2>&1
    local waited=0
    until docker exec "$container" docker info >/dev/null 2>&1; do
        waited=$((waited+1))
        if [[ $waited -gt 45 ]]; then
            fail 'dockerd never came up inside the container'
            docker exec "$container" tail -15 /var/log/dockerd.log 2>&1 | while IFS= read -r l; do dim "  $l"; done
            return
        fi
        sleep 1
    done
    pass "dockerd started inside the container (${waited}s, started manually - no systemd here)"

    if [[ "$with_image" == '1' ]]; then
        info 'loading lcs-image.tar the way the installer would have...'
        if docker exec "$container" docker load -i /opt/lcs-install/lcs-image.tar >/dev/null 2>&1; then
            pass 'lcs-image.tar loaded'
        else
            fail 'lcs-image.tar failed to load'
            return
        fi

        if ! docker exec "$container" docker image inspect "$IMAGE" >/dev/null 2>&1; then
            fail "the loaded image is not tagged $IMAGE, which is what the launcher runs"
            return
        fi

        info 'running: lcs up'
        local up rc
        up="$(docker exec "$container" /usr/local/bin/lcs up 2>&1)"
        rc=$?
        echo "$up" >"$WORK_DIR/lcs-up-$distro.log"
        if [[ $rc -eq 0 ]]; then
            pass 'lcs up succeeded end to end on a machine that started with nothing'
        else
            fail "lcs up exited $rc"
            echo "$up" | tail -12 | while IFS= read -r l; do dim "  $l"; done
        fi

        if docker exec "$container" sh -c \
            'command -v curl >/dev/null && curl -fsS -o /dev/null --max-time 5 http://localhost:4566/_lcs/ui/' >/dev/null 2>&1; then
            pass 'the console answers after lcs up'
        else
            fail 'the console did not answer after lcs up'
        fi

        # `lcs status` prints a docker ps table and then either "Console
        # answering" or "not answering yet". Matching on a loose running|up|ready
        # alternation passed even when nothing was running, because those words
        # appear in the not-running advice too. Assert the success line.
        local status
        status="$(docker exec "$container" /usr/local/bin/lcs status 2>&1)"
        if echo "$status" | grep -q 'Console answering'; then
            pass 'lcs status reports the console answering'
        elif echo "$status" | grep -q 'LCS is not running'; then
            fail 'lcs status reports LCS is not running'
        else
            fail 'lcs status did not confirm the console is answering'
            echo "$status" | tail -6 | while IFS= read -r l; do dim "  $l"; done
        fi

        docker exec "$container" /usr/local/bin/lcs down >/dev/null 2>&1
    else
        note 'no image tar available, so the launcher was not exercised'
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

if ! docker info >/dev/null 2>&1; then
    echo 'The host Docker daemon is not responding.' >&2
    exit 1
fi

mkdir -p "$WORK_DIR"
: >"$REPORT"

printf '\n%s  LCS cold-machine first-run test - layer 2 (install-lcs.sh on a bare OS)%s\n' "$C_BOLD" "$C_OFF"
printf '  %sdistros: %s | full run: %s%s\n' "$C_DIM" "$REQUESTED" "$FULL" "$C_OFF"

for d in $REQUESTED; do
    run_distro "$d"
done

CURRENT='summary'
step 'Cold installer summary'
printf '\n  %sChecks: %d, failures: %d%s\n' "$C_BOLD" "$CHECKS" "$FAILURES" "$C_OFF"
printf '  %sPer-distro logs and the full report: %s%s\n\n' "$C_DIM" "$WORK_DIR" "$C_OFF"
warn 'Container coverage only. The systemd, docker-group, desktop-menu and reboot'
warn 'paths are listed as GAP lines in the report and still need a real machine.'
echo

exit $FAILURES
