// Drives the window with a canned install, for LCS-Setup.exe /preview.
//
// Worth the hundred lines: the real thing takes ten minutes, needs a machine without Docker,
// and cannot be re-run to look at one screen again. This replays the same protocol the script
// emits, so what you see here is what the window will do.

using System;
using System.Collections.Generic;
using System.Windows.Forms;

namespace Lcs.Setup
{
    internal sealed class PreviewFeed
    {
        private readonly InstallerForm _form;
        private readonly Queue<string[]> _events = new Queue<string[]>();
        private readonly Timer _timer = new Timer();
        private bool _stopped;

        public PreviewFeed(InstallerForm form, bool planOnly)
        {
            _form = form;
            if (planOnly) QueuePlan(); else QueueInstall();

            _timer.Interval = 300;
            _timer.Tick += delegate { Next(); };
        }

        public void Start()
        {
            _timer.Start();
        }

        public void Stop()
        {
            _stopped = true;
            _timer.Stop();
            _form.Finished(1223);
        }

        private void Next()
        {
            if (_stopped) return;

            if (_events.Count == 0)
            {
                _timer.Stop();
                _form.Finished(0);
                return;
            }

            string[] item = _events.Dequeue();
            _timer.Interval = int.Parse(item[0]);

            InstallMessage message = InstallMessage.TryParse(item[1]);
            if (message != null) _form.Apply(message); else _form.Log(item[1]);
        }

        private void Add(int delayMs, string line)
        {
            _events.Enqueue(new string[] { delayMs.ToString(), line });
        }

        private void QueuePlan()
        {
            Add(120, "==> Checking this machine");
            Add(120, "@@LCS|STEP|checks|Checking this machine");
            Add(120, "    Microsoft Windows 11 Home (build 26200, x64)");
            Add(80, "@@LCS|FACT|os|Microsoft Windows 11 Home (build 26200)");
            Add(80, "@@LCS|FACT|arch|x64");
            Add(80, "@@LCS|FACT|memory|16 GB RAM");
            Add(200, "@@LCS|STEPDONE|checks|ok");
            Add(80, "@@LCS|FACT|docker|not installed");
            Add(80, "@@LCS|FACT|wsl|not enabled");
            Add(80, "@@LCS|FACT|checkout|C:\\src\\lcs");
            Add(80, "@@LCS|STEPS|checks:Checks|elevate:Permission|wsl:WSL2|docker:Docker Desktop|daemon:Docker engine|launcher:Launcher|image:Emulator image|start:First start");
            Add(80, "@@LCS|PLAN|wsl|Enable the Windows Subsystem for Linux|wsl --install --no-distribution. Needs administrator rights, and may ask for a restart.");
            Add(80, "@@LCS|PLAN|docker|Install Docker Desktop, about 600 MB, from Docker Inc|Checked against Docker Inc's code-signing certificate before it runs. Needs administrator rights. Free for personal use, education, and small business; installing accepts the Docker Desktop licence terms.");
            Add(80, "@@LCS|PLAN|launcher|Install the LCS launcher to C:\\Users\\you\\AppData\\Local\\LCS|Per-user, so no administrator rights, plus Start Menu and Desktop shortcuts.");
            Add(80, "@@LCS|PLAN|start|Start LCS, listening on 127.0.0.1:4566|Local only: LCS accepts any credentials and has no authentication, so it is not published to your network.");
            Add(80, "@@LCS|DONE|ok|Plan complete.");
        }

        private void QueueInstall()
        {
            Add(200, "@@LCS|STEPS|checks:Checks|elevate:Permission|wsl:WSL2|docker:Docker Desktop|daemon:Docker engine|launcher:Launcher|image:Emulator image|start:First start");
            Add(600, "@@LCS|STEP|checks|Checking this machine");
            Add(300, "@@LCS|STEPDONE|checks|ok");

            Add(900, "@@LCS|STEP|elevate|Waiting for the administrator prompt");
            Add(300, "@@LCS|STATUS|Windows is asking permission to install WSL2 and Docker Desktop|-1");

            Add(700, "@@LCS|STEP|wsl|Enabling the Windows Subsystem for Linux");
            Add(400, "    Installing: Virtual Machine Platform");
            Add(600, "@@LCS|STEPDONE|wsl|ok");

            Add(400, "@@LCS|STEP|docker|Installing Docker Desktop");
            for (int percent = 4; percent <= 100; percent += 8)
            {
                int megabytes = 604 * percent / 100;
                Add(220, "@@LCS|STATUS|Downloading Docker Desktop - " + megabytes + " of 604 MB|" + percent);
            }
            Add(300, "@@LCS|STATUS|Checking the download is signed by Docker Inc|-1");
            Add(500, "    Signed by: CN=Docker Inc, O=Docker Inc, L=Palo Alto, S=California, C=US");
            Add(600, "@@LCS|STATUS|Running the Docker Desktop installer - a few minutes|-1");
            Add(800, "@@LCS|STEPDONE|docker|ok");
            Add(200, "@@LCS|STEPDONE|elevate|ok");

            Add(400, "@@LCS|STEP|daemon|Starting the Docker engine");
            for (int seconds = 6; seconds <= 60; seconds += 6)
            {
                Add(260, "@@LCS|STATUS|Waiting for Docker Desktop - " + seconds + "s of the 30-90s a first start takes|" + (seconds * 100 / 90));
            }
            Add(300, "@@LCS|STEPDONE|daemon|ok");

            Add(400, "@@LCS|STEP|launcher|Installing the launcher and shortcuts");
            Add(300, "@@LCS|STATUS|Writing to C:\\Users\\you\\AppData\\Local\\LCS|-1");
            Add(400, "    Added to PATH; 'lcs' works in a new terminal.");
            Add(400, "@@LCS|STEPDONE|launcher|ok");

            Add(400, "@@LCS|STEP|image|Getting the emulator image");
            Add(600, "@@LCS|STATUS|Loading lcs-image.tar.gz (331 MB) - about a minute|-1");
            Add(1200, "@@LCS|STEPDONE|image|ok");

            Add(400, "@@LCS|STEP|start|Starting LCS");
            Add(500, "@@LCS|STATUS|Starting the container and waiting for the console to answer|-1");
            Add(900, "    Ready after 11s.");
            Add(300, "@@LCS|STEPDONE|start|ok");

            Add(100, "@@LCS|SUMMARY|Start        Start Menu > LCS > Start LCS");
            Add(100, "@@LCS|SUMMARY|Command line lcs up / lcs down / lcs status / lcs logs");
            Add(100, "@@LCS|SUMMARY|Console      http://localhost:4566/_lcs/ui/");
            Add(100, "@@LCS|SUMMARY|Endpoint     http://localhost:4566");
            Add(100, "@@LCS|DONE|ok|LCS is installed and running.");
        }
    }
}
