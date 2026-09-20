using System.Text.RegularExpressions;

namespace FbApiTool;

/// <summary>What an endpoint needs, and whether the signed-in user has it.</summary>
public sealed record RightCheck(string Documented, string? Right, bool? Held)
{
    /// <summary>True only when we both know the right and know it is missing.</summary>
    public bool Blocked => Held == false;

    public string Label => Right is null
        ? "needs " + Documented
        : Held switch
        {
            true => "✓ " + Right,
            false => "✗ " + Right + " — you do not have this",

            // Not signed in. "needs X" would read as a verdict on a user we
            // have not looked at.
            _ => Right + " — sign in to check",
        };
}

/// <summary>
/// Reads the access right an endpoint needs out of its description, and checks
/// it against the rights the login handed back.
///
/// The value is turning a 403 into a prediction. A 403 from Fishbowl does not
/// say which right was missing, so the usual next step is guessing whether the
/// payload is wrong or the account is — and that guess costs far more time than
/// the call did.
///
/// It only ever reports what the documentation says. Nothing here infers a
/// right from a path: a wrong prediction would send someone to an administrator
/// to fix a permission that was never the problem.
/// </summary>
public static partial class AccessRights
{
    // "Requires MO_VIEW", "Requires the Sales Order-View access right".
    //
    // Every word of the prose form has to be capitalised. Allowing any run
    // of letters and spaces let the greedy tail swallow the words that
    // FOLLOW the right — "Sales Order-View access right" came out as the
    // name of a right nobody holds, and the chip then called an entitled
    // user blocked.
    [GeneratedRegex(@"\bRequires\s+(?:the\s+)?([A-Z][A-Z_]{3,}|[A-Z][a-z]+(?: [A-Z][a-z]+)*-[A-Z][a-z]+(?: [A-Z][a-z]+)*)",
                    RegexOptions.None)]
    private static partial Regex RequiresRx();

    /// <summary>
    /// The CONSTANT_CASE names the documentation uses, mapped to the strings
    /// the login actually returns.
    ///
    /// The two vocabularies are different: the docs say MO_VIEW, the server
    /// says "Manufacture Order-View". Only pairs that have been confirmed are
    /// listed — an unmapped name is reported as documented and left unchecked,
    /// which is honest, rather than guessed at.
    /// </summary>
    private static readonly Dictionary<string, string> Known = new(StringComparer.OrdinalIgnoreCase)
    {
        ["MO_VIEW"] = "Manufacture Order-View",
        ["MO_EDIT"] = "Manufacture Order-Edit",
        ["MO_CREATE"] = "Manufacture Order-Create",
        ["MO_DELETE"] = "Manufacture Order-Delete",
        ["PO_VIEW"] = "Purchase Order-View",
        ["PO_EDIT"] = "Purchase Order-Edit",
        ["PO_CREATE"] = "Purchase Order-Create",
        ["PO_DELETE"] = "Purchase Order-Delete",
        ["SO_VIEW"] = "Sales Order-View",
        ["SO_EDIT"] = "Sales Order-Edit",
        ["SO_CREATE"] = "Sales Order-Create",
        ["SO_DELETE"] = "Sales Order-Delete",
        ["TO_VIEW"] = "Transfer Order-View",
        ["TO_EDIT"] = "Transfer Order-Edit",
        ["WO_VIEW"] = "Work Order-View",
        ["WO_EDIT"] = "Work Order-Edit",
        ["PART_VIEW"] = "Part-View",
        ["PART_EDIT"] = "Part-Edit",
        ["PRODUCT_VIEW"] = "Product-View",
        ["INVENTORY_VIEW"] = "Inventory-View",
        ["PICK_VIEW"] = "Picking-View",
        ["SHIP_VIEW"] = "Shipping-View",
        ["RECEIVE_VIEW"] = "Receiving-View",
        ["CUSTOMER_VIEW"] = "Customer-View",
        ["VENDOR_VIEW"] = "Vendor-View",
    };

    /// <summary>
    /// The entry Fishbowl grants alongside the individual rights when a group
    /// has everything. Whoever holds it cannot be blocked, so there is nothing
    /// for the chip to warn about.
    /// </summary>
    public const string FullRights = "Full Rights";

    /// <summary>The right this endpoint documents, or null if it documents none.</summary>
    public static RightCheck? For(ApiEndpoint endpoint, IReadOnlySet<string>? held)
    {
        var m = RequiresRx().Match(endpoint.Description ?? "");
        if (!m.Success) return null;

        var documented = m.Groups[1].Value.Trim();

        // Already in the server's own vocabulary?
        var right = documented.Contains('-') ? documented
                  : Known.TryGetValue(documented, out var mapped) ? mapped
                  : null;

        if (right is null || held is null) return new RightCheck(documented, right, null);

        // Two users the chip has nothing to offer.
        //
        // An empty list is the built-in administrator: they belong to no user
        // group, so there are no useraccess rows to enumerate and the login
        // returns nothing. That is the ABSENCE of a rights record, not a user
        // who holds no rights — reading it as the latter drew a cross on every
        // endpoint for the one account that can definitely call them all.
        //
        // Full Rights is the other: it means everything, by definition.
        //
        // Neither can be blocked, so neither gets a chip. A chip that cannot
        // be wrong and cannot be useful is just noise on the toolbar.
        if (held.Count == 0 || held.Contains(FullRights)) return null;

        return new RightCheck(documented, right, held.Contains(right));
    }
}
