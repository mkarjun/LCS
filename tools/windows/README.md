# Windows launcher and installer

`LCS-Setup.exe` installs LCS and everything it needs. `lcs.ps1` runs it afterwards.

## Layout

| File | Role |
|---|---|
| `LcsSetup.cs` | Thin bootstrapper compiled to `LCS-Setup.exe`. Extracts the two scripts it embeds, then shows the window or runs on the console. |
| `lcs-install.ps1` | The installer: preflight, consent, Docker Desktop, WSL2, launcher, shortcuts, start. |
| `lcs.ps1` | The runtime launcher, installed as `lcs`. |
| `ui/` | The installer window. Owner-drawn WinForms; see [The window](#the-window). |
| `LcsSetup.manifest` | `asInvoker`, system DPI awareness, comctl32 v6. |
| `build-installer.ps1` | Compiles the exe and draws its icon. |

The logic lives in PowerShell, not C#. Everything the installer drives — `winget`, `wsl`,
`Get-AuthenticodeSignature`, `Start-Process -Verb RunAs`, the shortcut API — is native
there and awkward in C#. The exe exists because people expect to double-click an installer,
and because a bare `.ps1` is blocked by the default execution policy.

That split survives the window: `ui/` renders progress and collects consent, but every fact
it shows comes from `lcs-install.ps1`, so the two cannot disagree about what an install does.

## Installing

```powershell
.\dist\LCS-Setup.exe             # the window
.\dist\LCS-Setup.exe /silent     # unattended, on the console
.\dist\LCS-Setup.exe /preview    # the window, driven by a canned install; changes nothing
```

Flags: `/silent`, `/dir=<path>`, `/image=<tag>`, `/nostart`, `/skipdeps`, `/preview`.

`/silent` still reports to whatever console launched it — the exe is a Windows application so
a double-click does not flash a console window, and attaches to its caller's when run from
one.

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

## The window

Four screens in one frame: the plan you consent to, the install, the details view, and the
outcome. The rail on the left holds the live step checklist and never moves, which is what
frees the middle to show something worth reading while Docker downloads.

That middle is a slideshow, and it follows the install rather than rotating blindly — the
"why it wants Docker" slide is on screen while Docker is being installed, the AWS CLI slide
while the launcher goes in. The slides teach the four things somebody needs ten minutes from
now: what LCS is, how to point a client at it, where the console lives, and what survives a
restart. The wait is the only moment in the product's life when the user has nothing else to
do. Hovering pauses the rotation; the dots and the arrow keys drive it by hand.

Every illustration is drawn with GDI+ rather than shipped as a bitmap, which is why the exe
is still around 120 KB.

### The progress protocol

`lcs-install.ps1 -Ui` emits one line per event on stdout among its ordinary output, and the
window is a reader of that stream:

```
@@LCS|FACT|arch|x64                        a fact about this machine
@@LCS|STEPS|checks:Checks|wsl:WSL2          the steps this install will work through
@@LCS|PLAN|docker|Install Docker...|~600MB  something the install will do
@@LCS|STEP|docker|Installing Docker         this step started
@@LCS|STATUS|Downloading 218/604 MB|36      detail for the current step, percent or -1
@@LCS|STEPDONE|docker|ok                    ok | skip | warn | fail
@@LCS|SUMMARY|Console|http://localhost...   a row of the closing summary
@@LCS|DONE|ok|LCS is running                ok | restart | incomplete | fail
```

Deliberately one-directional and line-based. A percent of `-1` means the script does not know
how long the step takes, and the bar says so instead of stalling at 90%.

Two consequences worth knowing:

- **`-Stage Plan`** is a read-only probe that reports what an install *would* do. The window
  runs it before drawing its first screen, so the consent it collects is for the work the
  script will actually perform on this machine.
- **The elevated stage is tee'd to a file.** `-Verb RunAs` cannot hand a pipe back, so
  `-UiLog <path>` gives the dependency stage somewhere to write and the window follows it.
  Without that, the Docker install would be five minutes of a window sitting still.

`/preview` replays a canned run of the same protocol. It is how the window gets looked at
without a ten-minute install on a machine that has no Docker.

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
window closing on someone else's machine — then compiles `LcsSetup.cs` and `ui/*.cs` with the
.NET Framework 4 `csc.exe` that ships with Windows. No SDK to build, no runtime to install.

**That compiler is C# 5**, and the installer's source is written to that language level
deliberately: no string interpolation, no `?.`, no expression-bodied members. Reaching for a
newer feature means reaching for an SDK, and then producing the installer stops being
something anyone can do on a stock Windows box.

The icon is drawn at build time with `System.Drawing` rather than checked in, so there is no
binary asset to keep in step with the palette. `-SkipIcon` skips it.

`dist/` is gitignored: the exe, the icon, and the image tarball are release artifacts.

### Offline installs

The exe does not bundle the LCS image — that would add hundreds of megabytes. Put a
tarball beside it and the installer loads it:

```powershell
docker save mkarjun/lcs:latest -o dist\lcs-image.tar
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
