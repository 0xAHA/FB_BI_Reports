using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace FbApiTool.Ui;

/// <summary>One stop on the tour: what to point at, and what to say about it.</summary>
/// <param name="Target">
/// Resolved when the step is shown rather than up front, because some of these
/// only exist once something has been opened.
/// </param>
public sealed record TourStop(string Title, string Body, Func<Control?> Target);

/// <summary>
/// The first-run walkthrough: dim the window, cut a hole around one control at
/// a time and say what it is for.
///
/// A tool with a sidebar, a tab strip, a workspace panel and two documentation
/// pages has more in it than is obvious, and the usual outcome is that half of
/// it is never found. Pointing at each part once is cheaper than a paragraph
/// nobody opens — and it turns itself off afterwards, because the second
/// showing of a tour is an irritation.
/// </summary>
public sealed class Tour
{
    private readonly Panel _host;
    private readonly IReadOnlyList<TourStop> _stops;
    private readonly Action _onFinished;

    private Grid? _layer;
    private Avalonia.Controls.Shapes.Path? _scrim;
    private Border? _card;
    private TextBlock? _title, _body, _count;
    private Button? _next;
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
        var res = Application.Current!;

        _scrim = new Avalonia.Controls.Shapes.Path
        {
            Fill = new SolidColorBrush(Color.FromArgb(0xB0, 0x10, 0x18, 0x1E)),
            IsHitTestVisible = true,
        };

        _title = new TextBlock { FontSize = 15, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap };
        _body = new TextBlock
        {
            FontSize = 12.5,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 7, 0, 0),
            Foreground = Brand.Sub,
        };
        _count = new TextBlock
        {
            FontSize = 11,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = Brand.Muted,
        };

        var skip = new Button { Content = "Skip", MinWidth = 74, Margin = new Thickness(0) };
        _next = new Button { Content = "Next", MinWidth = 94, Margin = new Thickness(0) };
        skip.Classes.Add("tool");
        _next.Classes.Add("primary");

        skip.Click += (_, _) => Finish();
        _next.Click += (_, _) => Next();

        var buttons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        buttons.Children.Add(skip);
        buttons.Children.Add(_next);

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
            Background = Brand.Surface,
            BorderBrush = Brand.Blue,
            BorderThickness = new Thickness(0, 0, 0, 3),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(16, 13),
            Width = 340,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            Child = stack,
            BoxShadow = BoxShadows.Parse("0 3 18 0 #4D000000"),
        };

        _layer = new Grid { Focusable = true };
        _layer.Children.Add(_scrim);
        _layer.Children.Add(_card);

        // The scrim swallows clicks, so the tour cannot be half-dismissed by
        // clicking the very thing it is pointing at.
        //
        // On the SCRIM, not on the layer. A layer-wide tunnelled handler runs
        // on the way DOWN to whatever was clicked, so it ate the tour's own
        // Skip and Next before either could see the press. The scrim sits
        // under the card in the same cell, so a click on the card never
        // reaches it and only the dark area is swallowed.
        _scrim.PointerPressed += (_, e) => e.Handled = true;

        // Escape leaves. Tunnelled, because nothing inside the layer wants it.
        _layer.AddHandler(InputElement.KeyDownEvent, (_, e) =>
        {
            if (e.Key == Key.Escape) { Finish(); e.Handled = true; }
        }, Avalonia.Interactivity.RoutingStrategies.Tunnel);

        Grid.SetRowSpan(_layer, 99);
        Grid.SetColumnSpan(_layer, 99);
        _host.Children.Add(_layer);

        // The hole is cut from the layer's own size, so it has to be recut when
        // the window is resized — otherwise the scrim keeps a stale rectangle
        // and the lit patch drifts off the control it belongs to.
        _layer.SizeChanged += (_, _) => Reposition();

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
        _next!.Content = _at == _stops.Count - 1 ? "Done" : "Next";

        Reposition();
    }

    /// <summary>
    /// Place the hole and the card for the current step.
    ///
    /// Posted rather than run inline: the card has just been given new text and
    /// has not been measured yet, so placing it now would use the previous
    /// step's height and leave it overlapping what it points at.
    /// </summary>
    private void Reposition() => Dispatcher.UIThread.Post(() =>
    {
        if (_layer is null || _at < 0 || _at >= _stops.Count) return;
        PointAt(_stops[_at].Target());
    }, DispatcherPriority.Loaded);

    /// <summary>
    /// Cut a hole over the target and put the card beside it.
    ///
    /// A target that is missing or off screen is not an error — the step is
    /// shown centred with no hole, which is better than skipping it and
    /// leaving a gap in the numbering.
    /// </summary>
    private void PointAt(Control? target)
    {
        var whole = new RectangleGeometry(new Rect(0, 0, _layer!.Bounds.Width, _layer.Bounds.Height));

        if (Visible(target) is not { } hole)
        {
            _scrim!.Data = whole;
            _card!.Margin = new Thickness(
                Math.Max(0, (_layer.Bounds.Width - _card.Width) / 2),
                Math.Max(0, (_layer.Bounds.Height - _card.Bounds.Height) / 2), 0, 0);
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
        var h = _card.Bounds.Height > 0 ? _card.Bounds.Height : 150;

        var x = Math.Clamp(hole.X, 12, Math.Max(12, _layer!.Bounds.Width - w - 12));

        if (hole.Bottom + gap + h <= _layer.Bounds.Height) return new Thickness(x, hole.Bottom + gap, 0, 0);
        if (hole.Y - gap - h >= 0) return new Thickness(x, hole.Y - gap - h, 0, 0);

        // A target taller than the card fits beside: whichever side has room.
        var y = Math.Clamp(hole.Y, 12, Math.Max(12, _layer.Bounds.Height - h - 12));
        return hole.Right + gap + w <= _layer.Bounds.Width
            ? new Thickness(hole.Right + gap, y, 0, 0)
            : new Thickness(Math.Max(12, hole.X - gap - w), y, 0, 0);
    }

    /// <summary>The target's bounds in overlay coordinates, if it is really on screen.</summary>
    private Rect? Visible(Control? target)
    {
        if (target is null || !target.IsVisible || _layer is null) return null;
        if (target.Bounds.Width <= 0 || target.Bounds.Height <= 0) return null;

        try
        {
            if (target.TranslatePoint(new Point(0, 0), _layer) is not { } at) return null;

            var r = new Rect(at.X, at.Y, target.Bounds.Width, target.Bounds.Height);
            return r.Intersects(new Rect(0, 0, _layer.Bounds.Width, _layer.Bounds.Height)) ? r : null;
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
