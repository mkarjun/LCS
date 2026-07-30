#!/usr/bin/env bash
#
# Builds .deb and .rpm packages for the LCS launcher.
#
#   ./build-packages.sh              build whatever the host has tools for
#   ./build-packages.sh --deb
#   ./build-packages.sh --rpm
#
# The packages install the same payload as install-lcs.sh: the `lcs` CLI and a desktop
# entry. They differ in one deliberate way - they *declare* Docker as a dependency rather
# than installing it themselves.
#
# That is not a shortcut. A postinst script that adds third-party apt/dnf repositories and
# pulls packages is discouraged by both Debian and Fedora packaging policy: it runs as root
# at an unpredictable moment, it cannot prompt, and it leaves repository state behind that
# the package manager will not remove. Declaring the dependency lets apt and dnf resolve
# and remove Docker the way they resolve and remove everything else. Users who want the
# dependency installed for them should run install-lcs.sh instead.
#
# Build tools needed: dpkg-deb for .deb, rpmbuild for .rpm. Neither exists on Windows, so
# build these on Linux or in a container:
#
#   docker run --rm -v "$PWD:/w" -w /w debian:12 \
#     sh -c 'apt-get update -qq && apt-get install -y -qq dpkg-dev rpm && ./build-packages.sh'

set -euo pipefail

VERSION="${LCS_VERSION:-0.1.0}"
RELEASE="${LCS_RELEASE:-1}"
MAINTAINER="${LCS_MAINTAINER:-LCS maintainers <noreply@example.invalid>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"

BUILD_DEB=0
BUILD_RPM=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --deb) BUILD_DEB=1; shift ;;
        --rpm) BUILD_RPM=1; shift ;;
        -h|--help) sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option '$1'." >&2; exit 1 ;;
    esac
done

# No explicit choice: build what this host can.
if [[ "$BUILD_DEB" -eq 0 && "$BUILD_RPM" -eq 0 ]]; then
    command -v dpkg-deb >/dev/null 2>&1 && BUILD_DEB=1
    command -v rpmbuild >/dev/null 2>&1 && BUILD_RPM=1
    if [[ "$BUILD_DEB" -eq 0 && "$BUILD_RPM" -eq 0 ]]; then
        echo "Neither dpkg-deb nor rpmbuild is available. See the header for a container command." >&2
        exit 1
    fi
fi

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m    %s\033[0m\n' "$1"; }

[[ -f "$SCRIPT_DIR/lcs" ]] || { echo "Missing $SCRIPT_DIR/lcs." >&2; exit 1; }
mkdir -p "$DIST_DIR"

DESCRIPTION='AWS-compatible cloud emulator that runs locally.
 LCS emulates AWS services on your own machine and serves a web console at
 http://localhost:4566/_lcs/ui/. This package installs the lcs command, which
 manages the emulator container. The emulator image itself is pulled or loaded
 separately.'

# Shared payload, so the two package formats cannot drift apart.
stage_payload() {
    local root="$1"
    install -d -m 0755 "$root/usr/bin"
    install -m 0755 "$SCRIPT_DIR/lcs" "$root/usr/bin/lcs"

    install -d -m 0755 "$root/usr/share/applications"
    cat > "$root/usr/share/applications/lcs.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Start LCS
Comment=Local Cloud Services - AWS-compatible emulator
Exec=/usr/bin/lcs up
Icon=utilities-terminal
Terminal=true
Categories=Development;
Keywords=aws;cloud;emulator;localstack;
EOF
    chmod 0644 "$root/usr/share/applications/lcs.desktop"

    # Always written, never copied from the repository: rpmbuild's %files entry must match
    # something, and a build run outside a full checkout would otherwise leave the doc
    # directory empty and fail.
    install -d -m 0755 "$root/usr/share/doc/lcs"
    cat > "$root/usr/share/doc/lcs/README" <<EOF
LCS - Local Cloud Services ${VERSION}

An AWS-compatible cloud emulator that runs on your own machine.

    lcs up          start the emulator and open the console
    lcs down        stop it
    lcs status      show whether it is running
    lcs logs        follow the emulator log
    lcs console     open the console in a browser

Console     http://localhost:4566/_lcs/ui/
Endpoint    http://localhost:4566

Point the AWS CLI at it:

    aws --endpoint-url http://localhost:4566 s3 ls

Any credentials work; 'test' / 'test' is conventional.

LCS binds to 127.0.0.1 only. It has no authentication and accepts any
credentials, so do not publish it on an untrusted network. Override with
LCS_BIND if you understand the consequences.

This package installs the launcher only. Docker is a declared dependency, and
the emulator image is pulled or loaded separately:

    docker build -f docker/Dockerfile -t lcs/lcs:merged .
EOF
    chmod 0644 "$root/usr/share/doc/lcs/README"
}

build_deb() {
    step "Building lcs_${VERSION}-${RELEASE}_all.deb"
    local root
    root="$(mktemp -d)"
    trap 'rm -rf "$root"' RETURN

    stage_payload "$root"
    install -d -m 0755 "$root/DEBIAN"

    # docker.io | docker-ce covers both the Debian package and Docker's own, so the
    # dependency is satisfiable however the user got Docker.
    cat > "$root/DEBIAN/control" <<EOF
Package: lcs
Version: ${VERSION}-${RELEASE}
Section: devel
Priority: optional
Architecture: all
Depends: docker.io | docker-ce, curl
Recommends: xdg-utils
Maintainer: ${MAINTAINER}
Description: ${DESCRIPTION}
EOF

    # Nudges the user through the one step the package cannot do for them: docker group
    # membership needs a new login to take effect.
    cat > "$root/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = "configure" ]; then
    if ! id -nG "${SUDO_USER:-$USER}" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
        echo "lcs: add yourself to the 'docker' group, then log out and back in:"
        echo "         sudo usermod -aG docker \$USER"
    fi
    echo "lcs: start the emulator with 'lcs up'."
fi
exit 0
EOF
    chmod 0755 "$root/DEBIAN/postinst"

    local out="$DIST_DIR/lcs_${VERSION}-${RELEASE}_all.deb"
    dpkg-deb --build --root-owner-group "$root" "$out" >/dev/null
    ok "$out"
}

build_rpm() {
    step "Building lcs-${VERSION}-${RELEASE}.noarch.rpm"
    local top
    top="$(mktemp -d)"
    trap 'rm -rf "$top"' RETURN

    mkdir -p "$top"/{BUILD,RPMS,SOURCES,SPECS,BUILDROOT}
    local root="$top/BUILDROOT/lcs"
    stage_payload "$root"

    cat > "$top/SPECS/lcs.spec" <<EOF
Name:           lcs
Version:        ${VERSION}
Release:        ${RELEASE}
Summary:        AWS-compatible cloud emulator that runs locally
License:        MIT
BuildArch:      noarch
Requires:       (docker or docker-ce or moby-engine)
Requires:       curl
%{?systemd_requires}

%description
LCS emulates AWS services on your own machine and serves a web console at
http://localhost:4566/_lcs/ui/. This package installs the lcs command, which
manages the emulator container. The emulator image itself is pulled or loaded
separately.

%install
cp -a %{_sourcedir}/root/. %{buildroot}/

%files
%{_bindir}/lcs
%{_datadir}/applications/lcs.desktop
%dir %{_datadir}/doc/lcs
%{_datadir}/doc/lcs/*

%post
if ! id -nG "\${SUDO_USER:-\$USER}" 2>/dev/null | tr ' ' '\\n' | grep -qx docker; then
    echo "lcs: add yourself to the 'docker' group, then log out and back in:"
    echo "         sudo usermod -aG docker \\\$USER"
fi
echo "lcs: start the emulator with 'lcs up'."

%changelog
* Thu Jul 30 2026 ${MAINTAINER} - ${VERSION}-${RELEASE}
- Packaged the lcs launcher.
EOF

    mkdir -p "$top/SOURCES/root"
    cp -a "$root/." "$top/SOURCES/root/"

    rpmbuild --define "_topdir $top" -bb "$top/SPECS/lcs.spec" >/dev/null
    local built
    built="$(find "$top/RPMS" -name '*.rpm' -print -quit)"
    [[ -n "$built" ]] || { echo 'rpmbuild produced no package.' >&2; exit 1; }
    cp "$built" "$DIST_DIR/"
    ok "$DIST_DIR/$(basename "$built")"
}

[[ "$BUILD_DEB" -eq 1 ]] && build_deb
[[ "$BUILD_RPM" -eq 1 ]] && build_rpm

echo
echo "  Packages are in $DIST_DIR"
echo
echo "  Install:  sudo apt install ./dist/lcs_${VERSION}-${RELEASE}_all.deb"
echo "            sudo dnf install ./dist/lcs-${VERSION}-${RELEASE}.noarch.rpm"
echo
echo "  These declare Docker as a dependency rather than installing it. To have Docker"
echo "  installed for you, use install-lcs.sh instead."
