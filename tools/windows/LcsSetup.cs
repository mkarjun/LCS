// LCS installer.
//
// Compiled to a single self-contained LCS-Setup.exe by build-installer.ps1, which embeds
// lcs.ps1 as a resource so the exe carries everything it installs. Targets the .NET
// Framework 4 compiler that ships with Windows, so building it needs no SDK download and
// running it needs no runtime install.
//
// What it does, in order:
//   1. Verifies Docker is installed and the daemon is responding.
//   2. Writes lcs.ps1 into the install directory.
//   3. Makes sure the LCS image is present (loads lcs-image.tar beside the exe if not).
//   4. Creates Start Menu and Desktop shortcuts that run the script.
//   5. Offers to start LCS.
//
// It never modifies system settings, never writes outside the install directory and the
// two shortcut folders, and needs no administrator rights.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

internal static class LcsSetup
{
    private const string ProductName = "LCS";
    private const string DefaultImage = "lcs/lcs:merged";
    private const string ImageTarName = "lcs-image.tar";
    private const string ScriptName = "lcs.ps1";

    private static int Main(string[] args)
    {
        bool silent = Array.Exists(args, a => a.Equals("/silent", StringComparison.OrdinalIgnoreCase));
        string installDir = GetArg(args, "/dir=") ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), ProductName);
        string image = GetArg(args, "/image=") ?? DefaultImage;

        Console.Title = ProductName + " Setup";
        Header();

        try
        {
            RequireDocker();
            InstallScript(installDir);
            EnsureImage(image, installDir);
            CreateShortcuts(installDir);
            Done(installDir, image);

            if (!silent && Ask("Start LCS now?"))
            {
                RunScript(installDir, "-Action Up");
            }
        }
        catch (Exception ex)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine();
            Console.WriteLine("Setup failed: " + ex.Message);
            Console.ResetColor();
            if (!silent) Pause();
            return 1;
        }

        if (!silent) Pause();
        return 0;
    }

    private static void Header()
    {
        Console.WriteLine();
        Console.WriteLine("  " + ProductName + " - Local Cloud Services");
        Console.WriteLine("  An AWS-compatible emulator you run on your own machine.");
        Console.WriteLine("  ------------------------------------------------------");
        Console.WriteLine();
    }

    // Docker is not bundled: it is a large install with its own licensing, and silently
    // pulling it in would be a surprise. Fail with the download link instead.
    private static void RequireDocker()
    {
        Step("Checking Docker");

        string version;
        if (!TryRun("docker", "--version", out version))
        {
            throw new Exception(
                "Docker is not installed, or not on PATH.\r\n" +
                "  Install Docker Desktop from https://docs.docker.com/desktop/install/windows-install/\r\n" +
                "  then run this installer again.");
        }
        Ok(version.Trim());

        // The CLI answers --version even with the daemon stopped, so liveness needs its
        // own check or every later command fails confusingly.
        string server;
        if (!TryRun("docker", "info --format \"{{.ServerVersion}}\"", out server))
        {
            throw new Exception(
                "Docker is installed but the daemon is not responding.\r\n" +
                "  Start Docker Desktop, wait for it to finish starting, then run this again.");
        }
        Ok("Docker daemon " + server.Trim());
    }

    private static void InstallScript(string installDir)
    {
        Step("Installing to " + installDir);
        Directory.CreateDirectory(installDir);

        string script = ReadEmbedded(ScriptName);
        string target = Path.Combine(installDir, ScriptName);
        File.WriteAllText(target, script, new UTF8Encoding(false));
        Ok(ScriptName);

        // A .cmd wrapper means the shortcuts and a double-click both work without anyone
        // fighting the PowerShell execution policy.
        string cmd = Path.Combine(installDir, "lcs.cmd");
        File.WriteAllText(cmd,
            "@echo off\r\n" +
            "powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0" + ScriptName + "\" %*\r\n",
            new UTF8Encoding(false));
        Ok("lcs.cmd");
    }

    private static void EnsureImage(string image, string installDir)
    {
        Step("Checking for image " + image);

        string ignored;
        if (TryRun("docker", "image inspect " + image, out ignored))
        {
            Ok("Already present.");
            return;
        }

        // Shipping the image as a tarball beside the exe is what makes this installer
        // usable on a machine with no access to a registry holding LCS.
        string tar = Path.Combine(AppDirectory(), ImageTarName);
        if (File.Exists(tar))
        {
            Ok("Loading " + ImageTarName + " - this takes a minute.");
            string output;
            if (!TryRun("docker", "load -i \"" + tar + "\"", out output))
            {
                throw new Exception("docker load failed for " + tar + ".\r\n" + output);
            }
            // Copy it next to the script so lcs.ps1 can reload it after a docker prune.
            string kept = Path.Combine(installDir, ImageTarName);
            if (!File.Exists(kept)) File.Copy(tar, kept);
            Ok("Image loaded.");
            return;
        }

        Warn("Image not found and no " + ImageTarName + " beside this installer.");
        Warn("Build it from a checkout of the LCS repository:");
        Warn("    docker build -f docker/Dockerfile -t " + image + " .");
        Warn("Setup will finish; LCS will not start until the image exists.");
    }

    private static void CreateShortcuts(string installDir)
    {
        Step("Creating shortcuts");

        string target = Path.Combine(installDir, "lcs.cmd");
        string startMenu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs), ProductName);
        Directory.CreateDirectory(startMenu);

        CreateShortcut(Path.Combine(startMenu, "Start LCS.lnk"), target, "-Action Up", installDir);
        CreateShortcut(Path.Combine(startMenu, "Stop LCS.lnk"), target, "-Action Down", installDir);
        Ok("Start Menu > " + ProductName);

        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        CreateShortcut(Path.Combine(desktop, "Start LCS.lnk"), target, "-Action Up", installDir);
        Ok("Desktop > Start LCS");
    }

    // Built through WScript.Shell by late binding so the exe needs no COM reference and
    // compiles with nothing but csc.exe.
    private static void CreateShortcut(string linkPath, string target, string arguments, string workingDir)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null)
        {
            Warn("Windows Script Host unavailable; skipping " + Path.GetFileName(linkPath) + ".");
            return;
        }

        object shell = Activator.CreateInstance(shellType);
        object link = shellType.InvokeMember("CreateShortcut",
            BindingFlags.InvokeMethod, null, shell, new object[] { linkPath });
        Type linkType = link.GetType();

        Set(linkType, link, "TargetPath", target);
        Set(linkType, link, "Arguments", arguments);
        Set(linkType, link, "WorkingDirectory", workingDir);
        Set(linkType, link, "Description", "Local Cloud Services - AWS-compatible emulator");
        linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
    }

    private static void Set(Type t, object instance, string property, string value)
    {
        t.InvokeMember(property, BindingFlags.SetProperty, null, instance, new object[] { value });
    }

    private static void Done(string installDir, string image)
    {
        Console.WriteLine();
        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine("  Installed.");
        Console.ResetColor();
        Console.WriteLine();
        Console.WriteLine("  Start LCS      Start Menu > " + ProductName + " > Start LCS");
        Console.WriteLine("  Or from a shell");
        Console.WriteLine("      \"" + Path.Combine(installDir, "lcs.cmd") + "\"");
        Console.WriteLine();
        Console.WriteLine("  Console        http://localhost:4566/_lcs/ui/");
        Console.WriteLine("  Endpoint       http://localhost:4566");
        Console.WriteLine("  Image          " + image);
        Console.WriteLine();
    }

    private static void RunScript(string installDir, string arguments)
    {
        var psi = new ProcessStartInfo
        {
            FileName = Path.Combine(installDir, "lcs.cmd"),
            Arguments = arguments,
            WorkingDirectory = installDir,
            UseShellExecute = false
        };
        using (Process p = Process.Start(psi))
        {
            p.WaitForExit();
        }
    }

    private static string ReadEmbedded(string name)
    {
        Assembly asm = Assembly.GetExecutingAssembly();
        foreach (string resource in asm.GetManifestResourceNames())
        {
            if (resource.EndsWith(name, StringComparison.OrdinalIgnoreCase))
            {
                using (Stream s = asm.GetManifestResourceStream(resource))
                using (var reader = new StreamReader(s))
                {
                    return reader.ReadToEnd();
                }
            }
        }
        throw new Exception("Installer is missing its embedded copy of " + name + ".");
    }

    private static bool TryRun(string file, string arguments, out string output)
    {
        var psi = new ProcessStartInfo
        {
            FileName = file,
            Arguments = arguments,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        try
        {
            using (Process p = Process.Start(psi))
            {
                string stdout = p.StandardOutput.ReadToEnd();
                string stderr = p.StandardError.ReadToEnd();
                p.WaitForExit();
                output = string.IsNullOrEmpty(stdout.Trim()) ? stderr : stdout;
                return p.ExitCode == 0;
            }
        }
        catch (Exception ex)
        {
            output = ex.Message;
            return false;
        }
    }

    private static string AppDirectory()
    {
        return Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
    }

    private static string GetArg(string[] args, string prefix)
    {
        foreach (string a in args)
        {
            if (a.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                return a.Substring(prefix.Length).Trim('"');
            }
        }
        return null;
    }

    private static bool Ask(string question)
    {
        Console.Write("  " + question + " [Y/n] ");
        string answer = Console.ReadLine();
        return string.IsNullOrWhiteSpace(answer) || answer.Trim().StartsWith("y", StringComparison.OrdinalIgnoreCase);
    }

    private static void Pause()
    {
        Console.WriteLine("  Press any key to close.");
        try { Console.ReadKey(true); } catch (InvalidOperationException) { /* piped input */ }
    }

    private static void Step(string message)
    {
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine("  ==> " + message);
        Console.ResetColor();
    }

    private static void Ok(string message)
    {
        Console.WriteLine("      " + message);
    }

    private static void Warn(string message)
    {
        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine("      " + message);
        Console.ResetColor();
    }
}
