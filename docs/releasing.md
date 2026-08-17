# Releasing LCS

LCS publishes its Docker images to **Docker Hub** as `mkarjun/lcs`.

| Tag | Built by | From |
|---|---|---|
| `:1.2.3`, `:latest` | `.github/workflows/release.yml` | a version tag push |
| `:1.2.3-compat`, `:latest-compat` | same | same |
| `:nightly`, `:nightly-mmddyyyy` | `.github/workflows/nightly.yml` | tip of `main`, 22:00 CT |

Both workflows read the repository name from one place:

```yaml
LCS_REPO: ${{ vars.DOCKERHUB_REPO || 'mkarjun/lcs' }}
```

Set a `DOCKERHUB_REPO` Actions **variable** to publish somewhere else without
editing either file. If you do, also update the README and the four launcher and
installer defaults listed at the bottom of this page — they are what users get
when they pass no image.

## One-time setup

Nothing is published until these are done. They need a human with Docker Hub and
repository-settings access.

1. **Create the Docker Hub repository** `mkarjun/lcs`. Public, unless you want
   every user to authenticate before pulling.
2. **Create a Docker Hub access token** with Read/Write scope — Account Settings
   → Personal access tokens. Not your account password.
3. **Add two Actions secrets** on the LCS repository, Settings → Secrets and
   variables → Actions:
   - `DOCKERHUB_USERNAME` — your Docker Hub username
   - `DOCKERHUB_TOKEN` — the token from step 2

Until step 3 exists, `release.yml` fails at the login step and nothing is
pushed. That is the intended failure mode: it stops rather than publishing
something half-built.

## Cutting a release

```bash
git tag 1.5.35
git push lcs 1.5.35
```

The tag pattern the workflow listens for is `[0-9]+.[0-9]+.[0-9]+` — no `v`
prefix. Pushing the tag is what triggers everything; there is no manual build
step and no artifact to upload by hand.

`release.yml` then builds native amd64 and arm64 binaries, assembles the native
and compat images, and pushes both with provenance and an SBOM. The version tag
is passed through as `--build-arg VERSION`, so the console's Environment widget
shows the real version instead of `latest`.

## Verify a release from a cold machine

A release that has never been installed from scratch is not known to work. The
cold-machine harness exists for exactly this:

```bash
tools/coldstart/cold-image.sh pull
```

That pulls the published tag into a Docker daemon with an empty cache and drives
it to a working console. It is the only check here that exercises what a new
user actually does. Run it against the real published tag after the release
completes, not before.

For the installers:

```bash
COLD_FULL=1 tools/coldstart/cold-installer.sh ubuntu
```

See `tools/coldstart/README.md` for what these can and cannot prove — notably
that the Windows Docker Desktop install branch still needs a real fresh machine.

## The Windows bundle

`tools/windows/dist/LCS-Bundle.zip` carries a copy of the image so the installer
works offline. It is a **frozen copy** and does not track the repository: rebuild
it from the release commit, or it ships an older LCS than the tag claims.

```powershell
tools\windows\make-bundle.ps1
```

## Where the image name appears

If the published name ever changes, these are the places that need to agree.
They are the defaults users get when they pass nothing:

- `.github/workflows/release.yml` — `LCS_REPO`
- `.github/workflows/nightly.yml` — `LCS_REPO`
- `tools/linux/lcs` — `LCS_IMAGE` default
- `tools/linux/install-lcs.sh` — `IMAGE`
- `tools/windows/lcs.ps1` — `-Image` default
- `tools/windows/lcs-install.ps1` — `-Image` default
- `README.md` — Quick Start, the Compose and Kubernetes examples, the options table
- `examples/lambda-e2e/README.md`

`lcs/lcs:merged` is the local build tag, not a published one. It stays as the
name a checkout builds under and as an offline fallback the launchers still
honour, so a machine that built LCS the old way keeps working.
