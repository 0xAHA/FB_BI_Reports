using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Path = System.Windows.Shapes.Path;

namespace FbApiTool;

/// <summary>One stop on the tour: what to point at, and what to say about it.</summary>
/// <param name="Target">
/// Resolved when the step is shown rather than up front, because some of these
/// only exist once something has been opened.
/// </param>
public sealed record TourStop(string Title, string Body, Func<FrameworkElement?> Target);

/// <summary>
/// The first-run walkthrough: dim the window, cut a hole around one control at
/// a time and say what it is for.
///
/// A tool with a sidebar, a tab strip, a workspace panel and two documentation
/// pages has more in it than is obvious, and the usual outcome is that half of
/// it is never found. Pointing at each part once is cheaper than writing a
/// paragraph nobody opens — and it turns itself off afterwards, because the
/// second showing of a tour is an irritation.
/// </summary>
public sealed class Tour
{
    private readonly Panel _host;
    private readonly IReadOnlyList<TourStop> _stops;
    private readonly Action _onFinished;

    private Grid? _layer;
    private Path? _scrim;
    private Border? _card;
    private TextBlock? _title, _body, _count;
    private int _at = -1;

    public Tour(Panel host, IReadOnlyList<TourStop> stops, Action onFinished)
    {
        _host = host;
        _stops = stops;
        _onFinished = onFinished;
    }

    public bool Running => _layer is not null;

    public void Start()
    {
        if (Running) return;
        Build();
        _at = -1;
        Next();
    }

    // ── THE OVERLAY ─────────────────────────────────────────────────────

    private void Build()
    {
        _scrim = new Path
        {
            Fill = new SolidColorBrush(Color.FromArgb(0xB0, 0x10, 0x18, 0x1E)),
            IsHitTestVisible = true,
        };

        _title = new TextBlock { FontSize = 15, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap };
        _body = new TextBlock
        {
            FontSize = 12.5, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 7, 0, 0),
            Foreground = (Brush)Application.Current.FindResource("FbTextSub"),
        };
        _count = new TextBlock
        {
            FontSize = 11, VerticalAlignment = VerticalAlignment.Center,
            Foreground = (Brush)Application.Current.FindResource("FbTextMuted"),
        };

        var skip = new Button { Content = "Skip", Style = (Style)Application.Current.FindResource("Tool"), MinWidth = 74 };
        var next = new Button
        {
            Content = "Next", Style = (Style)Application.Current.FindResource("Primary"),
            MinWidth = 94, Margin = new Thickness(8, 0, 0, 0),
        };
        skip.Click += (_, _) => Finish();
        next.Click += (_, _) => Next();

        var buttons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        buttons.Children.Add(skip);
        buttons.Children.Add(next);

        var foot = new DockPanel { Margin = new Thickness(0, 14, 0, 0) };
        DockPanel.SetDock(_count, Dock.Left);
        foot.Children.Add(_count);
        foot.Children.Add(buttons);

        var stack = new StackPanel();
        stack.Children.Add(_title);
        stack.Children.Add(_body);
        stack.Children.Add(foot);

        _card = new Border
        {
            Background = Brushes.White,
            BorderBrush = (Brush)Application.Current.FindResource("FbBlue"),
            BorderThickness = new Thickness(0, 0, 0, 3),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(16, 13, 16, 13),
            Width = 340,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            Child = stack,
            Effect = new System.Windows.Media.Effects.DropShadowEffect
            {
                BlurRadius = 18, ShadowDepth = 3, Opacity = 0.3, Color = Colors.Black,
            },
        };

        _layer = new Grid();
        _layer.Children.Add(_scrim);
        _layer.Children.Add(_card);

        // The scrim swallows clicks so the tour cannot be half-dismissed by
        // clicking the thing it is pointing at. Escape leaves.
        _layer.PreviewKeyDown += (_, e) => { if (e.Key == Key.Escape) { Finish(); e.Handled = true; } };
        _layer.MouseLeftButtonDown += (_, e) => e.Handled = true;

        Grid.SetRowSpan(_layer, 99);
        Grid.SetColumnSpan(_layer, 99);
        _host.Children.Add(_layer);

        _layer.Focusable = true;
        _layer.Focus();
    }

    private void Next()
    {
        _at++;
        if (_at >= _stops.Count) { Finish(); return; }

        var stop = _stops[_at];
        _title!.Text = stop.Title;
        _body!.Text = stop.Body;
        _count!.Text = "Step " + (_at + 1) + " of " + _stops.Count;

        // Laid out after the text has been measured, or the card is placed
        // using last step's height.
        _layer!.UpdateLayout();
        PointAt(stop.Target());
    }

    /// <summary>
    /// Cut a hole over the target and put the card beside it.
    ///
    /// A target that is missing or not on screen is not an error — the step is
    /// just shown centred with no hole, which is better than skipping it and
    /// leaving the numbering with a gap in it.
    /// </summary>
    private void PointAt(FrameworkElement? target)
    {
        var whole = new RectangleGeometry(new Rect(0, 0, _layer!.ActualWidth, _layer.ActualHeight));

        if (Visible(target) is not { } hole)
        {
            _scrim!.Data = whole;
            _card!.Margin = new Thickness(
                Math.Max(0, (_layer.ActualWidth - _card.Width) / 2),
                Math.Max(0, (_layer.ActualHeight - _card.ActualHeight) / 2), 0, 0);
            return;
        }

        var padded = new Rect(hole.X - 6, hole.Y - 6, hole.Width + 12, hole.Height + 12);
        _scrim!.Data = new CombinedGeometry(
            GeometryCombineMode.Exclude, whole,
            new RectangleGeometry(padded, 6, 6));

        _card!.Margin = Beside(padded);
    }

    /// <summary>Where the card goes: below the hole if it fits, else above, else beside.</summary>
    private Thickness Beside(Rect hole)
    {
        const double gap = 12;
        var w = _card!.Width;
        var h = _card.ActualHeight > 0 ? _card.ActualHeight : 150;

        var x = Math.Clamp(hole.X, 12, Math.Max(12, _layer!.ActualWidth - w - 12));

        if (hole.Bottom + gap + h <= _layer.ActualHeight) return new Thickness(x, hole.Bottom + gap, 0, 0);
        if (hole.Y - gap - h >= 0) return new Thickness(x, hole.Y - gap - h, 0, 0);

        // Tall target: sit to whichever side has room.
        var y = Math.Clamp(hole.Y, 12, Math.Max(12, _layer.ActualHeight - h - 12));
        return hole.Right + gap + w <= _layer.ActualWidth
            ? new Thickness(hole.Right + gap, y, 0, 0)
            : new Thickness(Math.Max(12, hole.X - gap - w), y, 0, 0);
    }

    /// <summary>The target's bounds in overlay coordinates, if it is really on screen.</summary>
    private Rect? Visible(FrameworkElement? target)
    {
        if (target is null || !target.IsVisible || target.ActualWidth <= 0 || target.ActualHeight <= 0)
            return null;

        try
        {
            var at = target.TransformToVisual(_layer).Transform(new Point(0, 0));
            var r = new Rect(at.X, at.Y, target.ActualWidth, target.ActualHeight);
            return r.IntersectsWith(new Rect(0, 0, _layer!.ActualWidth, _layer.ActualHeight)) ? r : null;
        }
        catch { return null; }
    }

    private void Finish()
    {
        if (_layer is not null) _host.Children.Remove(_layer);
        _layer = null;
        _onFinished();
    }
}
