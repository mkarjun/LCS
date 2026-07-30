# Linux launcher, installer, and packages

Two ways in: a universal installer that sets up Docker for you, or native packages that
declare Docker as a dependency.

| File | Role |
|---|---|
| `install-lcs.sh` | Universal installer. Installs Docker Engine, the `lcs` command, a menu entry, and starts LCS. |
| `lcs` | The launcher, installed to `$PREFIX/bin/lcs`. Twin of `tools/windows/lcs.ps1`. |
| `build-packages.sh` | Builds `.deb` and `.rpm`. |

## Installing

```bash
./install-lcs.sh            # interactive
./install-lcs.sh --yes      # unattended
```

Options: `--yes`, `--skip-docker`, `--no-start`, `--prefix <dir>`, `--image <tag>`.

Tested on Debian 12, Ubuntu 24.04, Fedora 40, Arch, and openSUSE Leap 15.6.

### What it does

1. Detects the distribution, package manager, and architecture (x86_64 or aarch64).
2. Shows every change it will make and asks once. `--yes` skips the prompt.
3. Installs Docker Engine — the distribution's own package where one exists
   (`docker.io`, `docker`), otherwise Docker's official repository with its GPG key. Both
   are verified by the package manager, which is why this never pipes a remote script into
   a shell.
4. Enables the `docker` service and adds you to the `docker` group.
5. Installs `lcs` to `/usr/local/bin` (or `~/.local/bin` without root) and a
   `.desktop` entry.
6. Starts LCS.

`sudo` is used only for the package manager and the group change. Everything else runs as
you, so the launcher and menu entry land in the right home directory.

> Membership of the `docker` group is equivalent to root on the machine. The installer says
> so before adding you. It only takes effect on your next login, and the installer tells
> you when that applies.

## Packages

```bash
sudo apt install ./dist/lcs_0.1.0-1_all.deb
sudo dnf install ./dist/lcs-0.1.0-1.noarch.rpm
```

These install the same launcher and menu entry, but **declare** Docker rather than
installing it (`docker.io | docker-ce` on Debian, `(docker or docker-ce or moby-engine)` on
RPM). That is deliberate: a `postinst` that adds third-party repositories and pulls
packages is discouraged by both Debian and Fedora packaging policy — it runs as root at an
unpredictable moment, cannot prompt, and leaves repository state the package manager will
not remove. Declaring the dependency lets apt and dnf resolve and remove Docker normally.

Use `install-lcs.sh` if you want Docker installed for you.

### Building

Needs `dpkg-deb` and `rpmbuild`, so build on Linux or in a container:

```bash
docker run --rm -v "$PWD:/w" -w /w debian:12 \
  sh -c 'apt-get update -qq && apt-get install -y -qq dpkg-dev rpm && ./build-packages.sh'
```

Version and maintainer come from `LCS_VERSION`, `LCS_RELEASE`, and `LCS_MAINTAINER`.

## Running LCS

```bash
lcs             # or: lcs up
lcs status
lcs down
lcs restart
lcs logs
lcs console
```

Configured with environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `LCS_IMAGE` | `lcs/lcs:merged` | Image to run |
| `LCS_PORT` | `4566` | Host port |
| `LCS_BIND` | `127.0.0.1` | Host interface |
| `LCS_DATA` | *(unset)* | Bind-mount for `/app/data`, enabling persistence |
| `LCS_DB_PORTS` | *(unset)* | Range to publish for RDS, e.g. `7000-7019` |
| `LCS_TIMEOUT` | `120` | Seconds to wait for readiness |

Two container flags are always applied and are the reason this script exists:

| Flag | Why |
|---|---|
| `-e FLOCI_TLS_ENABLED=true` | Required by the TLS-dependent paths and the compatibility suites. |
| `-v /var/run/docker.sock:/var/run/docker.sock` with `-u root` | Lambda, RDS, ECS, and EC2 start containers of their own. Without the socket, Lambda invocations fail with an opaque socket error. |

**LCS publishes on `127.0.0.1` by default.** It has no authentication and accepts any
credentials, and the Docker socket mount means anything that can reach the port can start
containers on the host. `LCS_BIND=0.0.0.0` warns and proceeds.

Without `LCS_DATA`, resources live in memory and a restart starts empty.

### Offline installs

Neither the installer nor the packages bundle the LCS image. Put a tarball beside the
installer and it loads it:

```bash
docker save lcs/lcs:merged -o lcs-image.tar
```

## Uninstalling

```bash
lcs down
sudo rm -f /usr/local/bin/lcs            # or ~/.local/bin/lcs
rm -f ~/.local/share/applications/lcs.desktop
```

Or `sudo apt remove lcs` / `sudo dnf remove lcs` if you used a package. Docker, if the
installer added it, is removed with your package manager.
