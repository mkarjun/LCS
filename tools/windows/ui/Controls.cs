// The owner-drawn pieces: buttons, the step rail, and the progress strip.
//
// Everything here paints itself rather than using the Windows themed renderer, because half
// of these sit on a dark surface and the stock controls have no dark mode to ask for.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Lcs.Setup
{
    internal enum ButtonKind
    {
        Primary,     // the one obvious action on the screen
        Secondary,
        Ghost,       // on the dark rail, or next to a Primary that should win
        Link
    }

    internal sealed class FlatButton : Button
    {
        private readonly ButtonKind _kind;
        private bool _hover;
        private bool _down;

        public FlatButton(ButtonKind kind, string text)
        {
            _kind = kind;
            Text = text;
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            BackColor = Color.Transparent;
            Cursor = Cursors.Hand;
            Font = _kind == ButtonKind.Link ? Theme.Small : Theme.Body;
            AutoSize = false;
            TabStop = true;
            Height = Theme.S(_kind == ButtonKind.Link ? 22 : 34);
        }

        // Buttons on the dark rail cannot inherit the light palette, and there is only one
        // dark surface in the window, so a flag is cheaper than a second theme.
        public bool OnDarkSurface { get; set; }

        protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { _hover = false; _down = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { _down = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { _down = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Theme.Smooth(g);

            Rectangle bounds = new Rectangle(0, 0, Width - 1, Height - 1);
            int radius = Theme.S(6);
            Color face;
            Color label;

            switch (_kind)
            {
                case ButtonKind.Primary:
                    face = _down ? Theme.InkLight : (_hover ? Color.FromArgb(0x2E, 0x36, 0x42) : Theme.Ink);
                    label = Theme.InkText;
                    Theme.FillRounded(g, bounds, radius, Enabled ? face : Theme.BorderStrong);
                    break;

                case ButtonKind.Secondary:
                    face = _hover ? Theme.CanvasAlt : Theme.Canvas;
                    label = Enabled ? Theme.Text : Theme.TextFaint;
                    Theme.FillRounded(g, bounds, radius, face);
                    Theme.DrawRounded(g, bounds, radius, Theme.BorderStrong, 1f);
                    break;

                case ButtonKind.Ghost:
                    label = OnDarkSurface ? Theme.InkText : Theme.Text;
                    if (_hover)
                    {
                        Theme.FillRounded(g, bounds, radius,
                            OnDarkSurface ? Theme.InkLight : Theme.CanvasAlt);
                    }
                    break;

                default:
                    label = _hover ? Theme.AmberDeep : Theme.Blue;
                    break;
            }

            if (Focused && _kind != ButtonKind.Link)
            {
                Theme.DrawRounded(g, Rectangle.Inflate(bounds, -Theme.S(2), -Theme.S(2)), radius, Theme.Amber, 1.4f);
            }

            using (var format = new StringFormat())
            using (var brush = new SolidBrush(label))
            {
                format.Alignment = StringAlignment.Center;
                format.LineAlignment = StringAlignment.Center;
                g.DrawString(Text, Font, brush, new RectangleF(0, 0, Width, Height), format);
            }

            if (_kind == ButtonKind.Link && _hover)
            {
                SizeF size = g.MeasureString(Text, Font);
                float x = (Width - size.Width) / 2f;
                float y = (Height + size.Height) / 2f - Theme.S(3);
                using (var pen = new Pen(label, 1f))
                {
                    g.DrawLine(pen, x, y, x + size.Width, y);
                }
            }
        }
    }

    internal enum StepState
    {
        Pending,
        Active,
        Ok,
        Skip,
        Warn,
        Fail
    }

    internal sealed class StepItem
    {
        public string Key;
        public string Label;
        public StepState State;
    }

    // The live checklist down the rail.
    //
    // This is the one thing Ubuntu's slideshow gets wrong: it replaces the progress view, so
    // you trade knowing where you are for something to read. Keeping the rail visible means
    // the slides cost nothing.
    internal sealed class StepRail : Control
    {
        private readonly List<StepItem> _steps = new List<StepItem>();
        private readonly Timer _spin;
        private int _angle;

        public StepRail()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Theme.Ink;
            _spin = new Timer();
            _spin.Interval = 60;
            _spin.Tick += delegate { _angle = (_angle + 24) % 360; Invalidate(); };
        }

        public void SetSteps(IEnumerable<StepItem> steps)
        {
            _steps.Clear();
            _steps.AddRange(steps);
            Sync();
        }

        public bool HasSteps
        {
            get { return _steps.Count > 0; }
        }

        // A step the plan did not predict still has to appear: the script is the authority on
        // what it is doing, and silently dropping an event would leave the rail lying.
        public void Begin(string key, string label)
        {
            StepItem step = Find(key);
            if (step == null)
            {
                step = new StepItem();
                step.Key = key;
                step.Label = label;
                _steps.Add(step);
            }
            step.State = StepState.Active;
            Sync();
        }

        public void Complete(string key, StepState state)
        {
            StepItem step = Find(key);
            if (step == null) return;
            step.State = state;
            Sync();
        }

        // Nothing may be left spinning once the install has stopped, or the rail claims work is
        // still going on after the window has reported an outcome. What the leftovers become
        // depends on that outcome: a step still open at the end of a successful install
        // finished without saying so, and one open at the end of a failure did not.
        public void CloseUnfinished(StepState state)
        {
            foreach (StepItem step in _steps)
            {
                if (step.State == StepState.Active) step.State = state;
            }
            Sync();
        }

        public string ActiveKey
        {
            get
            {
                for (int i = _steps.Count - 1; i >= 0; i--)
                {
                    if (_steps[i].State == StepState.Active) return _steps[i].Key;
                }
                return null;
            }
        }

        public int CompletedCount
        {
            get
            {
                int done = 0;
                foreach (StepItem step in _steps)
                {
                    if (step.State != StepState.Pending && step.State != StepState.Active) done++;
                }
                return done;
            }
        }

        public int Count
        {
            get { return _steps.Count; }
        }

        private StepItem Find(string key)
        {
            foreach (StepItem step in _steps)
            {
                if (step.Key == key) return step;
            }
            return null;
        }

        private void Sync()
        {
            bool spinning = ActiveKey != null;
            if (spinning != _spin.Enabled) _spin.Enabled = spinning;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Theme.Smooth(g);
            using (var back = new SolidBrush(Theme.Ink))
            {
                g.FillRectangle(back, ClientRectangle);
            }

            int rowHeight = Theme.S(31);
            int glyph = Theme.S(16);
            int x = Theme.S(2);
            int y = Theme.S(2);

            foreach (StepItem step in _steps)
            {
                var box = new Rectangle(x, y + (rowHeight - glyph) / 2, glyph, glyph);
                DrawGlyph(g, box, step.State);

                Color color;
                Font font = Theme.Small;
                switch (step.State)
                {
                    case StepState.Active: color = Theme.InkText; font = Theme.SmallBold; break;
                    case StepState.Pending: color = Theme.InkTextFaint; break;
                    case StepState.Fail: color = Theme.Red; break;
                    default: color = Theme.InkTextMuted; break;
                }

                Theme.DrawText(g, step.Label, font, color, box.Right + Theme.S(11), y + Theme.S(6));
                y += rowHeight;
            }
        }

        private void DrawGlyph(Graphics g, Rectangle box, StepState state)
        {
            switch (state)
            {
                case StepState.Active:
                    // An arc that keeps moving, because most of these steps are waiting on
                    // somebody else's installer and have no honest percentage.
                    using (var pen = new Pen(Theme.InkLight, Theme.S(2)))
                    {
                        g.DrawEllipse(pen, box);
                    }
                    using (var pen = new Pen(Theme.Amber, Theme.S(2)))
                    {
                        pen.StartCap = LineCap.Round;
                        pen.EndCap = LineCap.Round;
                        g.DrawArc(pen, box, _angle, 100);
                    }
                    break;

                case StepState.Ok:
                    Theme.FillRounded(g, box, box.Width / 2, Theme.Green);
                    DrawTick(g, box, Theme.Ink);
                    break;

                case StepState.Skip:
                    using (var pen = new Pen(Theme.InkTextFaint, Theme.S(2)))
                    {
                        g.DrawEllipse(pen, box);
                        int mid = box.Top + box.Height / 2;
                        g.DrawLine(pen, box.Left + Theme.S(4), mid, box.Right - Theme.S(4), mid);
                    }
                    break;

                case StepState.Warn:
                    Theme.FillRounded(g, box, box.Width / 2, Theme.Amber);
                    Theme.DrawText(g, "!", Theme.SmallBold, Theme.Ink,
                        box.Left + Theme.S(5), box.Top - Theme.S(1));
                    break;

                case StepState.Fail:
                    Theme.FillRounded(g, box, box.Width / 2, Theme.Red);
                    using (var pen = new Pen(Theme.InkText, Theme.S(2)))
                    {
                        pen.StartCap = LineCap.Round;
                        pen.EndCap = LineCap.Round;
                        int pad = Theme.S(5);
                        g.DrawLine(pen, box.Left + pad, box.Top + pad, box.Right - pad, box.Bottom - pad);
                        g.DrawLine(pen, box.Right - pad, box.Top + pad, box.Left + pad, box.Bottom - pad);
                    }
                    break;

                default:
                    using (var pen = new Pen(Theme.InkTextFaint, Theme.S(2)))
                    {
                        g.DrawEllipse(pen, Rectangle.Inflate(box, -Theme.S(2), -Theme.S(2)));
                    }
                    break;
            }
        }

        public static void DrawTick(Graphics g, Rectangle box, Color color)
        {
            using (var pen = new Pen(color, Math.Max(1.6f, Theme.S(2))))
            {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                float left = box.Left + box.Width * 0.27f;
                float mid = box.Left + box.Width * 0.44f;
                float right = box.Left + box.Width * 0.74f;
                g.DrawLine(pen, left, box.Top + box.Height * 0.52f, mid, box.Top + box.Height * 0.70f);
                g.DrawLine(pen, mid, box.Top + box.Height * 0.70f, right, box.Top + box.Height * 0.32f);
            }
        }
    }

    internal sealed class ProgressStrip : Control
    {
        private readonly Timer _marquee;
        private int _offset;
        private int _value = -1;

        public ProgressStrip()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer, true);
            Height = Theme.S(5);
            _marquee = new Timer();
            _marquee.Interval = 24;
            _marquee.Tick += delegate
            {
                _offset = (_offset + Theme.S(4)) % Math.Max(1, Width + Theme.S(180));
                Invalidate();
            };
        }

        // -1 means the script does not know how long this takes, so the bar says that rather
        // than inventing a number that stalls at 90%.
        public int Value
        {
            get { return _value; }
            set
            {
                _value = value;
                _marquee.Enabled = _value < 0;
                Invalidate();
            }
        }

        public void Stop()
        {
            _marquee.Enabled = false;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Theme.Smooth(g);

            var track = new Rectangle(0, 0, Width - 1, Height - 1);
            Theme.FillRounded(g, track, Height / 2, Theme.Border);

            if (_value >= 0)
            {
                int filled = (int)(Width * Math.Min(100, _value) / 100.0);
                if (filled > 2)
                {
                    Theme.FillRounded(g, new Rectangle(0, 0, filled, Height - 1), Height / 2, Theme.Amber);
                }
                return;
            }

            int span = Theme.S(150);
            int x = _offset - span;
            using (GraphicsPath clip = Theme.RoundedRect(track, Height / 2))
            {
                g.SetClip(clip);
                Theme.FillRounded(g, new Rectangle(x, 0, span, Height - 1), Height / 2, Theme.Amber);
                g.ResetClip();
            }
        }
    }
}
