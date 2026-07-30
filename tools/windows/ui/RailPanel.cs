// The dark rail down the left of the window: wordmark, what this machine is, and - once the
// install starts - the live step checklist.
//
// The rail is the part that never changes shape, which is what stops the slideshow from
// feeling like the installer has wandered off.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;

namespace Lcs.Setup
{
    internal sealed class RailPanel : Control
    {
        private readonly List<string[]> _facts = new List<string[]>();
        private string _section = "";

        public RailPanel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Ink;

            Steps = new StepRail();
            Steps.Visible = false;
            Controls.Add(Steps);
        }

        public StepRail Steps { get; private set; }

        public string Section
        {
            get { return _section; }
            set { _section = value; LayoutChildren(); Invalidate(); }
        }

        // Either { label, value } for a two-column line, or { text } for a whole one.
        public void SetFacts(List<string[]> facts)
        {
            _facts.Clear();
            if (facts != null) _facts.AddRange(facts);
            Invalidate();
        }

        public void LayoutChildren()
        {
            int x = Theme.S(26);
            int top = SectionTop() + Theme.S(26);
            Steps.SetBounds(x, top, Width - x - Theme.S(16), Height - top - Theme.S(20));
        }

        private int SectionTop()
        {
            return Theme.S(150);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Theme.Smooth(g);
            using (var back = new SolidBrush(Theme.Ink))
            {
                g.FillRectangle(back, ClientRectangle);
            }

            int x = Theme.S(26);

            var mark = new Rectangle(x, Theme.S(28), Theme.S(26), Theme.S(26));
            Theme.FillRounded(g, mark, Theme.S(7), Theme.Amber);
            Theme.DrawText(g, "L", Theme.Heading, Theme.Ink, mark.Left + Theme.S(7), mark.Top + Theme.S(3));
            Theme.DrawText(g, "LCS setup", Theme.Heading, Theme.InkText, mark.Right + Theme.S(11), mark.Top + Theme.S(3));

            Theme.DrawWrapped(g, "Local Cloud Services. The AWS API, on your own machine.",
                Theme.Small, Theme.InkTextMuted,
                new Rectangle(x, Theme.S(70), Width - x - Theme.S(26), Theme.S(60)));

            int y = SectionTop();
            if (!string.IsNullOrEmpty(_section))
            {
                Theme.DrawText(g, _section.ToUpperInvariant(), Theme.Tiny, Theme.InkTextFaint, x, y);
            }

            if (Steps.Visible) return;

            y += Theme.S(26);
            foreach (string[] fact in _facts)
            {
                if (fact.Length == 1)
                {
                    y += Theme.DrawWrapped(g, fact[0], Theme.Small, Theme.InkTextMuted,
                        new Rectangle(x, y, Width - x - Theme.S(24), Theme.S(48))) + Theme.S(6);
                    continue;
                }

                Theme.DrawText(g, fact[0], Theme.Tiny, Theme.InkTextFaint, x, y);
                y += Theme.S(15);
                y += Theme.DrawWrapped(g, fact[1], Theme.Small, Theme.InkText,
                    new Rectangle(x, y, Width - x - Theme.S(24), Theme.S(48))) + Theme.S(12);
            }
        }
    }
}
