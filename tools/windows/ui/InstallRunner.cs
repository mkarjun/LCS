// Runs lcs-install.ps1 and turns its output into events.
//
// The window is a reader of the script, never a second implementation of it: every fact it
// shows - the plan, the steps, the progress, the closing summary - arrives on this stream.
// That is what keeps the two from disagreeing about what an install does.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

namespace Lcs.Setup
{
    internal sealed class InstallMessage
    {
        public string Kind;
        public string[] Fields;

        public string Field(int index)
        {
            return (Fields != null && index < Fields.Length) ? Fields[index] : "";
        }

        // "@@LCS|STATUS|Downloading 218 of 604 MB|36" - anything else is ordinary output.
        public static InstallMessage TryParse(string line)
        {
            if (line == null) return null;
            string trimmed = line.Trim();
            if (!trimmed.StartsWith("@@LCS|", StringComparison.Ordinal)) return null;

            string[] parts = trimmed.Substring("@@LCS|".Length).Split('|');
            if (parts.Length == 0) return null;

            var message = new InstallMessage();
            message.Kind = parts[0];
            message.Fields = new string[Math.Max(0, parts.Length - 1)];
            Array.Copy(parts, 1, message.Fields, 0, message.Fields.Length);
            return message;
        }
    }

    internal sealed class InstallRunner
    {
        // Raised on a background thread. The form marshals to the UI thread itself, so the
        // runner never has to know it is talking to a window.
        public event Action<InstallMessage> Message;
        public event Action<string> Output;
        public event Action<int> Exited;

        private Process _process;
        private FileTail _tail;
        private volatile bool _cancelled;

        public string LogPath { get; private set; }

        public bool Running
        {
            get { return _process != null && !_process.HasExited; }
        }

        public void Start(string scriptPath, string arguments, string logPath)
        {
            LogPath = logPath;

            // -Verb RunAs cannot hand a pipe back to this process, so the elevated half of
            // the install reports itself through a file that both sides agree on. Following
            // it here is what makes the Docker install visible instead of a still window.
            if (!string.IsNullOrEmpty(logPath))
            {
                File.WriteAllText(logPath, "");
                _tail = new FileTail(logPath, OnLine);
                _tail.Start();
            }

            var psi = new ProcessStartInfo();
            psi.FileName = "powershell.exe";
            psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + scriptPath + "\" " + arguments;
            psi.WorkingDirectory = Path.GetDirectoryName(scriptPath);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;

            _process = new Process();
            _process.StartInfo = psi;
            _process.EnableRaisingEvents = true;
            _process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { OnLine(e.Data); };
            _process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { OnLine(e.Data); };
            _process.Exited += delegate
            {
                // The elevated child writes to the log through a pipe of its own, so give
                // the tail a moment to catch its last lines before the window moves on.
                Thread.Sleep(400);
                if (_tail != null) _tail.Stop();

                Action<int> handler = Exited;
                if (handler != null) handler(_cancelled ? 1223 : _process.ExitCode);
            };

            _process.Start();
            _process.BeginOutputReadLine();
            _process.BeginErrorReadLine();
        }

        // Kills the tree rather than the shell: the interesting child is whatever winget,
        // docker, or the Docker Desktop installer is doing, and killing only powershell.exe
        // would leave that running with nobody watching it.
        public void Cancel()
        {
            if (!Running) return;
            _cancelled = true;

            try
            {
                var kill = new ProcessStartInfo("taskkill.exe", "/PID " + _process.Id + " /T /F");
                kill.UseShellExecute = false;
                kill.CreateNoWindow = true;
                using (Process killer = Process.Start(kill))
                {
                    killer.WaitForExit(5000);
                }
            }
            catch (Exception)
            {
                try { _process.Kill(); } catch (Exception) { }
            }
        }

        private void OnLine(string line)
        {
            if (line == null) return;

            InstallMessage message = InstallMessage.TryParse(line);
            if (message != null)
            {
                Action<InstallMessage> handler = Message;
                if (handler != null) handler(message);
                return;
            }

            Action<string> output = Output;
            if (output != null) output(line);
        }
    }

    // Follows a file that another process is appending to.
    //
    // Opened with the widest possible sharing: the writer is an elevated PowerShell holding
    // it open for append, and a stricter share mode here would fail its next write.
    internal sealed class FileTail
    {
        private readonly string _path;
        private readonly Action<string> _onLine;
        private Thread _thread;
        private volatile bool _stop;

        public FileTail(string path, Action<string> onLine)
        {
            _path = path;
            _onLine = onLine;
        }

        public void Start()
        {
            _thread = new Thread(Loop);
            _thread.IsBackground = true;
            _thread.Start();
        }

        public void Stop()
        {
            _stop = true;
        }

        private void Loop()
        {
            long offset = 0;
            var partial = new StringBuilder();

            while (!_stop)
            {
                try
                {
                    using (var stream = new FileStream(_path, FileMode.Open, FileAccess.Read,
                                                       FileShare.ReadWrite | FileShare.Delete))
                    {
                        if (stream.Length < offset) offset = 0;   // truncated and reused
                        stream.Seek(offset, SeekOrigin.Begin);

                        using (var reader = new StreamReader(stream, Encoding.UTF8))
                        {
                            int value;
                            while ((value = reader.Read()) >= 0)
                            {
                                char c = (char)value;
                                if (c == '\n')
                                {
                                    Emit(partial.ToString());
                                    partial.Length = 0;
                                }
                                else if (c != '\r')
                                {
                                    partial.Append(c);
                                }
                            }

                            // Inside the reader's scope: disposing it closes the stream, and
                            // asking a closed FileStream for its length throws on this thread,
                            // which would take the window down with it.
                            offset = stream.Position;
                        }
                    }
                }
                catch (UnauthorizedAccessException)
                {
                    return;
                }
                catch (Exception)
                {
                    // Locked, half-written, or deleted from under us. This thread only ever
                    // makes the install *visible*, so it must never be the thing that fails
                    // one - the next pass picks up whatever it missed.
                }

                Thread.Sleep(200);
            }

            if (partial.Length > 0) Emit(partial.ToString());
        }

        private void Emit(string line)
        {
            if (line.Length == 0) return;
            if (_onLine != null) _onLine(line);
        }
    }
}
