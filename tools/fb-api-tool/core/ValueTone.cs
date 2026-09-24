namespace FbApiTool;

/// <summary>What a value means, for colouring purposes.</summary>
public enum ValueTone
{
    /// <summary>Ordinary text or a number — no special treatment.</summary>
    None,
    /// <summary>Nothing there: null, or an empty cell.</summary>
    Empty,
    /// <summary>Done, and done well: Fulfilled, Shipped, Approved, true.</summary>
    Positive,
    /// <summary>Under way: Issued, In Progress, Picking.</summary>
    Active,
    /// <summary>Wants a human: Pending Approval, Expired, Closed Short.</summary>
    Warning,
    /// <summary>Stopped or undone: Voided, Cancelled, false.</summary>
    Negative,
    /// <summary>Not started, or archived: Entered, Draft, Historical.</summary>
    Quiet,
}

/// <summary>
/// Works out what a response value means so the table and the JSON view can
/// colour it.
///
/// The status lists are Fishbowl's own words as they come back over REST —
/// order statuses, pick and shipment statuses, and the handful of flags that
/// arrive as strings. Grouping them by what they mean rather than by which
/// module they came from is the point: "Fulfilled" on a sales order and
/// "Received" on a purchase order are the same news to whoever is reading the
/// table.
///
/// Unknown values get <see cref="ValueTone.None"/> and are left alone. Guessing
/// from a substring would eventually colour a part description.
/// </summary>
public static class Tone
{
    private static readonly HashSet<string> Positive = new(StringComparer.OrdinalIgnoreCase)
    {
        "Fulfilled", "Shipped", "Received", "Closed", "Completed", "Complete", "Finished",
        "Approved", "Paid", "Posted", "Packed", "Picked", "Committed", "Active", "Enabled",
        "Success", "Successful", "Available", "OK", "true", "yes",
    };

    private static readonly HashSet<string> Active = new(StringComparer.OrdinalIgnoreCase)
    {
        "Issued", "In Progress", "InProgress", "Started", "Picking", "Partial", "Partially Fulfilled",
        "Scheduled", "Planned", "Printed", "Processing", "Open", "Running", "Reserved", "Split",
    };

    private static readonly HashSet<string> Warning = new(StringComparer.OrdinalIgnoreCase)
    {
        "Pending Approval", "Bid Request", "Estimate", "Expired", "On Hold", "Hold",
        "Closed Short", "Short", "Backordered", "Back Ordered", "Overdue", "Late",
        "Warning", "Unapproved", "Awaiting Approval", "Quote", "Not Available", "Unpaid",
    };

    private static readonly HashSet<string> Negative = new(StringComparer.OrdinalIgnoreCase)
    {
        "Void", "Voided", "Cancelled", "Canceled", "Rejected", "Failed", "Error", "Deleted",
        "Inactive", "Disabled", "Unfulfilled", "false", "no",
    };

    private static readonly HashSet<string> Quiet = new(StringComparer.OrdinalIgnoreCase)
    {
        "Entered", "Draft", "New", "Historical", "Archived", "None", "Pending", "Unknown",
        "Not Started", "Created",
    };

    public static ValueTone Classify(string? value)
    {
        var v = (value ?? "").Trim();
        if (v.Length == 0 || v.Equals("null", StringComparison.OrdinalIgnoreCase)) return ValueTone.Empty;

        if (Positive.Contains(v)) return ValueTone.Positive;
        if (Active.Contains(v)) return ValueTone.Active;
        if (Warning.Contains(v)) return ValueTone.Warning;
        if (Negative.Contains(v)) return ValueTone.Negative;
        if (Quiet.Contains(v)) return ValueTone.Quiet;

        return ValueTone.None;
    }

    /// <summary>
    /// Should this value be drawn as a chip rather than as plain text?
    ///
    /// Only for values that carry a recognised meaning. A chip around every
    /// cell would be noise, and around a part number it would be a lie.
    /// </summary>
    public static bool IsChip(string? value) => Classify(value) is not (ValueTone.None or ValueTone.Empty);
}
