# LCS CloudShell

Goal: an in-console terminal indistinguishable from AWS CloudShell, backed by LCS.

## Reality mapping

LCS "EC2" instances are **Docker containers**, and there is no real SSH / EBS / VPC /
Session Manager fabric. So CloudShell maps to LCS like this:

| AWS CloudShell | LCS implementation |
|---|---|
| Dedicated EC2 per session + SSH | Per-session **tools container**; terminal via `docker exec` PTY over a WebSocket |
| Temporary STS credentials, IAM-enforced | **Real** — LCS STS mints session creds; the IAM enforcement filter already gates every call, so the CLI in the shell succeeds/denies exactly per policy. No elevation. |
| Dedicated EBS mounted at /home | **Docker volume** per user, mounted at `/home/cloudshell-user` |
| Pre-installed tools (awscli, terraform, kubectl, …) | Baked into the tools image |
| VPC endpoints / Session Manager / SCP / proxy / custom DNS / billing | Thin or N/A — LCS has no real network fabric; documented as out of scope until those services gain backing |

## Architecture (decoupled services)

```
Browser (xterm.js)  ──WS──►  WebSocket gateway  ──►  Terminal gateway (docker exec PTY)
                                     │
      Session manager ──┬── Credential manager (STS session, auto-refresh)
                        ├── Provisioning service (container lifecycle, idle/session timeout)
                        └── Volume manager (per-user docker volume)
      IAM evaluator: reuses the existing LCS enforcement filter (no new evaluator)
      Audit: command/session events → CloudWatch Logs
```

Frontend and the WebSocket protocol are the seam; everything below the socket is
swappable.

## Status

All four phases are built. The terminal is real: keystrokes reach a shell in a container,
and the AWS CLI in it talks to LCS under temporary credentials the IAM filter enforces.

### Phase 1 — Frontend (done)

`console/src/services/cloudshell/`:
- `CloudShellPage.tsx` — AWS-parity chrome: toolbar (Actions, upload/download, new tab),
  tab strip, split view, fullscreen, per-tab status indicator, dark theme, settings.
  Route `/_lcs/ui/cloudshell`, launched from the top-nav CloudShell icon.
- `XtermView.tsx` — xterm.js terminal: ANSI colour, UTF-8, mouse selection, fit-to-
  container with PTY resize, Ctrl/Cmd+C copy-on-selection, Ctrl/Cmd+V paste.
- `session.ts` — WebSocket transport with reconnect + backoff, plus the in-browser
  **preview shell** used only when the backend reports itself unavailable.
- `api.ts` — the `/_lcs/cloudshell/*` control plane: status probe, restart, delete,
  upload, download.

### Phase 2 — Terminal gateway + session (done)

`src/main/java/io/github/hectorvent/floci/cloudshell/`:

| Class | Role |
|---|---|
| `CloudShellWebSocketRoute` | `/_lcs/cloudshell/ws?session=<id>`; the JSON frame protocol |
| `CloudShellTerminalGateway` | `docker exec` PTY: stdin, output, `resizeExecCmd` |
| `CloudShellSessionManager` | create/track/reap; idle and lifetime timeouts |
| `CloudShellProvisioner` | container + home volume; tools image with fallback |
| `TerminalInputStream` | stdin queue (not `PipedInputStream` — see its javadoc) |
| `Utf8StreamDecoder` | joins multi-byte characters split across PTY chunks |

Tools image: `docker/cloudshell/Dockerfile` — AWS CLI v2, Terraform, kubectl, git, python,
node, jq, vim, nano, zip/unzip, openssh-clients. Build it and CloudShell picks it up:

```bash
docker build -t lcs/cloudshell:latest -f docker/cloudshell/Dockerfile docker/cloudshell
```

Without it, sessions fall back to `amazon/aws-cli:latest` and say so in the terminal.

### Phase 3 — Credentials + storage (done)

- `CloudShellCredentials` mints an `ASIA…` session credential set exactly as
  `GetSessionToken` does and registers it with `IamService`, so the existing enforcement
  filter gates every call the shell makes. Injected as `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`, alongside `AWS_REGION` and
  `AWS_ENDPOINT_URL` from `LaunchedContainerAwsEnv`.
- Home volume is a Docker named volume per **account and Region**, mounted at
  `/home/cloudshell-user`. It survives session restart, session deletion, and LCS restart —
  deleting a session removes its container, never its files.

### Phase 4 — Config + audit (done)

`floci.services.cloudshell.*`: `enabled`, `image`, `fallback-image`, `shells`,
`home-directory`, `home-volume-prefix`, `memory-mb`, `idle-timeout-seconds` (20 min),
`session-timeout-seconds` (12 h), `max-sessions`, `audit-enabled`, `audit-log-group`,
`docker-network`.

`CloudShellAudit` writes session start/stop and every command line to the
`/lcs/cloudshell` CloudWatch log group, one stream per session — readable from the LCS
CloudWatch console like any other log group.

## Known limits

- **Command audit is keystroke-derived.** `CommandLineTracker` reconstructs lines from
  stdin, so history recall and tab completion are recorded as what was typed rather than
  what ran. An exact record needs shell-side instrumentation.
- **AWS config keys with no LCS meaning are not offered**, rather than accepted and
  ignored: instance type, subnet/VPC/security group, EBS size. LCS has no such fabric.
  "Create VPC environment" is shown disabled for the same reason.
- **No credential auto-refresh mid-session.** Credentials are minted for the session
  lifetime (12 h by default), so they cannot expire inside a session that the reaper would
  have ended anyway. A refresh loop only becomes necessary if the lifetime cap is raised.
- **Sessions are per browser, not per user.** LCS has no login, so the console mints a
  session id and remembers it in `localStorage`, which is what lets a visit reattach to the
  environment it left. Two browsers are two environments; they share the home volume, since
  that is scoped to account and Region.

## Security invariants

Isolated container per session; no shared filesystem or credentials between them. Session
creds are the user's own — **never** elevated. Session ids are constrained to
`[A-Za-z0-9_-]{1,64}` before becoming a container name; uploads are constrained to a plain
file name so they cannot be written outside the home directory. Abandoned sessions are
reaped on timeout, and every session is torn down on LCS shutdown.
