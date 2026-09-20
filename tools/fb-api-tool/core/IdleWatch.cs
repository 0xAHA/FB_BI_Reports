namespace FbApiTool;

/// <summary>What the idle watch thinks should happen right now.</summary>
public enum IdleState
{
    /// <summary>Recently used. Nothing to do.</summary>
    Active,
    /// <summary>Idle long enough to warn, with the grace period still running.</summary>
    Warning,
    /// <summary>Grace period over — sign out.</summary>
    Expired,
}

/// <summary>
/// Signs the tool out after a spell of doing nothing.
///
/// Fishbowl licences are seat-limited, so a session this tool is holding onto
/// is a seat somebody else cannot have. Leaving one open over a long lunch is
/// the normal way that happens, and the tool has no way of knowing it is not
/// wanted any more — so it asks.
///
/// The timing is the HTML tool's: ten minutes of nothing, then a two-minute
/// countdown that any activity cancels. Long enough not to interrupt someone
/// reading a large response, short enough to matter over lunch.
///
/// Deliberately a plain object with a clock passed in, so the behaviour can be
/// tested without waiting twelve minutes for it.
/// </summary>
public sealed class IdleWatch(TimeSpan? idle = null, TimeSpan? grace = null)
{
    // Settable: both come from a preference, and changing one in the settings
    // window has to take effect without restarting the tool.
    public TimeSpan IdleAfter { get; set; } = idle ?? TimeSpan.FromMinutes(10);
    public TimeSpan Grace { get; set; } = grace ?? TimeSpan.FromMinutes(2);

    private DateTime _lastActivity = DateTime.UtcNow;

    /// <summary>Whether the watch is running at all. Off when not signed in.</summary>
    public bool Enabled { get; set; }

    public void Touch(DateTime? now = null) => _lastActivity = now ?? DateTime.UtcNow;

    public TimeSpan IdleFor(DateTime? now = null) => (now ?? DateTime.UtcNow) - _lastActivity;

    public IdleState State(DateTime? now = null)
    {
        if (!Enabled) return IdleState.Active;

        var idleFor = IdleFor(now);
        if (idleFor >= IdleAfter + Grace) return IdleState.Expired;
        if (idleFor >= IdleAfter) return IdleState.Warning;
        return IdleState.Active;
    }

    /// <summary>Seconds left before sign-out, while warning. Zero otherwise.</summary>
    public int SecondsLeft(DateTime? now = null)
    {
        if (State(now) != IdleState.Warning) return 0;
        var left = IdleAfter + Grace - IdleFor(now);
        return Math.Max(0, (int)Math.Ceiling(left.TotalSeconds));
    }

    /// <summary>The countdown message, ready to show.</summary>
    public string Message(DateTime? now = null)
    {
        var left = SecondsLeft(now);
        return left == 0
            ? ""
            : "Idle — signing out in " + left + "s to release the licence. Move the mouse or press a key to stay.";
    }
}
