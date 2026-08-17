#!/usr/bin/env bash
#
# LCS installer for Linux.
#
# Installs Docker Engine if it is missing, then the lcs launcher, a desktop entry, and
# starts LCS.
#
#   ./install-lcs.sh                    interactive
#   ./install-lcs.sh --yes              unattended
#   curl -fsSL <url>/install-lcs.sh | bash -s -- --yes
#
# Docker comes from the distribution's own repository where one exists, with the official
# Docker repository as the fallback. Both are GPG-verified by the package manager, which is
# why this never pipes a remote script into a shell.
#
# Options:
#   --yes, -y            skip the confirmation screen
#   --skip-docker        fail rather than install Docker
#   --no-start           install but do not start LCS
#   --prefix <dir>       install root (default /usr/local, or ~/.local without root)
#   --image <tag>        LCS image (default lcs/lcs:merged)

set -euo pipefail

ASSUME_YES=0
SKIP_DOCKER=0
NO_START=0
PREFIX=''
IMAGE='lcs/lcs:merged'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -t 1 ]]; then
    C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
    C_RED=$'\033[31m'; C_DIM=$'\033[90m'; C_BOLD=$'\033[1m'; C_OFF=$'\033[0m'
else
    C_CYAN=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_DIM=''; C_BOLD=''; C_OFF=''
fi

step() { printf '%s==> %s%s\n' "$C_CYAN" "$1" "$C_OFF"; }
ok()   { printf '%s    %s%s\n' "$C_GREEN" "$1" "$C_OFF"; }
info() { printf '    %s\n' "$1"; }
warn() { printf '%s    %s%s\n' "$C_YELLOW" "$1" "$C_OFF"; }
err()  { printf '%s    %s%s\n' "$C_RED" "$1" "$C_OFF" >&2; }
die()  { err "$1"; exit 1; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --yes|-y)     ASSUME_YES=1; shift ;;
        --skip-docker) SKIP_DOCKER=1; shift ;;
        --no-start)   NO_START=1; shift ;;
        --prefix)     PREFIX="$2"; shift 2 ;;
        --image)      IMAGE="$2"; shift 2 ;;
        -h|--help)    sed -n '3,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *)            die "Unknown option '$1'. Try --help." ;;
    esac
done

# ── Environment ───────────────────────────────────────────────────────────────

# $USER is set by login shells, and this script runs in plenty of things that are not
# one: `curl | bash` from cloud-init, a provisioning step, a container. With `set -u`
# an unset $USER aborted the run at the plan screen, before anything was installed --
# which is to say the documented unattended install could not work.
USER="${USER:-$(id -un)}"

# sudo is only ever used for the package manager and the docker group. Everything else
# runs as the invoking user, so the launcher and desktop entry land in the right home.
SUDO=''
if [[ "$(id -u)" -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
        SUDO='sudo'
    fi
fi

if [[ -z "$PREFIX" ]]; then
    if [[ "$(id -u)" -eq 0 || -n "$SUDO" ]]; then
        PREFIX='/usr/local'
    else
        # No root and no sudo: fall back to a per-user install that still puts `lcs` on
        # PATH for most shells.
        PREFIX="$HOME/.local"
    fi
fi

BIN_DIR="$PREFIX/bin"

detect_distro() {
    if [[ -r /etc/os-release ]]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        DISTRO_ID="${ID:-unknown}"
        DISTRO_LIKE="${ID_LIKE:-}"
        DISTRO_NAME="${PRETTY_NAME:-$DISTRO_ID}"
        DISTRO_CODENAME="${VERSION_CODENAME:-}"
    else
        DISTRO_ID='unknown'; DISTRO_LIKE=''; DISTRO_NAME='unknown Linux'; DISTRO_CODENAME=''
    fi

    case " $DISTRO_ID $DISTRO_LIKE " in
        *' debian '*|*' ubuntu '*)               PKG='apt' ;;
        *' fedora '*|*' rhel '*|*' centos '*)    PKG=$(command -v dnf >/dev/null 2>&1 && echo dnf || echo yum) ;;
        *' suse '*|*' opensuse '*)               PKG='zypper' ;;
        *' arch '*)                              PKG='pacman' ;;
        *)
            # ID_LIKE is absent on some derivatives; fall back to whatever is installed.
            for candidate in apt dnf yum zypper pacman; do
                if command -v "$candidate" >/dev/null 2>&1; then PKG="$candidate"; break; fi
            done
            PKG="${PKG:-unknown}"
            ;;
    esac
}

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)  ARCH='amd64' ;;
        aarch64|arm64) ARCH='arm64' ;;
        *)             die "Unsupported architecture '$(uname -m)'. LCS needs x86_64 or aarch64." ;;
    esac
}

docker_installed() { command -v docker >/dev/null 2>&1; }
docker_running()   { docker info >/dev/null 2>&1; }

# ── Consent ───────────────────────────────────────────────────────────────────

show_plan() {
    local needs_docker=$1

    echo
    printf '%s  This installer will:%s\n' "$C_BOLD" "$C_OFF"
    echo
    if [[ "$needs_docker" -eq 1 ]]; then
        echo "   * Install Docker Engine using $PKG, from the distribution's repository"
        echo "     (or Docker's official repository if the distribution has no package)."
        printf '%s     Needs root via sudo. Packages are GPG-verified by %s.%s\n' "$C_DIM" "$PKG" "$C_OFF"
        echo "   * Add $USER to the 'docker' group so Docker works without sudo."
        printf '%s     Membership of that group is equivalent to root on this machine.%s\n' "$C_DIM" "$C_OFF"
        echo '   * Enable and start the docker service.'
    else
        echo '   * Nothing: Docker is already installed.'
    fi
    echo "   * Install the 'lcs' launcher to $BIN_DIR."
    echo '   * Add an application menu entry.'
    echo '   * Start LCS, listening on 127.0.0.1:4566 only.'
    echo
    printf '%s  It changes no other system setting and installs nothing else.%s\n' "$C_DIM" "$C_OFF"
    echo

    [[ "$ASSUME_YES" -eq 1 ]] && return 0

    # With `curl | bash` stdin is the script, so the prompt has to read the terminal
    # directly or it would consume the rest of the script and answer itself.
    local answer=''
    if [[ -r /dev/tty ]]; then
        printf '  Continue? [Y/n] '
        read -r answer </dev/tty || answer=''
    else
        warn 'No terminal available for the prompt; re-run with --yes to install unattended.'
        exit 2
    fi

    case "${answer,,}" in
        ''|y|yes) return 0 ;;
        *)        warn 'Cancelled. Nothing was changed.'; exit 2 ;;
    esac
}

# ── Docker ────────────────────────────────────────────────────────────────────

install_docker() {
    step 'Installing Docker Engine'
    [[ -n "$SUDO" || "$(id -u)" -eq 0 ]] || die \
"Installing Docker needs root, and sudo is not available.
    Install Docker yourself (https://docs.docker.com/engine/install/) then re-run with --skip-docker."

    case "$PKG" in
        apt)     install_docker_apt ;;
        dnf|yum) install_docker_rpm ;;
        zypper)  $SUDO zypper --non-interactive install docker docker-compose ;;
        pacman)  $SUDO pacman -Sy --noconfirm docker docker-compose ;;
        *)       die "No package manager found that this installer knows how to drive. Install Docker from https://docs.docker.com/engine/install/ then re-run with --skip-docker." ;;
    esac

    enable_docker_service
    add_docker_group
}

install_docker_apt() {
    export DEBIAN_FRONTEND=noninteractive
    $SUDO apt-get update -qq

    # docker.io is Debian/Ubuntu's own package: no third-party repository, and it tracks
    # the distribution's security updates. Good enough for an emulator host.
    if apt-cache show docker.io >/dev/null 2>&1; then
        info 'Using the distribution package (docker.io).'
        $SUDO apt-get install -y -qq docker.io
        return
    fi

    info "Distribution has no docker.io; adding Docker's official repository."
    $SUDO apt-get install -y -qq ca-certificates curl gnupg
    $SUDO install -m 0755 -d /etc/apt/keyrings

    local repo_id="$DISTRO_ID"
    case " $DISTRO_LIKE " in *' ubuntu '*) repo_id='ubuntu' ;; *' debian '*) repo_id='debian' ;; esac
    [[ "$repo_id" == 'debian' || "$repo_id" == 'ubuntu' ]] || repo_id='debian'

    curl -fsSL "https://download.docker.com/linux/${repo_id}/gpg" \
        | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    $SUDO chmod a+r /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${repo_id} ${DISTRO_CODENAME} stable" \
        | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null

    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq docker-ce docker-ce-cli containerd.io
}

install_docker_rpm() {
    if $PKG list --available docker >/dev/null 2>&1 || $PKG info docker >/dev/null 2>&1; then
        info 'Using the distribution package (docker).'
        $SUDO $PKG install -y docker
        return
    fi

    info "Distribution has no docker package; adding Docker's official repository."
    $SUDO $PKG install -y dnf-plugins-core || true
    local repo_id='fedora'
    case " $DISTRO_ID $DISTRO_LIKE " in *' rhel '*|*' centos '*) repo_id='centos' ;; esac
    $SUDO $PKG config-manager --add-repo "https://download.docker.com/linux/${repo_id}/docker-ce.repo"
    $SUDO $PKG install -y docker-ce docker-ce-cli containerd.io
}

enable_docker_service() {
    if command -v systemctl >/dev/null 2>&1; then
        $SUDO systemctl enable --now docker >/dev/null 2>&1 || \
            warn 'Could not enable the docker service; start it yourself with: sudo systemctl start docker'
        ok 'Docker service enabled.'
    else
        warn 'No systemd here; start the Docker daemon however this system does it.'
    fi
}

add_docker_group() {
    if id -nG "$USER" | tr ' ' '\n' | grep -qx docker; then
        ok "$USER is already in the 'docker' group."
        return
    fi
    $SUDO groupadd -f docker
    $SUDO usermod -aG docker "$USER"
    ok "Added $USER to the 'docker' group."
    # The new group only applies to new logins, so this run still needs sudo for docker.
    NEEDS_RELOGIN=1
}

# ── LCS ───────────────────────────────────────────────────────────────────────

install_launcher() {
    step "Installing the launcher to $BIN_DIR"

    local source="$SCRIPT_DIR/lcs"
    [[ -f "$source" ]] || die "Cannot find the 'lcs' script next to this installer ($SCRIPT_DIR)."

    if [[ "$BIN_DIR" == "$HOME"/* ]]; then
        mkdir -p "$BIN_DIR"
        install -m 0755 "$source" "$BIN_DIR/lcs"
    else
        $SUDO install -d -m 0755 "$BIN_DIR"
        $SUDO install -m 0755 "$source" "$BIN_DIR/lcs"
    fi
    ok "$BIN_DIR/lcs"

    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        warn "$BIN_DIR is not on your PATH. Add it:"
        warn "    echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.profile"
    fi
}

install_desktop_entry() {
    step 'Adding an application menu entry'
    local dir="$HOME/.local/share/applications"
    mkdir -p "$dir"

    # Terminal=true so the readiness output and any error are visible; a silent launcher
    # that fails looks identical to one that worked.
    cat > "$dir/lcs.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Start LCS
Comment=Local Cloud Services - AWS-compatible emulator
Exec=$BIN_DIR/lcs up
Icon=utilities-terminal
Terminal=true
Categories=Development;
Keywords=aws;cloud;emulator;localstack;
EOF
    chmod 0644 "$dir/lcs.desktop"
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$dir" 2>/dev/null || true
    ok 'Applications > Start LCS'
}

install_image() {
    step "Checking for the $IMAGE image"

    local docker_cmd='docker'
    [[ "${NEEDS_RELOGIN:-0}" -eq 1 ]] && docker_cmd="$SUDO docker"

    if $docker_cmd image inspect "$IMAGE" >/dev/null 2>&1; then
        ok 'Already present.'
        return 0
    fi

    local tar="$SCRIPT_DIR/lcs-image.tar"
    if [[ -f "$tar" ]]; then
        info "Loading $tar - this takes a minute."
        $docker_cmd load -i "$tar"
        ok 'Image loaded.'
        return 0
    fi

    warn "Image '$IMAGE' is not present, and no lcs-image.tar beside this installer."
    warn 'Build it from a checkout of the LCS repository:'
    warn "    docker build -f docker/Dockerfile -t $IMAGE ."
    warn 'Everything else is installed; LCS will start once the image exists.'
    return 1
}

summary() {
    local have_image=$1
    cat <<EOF

  ${C_GREEN}Installed.${C_OFF}

  Start        lcs up
  Also         lcs down | lcs status | lcs logs | lcs console
  Menu         Applications > Start LCS

  Console      http://localhost:4566/_lcs/ui/
  Endpoint     http://localhost:4566

${C_DIM}  Bound to 127.0.0.1 only. LCS accepts any credentials and has no
  authentication, so it is not exposed to your network by default.${C_OFF}
EOF
    [[ "$have_image" -eq 0 ]] || { echo; warn 'The LCS image is still missing - see the note above.'; }
    if [[ "${NEEDS_RELOGIN:-0}" -eq 1 ]]; then
        echo
        warn "Log out and back in before running 'lcs' - the 'docker' group applies to new logins only."
    fi
    echo
}

# ── Main ──────────────────────────────────────────────────────────────────────

printf '\n%s  LCS - Local Cloud Services%s\n' "$C_BOLD" "$C_OFF"
echo '  An AWS-compatible emulator that runs on your own machine.'
echo '  --------------------------------------------------------'

detect_distro
detect_arch
step 'Checking this machine'
info "$DISTRO_NAME ($ARCH, package manager: $PKG)"

NEEDS_DOCKER=0
if docker_installed; then
    ok "Docker already installed ($(docker --version 2>/dev/null || echo 'version unknown'))."
else
    NEEDS_DOCKER=1
fi

if [[ "$NEEDS_DOCKER" -eq 1 && "$SKIP_DOCKER" -eq 1 ]]; then
    die 'Docker is not installed and --skip-docker was given.'
fi

show_plan "$NEEDS_DOCKER"

[[ "$NEEDS_DOCKER" -eq 1 ]] && install_docker

if ! docker_running && [[ "${NEEDS_RELOGIN:-0}" -ne 1 ]]; then
    warn 'The Docker daemon is not responding yet.'
    if command -v systemctl >/dev/null 2>&1; then
        $SUDO systemctl start docker >/dev/null 2>&1 || true
    fi
fi

install_launcher
install_desktop_entry

HAVE_IMAGE=0
install_image || HAVE_IMAGE=1

summary "$HAVE_IMAGE"

if [[ "$HAVE_IMAGE" -eq 0 && "$NO_START" -eq 0 && "${NEEDS_RELOGIN:-0}" -ne 1 ]]; then
    step 'Starting LCS'
    "$BIN_DIR/lcs" up
fi
