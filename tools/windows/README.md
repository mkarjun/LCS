# Windows launcher and installer

Two things live here: a script that runs LCS, and an installer that puts that script on a
machine with shortcuts.

## Running LCS

`lcs.ps1` is the whole lifecycle.

```powershell
.\lcs.ps1                 # start, wait until ready, open the console
.\lcs.ps1 -Action Status
.\lcs.ps1 -Action Down
.\lcs.ps1 -Action Restart
.\lcs.ps1 -Action Logs
```

It always applies the two flags that matter and are easy to forget:

| Flag | Why |
|---|---|
| `-e FLOCI_TLS_ENABLED=true` | Required by the TLS-dependent paths and the compatibility suites. |
| `-v /var/run/docker.sock:/var/run/docker.sock` with `-u root` | Lambda, RDS, ECS, and EC2 start containers of their own. Without the socket, Lambda invocations fail with an opaque socket error. |

Useful options:

```powershell
.\lcs.ps1 -Persist "$env:LOCALAPPDATA\LCS\data"   # keep resources across restarts
.\lcs.ps1 -PublishDbPorts                          # reach RDS databases at localhost:<port>
.\lcs.ps1 -Port 4570                               # if 4566 is taken
.\lcs.ps1 -Image lcs/lcs:dev                       # or set $env:LCS_IMAGE
```

Without `-Persist`, everything is in-memory and a restart starts empty.

`-PublishDbPorts` is off by default because publishing the range costs several seconds of
startup on Docker Desktop, and most users never point a SQL client at a database.

## Building the installer

```powershell
.\build-installer.ps1
```

Produces `dist\LCS-Setup.exe`. It compiles with the .NET Framework 4 `csc.exe` that ships
with Windows, so building needs no SDK and the result runs with no runtime install.
`lcs.ps1` is embedded as a resource, so the exe is self-contained.

`dist/` is gitignored: the exe and the image tarball are release artifacts, not source.

### Offline installs

`LCS-Setup.exe` does not bundle the LCS image — it would add hundreds of megabytes. On a
machine that cannot reach a registry with LCS, export the image next to the exe and the
installer will load it:

```powershell
docker save lcs/lcs:merged -o dist\lcs-image.tar
```

## What the installer does

1. Verifies Docker is installed **and** that the daemon is responding. The CLI answers
   `--version` with the daemon stopped, so both are checked.
2. Writes `lcs.ps1` and a `lcs.cmd` wrapper to `%LOCALAPPDATA%\LCS`. The wrapper is what
   sidesteps the PowerShell execution policy.
3. Loads `lcs-image.tar` if the image is missing and the tarball is present.
4. Creates Start Menu and Desktop shortcuts.
5. Offers to start LCS.

It needs no administrator rights, changes no system settings, and writes only to the
install directory and the two shortcut folders.

Flags: `/silent` (no prompts), `/dir=<path>`, `/image=<tag>`.

Docker itself is not bundled — it is a large install with its own licensing. The installer
links to the download instead.

## Uninstalling

There is no uninstaller. Remove the three locations by hand:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\LCS"
Remove-Item -Recurse -Force "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\LCS"
Remove-Item "$([Environment]::GetFolderPath('DesktopDirectory'))\Start LCS.lnk"
docker rm -f lcs
```
