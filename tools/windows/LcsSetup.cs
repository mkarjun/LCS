// LCS-Setup.exe - the double-clickable entry point for installing LCS on Windows.
//
// Two things live here and nothing else: the embedded PowerShell payload, and the choice
// between the window and the console.
//
// This is deliberately still a thin bootstrapper. The window under ui\ shows progress and
// collects consent, but every decision about what an install does belongs to
// lcs-install.ps1, which does the real work (preflight, consent, Docker Desktop, WSL2,
// launcher, shortcuts, start).
//
// Keeping the logic in PowerShell rather than C# is what makes the installer maintainable:
// everything it has to drive - winget, wsl, Get-AuthenticodeSignature, Start-Process
// -Verb RunAs, the WScript.Shell shortcut API - is native there and awkward here. The exe
// exists because people expect to double-click an installer, and because a .ps1 on its own
// is blocked by the default execution policy.
//
// It runs as the signed-in user and does not elevate. lcs-install.ps1 elevates only the
// dependency step, so the LCS install lands in the right profile.
//
// Built by build-installer.ps1 with the .NET Framework 4 csc.exe that ships with Windows,
// so producing it needs no SDK and running it needs no runtime install. That compiler is
// C# 5, which is why there is no string interpolation anywhere in this installer.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Lcs.Setup;

internal static class LcsSetup
{
    private const string ProductName = "LCS";

    // Extracted together: lcs-install.ps1 copies lcs.ps1 to the install directory, and
    // resolves it relative to its own location.
    private static readonly string[] EmbeddedScripts = { "lcs-install.ps1", "lcs.ps1" };

    [STAThread]
    private static int Main(string[] args)
    {
        bool silent = HasFlag(args, "/silent") || HasFlag(args, "-silent") || HasFlag(args, "/s");
        bool preview = HasFlag(args, "/preview");
        string workDir = null;

        try
        {
            workDir = ExtractPayload();
            string script = Path.Combine(workDir, "lcs-install.ps1");
            string arguments = BuildArguments(args, silent);

            // Unattended provisioning has no window to look at and expects a console to
            // report to, so /silent keeps the original behaviour exactly.
            if (silent)
            {
                return RunConsoleWithParentAttached(workDir, script, arguments);
            }

            return RunWindow(script, arguments, preview);
        }
        catch (Exception ex)
        {
            ReportStartupFailure(ex, silent);
            return 1;
        }
        finally
        {
            // Best effort: the payload is two small text files in %TEMP%, and a locked
            // file here should never fail an otherwise successful install.
            TryDelete(workDir);
        }
    }

    private static int RunWindow(string script, string arguments, bool preview)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        using (var window = new InstallerForm(script, arguments, preview))
        {
            Application.Run(window);
        }
        return 0;
    }

    private static int RunConsoleInstaller(string workDir, string script, string arguments)
    {
        Console.Title = ProductName + " Setup";
        int exitCode = RunInstaller(workDir, script, arguments);

        // 3010 is the Windows convention for "succeeded, restart required". The
        // installer uses it when WSL2 needs a reboot, and that is not a failure.
        if (exitCode == 3010)
        {
            Console.WriteLine();
            Warn("  Restart Windows to finish, then use Start Menu > " + ProductName + " > Start LCS.");
            exitCode = 0;
        }

        return exitCode;
    }

    // The exe is built as a Windows application so double-clicking it does not flash a
    // console behind the window. That leaves /silent with nowhere to write, so it borrows
    // the console of whatever launched it.
    private static int RunConsoleWithParentAttached(string workDir, string script, string arguments)
    {
        bool attached = AttachConsole(AttachParentProcess);
        try
        {
            return RunConsoleInstaller(workDir, script, arguments);
        }
        finally
        {
            if (attached) FreeConsole();
        }
    }

    private static string ExtractPayload()
    {
        string workDir = Path.Combine(Path.GetTempPath(), "lcs-setup-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        Directory.CreateDirectory(workDir);

        foreach (string name in EmbeddedScripts)
        {
            // No BOM: PowerShell copes either way, but a BOM-free UTF-8 file is what the
            // repository ships and keeps the extracted copy byte-identical.
            File.WriteAllText(Path.Combine(workDir, name), ReadEmbedded(name), new UTF8Encoding(false));
        }

        return workDir;
    }

    // Passes the caller's flags straight through so LCS-Setup.exe accepts everything
    // lcs-install.ps1 does, without this file having to know what those options are.
    private static string BuildArguments(string[] args, bool silent)
    {
        var sb = new StringBuilder();
        if (silent) sb.Append(" -Silent");

        // The scripts run from a temp directory, so the installer would otherwise look for
        // the image archive there. Point it at the exe's own folder instead: that is where
        // a bundle puts lcs-image.tar.gz, and passing the path beats copying ~330 MB.
        sb.Append(" -PayloadDir \"").Append(AppDirectory()).Append('"');

        foreach (string arg in args)
        {
            string value;
            if (TryValue(arg, "/dir=", out value))   { sb.Append(" -InstallDir \"").Append(value).Append('"'); }
            else if (TryValue(arg, "/image=", out value)) { sb.Append(" -Image \"").Append(value).Append('"'); }
            else if (Matches(arg, "/nostart"))       { sb.Append(" -NoStart"); }
            else if (Matches(arg, "/skipdeps"))      { sb.Append(" -SkipDependencies"); }
        }

        return sb.ToString();
    }

    private static int RunInstaller(string workDir, string script, string extraArguments)
    {
        // -ExecutionPolicy Bypass applies to this process only. It does not change the
        // machine's policy, which is why the installer never has to touch that setting.
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"" + extraArguments,
            WorkingDirectory = workDir,
            UseShellExecute = false
        };

        using (Process process = Process.Start(psi))
        {
            process.WaitForExit();
            return process.ExitCode;
        }
    }

    private static void ReportStartupFailure(Exception ex, bool silent)
    {
        string message = "Setup could not start: " + ex.Message + "\r\n\r\n" +
                         "As a fallback, run the installer from a checkout of the repository:\r\n" +
                         "    powershell -ExecutionPolicy Bypass -File tools\\windows\\lcs-install.ps1";

        if (silent)
        {
            Console.WriteLine();
            Error("  " + message);
            return;
        }

        MessageBox.Show(message, ProductName + " setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    private static string ReadEmbedded(string name)
    {
        Assembly asm = Assembly.GetExecutingAssembly();
        foreach (string resource in asm.GetManifestResourceNames())
        {
            if (resource.EndsWith(name, StringComparison.OrdinalIgnoreCase))
            {
                using (Stream stream = asm.GetManifestResourceStream(resource))
                using (var reader = new StreamReader(stream))
                {
                    return reader.ReadToEnd();
                }
            }
        }
        throw new Exception("this build is missing its embedded copy of " + name + ".");
    }

    private static string AppDirectory()
    {
        return Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
    }

    private static void TryDelete(string directory)
    {
        if (directory == null || !Directory.Exists(directory)) return;
        try { Directory.Delete(directory, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private static bool HasFlag(string[] args, string flag)
    {
        return Array.Exists(args, a => a.Equals(flag, StringComparison.OrdinalIgnoreCase));
    }

    private static bool Matches(string arg, string flag)
    {
        return arg.Equals(flag, StringComparison.OrdinalIgnoreCase)
            || arg.Equals("-" + flag.TrimStart('/'), StringComparison.OrdinalIgnoreCase);
    }

    private static bool TryValue(string arg, string prefix, out string value)
    {
        if (arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            value = arg.Substring(prefix.Length).Trim('"');
            return true;
        }
        value = null;
        return false;
    }

    private static void Warn(string message)
    {
        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine(message);
        Console.ResetColor();
    }

    private static void Error(string message)
    {
        Console.ForegroundColor = ConsoleColor.Red;
        Console.WriteLine(message);
        Console.ResetColor();
    }

    private const int AttachParentProcess = -1;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AttachConsole(int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeConsole();
}
