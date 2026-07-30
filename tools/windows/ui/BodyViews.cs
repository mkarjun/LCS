// The two static screens: the plan you consent to, and the outcome you are left with.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;

namespace Lcs.Setup
{
    internal sealed class PlanItem
    {
        public string Key;
        public string Text;
        public string Detail;
    }

    // What the install will do, in the script's own words.
    //
    // Not a re-description: these lines come from lcs-install.ps1's Plan stage, so consenting
    // here is consenting to what that script will actually run.
    internal sealed class PlanView : Control
    {
        private readonly List<PlanItem> _items = new List<PlanItem>();

        public PlanView()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Canvas;
        }

        public void SetItems(List<PlanItem> items)
        {
            _items.Clear();
            if (items != null) _items.AddRange(items);
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Theme.Smooth(g);
            using (var back = new SolidBrush(Theme.Canvas))
            {
                g.FillRectangle(back, ClientRectangle);
            }

            int x = Theme.S(30);
            int y = Theme.S(4);
            int width = Width - x - Theme.S(40);

            foreach (PlanItem item in _items)
            {
                var bullet = new Rectangle(x, y + Theme.S(5), Theme.S(8), Theme.S(8));
                Theme.FillRounded(g, bullet, Theme.S(2), Theme.Amber);

                int textX = x + Theme.S(20);
                int textWidth = width - Theme.S(20);

                y += Theme.DrawWrapped(g, item.Text, Theme.BodyBold, Theme.Text,
                    new Rectangle(textX, y, textWidth, Theme.S(60)));
                y += Theme.S(2);
                y += Theme.DrawWrapped(g, item.Detail, Theme.Small, Theme.TextMuted,
                    new Rectangle(textX, y, textWidth, Theme.S(80)));
                y += Theme.S(16);
            }

            Theme.DrawWrapped(g, "Nothing else on this machine is changed, and nothing else is installed.",
                Theme.Small, Theme.TextFaint, new Rectangle(x, y + Theme.S(4), width, Theme.S(40)));
        }
    }

    internal enum Outcome
    {
        Ok,
        Restart,
        Incomplete,
        Fail
    }

    internal sealed class FinishView : Control
    {
        // { label, value } pairs from the script's own closing summary. An empty label is a
        // line of prose rather than a reference-card row.
        private readonly List<string[]> _summary = new List<string[]>();
        private Outcome _outcome = Outcome.Ok;
        private string _message = "";

        public FinishView()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Canvas;
        }

        public void Set(Outcome outcome, string message, List<string[]> summary)
        {
            _outcome = outcome;
            _message = message;
            _summary.Clear();
            if (summary != null) _summary.AddRange(summary);
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Theme.Smooth(g);
            using (var back = new SolidBrush(Theme.Canvas))
            {
                g.FillRectangle(back, ClientRectangle);
            }

            int x = Theme.S(30);
            int y = Theme.S(8);
            int width = Width - x - Theme.S(40);

            var badge = new Rectangle(x, y, Theme.S(34), Theme.S(34));
            DrawBadge(g, badge);

            string headline;
            switch (_outcome)
            {
                case Outcome.Ok: headline = "LCS is running"; break;
                case Outcome.Restart: headline = "Restart Windows to finish"; break;
                case Outcome.Incomplete: headline = "Almost - LCS cannot start yet"; break;
                default: headline = "Setup did not finish"; break;
            }

            Theme.DrawText(g, headline, Theme.Display, Theme.Text, badge.Right + Theme.S(14), y + Theme.S(3));
            y += Theme.S(46);

            y += Theme.DrawWrapped(g, _message, Theme.Body, Theme.TextMuted,
                new Rectangle(x, y, width, Theme.S(80)));
            y += Theme.S(18);

            if (_summary.Count == 0) return;

            // A card rather than loose lines: these are the things worth writing down, and
            // they should look like a reference card, not like more prose.
            int valueX = Theme.S(110);
            int valueWidth = width - valueX - Theme.S(20);
            int lineHeight = Theme.S(24);

            // Measured before it is drawn, because the rows are not all one line: a numbered
            // remediation step is a sentence that has to wrap, and a card sized for four
            // one-liners would cut it off mid-command.
            int cardHeight = Theme.S(22);
            foreach (string[] line in _summary)
            {
                cardHeight += IsCommand(line) ? lineHeight
                    : Theme.MeasureWrapped(g, Value(line), Theme.Small, valueWidth) + Theme.S(6);
            }

            var card = new Rectangle(x, y, width, cardHeight);
            Theme.FillRounded(g, card, Theme.S(8), Theme.CanvasAlt);
            Theme.DrawRounded(g, card, Theme.S(8), Theme.Border, 1f);

            int lineY = card.Top + Theme.S(11);
            foreach (string[] line in _summary)
            {
                string label = Label(line);
                string value = Value(line);
                if (label.Length > 0)
                {
                    Theme.DrawText(g, label, Theme.Small, Theme.TextMuted, card.Left + Theme.S(14), lineY + Theme.S(2));
                }

                if (IsCommand(line))
                {
                    // Mono only where the value is something to type or paste.
                    Theme.DrawText(g, value, Theme.Mono, Theme.Text, card.Left + valueX, lineY);
                    lineY += lineHeight;
                    continue;
                }

                lineY += Theme.DrawWrapped(g, value, Theme.Small, Theme.TextMuted,
                    new Rectangle(card.Left + (label.Length > 0 ? valueX : Theme.S(14)), lineY + Theme.S(2),
                        valueWidth, Theme.S(60))) + Theme.S(6);
            }
        }

        private static string Label(string[] line)
        {
            return line.Length > 0 ? line[0] : "";
        }

        private static string Value(string[] line)
        {
            return line.Length > 1 ? line[1] : "";
        }

        // A numbered label means a remediation step, which is a sentence; a named one means a
        // command or a URL.
        private static bool IsCommand(string[] line)
        {
            string label = Label(line);
            if (label.Length == 0) return false;
            foreach (char c in label)
            {
                if (char.IsDigit(c)) return false;
            }
            return true;
        }

        private void DrawBadge(Graphics g, Rectangle box)
        {
            switch (_outcome)
            {
                case Outcome.Ok:
                    Theme.FillRounded(g, box, box.Width / 2, Theme.Green);
                    StepRail.DrawTick(g, box, Color.White);
                    break;

                case Outcome.Restart:
                    Theme.FillRounded(g, box, box.Width / 2, Theme.Amber);
                    Theme.DrawText(g, "!", Theme.Display, Theme.Ink, box.Left + Theme.S(13), box.Top + Theme.S(2));
                    break;

                case Outcome.Incomplete:
                    Theme.FillRounded(g, box, box.Width / 2, Theme.Amber);
                    Theme.DrawText(g, "!", Theme.Display, Theme.Ink, box.Left + Theme.S(13), box.Top + Theme.S(2));
                    break;

                default:
                    Theme.FillRounded(g, box, box.Width / 2, Theme.Red);
                    using (var pen = new Pen(Color.White, Theme.S(3)))
                    {
                        int pad = Theme.S(11);
                        g.DrawLine(pen, box.Left + pad, box.Top + pad, box.Right - pad, box.Bottom - pad);
                        g.DrawLine(pen, box.Right - pad, box.Top + pad, box.Left + pad, box.Bottom - pad);
                    }
                    break;
            }
        }
    }
}
