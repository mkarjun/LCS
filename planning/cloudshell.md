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

### Phase 1 — Frontend (DONE, this branch)

`console/src/services/cloudshell/`:
- `CloudShellPage.tsx` — AWS-parity chrome: toolbar (Actions, upload/download, new tab),
  tab strip, split view, fullscreen, per-tab status indicator, dark theme, drag-drop
  upload target. Route `/_lcs/ui/cloudshell`, launched from the top-nav CloudShell icon.
- `XtermView.tsx` — xterm.js terminal: ANSI colour, UTF-8, mouse selection, fit-to-
  container with PTY resize, Ctrl/Cmd+C copy-on-selection, Ctrl/Cmd+V paste.
- `session.ts` — WebSocket transport with auto-reconnect + backoff, and an in-browser
  **preview shell** fallback (command history, line editing, a few commands) so the UI is
  fully usable before the backend exists. The WS wire protocol is documented in the file.

`useSim` is currently forced true (no backend yet). Flip to false once the gateway ships.

### Phase 2 — Terminal gateway + session (TODO, Java/Quarkus)

- WebSocket endpoint `/_lcs/cloudshell/ws?session=<id>` bridging to a `docker exec -it`
  PTY (reuse `Ec2ContainerManager`'s Docker client).
- Session manager: create/track/reap sessions; idle-timeout stop, duration terminate.
- Tools image: awscli v2, terraform, kubectl, git, python, node, docker client, jq, curl,
  vim, nano, zip, unzip, session-manager-plugin.

### Phase 3 — Credentials + storage (TODO)

- Credential manager: STS session token for the logged-in identity, injected as
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` / `AWS_REGION`; auto
  refresh before expiry. No long-lived keys.
- Volume manager: per-user docker volume, created on first launch, mounted at
  `/home/cloudshell-user` every session; configurable cleanup.

### Phase 4 — Config + audit (TODO)

- Config keys (all overridable): AMI/tools image, instance type→container size, subnet,
  VPC, security group, idle timeout, session timeout, EBS/volume size, auto-stop,
  auto-terminate, installed tools.
- Audit: session start/stop + command execution → CloudWatch Logs / audit log.

## Security invariants

Isolated container per user; no shared filesystem, instance, or credentials. Session creds
are the user's own — **never** elevated. Abandoned sessions reaped on timeout.
