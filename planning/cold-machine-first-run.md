# Cold-machine first-run test

**Run:** 2026-08-17, against `main` at `1ac5fee8`.
**Harness:** `tools/coldstart/` (see its README for what each layer can and cannot prove).

The question: does LCS work on a machine with nothing pre-installed and nothing
pre-configured? Every other suite in this repository runs on a machine that has
already built LCS once, so none of them can see the failures a new user hits.

## What was run, and what it cost to find out

| Layer | Channel | Result |
|---|---|---|
| 1 — image on bare Docker | bundled `lcs-image.tar` | **10 checks, 0 failures** |
| 1 — image on bare Docker | build from checkout | **passes** — 571 s cold build |
| 1 — image on bare Docker | `docker pull` | **fails** — no registry serves the tag |
| 2 — `install-lcs.sh` on bare Linux | Ubuntu, Debian, Arch | **pass** (one blocking bug found and fixed) |
| 2 — `install-lcs.sh` on bare Linux | Fedora 41 | **fails** — dnf5 syntax |
| 3 — Windows installer | this machine | **14 checks, 0 failures**, big caveat |
| 4 — console cold first load | — | **passes**, faster than expected |

Of the three distribution channels, two work today and one does not exist.

## Findings

### 1. `install-lcs.sh` aborted before installing anything when `$USER` was unset — FIXED

The installer runs under `set -euo pipefail` and referenced `$USER` in five
places with no fallback. `$USER` is set by login shells; it is *not* set in a
container, under cloud-init, or in `curl … | bash` from a non-login shell — which
is precisely the unattended path the script's own header documents:

```
curl -fsSL <url>/install-lcs.sh | bash -s -- --yes
```

The run died at line 132, on the plan screen, before installing anything:

```
/opt/lcs-install/install-lcs.sh: line 132: USER: unbound variable
```

Fixed in `tools/linux/install-lcs.sh` by defaulting `USER="${USER:-$(id -un)}"`.
The failure was observed first and the fix verified against it with `env -u USER`,
so the guard is real rather than assumed.

This is the one finding that would have shipped as a broken install.

### 2. The Fedora install path uses dnf4 syntax and fails on dnf5 — NOT FIXED

`install_docker_rpm` in `tools/linux/install-lcs.sh` adds Docker's repository with:

```bash
$SUDO $PKG config-manager --add-repo "https://download.docker.com/linux/${repo_id}/docker-ce.repo"
```

That is dnf4. Fedora 41 and later ship **dnf5**, where the subcommand was
replaced, and the installer dies there:

```
Unknown argument "--add-repo" for command "config-manager".
```

`dnf install -y dnf-plugins-core` succeeds first (81 packages), so the run gets
far enough to look like it is working before failing at exit 2. Docker is never
installed, the launcher is never installed, and nothing is cleaned up.

Fedora 41, 42 and 43 are all dnf5, so this is every currently supported Fedora.
RHEL/CentOS take the same branch and should be checked against their dnf version.

The dnf5 form is `config-manager addrepo --from-repofile=<url>`. The
version-independent alternative is to write the `.repo` file directly, which
works on both. Left unfixed deliberately — unlike finding #1 it does not block
the test harness, so it is a decision about product code rather than a
prerequisite for testing.

### 3. The README tells a cold user to run an image that does not exist

`README.md` names `lcs/lcs:latest` in four places (Quick Start, both Compose
examples, the Kubernetes snippet) and `lcs/lcs:dev` in the options table. Every
installer and launcher actually defaults to **`lcs/lcs:merged`**, and
`make-bundle.ps1` states in its own help text that this tag is *"published to no
registry"*.

Verified directly — this is the entire `pull` channel result:

```
FAIL  docker pull lcs/lcs:latest failed -- no registry serves this tag
```

A user who follows the Quick Start on a cold machine gets an image-not-found
error as their first experience of the product. Either the README must stop
promising a registry pull until one exists, or the tag has to be published.

### 4. The Windows installer ships no uninstaller

There is no uninstall path in `lcs-install.ps1` or `LcsSetup.cs`. The install is
per-user — `%LOCALAPPDATA%\LCS`, a user PATH entry, Start Menu and Desktop
shortcuts — so it is reversible by hand, but nothing ships to do it.
`cold-windows.ps1` records what it changed and reverts it itself for that reason.

### 5. The shipped bundle is older than the code

`tools/windows/dist/LCS-Bundle.zip` and its `lcs-image.tar.gz` were built
2026-07-30, roughly two and a half weeks behind `main`. Whatever ships at MVP has
to be rebuilt from the release commit; a bundle is a frozen copy of the image and
does not track the repository.

### 6. The image under test reports its version as `latest`

The console's Environment widget shows `Version: latest`, because
`docker/Dockerfile` takes `ARG VERSION=latest` and the build did not pass one.
Not a defect in itself, but a release build should set `--build-arg VERSION=` so
users can tell which build they are running when they report a problem.

## Layer 1 — the image on a machine with only Docker

The point of this layer is an **empty image cache**, not a clean OS. A developer
machine has months of accumulated layers; a new user has none, and every
container-backed service pulls its backing image on first use. The harness runs
LCS against a nested `docker:dind` daemon that has never pulled anything, so
first-use pulls are real. It does not prune the host.

Measured, bundled-tar channel:

| | |
|---|---|
| Image tar | 347 MB |
| Load into an empty daemon | 61 s |
| `docker run` → healthcheck healthy | 11 s |
| `docker run` → console answering | 12 s |
| Emulator's own startup claim | 9.8 s (`floci 1.5.34`, Quarkus 3.36.3) |
| Cold pull of `amazon/aws-cli` | 53 s |
| Disk in the daemon afterwards | 1.161 GB |

S3 `CreateBucket` and DynamoDB `CreateTable` both succeeded against the cold
instance, so the signed-request path works on first run with no warm state.

**Cold-start time is not a problem.** Twelve seconds from `docker run` to a
usable console, against an empty cache, is good.

### The real first-run cost is the backing-image pulls

Lambda is the sharpest case, because the first invoke has to pull a runtime image
that a developer machine always already has:

| | |
|---|---|
| `CreateFunction` | 7 s, `State: Active` |
| **First `Invoke`** | **67 s** — pulls `public.ecr.aws/lambda/python:3.11` |
| Second `Invoke` | 5 s, image now cached |

Both returned `StatusCode: 200` with the correct payload, so nothing is broken —
but a new user's first Lambda invocation takes over a minute, and thirteen times
longer than every invocation after it. No existing test can see this, because on
any machine that has run Lambda once the image is already there.

The same shape applies to every other container-backed service: RDS, ECS, EC2,
EKS, Neptune, ElastiCache, MSK, OpenSearch, CodeBuild and CloudShell all pull on
first use. Only Lambda and the AWS CLI image were measured in this pass.

This is worth a line in the README rather than a code change: the first use of a
container-backed service downloads an image, and that is normal.

### Build-from-checkout channel

A clean `git archive` of `HEAD` built into an image on a daemon with nothing
cached — no base images, no Maven repository, no npm cache:

| | |
|---|---|
| Cold build | **571 s** (9.5 min) |
| `docker run` → console answering | 13 s |
| Emulator's own startup claim | 9.0 s |

So "clone the repo and build it" works, and takes about ten minutes on a cold
machine plus whatever the network costs. Everything downstream behaved as it did
on the tar channel.

## Layer 2 — `install-lcs.sh` on a bare Linux OS

Stock distro containers, no Docker, no configuration, installer run as a new user
would run it. This found finding #1.

Ubuntu 22.04, full run — **11 checks, 0 failures**:

| Step | Result |
|---|---|
| Base image confirmed to have no Docker | pass |
| Installer ran to completion | 39 s, exit 0 |
| Distribution identified | Ubuntu 22.04.5 LTS, apt |
| Docker installed by the installer | 29.1.3 from the distro repo |
| Launcher installed | `/usr/local/bin/lcs` |
| Desktop entry written | `~/.local/share/applications/lcs.desktop` |
| `lcs-image.tar` loaded | pass |
| `lcs up` | succeeded end to end |
| Console answering afterwards | pass |
| `lcs status` | reports the console answering |

That is the whole documented Linux path, from a machine with nothing on it to a
console answering, with the one blocking bug fixed.

Across the four distributions the installer claims to support:

| Distro | Installer | Docker it installed | Result |
|---|---|---|---|
| Ubuntu 22.04 | 39 s, exit 0 | 29.1.3 (distro repo) | **pass**, full run through `lcs up` |
| Debian 12 | 76 s, exit 0 | 20.10.24 (distro repo) | **pass**, install only |
| Arch | 15 s, exit 0 | 29.7.2 (distro repo) | **pass**, install only |
| Fedora 41 | exit 2 | none | **fail** — finding #2 |

openSUSE is claimed in the README and was not tested; it takes the `zypper`
branch, which nothing here has exercised.

Debian resolving to Docker 20.10.24 is worth a look on its own — that is a
notably old engine, and it is what a Debian 12 user gets by default.

**What a container cannot prove.** These are emitted as `GAP` lines in the report
so a pass is never mistaken for coverage:

- **systemd** — no init in a container, so `systemctl enable --now docker` cannot
  work and the installer takes its documented warning path. Whether Docker comes
  back after a reboot is untested.
- **The docker group** — containers run as root, already able to use the socket,
  so the `usermod -aG docker` branch and the re-login it warns about never fire.
- **The desktop entry** — that the file is written is asserted; whether a desktop
  environment shows "Start LCS" is not.
- **Reboot survival**, and whether `--restart unless-stopped` actually restarts.

These need a real VM. Vagrant with the VMware provider is the shortest path on
this machine if that coverage is wanted before release.

## Layer 3 — the Windows installer

14 checks passed: the machine check, detection of an existing Docker Desktop,
launcher install, PATH entry, Start Menu and Desktop shortcuts, and `lcs up` /
`status` / console / `down`.

**The caveat is larger than the result.** The part that actually matters on cold
Windows — installing Docker Desktop, with its download, code-signing
verification, elevation prompt, WSL2 enablement, and possible reboot — is skipped
entirely whenever Docker is already present, which it is on any machine able to
run this test. The graphical `LCS-Setup.exe` front-end, which is what most users
will actually run, is also untested.

A container cannot close this: Windows containers cannot install Docker Desktop,
cannot reboot, and have no GUI. A VM on a WSL2/Hyper-V host is unreliable for it
too, because Docker Desktop in the guest needs nested virtualization.

**This needs a genuinely fresh Windows machine before MVP.** It is the single
largest untested surface.

## Layer 4 — the console's cold first load

Against a freshly started cold instance, first navigation to `/_lcs/ui/`:

| | |
|---|---|
| Resources | 4 (one JS bundle, one CSS, a logo, one API call) |
| Transferred | 1.85 MB |
| DOMContentLoaded | 1.06 s |
| Load event | 1.08 s |
| Console errors | none |

The page rendered with live data from the instance — "Emulator health: Running
70, Disabled 0" — so the console is talking to the emulator, not showing a shell.

Worth noting against the concern recorded in the execution plan about a cold
first navigation pulling ~250 Cloudscape modules: that is the **dev-server**
path. The shipped console is a production bundle and does not behave that way.

## Still open before MVP

Blocking, in the order they would bite a new user:

1. **Fix the Fedora dnf5 path** (finding #2). Every supported Fedora fails today.
2. **Decide the registry story** and make the README agree with it (finding #3).
   Right now the Quick Start's first command cannot work.
3. **A fresh Windows machine** for the Docker Desktop install branch and the
   `LCS-Setup.exe` GUI. Nothing in this environment can substitute, and it is the
   single largest untested surface.

Should be done, not strictly blocking:

4. **A real Linux VM** for systemd, the docker-group re-login, the desktop menu
   entry, and reboot survival — the `GAP` lines containers cannot close.
5. **Rebuild the Windows bundle** from the release commit (finding #5).
6. **An uninstaller**, or a documented manual removal procedure (finding #4).
7. **Set `--build-arg VERSION`** on release builds (finding #6).
8. **openSUSE** (`zypper`) is claimed in the README and has never been run.
9. **First-use pull cost** deserves a README line so a 67-second first Lambda
   invoke does not read as a hang.

## Reproducing

```bash
tools/coldstart/cold-image.sh tar          # or build, or pull
tools/coldstart/cold-installer.sh          # all four distros
COLD_FULL=1 tools/coldstart/cold-installer.sh ubuntu
```

```powershell
tools\coldstart\cold-windows.ps1 -PlanOnly
```

`tools/coldstart/README.md` documents the environment variables and, more
importantly, exactly what each layer cannot prove.
