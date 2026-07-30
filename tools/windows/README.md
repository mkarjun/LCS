# Windows launcher and installer

`LCS-Setup.exe` installs LCS and everything it needs. `lcs.ps1` runs it afterwards.

## Layout

| File | Role |
|---|---|
| `LcsSetup.cs` | Thin bootstrapper compiled to `LCS-Setup.exe`. Extracts the two scripts it embeds and runs the installer. |
| `lcs-install.ps1` | The installer: preflight, consent, Docker Desktop, WSL2, launcher, shortcuts, start. |
| `lcs.ps1` | The runtime launcher, installed as `lcs`. |
| `build-installer.ps1` | Compiles the exe. |

The logic lives in PowerShell, not C#. Everything the installer drives — `winget`, `wsl`,
`Get-AuthenticodeSignature`, `Start-Process -Verb RunAs`, the shortcut API — is native
there and awkward in C#. The exe exists because people expect to double-click an installer,
and because a bare `.ps1` is blocked by the default execution policy.

## Installing

```powershell
.\dist\LCS-Setup.exe             # interactive
.\dist\LCS-Setup.exe /silent     # unattended
```

Flags: `/silent`, `/dir=<path>`, `/image=<tag>`, `/nostart`, `/skipdeps`.

Requires Windows 10 version 2004 (build 19041) or newer on x64 or arm64. Below that,
Docker Desktop's WSL2 backend does not exist and the installer stops with that reason
rather than installing something that cannot work.

### What it does

1. **Preflight** — Windows build and architecture.
2. **Consent** — one screen listing every change, including where Docker Desktop is
   downloaded from and that installing it accepts Docker's licence terms. `/silent` skips
   it, which is an explicit opt-in to those terms.
3. **Dependencies**, if needed — `wsl --install --no-distribution`, then Docker Desktop via
   `winget` (which verifies the package itself) or a direct download from
   `desktop.docker.com`. A direct download is checked with `Get-AuthenticodeSignature` and
   deleted unless Windows says Docker Inc signed it — TLS proves who served the bytes, not
   who built them.
4. **Launcher** — `lcs.ps1` and a `lcs.cmd` wrapper to `%LOCALAPPDATA%\LCS`, added to the
   user PATH.
5. **Shortcuts** — Start Menu and Desktop.
6. **Start** — waits for the daemon, then runs `lcs up`.

Only step 3 elevates, and it runs as a separate child process. If the whole installer ran
elevated, `%LOCALAPPDATA%`, the Start Menu, and the Desktop would resolve to the
administrator's profile and the user would end up with an install they cannot see.

Exit code 3010 means "installed, restart required" — WSL2 sometimes needs a reboot. The
launcher and shortcuts are installed first so they are there afterwards.

## Running LCS

```powershell
lcs             # or: lcs up
lcs status
lcs down
lcs restart
lcs logs
lcs console
```

`-Persist <dir>`, `-Port <n>`, `-BindAddress <ip>`, `-PublishDbPorts`, `-Image <tag>`,
`-NoBrowser`.

Two container flags are always applied and are the reason this script exists:

| Flag | Why |
|---|---|
| `-e FLOCI_TLS_ENABLED=true` | Required by the TLS-dependent paths and the compatibility suites. |
| `-v /var/run/docker.sock:/var/run/docker.sock` with `-u root` | Lambda, RDS, ECS, and EC2 start containers of their own. Without the socket, Lambda invocations fail with an opaque socket error. |

**LCS publishes on `127.0.0.1` by default.** It has no authentication and accepts any
credentials, and the Docker socket mount means anything that can reach the port can start
containers on the host. `-BindAddress 0.0.0.0` warns and proceeds.

## Building

```powershell
.\build-installer.ps1
```

Parses both scripts before compiling — a syntax error otherwise shows up as the installer
window closing on someone else's machine — then compiles with the .NET Framework 4
`csc.exe` that ships with Windows. No SDK to build, no runtime to install.

`dist/` is gitignored: the exe and the image tarball are release artifacts.

### Offline installs

The exe does not bundle the LCS image — that would add hundreds of megabytes. Put a
tarball beside it and the installer loads it:

```powershell
docker save lcs/lcs:merged -o dist\lcs-image.tar
```

## Uninstalling

No uninstaller. Remove the four things it creates:

```powershell
docker rm -f lcs
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\LCS"
Remove-Item -Recurse -Force "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\LCS"
Remove-Item "$([Environment]::GetFolderPath('DesktopDirectory'))\Start LCS.lnk"
```

Then drop `%LOCALAPPDATA%\LCS` from your user PATH. Docker Desktop, if the installer added
it, is uninstalled through Settings > Apps.
