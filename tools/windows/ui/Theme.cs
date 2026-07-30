// Colours, fonts, and DPI for the graphical installer.
//
// Squid ink and amber are the LCS console's own palette, deliberately: the installer is the
// first screen of the product, and it should not look like it came from somewhere else.
//
// C# 5 only. This is compiled by the .NET Framework 4 csc.exe that ships with Windows, so
// there is no string interpolation, no ?. and no expression-bodied members anywhere in the
// installer's source - that is the price of needing no SDK to build it.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;

namespace Lcs.Setup
{
    internal static class Theme
    {
        public const int WindowWidth = 940;
        public const int WindowHeight = 624;
        public const int RailWidth = 248;

        public static readonly Color Ink = Rgb(0x16, 0x19, 0x1F);
        public static readonly Color InkLight = Rgb(0x24, 0x2B, 0x35);
        public static readonly Color InkText = Rgb(0xE9, 0xED, 0xF2);
        public static readonly Color InkTextMuted = Rgb(0x8D, 0x99, 0xA8);
        public static readonly Color InkTextFaint = Rgb(0x5E, 0x6A, 0x79);

        public static readonly Color Canvas = Color.White;
        public static readonly Color CanvasAlt = Rgb(0xF6, 0xF7, 0xF8);
        public static readonly Color Border = Rgb(0xDA, 0xDF, 0xE4);
        public static readonly Color BorderStrong = Rgb(0xAF, 0xB9, 0xC3);

        public static readonly Color Text = Rgb(0x16, 0x19, 0x1F);
        public static readonly Color TextMuted = Rgb(0x59, 0x65, 0x73);
        public static readonly Color TextFaint = Rgb(0x8B, 0x97, 0xA6);

        public static readonly Color Amber = Rgb(0xFF, 0x99, 0x00);
        public static readonly Color AmberDeep = Rgb(0xC4, 0x73, 0x00);
        public static readonly Color AmberWash = Rgb(0xFF, 0xF3, 0xE0);
        public static readonly Color Green = Rgb(0x1D, 0x9E, 0x6E);
        public static readonly Color Red = Rgb(0xC7, 0x33, 0x1A);
        public static readonly Color Blue = Rgb(0x0A, 0x6A, 0xC9);
        public static readonly Color BlueWash = Rgb(0xEB, 0xF3, 0xFC);

        public static readonly Color CodeBg = Rgb(0x0F, 0x14, 0x1A);
        public static readonly Color CodeText = Rgb(0xC5, 0xCF, 0xDA);
        public static readonly Color CodeMuted = Rgb(0x76, 0x83, 0x92);

        public static Font Display;      // the one big heading per screen
        public static Font Heading;
        public static Font Body;
        public static Font BodyBold;
        public static Font Small;
        public static Font SmallBold;
        public static Font Tiny;
        public static Font Mono;
        public static Font MonoSmall;

        private static float _scale = 1f;

        // Everything is laid out in scaled pixels while the fonts stay in points, because
        // points already follow the system DPI. The manifest asks for system DPI awareness
        // rather than per-monitor: dragging an installer between differently scaled screens
        // is not worth the code it would take to repaint correctly.
        public static void Init(IWin32Window probe)
        {
            Control control = probe as Control;
            if (control != null)
            {
                using (Graphics g = control.CreateGraphics())
                {
                    _scale = g.DpiX / 96f;
                }
            }

            string sans = PickFamily("Segoe UI Variable Text", "Segoe UI", "Tahoma");
            string sansHeavy = PickFamily("Segoe UI Semibold", "Segoe UI", "Tahoma");
            string mono = PickFamily("Cascadia Mono", "Consolas", "Courier New");

            Display = new Font(sansHeavy, 15.5f, FontStyle.Regular, GraphicsUnit.Point);
            Heading = new Font(sansHeavy, 11f, FontStyle.Regular, GraphicsUnit.Point);
            Body = new Font(sans, 9.75f, FontStyle.Regular, GraphicsUnit.Point);
            BodyBold = new Font(sansHeavy, 9.75f, FontStyle.Regular, GraphicsUnit.Point);
            Small = new Font(sans, 8.75f, FontStyle.Regular, GraphicsUnit.Point);
            SmallBold = new Font(sansHeavy, 8.75f, FontStyle.Regular, GraphicsUnit.Point);
            Tiny = new Font(sans, 8f, FontStyle.Regular, GraphicsUnit.Point);
            Mono = new Font(mono, 9.25f, FontStyle.Regular, GraphicsUnit.Point);
            MonoSmall = new Font(mono, 8.25f, FontStyle.Regular, GraphicsUnit.Point);
        }

        public static int S(int pixels)
        {
            return (int)Math.Round(pixels * _scale);
        }

        // Semibold and Cascadia are not on every supported build, and a missing family
        // silently becomes something arbitrary rather than throwing, so ask first.
        private static string PickFamily(params string[] candidates)
        {
            foreach (string candidate in candidates)
            {
                foreach (FontFamily family in FontFamily.Families)
                {
                    if (string.Equals(family.Name, candidate, StringComparison.OrdinalIgnoreCase))
                    {
                        return candidate;
                    }
                }
            }
            return candidates[candidates.Length - 1];
        }

        public static void Smooth(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        }

        public static GraphicsPath RoundedRect(Rectangle bounds, int radius)
        {
            int d = radius * 2;
            var path = new GraphicsPath();
            if (d <= 0)
            {
                path.AddRectangle(bounds);
                return path;
            }

            path.AddArc(bounds.Left, bounds.Top, d, d, 180, 90);
            path.AddArc(bounds.Right - d, bounds.Top, d, d, 270, 90);
            path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
            path.AddArc(bounds.Left, bounds.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        public static void FillRounded(Graphics g, Rectangle bounds, int radius, Color color)
        {
            using (GraphicsPath path = RoundedRect(bounds, radius))
            using (var brush = new SolidBrush(color))
            {
                g.FillPath(brush, path);
            }
        }

        public static void DrawRounded(Graphics g, Rectangle bounds, int radius, Color color, float width)
        {
            using (GraphicsPath path = RoundedRect(bounds, radius))
            using (var pen = new Pen(color, width))
            {
                g.DrawPath(pen, path);
            }
        }

        // Word-wraps into a fixed width and reports the height used, so a panel can stack
        // paragraphs without a layout engine.
        public static int DrawWrapped(Graphics g, string text, Font font, Color color, Rectangle bounds)
        {
            if (string.IsNullOrEmpty(text)) return 0;

            using (var brush = new SolidBrush(color))
            using (var format = new StringFormat(StringFormatFlags.LineLimit))
            {
                format.Trimming = StringTrimming.Word;
                g.DrawString(text, font, brush, bounds, format);
                SizeF used = g.MeasureString(text, font, bounds.Width, format);
                return (int)Math.Ceiling(used.Height);
            }
        }

        public static int MeasureWrapped(Graphics g, string text, Font font, int width)
        {
            if (string.IsNullOrEmpty(text)) return 0;
            using (var format = new StringFormat(StringFormatFlags.LineLimit))
            {
                format.Trimming = StringTrimming.Word;
                return (int)Math.Ceiling(g.MeasureString(text, font, width, format).Height);
            }
        }

        public static void DrawText(Graphics g, string text, Font font, Color color, int x, int y)
        {
            using (var brush = new SolidBrush(color))
            {
                g.DrawString(text, font, brush, x, y);
            }
        }

        private static Color Rgb(int r, int g, int b)
        {
            return Color.FromArgb(r, g, b);
        }
    }
}
