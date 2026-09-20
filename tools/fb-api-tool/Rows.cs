using System.Windows;
using System.Windows.Controls;

namespace FbApiTool;

/// <summary>Finding the list row a mouse event actually landed on.</summary>
public static class Rows
{
    /// <summary>
    /// The item behind whatever was clicked, or null if the click missed the
    /// rows (the scrollbar, the padding around them).
    ///
    /// Walking up from the original source is the only reliable way: the event
    /// arrives from whichever TextBlock or Border inside the template was under
    /// the pointer, never from the row itself.
    /// </summary>
    public static object? Clicked(ItemsControl list, object? source)
    {
        if (source is not DependencyObject d) return null;

        var container = list.ContainerFromElement(d);
        return container is null ? null : list.ItemContainerGenerator.ItemFromContainer(container);
    }
}
