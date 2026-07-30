// The slideshow that fills the middle of the window while the install runs.
//
// Advances itself every few seconds, jumps to whichever slide suits the step now running,
// pauses while the pointer is over it, and can be driven by the dots or the arrow keys. Every
// illustration is drawn here rather than shipped as a bitmap, which is why the whole
// installer is still one small exe.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Lcs.Setup
{
    internal sealed class SlideView : Control
    {
        private const int AdvanceMs = 7000;

        private readonly List<Slide> _slides;
        private readonly Timer _advance;
        private readonly List<Rectangle> _dots = new List<Rectangle>();
        private Rectangle _prev;
        private Rectangle _next;
        private int _index;
        private bool _paused;
        private string _context;

        public SlideView(List<Slide> slides)
        {
            _slides = slides;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Canvas;

            _advance = new Timer();
            _advance.Interval = AdvanceMs;
            _advance.Tick += delegate { Advance(1); };
            _advance.Start();
        }

        // Called when the install moves to a new step. If a slide was written for that step,
        // show it; otherwise leave the rotation alone rather than jumping for no reason.
        public void FollowStep(string stepKey)
        {
            if (string.IsNullOrEmpty(stepKey) || stepKey == _context) return;
            _context = stepKey;

            for (int i = 0; i < _slides.Count; i++)
            {
                if (_slides[i].Steps == null) continue;
                foreach (string key in _slides[i].Steps)
                {
                    if (key != stepKey) continue;
                    Show(i);
                    return;
                }
            }
        }

        private void Show(int index)
        {
            _index = ((index % _slides.Count) + _slides.Count) % _slides.Count;
            _advance.Stop();
            if (!_paused) _advance.Start();
            Invalidate();
        }

        private void Advance(int delta)
        {
            Show(_index + delta);
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            // Reading is the whole point of the slide, so hovering stops it moving under you.
            _paused = true;
            _advance.Stop();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            _paused = false;
            _advance.Start();
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            Cursor = HitIndex(e.Location) >= 0 || _prev.Contains(e.Location) || _next.Contains(e.Location)
                ? Cursors.Hand
                : Cursors.Default;
            base.OnMouseMove(e);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            int dot = HitIndex(e.Location);
            if (dot >= 0) { Show(dot); }
            else if (_prev.Contains(e.Location)) { Advance(-1); }
            else if (_next.Contains(e.Location)) { Advance(1); }
            base.OnMouseDown(e);
        }

        public bool HandleKey(Keys key)
        {
            if (key == Keys.Left) { Advance(-1); return true; }
            if (key == Keys.Right) { Advance(1); return true; }
            return false;
        }

        private int HitIndex(Point point)
        {
            for (int i = 0; i < _dots.Count; i++)
            {
                if (Rectangle.Inflate(_dots[i], Theme.S(4), Theme.S(8)).Contains(point)) return i;
            }
            return -1;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Theme.Smooth(g);
            using (var back = new SolidBrush(Theme.Canvas))
            {
                g.FillRectangle(back, ClientRectangle);
            }

            if (_slides.Count == 0) return;
            Slide slide = _slides[_index];

            int pad = Theme.S(30);
            int artWidth = Theme.S(196);
            int artHeight = Theme.S(150);
            int textWidth = Math.Max(Theme.S(220), Width - pad * 2 - artWidth - Theme.S(24));

            DrawBadge(g, pad, pad);

            // Measured first, then centred in what is left between the badge and the dots.
            // Slides differ by a hundred pixels depending on whether they carry a snippet, and
            // top-aligning them all leaves the short ones stranded at the ceiling.
            int titleHeight = Theme.MeasureWrapped(g, slide.Title, Theme.Display, textWidth);
            int bodyHeight = Theme.MeasureWrapped(g, slide.Body, Theme.Body, textWidth);
            int codeHeight = CodeHeight(slide);

            // The prose shares its row with the illustration; the snippet goes underneath both
            // at full width, so a long command line has room and nothing lands on the artwork.
            int upperHeight = Math.Max(titleHeight + Theme.S(12) + bodyHeight, artHeight);
            int blockHeight = upperHeight + (codeHeight > 0 ? Theme.S(22) + codeHeight : 0);

            int regionTop = pad + Theme.S(34);
            int regionHeight = Height - pad - Theme.S(26) - regionTop;
            int top = regionTop + Math.Max(0, (regionHeight - blockHeight) / 2);

            var art = new Rectangle(Width - pad - artWidth,
                top + Math.Max(0, (upperHeight - artHeight) / 2), artWidth, artHeight);
            SlideArtist.Draw(g, slide.Art, art);

            int y = top;
            Theme.DrawWrapped(g, slide.Title, Theme.Display, Theme.Text,
                new Rectangle(pad, y, textWidth, titleHeight + Theme.S(4)));
            y += titleHeight + Theme.S(12);

            Theme.DrawWrapped(g, slide.Body, Theme.Body, Theme.TextMuted,
                new Rectangle(pad, y, textWidth, bodyHeight + Theme.S(4)));

            if (codeHeight > 0)
            {
                DrawCode(g, slide.Code,
                    new Rectangle(pad, top + upperHeight + Theme.S(22), Width - pad * 2, codeHeight));
            }

            DrawFooter(g, pad);
        }

        private int CodeHeight(Slide slide)
        {
            if (slide.Code == null || slide.Code.Length == 0) return 0;
            return slide.Code.Length * Theme.S(19) + Theme.S(20);
        }

        private void DrawBadge(Graphics g, int x, int y)
        {
            string label = "While you wait";
            SizeF size = g.MeasureString(label, Theme.Tiny);
            var pill = new Rectangle(x, y, (int)size.Width + Theme.S(16), Theme.S(20));
            Theme.FillRounded(g, pill, Theme.S(4), Theme.AmberWash);
            Theme.DrawText(g, label, Theme.Tiny, Theme.AmberDeep, x + Theme.S(8), y + Theme.S(3));

            string counter = (_index + 1) + " of " + _slides.Count;
            Theme.DrawText(g, counter, Theme.Tiny, Theme.TextFaint, pill.Right + Theme.S(10), y + Theme.S(3));
        }

        private void DrawCode(Graphics g, string[] lines, Rectangle box)
        {
            int lineHeight = Theme.S(19);
            Theme.FillRounded(g, box, Theme.S(7), Theme.CodeBg);

            int y = box.Top + Theme.S(10);
            for (int i = 0; i < lines.Length; i++)
            {
                // A line that is output rather than input is dimmed, so a snippet reads as a
                // transcript without needing a prompt character nobody types.
                bool isOutput = i > 0 && !lines[i].StartsWith("aws") && !lines[i].StartsWith("lcs")
                                      && !lines[i].StartsWith("http");
                Theme.DrawText(g, lines[i], Theme.Mono,
                    isOutput ? Theme.CodeMuted : Theme.CodeText, box.Left + Theme.S(14), y);
                y += lineHeight;
            }
        }

        private void DrawFooter(Graphics g, int pad)
        {
            _dots.Clear();
            int size = Theme.S(4);
            int y = Height - pad - size;
            int x = pad;

            for (int i = 0; i < _slides.Count; i++)
            {
                bool current = i == _index;
                var dot = new Rectangle(x, y, current ? Theme.S(22) : Theme.S(14), size);
                Theme.FillRounded(g, dot, size / 2, current ? Theme.Amber : Theme.Border);
                _dots.Add(dot);
                x = dot.Right + Theme.S(6);
            }

            int chevron = Theme.S(22);
            _next = new Rectangle(Width - pad - chevron, y - chevron / 2, chevron, chevron);
            _prev = new Rectangle(_next.Left - chevron - Theme.S(6), _next.Top, chevron, chevron);
            DrawChevron(g, _prev, true);
            DrawChevron(g, _next, false);
        }

        private void DrawChevron(Graphics g, Rectangle box, bool pointsLeft)
        {
            using (var pen = new Pen(Theme.BorderStrong, Theme.S(2)))
            {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                int cx = box.Left + box.Width / 2;
                int cy = box.Top + box.Height / 2;
                int arm = Theme.S(4);
                int tip = pointsLeft ? cx - arm : cx + arm;
                g.DrawLine(pen, pointsLeft ? cx + arm / 2 : cx - arm / 2, cy - arm, tip, cy);
                g.DrawLine(pen, tip, cy, pointsLeft ? cx + arm / 2 : cx - arm / 2, cy + arm);
            }
        }
    }

    // Flat line drawings, two strokes and a fill each. They exist to give the eye somewhere
    // to rest, not to illustrate anything precisely, so none of them is worth a bitmap.
    internal static class SlideArtist
    {
        public static void Draw(Graphics g, SlideArt art, Rectangle box)
        {
            switch (art)
            {
                case SlideArt.Container: Container(g, box); break;
                case SlideArt.Terminal: Terminal(g, box); break;
                case SlideArt.Console: ConsoleWindow(g, box); break;
                case SlideArt.Layers: Layers(g, box); break;
                case SlideArt.Lambda: Lambda(g, box); break;
                default: Storage(g, box); break;
            }
        }

        private static void Container(Graphics g, Rectangle box)
        {
            int cell = Math.Min(box.Width, box.Height) / 4;
            var outer = new Rectangle(box.Left + cell / 2, box.Top + cell / 2, cell * 3, cell * 3);
            Theme.FillRounded(g, outer, Theme.S(10), Theme.CanvasAlt);
            Theme.DrawRounded(g, outer, Theme.S(10), Theme.Border, 1.4f);

            int inner = cell * 3 / 4;
            int gap = (outer.Width - inner * 2) / 3;
            for (int row = 0; row < 2; row++)
            {
                for (int column = 0; column < 2; column++)
                {
                    var chip = new Rectangle(
                        outer.Left + gap + column * (inner + gap),
                        outer.Top + gap + row * (inner + gap),
                        inner, inner);
                    bool accent = row == column;
                    Theme.FillRounded(g, chip, Theme.S(5), accent ? Theme.Amber : Theme.Ink);
                }
            }
        }

        private static void Terminal(Graphics g, Rectangle box)
        {
            var frame = new Rectangle(box.Left + Theme.S(8), box.Top + Theme.S(16),
                                      box.Width - Theme.S(16), box.Height - Theme.S(40));
            Theme.FillRounded(g, frame, Theme.S(8), Theme.CodeBg);

            int dot = Theme.S(6);
            for (int i = 0; i < 3; i++)
            {
                var light = new Rectangle(frame.Left + Theme.S(10) + i * (dot + Theme.S(5)),
                                          frame.Top + Theme.S(10), dot, dot);
                Theme.FillRounded(g, light, dot / 2, i == 0 ? Theme.Amber : Theme.CodeMuted);
            }

            int y = frame.Top + Theme.S(28);
            int[] widths = { 62, 44, 74, 36 };
            for (int i = 0; i < widths.Length; i++)
            {
                int width = frame.Width * widths[i] / 100;
                Theme.FillRounded(g, new Rectangle(frame.Left + Theme.S(12), y, width, Theme.S(5)),
                    Theme.S(2), i == 0 ? Theme.Amber : Theme.CodeMuted);
                y += Theme.S(13);
            }
        }

        private static void ConsoleWindow(Graphics g, Rectangle box)
        {
            var frame = new Rectangle(box.Left + Theme.S(8), box.Top + Theme.S(14),
                                      box.Width - Theme.S(16), box.Height - Theme.S(36));
            Theme.FillRounded(g, frame, Theme.S(8), Theme.CanvasAlt);
            Theme.DrawRounded(g, frame, Theme.S(8), Theme.Border, 1.4f);

            var bar = new Rectangle(frame.Left, frame.Top, frame.Width, Theme.S(20));
            using (var brush = new SolidBrush(Theme.Ink))
            using (var clip = Theme.RoundedRect(frame, Theme.S(8)))
            {
                g.SetClip(clip);
                g.FillRectangle(brush, bar);
                g.ResetClip();
            }
            Theme.FillRounded(g, new Rectangle(bar.Left + Theme.S(9), bar.Top + Theme.S(7),
                Theme.S(46), Theme.S(6)), Theme.S(3), Theme.Amber);

            var side = new Rectangle(frame.Left + Theme.S(1), bar.Bottom + Theme.S(6),
                                     Theme.S(40), frame.Bottom - bar.Bottom - Theme.S(12));
            int y = side.Top;
            while (y < side.Bottom - Theme.S(6))
            {
                Theme.FillRounded(g, new Rectangle(side.Left + Theme.S(8), y, Theme.S(26), Theme.S(4)),
                    Theme.S(2), Theme.BorderStrong);
                y += Theme.S(12);
            }

            var panel = new Rectangle(side.Right + Theme.S(8), bar.Bottom + Theme.S(8),
                                      frame.Right - side.Right - Theme.S(18), frame.Bottom - bar.Bottom - Theme.S(18));
            Theme.FillRounded(g, panel, Theme.S(5), Color.White);
            Theme.DrawRounded(g, panel, Theme.S(5), Theme.Border, 1f);
        }

        private static void Layers(Graphics g, Rectangle box)
        {
            int height = Theme.S(26);
            int width = box.Width - Theme.S(40);
            int x = box.Left + Theme.S(20);
            int y = box.Top + Theme.S(22);

            Color[] fills = { Theme.Amber, Theme.InkLight, Theme.Ink };
            string[] labels = { "LCS", "Docker", "WSL2" };

            for (int i = 0; i < 3; i++)
            {
                var slab = new Rectangle(x + i * Theme.S(6), y + i * (height + Theme.S(8)),
                                         width - i * Theme.S(12), height);
                Theme.FillRounded(g, slab, Theme.S(6), fills[i]);
                Theme.DrawText(g, labels[i], Theme.Tiny,
                    i == 0 ? Theme.Ink : Theme.InkText,
                    slab.Left + Theme.S(10), slab.Top + Theme.S(6));
            }
        }

        private static void Lambda(Graphics g, Rectangle box)
        {
            var circle = new Rectangle(box.Left + box.Width / 2 - Theme.S(42),
                                       box.Top + Theme.S(24), Theme.S(84), Theme.S(84));
            Theme.FillRounded(g, circle, circle.Width / 2, Theme.CanvasAlt);
            Theme.DrawRounded(g, circle, circle.Width / 2, Theme.Border, 1.4f);

            using (var pen = new Pen(Theme.Amber, Theme.S(4)))
            {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                int cx = circle.Left + circle.Width / 2;
                int cy = circle.Top + circle.Height / 2;
                var points = new PointF[]
                {
                    new PointF(cx + Theme.S(6), cy - Theme.S(22)),
                    new PointF(cx - Theme.S(10), cy + Theme.S(2)),
                    new PointF(cx + Theme.S(2), cy + Theme.S(2)),
                    new PointF(cx - Theme.S(6), cy + Theme.S(22))
                };
                g.DrawLines(pen, points);
            }
        }

        private static void Storage(Graphics g, Rectangle box)
        {
            int width = box.Width - Theme.S(56);
            int x = box.Left + Theme.S(28);
            int y = box.Top + Theme.S(26);
            int height = Theme.S(18);

            for (int i = 0; i < 3; i++)
            {
                var drum = new Rectangle(x, y + i * (height + Theme.S(10)), width, height);
                Theme.FillRounded(g, drum, height / 2, i == 2 ? Theme.Amber : Theme.CanvasAlt);
                Theme.DrawRounded(g, drum, height / 2, i == 2 ? Theme.AmberDeep : Theme.BorderStrong, 1.4f);
            }
        }
    }
}
