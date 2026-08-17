# Cold-machine first-run test

Does LCS work on a machine that has nothing installed and nothing configured?

Every other test in this repository runs on a machine that has already built
LCS at least once. That machine has a warm Docker cache, a `~/.lcs`, an image
tagged from a previous build, and a shell whose PATH was fixed by hand months
ago. A new user has none of that, and the failures they hit are the ones no
existing suite can see.

These scripts try to answer the question honestly, which means being equally
clear about what they *cannot* answer. Read the gaps.

## The three layers

A "cold machine" is really three separate claims, and they are not equally
testable from a developer box.

| Layer | What it claims | Covered by |
|---|---|---|
| 1 | The image runs on a machine that has only Docker | `cold-image.sh` — fully |
| 2 | `install-lcs.sh` works on a bare Linux OS | `cold-installer.sh` — partially |
| 3 | `LCS-Setup.exe` works on bare Windows | `cold-windows.ps1` — barely |

## Layer 1 — the image on bare Docker

```bash
./cold-image.sh tar      # load lcs-image.tar, as the installers do
./cold-image.sh build    # build from this checkout, as a repo clone does
./cold-image.sh pull     # docker pull, as a published registry would
```

The thing that makes a first run different is not the operating system, it is
an **empty image cache**. Every container-backed service — Lambda, RDS, ECS,
EC2, EKS, Neptune, ElastiCache, MSK, OpenSearch, CodeBuild, CloudShell — pulls
a backing image the first time it is used. On a developer machine those are
already cached and first use looks instant. On a new machine each one is a real
pull that can be slow, or can fail outright on a tag nothing serves.

So the script runs LCS against a **nested Docker daemon** (`docker:dind`) whose
cache has never held anything. It does not prune the host, so running it never
destroys images you still want.

Two deviations from a true cold machine, both artifacts of nesting rather than
of LCS:

- Inside the nested daemon the LCS port is published on `0.0.0.0`, because the
  host mapping lands on the dind container's interface rather than its
  loopback. The **host** side is still pinned to `127.0.0.1` — LCS has no
  authentication, and a `0.0.0.0` publish would put a fully drivable AWS
  emulator on the local network.
- The nested daemon is `docker:dind`, not the Docker Desktop or Docker Engine a
  user would have.

## Layer 2 — the Linux installer on a bare OS

```bash
./cold-installer.sh                     # every distro, install-only
./cold-installer.sh ubuntu              # one distro
COLD_FULL=1 ./cold-installer.sh ubuntu  # also load the image and run `lcs up`
```

Each distro gets a privileged container from a stock base image with no Docker
and no configuration, and the installer runs in it exactly as a new user would
run it.

**What a container cannot prove.** These are emitted as `GAP` lines in the
report so a pass is never mistaken for coverage:

- **systemd.** Stock containers have no init, so `systemctl enable --now docker`
  cannot work and the installer takes its documented warning path. The daemon is
  started by hand. Whether Docker comes back after a reboot is untested.
- **The docker group.** The installer adds the invoking user to it and warns a
  re-login is needed. Containers run as root, already allowed to use the socket,
  so that branch never fires.
- **The desktop entry.** That the file is written is asserted; whether a desktop
  environment then shows "Start LCS" in its menu is not.
- **Reboot survival**, and whether `--restart unless-stopped` actually restarts.

Closing those needs a real VM. Vagrant with the VMware provider is the shortest
path if one is available.

## Layer 3 — the Windows installer

```powershell
.\cold-windows.ps1 -PlanOnly   # read-only machine check, changes nothing
.\cold-windows.ps1             # install, drive lcs, then revert
```

This is the layer that cannot be honestly automated from a machine that already
has Docker Desktop, and the script says so rather than implying coverage.

It covers the machine check, detection of an existing Docker Desktop, the
launcher install, the PATH entry, the Start Menu and Desktop shortcuts, and
driving `lcs up` / `status` / `down`.

It does **not** cover the part that actually matters on cold Windows: installing
Docker Desktop — the download, the code-signing verification, the elevation
prompt, WSL2 enablement, and the reboot that can follow. That branch is skipped
entirely whenever Docker is already present. Nor does it cover the graphical
`LCS-Setup.exe` front-end, which is what most users will run.

Those need a genuinely fresh Windows machine. A container cannot do it: Windows
containers cannot install Docker Desktop, cannot reboot, and have no GUI. A VM
on a Hyper-V/WSL2 host is unreliable for it too, because Docker Desktop in the
guest needs nested virtualization.

**There is no uninstaller.** The installer is per-user — it writes
`%LOCALAPPDATA%\LCS`, a user PATH entry, and shortcuts — so `cold-windows.ps1`
records what it changed and puts it back itself. Pass `-KeepInstall` to leave
the installation in place.

## Environment variables

| Variable | Applies to | Meaning |
|---|---|---|
| `COLD_WORK_DIR` | all | Where the image tar, logs and reports go |
| `COLD_IMAGE` | all | Image tag to run (default `mkarjun/lcs:latest`) |
| `COLD_KEEP=1` | layer 1 | Leave the nested daemon running for inspection |
| `COLD_HOST_PORT` | layer 1 | Host port for the console (default `14566`) |
| `COLD_READY_TIMEOUT` | layer 1 | Seconds to wait for a cold start (default `300`) |
| `COLD_SOURCE_IMAGE` | layer 1 | Host image to export into the tar (default `floci:full`) |
| `COLD_FULL=1` | layer 2 | Also load the image and run `lcs up` |

## Reading the reports

Each script writes a report to `COLD_WORK_DIR` with one line per check:

```
PASS  the image's own healthcheck reported healthy after 11s
FAIL  docker pull lcs/lcs:latest failed -- no registry serves this tag
NOTE  cold time-to-console: 14s from docker run
GAP   systemctl enable --now docker (no init in a container)
```

`GAP` lines are the important ones. They are not failures; they are the parts of
a real first run this environment provably cannot exercise, and they are what a
manual pass on a real machine still has to cover before release.

## A note on Git Bash

The layer 1 and 2 scripts set `MSYS_NO_PATHCONV=1` so that `/var/run/docker.sock`
survives being passed to `docker.exe`. That also stops Git Bash rewriting
`/dev/null`, so host-side `curl` discards output with a shell redirect rather
than `-o /dev/null` — otherwise curl fails with a write error on every call and
a perfectly healthy instance looks like a hang.
