using Avalonia.Controls;

namespace FbApiTool.Ui;

/// <summary>
/// The first-run walkthrough, and what it points at.
///
/// The stops live here rather than in Tour because they are about this window:
/// Tour knows how to cut a hole and place a card, and nothing about what is
/// worth pointing at.
/// </summary>
public partial class MainWindow
{
    private Tour? _tour;

    private IReadOnlyList<TourStop> TourStops() =>
    [
        new("Pick a server, then connect",
            "The list holds an address and app identity for each Fishbowl you use. A server marked as "
            + "production asks before every write.",
            () => CmbProfile),

        new("Find an endpoint",
            "Search by name, path or anything in the description. The GET / POST / DELETE pills filter the "
            + "tree, and everything in it is generated from the server's own /apidocs.json.",
            () => TxtSearch),

        new("Click one to open it",
            "Each endpoint opens in its own tab with its parameters, a body template built from the "
            + "documented fields, and the access right it needs when the docs name one.",
            () => TreeEndpoints),

        new("Requests stay open in tabs",
            "Work on several at once. Enter sends from any field; inside the editors it is Ctrl+Enter. The "
            + "URL bar is editable if you need to send something the form cannot express.",
            () => Tabs),

        new("Saved requests, variables and history",
            "Keep a request by name, define {{variables}} to thread an id from one call into the next, and "
            + "look back at what you have already sent. Drag the top edge to make this taller.",
            () => Workspace),

        new("A whole tab for SQL",
            "The Data tab is a SQL workspace over /api/data-query: a schema browser, completion that knows "
            + "your tables, a formatter, and table output.",
            () => TabData),

        new("Two built-in guides",
            "One for this tool, one for the Fishbowl API itself. Both work with no connection.",
            () => TabDocs),

        new("Everything else is in here",
            "Servers, which view a response opens on, how long before an idle session signs out, whether a "
            + "row limit is added to a query — and this tour, if you want it again.",
            () => BtnSettings),
    ];

    /// <summary>
    /// Run the tour. Doing nothing if one is already running matters: the
    /// settings window can ask for it while the first-run check is also about
    /// to, and two overlays would fight over the same scrim.
    /// </summary>
    private void StartTour()
    {
        if (_tour?.Running == true) return;

        TourHost.IsHitTestVisible = true;
        _tour = new Tour(TourHost, TourStops(), () =>
        {
            TourHost.IsHitTestVisible = false;
            Set(Prefs.TipsDone, "1");
            TxtStatus.Text = "Tour finished. Run it again from the settings button.";
        });
        _tour.Start();
    }

    /// <summary>
    /// Offer it once, after the connect dialog rather than over it.
    ///
    /// Pointing at the server picker while a modal covers it would be the tour
    /// contradicting itself on its first step.
    /// </summary>
    private void OfferTour()
    {
        if (!Prefs.TourPending(Get)) return;
        StartTour();
    }
}
