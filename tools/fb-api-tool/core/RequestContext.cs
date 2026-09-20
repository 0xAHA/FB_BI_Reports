namespace FbApiTool;

/// <summary>
/// Everything a request pane needs from the window around it.
///
/// This is the contract between the core and whichever UI is drawing it: the
/// pane asks for the base URL, the token, a place to put status text and a way
/// to raise a dialog, and does not know what draws any of them. It lives here
/// rather than beside a view so that two front ends cannot drift into two
/// slightly different ideas of what a request pane is entitled to ask for.
///
/// The two that raise a dialog are asynchronous. WPF can show a modal and
/// return an answer on the spot; most toolkits, Avalonia included, cannot —
/// so the signature that works everywhere is the one that waits.
/// </summary>
public sealed class RequestContext
{
    public required ApiCatalog Catalog { get; init; }
    public required ApiRunner Runner { get; init; }
    public required Func<string> BaseUrl { get; init; }
    public required Func<string?> Token { get; init; }
    public required Action<string> Status { get; init; }
    public required Action<HistoryEntry> Record { get; init; }

    /// <summary>Read a persisted preference, e.g. whether to keep query results.</summary>
    public required Func<string, string?> Setting { get; init; }

    public required Action<string, string> SetSetting { get; init; }

    /// <summary>The live variable list, shared with the workspace panel.</summary>
    public required IReadOnlyCollection<Variable> Variables { get; init; }

    /// <summary>Set or add a variable: name, value, where it came from.</summary>
    public required Action<string, string, string?> SetVariable { get; init; }

    /// <summary>The signed-in user's access rights, or null when not connected.</summary>
    public required Func<IReadOnlySet<string>?> Rights { get; init; }

    public required Func<bool> Authenticated { get; init; }

    /// <summary>Asked before a write to production; false cancels the send.</summary>
    public required Func<string, string, Task<bool>> ConfirmSend { get; init; }

    public required Action<SavedRequest> Store { get; init; }

    public required Func<DbSchema.Snapshot?> Schema { get; init; }

    public required Func<bool, Task<DbSchema.Snapshot?>> LoadSchema { get; init; }

    /// <summary>A one-line input box, owned by the window: title, label, initial value.</summary>
    public required Func<string, string, string, Task<string?>> Ask { get; init; }
}
