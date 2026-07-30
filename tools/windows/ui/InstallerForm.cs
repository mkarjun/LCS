// The installer window.
//
// Four screens in one frame, and the frame is the point: the rail on the left says where the
// install has got to and never moves, so the middle is free to show something worth reading
// while Docker downloads. Ubuntu's installer had the slideshow idea first; the difference here
// is that it does not cost you the progress view, and the slides teach the product instead of
// advertising it.
//
// Everything the window knows comes from lcs-install.ps1's -Ui output. It has no opinion of
// its own about what an install does, which is why the two can never disagree.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace Lcs.Setup
{
    internal enum Phase
    {
        Probing,
        Welcome,
        Advanced,
        Installing,
        Finished
    }

    internal sealed class InstallerForm : Form
    {
        private const string DefaultConsoleUrl = "http://localhost:4566/_lcs/ui/";

        private readonly string _scriptPath;
        private readonly string _baseArguments;
        private readonly bool _preview;

        private readonly Dictionary<string, string> _facts = new Dictionary<string, string>();
        private readonly List<PlanItem> _planItems = new List<PlanItem>();
        private readonly List<string[]> _summary = new List<string[]>();
        private readonly StringBuilder _transcript = new StringBuilder();

        private RailPanel _rail;
        private Label _title;
        private Label _subtitle;
        private Label _status;
        private PlanView _plan;
        private SlideView _slides;
        private FinishView _finish;
        private Panel _logFrame;
        private TextBox _log;
        private Panel _advancedPanel;
        private TextBox _installDir;
        private CheckBox _buildFromSource;
        private CheckBox _noStart;
        private ProgressStrip _progress;
        private FlatButton _install;
        private FlatButton _cancel;
        private FlatButton _close;
        private FlatButton _openConsole;
        private FlatButton _detailsLink;
        private FlatButton _advancedLink;
        private FlatButton _copyLink;
        private FlatButton _closeX;

        private InstallRunner _runner;
        private Phase _phase = Phase.Probing;
        private Outcome _outcome = Outcome.Fail;
        private string _doneMessage = "";
        private string _logPath;
        private DateTime _started;
        private int _stepPercent = -1;
        private int _logLines;
        private bool _showingLog;
        private PreviewFeed _feed;

        public InstallerForm(string scriptPath, string baseArguments, bool preview)
        {
            _scriptPath = scriptPath;
            _baseArguments = baseArguments;
            _preview = preview;

            Theme.Init(this);
            BuildWindow();
            BuildControls();
            LayoutAll();
            GoProbing();
        }

        // ── Window ────────────────────────────────────────────────────────────────

        private void BuildWindow()
        {
            Text = "LCS setup";
            // Borderless, because the stock title bar would be the only part of the window
            // that did not belong to the product. Dragging and Escape are wired up below.
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Theme.Canvas;
            ClientSize = new Size(Theme.S(Theme.WindowWidth), Theme.S(Theme.WindowHeight));
            MinimumSize = ClientSize;
            KeyPreview = true;
            DoubleBuffered = true;
            ShowInTaskbar = true;
            MouseDown += StartDrag;
        }

        private void BuildControls()
        {
            _rail = new RailPanel();
            _rail.MouseDown += StartDrag;
            Controls.Add(_rail);

            _title = MakeLabel(Theme.Display, Theme.Text);
            _title.MouseDown += StartDrag;
            _subtitle = MakeLabel(Theme.Body, Theme.TextMuted);
            _subtitle.MouseDown += StartDrag;
            _status = MakeLabel(Theme.Small, Theme.TextMuted);

            _plan = new PlanView();
            _finish = new FinishView();
            _slides = new SlideView(SlideDeck.Build());
            _finish.Visible = false;
            _slides.Visible = false;
            Controls.Add(_plan);
            Controls.Add(_finish);
            Controls.Add(_slides);

            _logFrame = new Panel();
            _logFrame.BackColor = Theme.CodeBg;
            _logFrame.Padding = new Padding(Theme.S(12));
            _logFrame.Visible = false;
            _log = new TextBox();
            _log.Multiline = true;
            _log.ReadOnly = true;
            _log.BorderStyle = BorderStyle.None;
            _log.BackColor = Theme.CodeBg;
            _log.ForeColor = Theme.CodeText;
            _log.Font = Theme.MonoSmall;
            _log.ScrollBars = ScrollBars.Vertical;
            _log.WordWrap = true;
            _log.Dock = DockStyle.Fill;
            _log.TabStop = false;
            _logFrame.Controls.Add(_log);
            Controls.Add(_logFrame);

            BuildAdvancedPanel();

            _progress = new ProgressStrip();
            Controls.Add(_progress);

            _install = MakeButton(ButtonKind.Primary, "Install", delegate { GoInstalling(); });
            _cancel = MakeButton(ButtonKind.Secondary, "Cancel", delegate { CancelOrClose(); });
            _close = MakeButton(ButtonKind.Secondary, "Close", delegate { Close(); });
            _openConsole = MakeButton(ButtonKind.Primary, "Open console", delegate { OpenConsole(); });
            _detailsLink = MakeButton(ButtonKind.Link, "Show details", delegate { ToggleLog(); });
            _advancedLink = MakeButton(ButtonKind.Link, "Advanced options", delegate { ToggleAdvanced(); });
            _copyLink = MakeButton(ButtonKind.Link, "Copy log", delegate { CopyLog(); });

            _closeX = MakeButton(ButtonKind.Ghost, "✕", delegate { CancelOrClose(); });
            _closeX.Size = new Size(Theme.S(30), Theme.S(30));
            _closeX.Font = Theme.Small;
            _closeX.AccessibleName = "Close setup";
        }

        private void BuildAdvancedPanel()
        {
            _advancedPanel = new Panel();
            _advancedPanel.BackColor = Theme.Canvas;
            _advancedPanel.Visible = false;

            Label dirLabel = MakeLabel(Theme.SmallBold, Theme.Text);
            dirLabel.Text = "Install location";
            dirLabel.SetBounds(0, 0, Theme.S(300), Theme.S(20));

            _installDir = new TextBox();
            _installDir.Font = Theme.Body;
            _installDir.BorderStyle = BorderStyle.FixedSingle;
            _installDir.SetBounds(0, Theme.S(24), Theme.S(520), Theme.S(26));

            Label dirHint = MakeLabel(Theme.Small, Theme.TextFaint);
            dirHint.Text = "Per-user, so this needs no administrator rights.";
            dirHint.SetBounds(0, Theme.S(56), Theme.S(520), Theme.S(20));

            _noStart = MakeCheckBox("Don't start LCS when the install finishes", Theme.S(88));
            _buildFromSource = MakeCheckBox("Build the emulator image from source if it cannot be found (10-20 minutes)", Theme.S(116));

            _advancedPanel.Controls.Add(dirLabel);
            _advancedPanel.Controls.Add(_installDir);
            _advancedPanel.Controls.Add(dirHint);
            _advancedPanel.Controls.Add(_noStart);
            _advancedPanel.Controls.Add(_buildFromSource);
            Controls.Add(_advancedPanel);
        }

        private CheckBox MakeCheckBox(string text, int y)
        {
            var box = new CheckBox();
            box.Text = text;
            box.Font = Theme.Body;
            box.ForeColor = Theme.Text;
            box.BackColor = Theme.Canvas;
            box.FlatStyle = FlatStyle.Standard;
            box.AutoSize = false;
            box.SetBounds(0, y, Theme.S(560), Theme.S(24));
            return box;
        }

        private Label MakeLabel(Font font, Color color)
        {
            var label = new Label();
            label.Font = font;
            label.ForeColor = color;
            label.BackColor = Theme.Canvas;
            label.AutoSize = false;
            label.AutoEllipsis = true;
            Controls.Add(label);
            return label;
        }

        private FlatButton MakeButton(ButtonKind kind, string text, EventHandler onClick)
        {
            var button = new FlatButton(kind, text);
            button.Click += onClick;
            Controls.Add(button);
            return button;
        }

        private void LayoutAll()
        {
            int railWidth = Theme.S(Theme.RailWidth);
            _rail.SetBounds(1, 1, railWidth, ClientSize.Height - 2);
            _rail.LayoutChildren();

            int left = railWidth + Theme.S(30);
            int right = ClientSize.Width - Theme.S(30);
            int width = right - left;

            _title.SetBounds(left, Theme.S(26), width - Theme.S(40), Theme.S(30));
            _subtitle.SetBounds(left, Theme.S(56), width - Theme.S(40), Theme.S(22));
            _closeX.Location = new Point(ClientSize.Width - Theme.S(38), Theme.S(9));

            int bodyTop = Theme.S(96);
            int footerTop = ClientSize.Height - Theme.S(112);
            var body = new Rectangle(railWidth, bodyTop, ClientSize.Width - railWidth - 1, footerTop - bodyTop);

            // The slideshow paints its own margins, so it gets the whole body; everything
            // else is inset to line up with the header text above it.
            _slides.Bounds = body;
            _plan.Bounds = body;
            _finish.Bounds = body;
            _logFrame.SetBounds(left, bodyTop + Theme.S(4), width, body.Height - Theme.S(12));
            _advancedPanel.SetBounds(left, bodyTop + Theme.S(6), width, body.Height - Theme.S(12));

            _status.SetBounds(left, footerTop + Theme.S(14), width - Theme.S(140), Theme.S(20));
            _progress.SetBounds(left, footerTop + Theme.S(40), width, Theme.S(5));

            int linkY = ClientSize.Height - Theme.S(50);
            _detailsLink.SetBounds(left - Theme.S(6), linkY, Theme.S(96), Theme.S(24));
            _advancedLink.SetBounds(left - Theme.S(6), linkY, Theme.S(122), Theme.S(24));
            _copyLink.SetBounds(_detailsLink.Right + Theme.S(8), linkY, Theme.S(86), Theme.S(24));
        }

        private void PackRight(params FlatButton[] buttons)
        {
            int x = ClientSize.Width - Theme.S(30);
            int y = ClientSize.Height - Theme.S(56);

            foreach (FlatButton button in buttons)
            {
                if (!button.Visible) continue;
                int width = TextRenderer.MeasureText(button.Text, button.Font).Width + Theme.S(34);
                width = Math.Max(width, Theme.S(88));
                button.SetBounds(x - width, y, width, Theme.S(34));
                x -= width + Theme.S(10);
            }
        }

        // ── Screens ───────────────────────────────────────────────────────────────

        private void SetPhase(Phase phase)
        {
            _phase = phase;

            _plan.Visible = phase == Phase.Welcome;
            _advancedPanel.Visible = phase == Phase.Advanced;
            // The probe takes a second or two of looking for Docker. That is long enough to be
            // an empty white window, so the slideshow starts there rather than at the install.
            _slides.Visible = (phase == Phase.Installing || phase == Phase.Probing) && !_showingLog;
            _logFrame.Visible = (phase == Phase.Installing || phase == Phase.Finished) && _showingLog;
            _finish.Visible = phase == Phase.Finished && !_showingLog;

            bool running = phase == Phase.Probing || phase == Phase.Installing;
            _progress.Visible = running;
            _status.Visible = running;
            if (!running) _progress.Stop();

            _rail.Steps.Visible = phase == Phase.Installing || (phase == Phase.Finished && _rail.Steps.HasSteps);

            _install.Visible = phase == Phase.Welcome || phase == Phase.Advanced;
            _cancel.Visible = phase == Phase.Welcome || phase == Phase.Advanced || phase == Phase.Installing;
            _close.Visible = phase == Phase.Finished;
            _openConsole.Visible = phase == Phase.Finished && _outcome == Outcome.Ok;
            // The log stays reachable after the install ends: on a failure it is the only
            // place the reason exists, and reading it should not need the installer re-run.
            _detailsLink.Visible = phase == Phase.Installing || phase == Phase.Finished;
            _advancedLink.Visible = phase == Phase.Welcome || phase == Phase.Advanced;
            _copyLink.Visible = phase == Phase.Finished;

            _advancedLink.Text = phase == Phase.Advanced ? "Back to the plan" : "Advanced options";
            _rail.Invalidate();
            PackRight(_openConsole, _install, _close, _cancel);
        }

        private void GoProbing()
        {
            _title.Text = "Checking this machine";
            _subtitle.Text = "Finding out what LCS needs here. Nothing is being changed yet.";
            _rail.Section = "";
            _status.Text = "Looking for Docker, WSL2, and the emulator image.";
            _progress.Value = -1;
            SetPhase(Phase.Probing);
        }

        // The probe starts here rather than in the constructor: script output is marshalled
        // onto the UI thread, and before the window has a handle there is nothing to marshal
        // to, so the first few facts would be dropped.
        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Start("-Stage Plan -Ui " + _baseArguments, null);
        }

        private void GoWelcome()
        {
            _title.Text = "Ready to install";
            _subtitle.Text = DescribeWork();
            _rail.Section = "This machine";
            _rail.SetFacts(MachineFacts());
            _plan.SetItems(_planItems);

            _installDir.Text = FindPlanDirectory();
            _buildFromSource.Enabled = _facts.ContainsKey("checkout");
            if (!_buildFromSource.Enabled)
            {
                _buildFromSource.Text = "Build the emulator image from source (needs a checkout of the LCS repository)";
                _buildFromSource.ForeColor = Theme.TextFaint;
            }

            SetPhase(Phase.Welcome);
            _install.Focus();
        }

        private void GoInstalling()
        {
            _title.Text = "Installing LCS";
            _subtitle.Text = "This takes about ten minutes. You can leave it running.";
            _rail.Section = "Progress";
            _started = DateTime.Now;
            _summary.Clear();
            SetPhase(Phase.Installing);

            var arguments = new StringBuilder("-Ui ");
            arguments.Append(_baseArguments);

            string directory = _installDir.Text.Trim();
            if (directory.Length > 0) arguments.Append(" -InstallDir \"").Append(directory).Append('"');
            if (_noStart.Checked) arguments.Append(" -NoStart");
            if (_buildFromSource.Checked && _buildFromSource.Enabled) arguments.Append(" -BuildFromSource");

            _logPath = Path.Combine(Path.GetTempPath(),
                "lcs-setup-" + DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + ".log");
            arguments.Append(" -UiLog \"").Append(_logPath).Append('"');

            Start(arguments.ToString(), _logPath);
        }

        private void GoFinished()
        {
            _rail.Steps.CloseUnfinished(_outcome == Outcome.Fail ? StepState.Fail : StepState.Ok);
            _progress.Stop();

            switch (_outcome)
            {
                case Outcome.Ok:
                    _title.Text = "Done";
                    _subtitle.Text = "LCS is installed and answering on this machine.";
                    break;
                case Outcome.Restart:
                    _title.Text = "One restart to go";
                    _subtitle.Text = "Windows needs a restart before Docker can run.";
                    break;
                case Outcome.Incomplete:
                    _title.Text = "Not finished";
                    _subtitle.Text = "The launcher is installed, but LCS cannot start yet.";
                    break;
                default:
                    _title.Text = "Setup stopped";
                    _subtitle.Text = "Nothing further was changed. The details view has the whole log.";
                    break;
            }

            string message = _doneMessage;
            if (_outcome == Outcome.Ok)
            {
                message = "Took " + Elapsed() + ". The launcher is on your PATH, the shortcuts are in the Start Menu, and LCS is bound to 127.0.0.1 only - it accepts any credentials and has no authentication, so it is not published to your network.";
            }

            _rail.Section = _outcome == Outcome.Ok ? "Installed" : "Where it stopped";
            _finish.Set(_outcome, message, _summary);
            SetPhase(Phase.Finished);
            (_outcome == Outcome.Ok ? (Control)_openConsole : _close).Focus();
        }

        private string DescribeWork()
        {
            int minutes = _facts.ContainsKey("docker") && _facts["docker"].StartsWith("running", StringComparison.OrdinalIgnoreCase)
                ? 3 : 10;
            string plural = _planItems.Count == 1 ? "step" : "steps";
            return _planItems.Count + " " + plural + ", about " + minutes + " minutes. Nothing else on this machine changes.";
        }

        private List<string[]> MachineFacts()
        {
            var facts = new List<string[]>();
            AddFact(facts, "Windows", "os");
            AddFact(facts, "Processor", "arch");
            AddFact(facts, "Docker", "docker");
            AddFact(facts, "WSL2", "wsl");
            return facts;
        }

        private void AddFact(List<string[]> into, string label, string key)
        {
            if (!_facts.ContainsKey(key)) return;
            string value = _facts[key];
            if (key == "arch" && _facts.ContainsKey("memory")) value += ", " + _facts["memory"];
            into.Add(new string[] { label, value });
        }

        private string FindPlanDirectory()
        {
            // The plan says where the launcher goes; echoing the script's own answer beats
            // this window guessing at %LOCALAPPDATA% and being wrong when -InstallDir was set.
            foreach (PlanItem item in _planItems)
            {
                if (item.Key != "launcher") continue;
                int marker = item.Text.IndexOf(" to ", StringComparison.Ordinal);
                if (marker > 0) return item.Text.Substring(marker + 4).Trim();
            }
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LCS");
        }

        private string Elapsed()
        {
            TimeSpan span = DateTime.Now - _started;
            if (span.TotalMinutes < 1) return (int)span.TotalSeconds + "s";
            return (int)span.TotalMinutes + "m " + span.Seconds + "s";
        }

        // ── Running the script ────────────────────────────────────────────────────

        private void Start(string arguments, string logPath)
        {
            if (_preview)
            {
                _feed = new PreviewFeed(this, arguments.Contains("-Stage Plan"));
                _feed.Start();
                return;
            }

            _runner = new InstallRunner();
            _runner.Message += delegate(InstallMessage message) { Post(delegate { Apply(message); }); };
            _runner.Output += delegate(string line) { Post(delegate { Log(line); }); };
            _runner.Exited += delegate(int code) { Post(delegate { Finished(code); }); };
            _runner.Start(_scriptPath, arguments, logPath);
        }

        // Runner events arrive on background threads; everything below this line runs on the
        // UI thread only.
        private void Post(Action action)
        {
            if (IsDisposed || !IsHandleCreated) return;
            try { BeginInvoke(action); } catch (ObjectDisposedException) { }
        }

        internal void Apply(InstallMessage message)
        {
            switch (message.Kind)
            {
                case "FACT":
                    _facts[message.Field(0)] = message.Field(1);
                    if (_phase == Phase.Welcome) _rail.SetFacts(MachineFacts());
                    break;

                case "STEPS":
                    var steps = new List<StepItem>();
                    foreach (string field in message.Fields)
                    {
                        int split = field.IndexOf(':');
                        if (split <= 0) continue;
                        var step = new StepItem();
                        step.Key = field.Substring(0, split);
                        step.Label = field.Substring(split + 1);
                        step.State = StepState.Pending;
                        steps.Add(step);
                    }
                    if (steps.Count > 0) _rail.Steps.SetSteps(steps);
                    break;

                case "PLAN":
                    var item = new PlanItem();
                    item.Key = message.Field(0);
                    item.Text = message.Field(1);
                    item.Detail = message.Field(2);
                    _planItems.Add(item);
                    break;

                case "STEP":
                    _stepPercent = -1;
                    _rail.Steps.Begin(message.Field(0), message.Field(1));
                    _slides.FollowStep(message.Field(0));
                    _status.Text = message.Field(1) + "…";
                    UpdateProgress();
                    break;

                case "STATUS":
                    _status.Text = message.Field(0);
                    _stepPercent = ParseInt(message.Field(1), -1);
                    UpdateProgress();
                    break;

                case "STEPDONE":
                    _rail.Steps.Complete(message.Field(0), ParseState(message.Field(1)));
                    _stepPercent = -1;
                    UpdateProgress();
                    break;

                case "SUMMARY":
                    _summary.Add(new string[] { message.Field(0), message.Field(1) });
                    break;

                case "DONE":
                    // Recorded, not acted on: the window waits for the process to exit so a
                    // failure reported by the elevated child cannot end the install early.
                    _outcome = ParseOutcome(message.Field(0));
                    _doneMessage = message.Field(1);
                    break;
            }
        }

        private void UpdateProgress()
        {
            int total = Math.Max(1, _rail.Steps.Count);
            int done = _rail.Steps.CompletedCount;

            if (_stepPercent >= 0)
            {
                double fraction = (done + Math.Min(100, _stepPercent) / 100.0) / total;
                _progress.Value = (int)Math.Round(fraction * 100);
            }
            else
            {
                _progress.Value = -1;
            }
        }

        internal void Log(string line)
        {
            if (line == null) return;
            _transcript.AppendLine(line);

            // The transcript keeps everything for "Copy log"; the box on screen does not need
            // to, and a TextBox holding a Docker build's output scrolls like treacle.
            if (++_logLines > 2000)
            {
                _log.Clear();
                _log.AppendText("[earlier output is in Copy log]" + Environment.NewLine);
                _logLines = 1;
            }
            _log.AppendText(line + Environment.NewLine);
        }

        internal void Finished(int code)
        {
            if (_phase == Phase.Probing)
            {
                if (code == 0 && _planItems.Count > 0)
                {
                    GoWelcome();
                    return;
                }

                _outcome = Outcome.Fail;
                if (string.IsNullOrEmpty(_doneMessage))
                {
                    _doneMessage = "This machine could not be checked, so nothing was installed. The details view has the reason.";
                }
                _showingLog = false;
                GoFinished();
                return;
            }

            if (code == 1223)
            {
                _outcome = Outcome.Fail;
                _doneMessage = "Cancelled. Anything already installed - WSL2 or Docker Desktop - was left in place; the LCS launcher and shortcuts are the only things this installer adds.";
            }
            else if (code != 0 && _outcome == Outcome.Ok)
            {
                // A non-zero exit with a success message means the script threw after saying
                // so; the exit code is the one to believe.
                _outcome = Outcome.Fail;
            }

            GoFinished();
        }

        // ── Actions ───────────────────────────────────────────────────────────────

        private void ToggleLog()
        {
            _showingLog = !_showingLog;
            _detailsLink.Text = _showingLog ? "Hide details" : "Show details";
            SetPhase(_phase);
        }

        private void ToggleAdvanced()
        {
            SetPhase(_phase == Phase.Advanced ? Phase.Welcome : Phase.Advanced);
            _title.Text = _phase == Phase.Advanced ? "Advanced options" : "Ready to install";
            _subtitle.Text = _phase == Phase.Advanced
                ? "Defaults suit most machines. These are here for the ones they do not."
                : DescribeWork();
        }

        private void OpenConsole()
        {
            try { Process.Start(ConsoleUrl()); } catch (Exception) { }
        }

        // Taken from the summary rather than assumed, so -Port and a different bind address
        // open the console the install actually produced.
        private string ConsoleUrl()
        {
            foreach (string[] line in _summary)
            {
                if (line.Length > 1 &&
                    line[0].Equals("Console", StringComparison.OrdinalIgnoreCase) &&
                    line[1].StartsWith("http", StringComparison.Ordinal))
                {
                    return line[1];
                }
            }
            return DefaultConsoleUrl;
        }

        private void CopyLog()
        {
            try
            {
                Clipboard.SetText(_transcript.ToString());
                _copyLink.Text = "Copied";
            }
            catch (Exception)
            {
                _copyLink.Text = "Could not copy";
            }
        }

        private void CancelOrClose()
        {
            if (_phase != Phase.Installing)
            {
                Close();
                return;
            }

            DialogResult answer = MessageBox.Show(this,
                "Stop the install?\n\nWSL2 or Docker Desktop may be part-installed if that step was running. LCS itself has not been started.",
                "LCS setup", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);

            if (answer != DialogResult.Yes) return;
            _status.Text = "Stopping…";
            if (_runner != null) _runner.Cancel();
            if (_feed != null) _feed.Stop();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (_phase == Phase.Installing && _runner != null && _runner.Running)
            {
                e.Cancel = true;
                CancelOrClose();
                return;
            }
            base.OnFormClosing(e);
        }

        protected override bool ProcessCmdKey(ref Message message, Keys keyData)
        {
            if (keyData == Keys.Escape)
            {
                CancelOrClose();
                return true;
            }
            if (_phase == Phase.Installing && !_showingLog && _slides.HandleKey(keyData))
            {
                return true;
            }
            return base.ProcessCmdKey(ref message, keyData);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);

            // A borderless window on a white page needs an edge, and the hairline separators
            // are what keep the header and footer from floating.
            using (var pen = new Pen(Theme.BorderStrong, 1f))
            {
                e.Graphics.DrawRectangle(pen, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
            }

            int left = Theme.S(Theme.RailWidth);
            using (var pen = new Pen(Theme.Border, 1f))
            {
                e.Graphics.DrawLine(pen, left, Theme.S(88), ClientSize.Width - 1, Theme.S(88));
                int footer = ClientSize.Height - Theme.S(112);
                e.Graphics.DrawLine(pen, left, footer, ClientSize.Width - 1, footer);
            }
        }

        // ── Dragging a window with no title bar ───────────────────────────────────

        private const int WmNcLButtonDown = 0xA1;
        private const int HtCaption = 0x2;

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr window, int message, int wparam, int lparam);

        private void StartDrag(object sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            ReleaseCapture();
            SendMessage(Handle, WmNcLButtonDown, HtCaption, 0);
        }

        private static int ParseInt(string text, int fallback)
        {
            int value;
            return int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out value) ? value : fallback;
        }

        private static StepState ParseState(string text)
        {
            switch (text)
            {
                case "ok": return StepState.Ok;
                case "skip": return StepState.Skip;
                case "warn": return StepState.Warn;
                default: return StepState.Fail;
            }
        }

        private static Outcome ParseOutcome(string text)
        {
            switch (text)
            {
                case "ok": return Outcome.Ok;
                case "restart": return Outcome.Restart;
                case "incomplete": return Outcome.Incomplete;
                default: return Outcome.Fail;
            }
        }
    }
}
