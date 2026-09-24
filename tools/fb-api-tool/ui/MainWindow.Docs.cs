using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace FbApiTool.Ui;

/// <summary>
/// The Documentation tab.
///
/// Two documents that are deliberately not merged: one is about driving this
/// window, the other is the Fishbowl API guide, carried verbatim so that
/// nothing here can be mistaken for something Fishbowl said.
///
/// The browser is the platform's own — WebView2 on Windows, WebKitGTK on
/// Linux — rather than a bundled Chromium, which would cost over 100 MB for
/// one tab showing a local file. Where neither is installed the help opens in
/// the system browser instead of the tab going blank.
/// </summary>
public partial class MainWindow
{
    private NativeWebView? _docs;
    private bool _docsFailed;

    /// <summary>The published article. The one address here that is not this server's.</summary>
    private const string HelpSite = "https://help.fishbowlinventory.com/advanced/s/article/API";

    private void SetUpDocs()
    {
        DocTool.IsCheckedChanged += (_, _) => NavigateDocs();
        DocApi.IsCheckedChanged += (_, _) => NavigateDocs();

        BtnDocsBack.Click += (_, _) => { if (_docs?.CanGoBack == true) _docs.GoBack(); };
        BtnDocsReload.Click += (_, _) => NavigateDocs();
        BtnDocsOpen.Click += (_, _) => OpenInBrowser(CurrentDocPath());

        // All three leave the tab. Two of them live on the server rather than
        // on disk, so a follow-up link has to go somewhere with an address bar
        // and a back button that means something.
        MnuHelpSite.Click += (_, _) => OpenUrl(HelpSite);
        MnuServerDocs.Click += (_, _) => OpenServerDocs("/apidocs");
        MnuServerDocsJson.Click += (_, _) => OpenServerDocs("/apidocs.json");
    }

    /// <summary>
    /// Open one of the server's own reference pages, for whichever server is
    /// selected right now.
    ///
    /// Not authenticated, either of them, so this works before signing in —
    /// which is when it is most useful, because a catalog that does not match
    /// the server is a common reason a first request fails.
    /// </summary>
    private void OpenServerDocs(string path)
    {
        var baseUrl = (_fb.BaseUrl ?? "").TrimEnd('/');
        if (baseUrl.Length == 0)
        {
            TxtStatus.Text = "No server address to ask. Set one in Settings ▸ Servers.";
            return;
        }
        OpenUrl(baseUrl + path);
    }

    /// <summary>
    /// Build the browser the first time the tab is opened.
    ///
    /// Not at start-up: a web view costs a process and most sessions never
    /// open this tab.
    /// </summary>
    private void ShowDocs()
    {
        if (_docs is not null || _docsFailed) return;

        try
        {
            _docs = new NativeWebView { Background = Brand.Surface };

            // A link to somewhere else is a link OUT. The guides now open with
            // the Fishbowl help centre and the server's own /apidocs, and
            // following one of those inside a tab with no address bar strands
            // you somewhere you cannot navigate from or get back out of.
            _docs.NavigationStarted += (_, e) =>
            {
                if (e.Request is not { } target || IsLocalDoc(target)) return;

                e.Cancel = true;
                OpenUrl(target.ToString());
            };

            // A target="_blank" link never reaches NavigationStarted; it asks
            // for a window instead, and a web view with no chrome has nothing
            // to give it.
            _docs.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                if (e.Request is { } target) OpenUrl(target.ToString());
            };

            DocsHost.Children.Add(_docs);
            NavigateDocs();
        }
        catch (Exception ex)
        {
            _docs = null;
            _docsFailed = true;
            DocsHost.Children.Clear();
            DocsHost.Children.Add(NoBrowser(ex.Message));
        }
    }

    /// <summary>
    /// Is this one of the two guides on disk?
    ///
    /// Anchors within a page are file:// too, so they stay inside the tab and
    /// the contents list keeps working.
    /// </summary>
    private static bool IsLocalDoc(Uri url) => url.IsFile || url.Scheme == "about";

    private string CurrentDocPath() =>
        DocApi.IsChecked == true ? Assets.GuidePath() : Assets.ToolGuidePath();

    private void NavigateDocs()
    {
        if (_docs is null) return;

        try { _docs.Navigate(new Uri(new Uri(CurrentDocPath()).AbsoluteUri)); }
        catch (Exception ex) { TxtStatus.Text = "Could not open that document: " + ex.Message; }
    }

    /// <summary>
    /// What the tab says when the platform has no web view.
    ///
    /// The documents are ordinary HTML files on disk, so the answer is never
    /// "you cannot read this" — it is a button that opens them in whatever
    /// browser the machine does have.
    /// </summary>
    private Control NoBrowser(string why)
    {
        var openTool = new Button { Content = "Open the tool guide", Margin = new Avalonia.Thickness(0) };
        var openApi = new Button { Content = "Open the API guide", Margin = new Avalonia.Thickness(0) };
        openTool.Classes.Add("primary");
        openApi.Classes.Add("tool");

        openTool.Click += (_, _) => OpenInBrowser(Assets.ToolGuidePath());
        openApi.Click += (_, _) => OpenInBrowser(Assets.GuidePath());

        return new StackPanel
        {
            Spacing = 10,
            Margin = new Avalonia.Thickness(40),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            MaxWidth = 520,
            Children =
            {
                new TextBlock
                {
                    Text = "No browser to show this in",
                    FontSize = 16,
                    FontWeight = FontWeight.SemiBold,
                    HorizontalAlignment = HorizontalAlignment.Center,
                },
                new TextBlock
                {
                    Text = "This tab embeds whichever browser the machine already has — the Microsoft "
                         + "Edge WebView2 Runtime on Windows, WebKitGTK on Linux — and neither answered.\n\n"
                         + "Both guides are ordinary HTML files, so they open perfectly well on their own.",
                    FontSize = 13,
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = Brand.Sub,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    TextAlignment = TextAlignment.Center,
                },
                new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    Spacing = 8,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    Margin = new Avalonia.Thickness(0, 6, 0, 0),
                    Children = { openTool, openApi },
                },
                new TextBlock
                {
                    Text = why,
                    FontSize = 11,
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Avalonia.Thickness(0, 10, 0, 0),
                    Foreground = Brand.Muted,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    TextAlignment = TextAlignment.Center,
                },
            },
        };
    }

    /// <summary>
    /// Hand a local file to the desktop.
    ///
    /// UseShellExecute is what makes this the user's browser rather than an
    /// attempt to execute the HTML file, and it is also the only form that
    /// works unchanged on Windows and on Linux.
    /// </summary>
    private void OpenInBrowser(string path) => OpenUrl(new Uri(path).AbsoluteUri);

    private void OpenUrl(string url)
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true,
            });
            TxtStatus.Text = "Opened " + url + " in your browser.";
        }
        catch (Exception ex) { TxtStatus.Text = "Could not open " + url + ": " + ex.Message; }
    }
}
