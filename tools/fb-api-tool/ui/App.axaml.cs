using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Threading;

namespace FbApiTool.Ui;

public partial class App : Application
{
    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    /// <summary>
    /// A binding to a palette token, for a control coloured from code.
    ///
    /// The markup form of this is {DynamicResource Key}. There is no code form
    /// that keeps following the theme, so this is it: assigning a brush from a
    /// lookup gives a control the colour that was current when it was BUILT,
    /// and it keeps that colour through every subsequent theme change.
    /// </summary>
    public static Avalonia.Markup.Xaml.MarkupExtensions.DynamicResourceExtension Token(string key) =>
        new Avalonia.Markup.Xaml.MarkupExtensions.DynamicResourceExtension(key);

    public override void OnFrameworkInitializationCompleted()
    {
        // Every path that can reach the top of the stack, caught and written
        // down. Without these the window simply vanishes, which is what
        // happened: there was nothing in %LOCALAPPDATA% to read because
        // nothing was ever asked to write it.
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            if (e.ExceptionObject is Exception ex) Log.Crash("AppDomain", ex);
        };

        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Log.Crash("Task", e.Exception);
            e.SetObserved();
        };

        // A throw inside a handler kills the UI thread and takes the window
        // with it. Caught here it becomes a line in the log and a window that
        // is still up — which is the difference between a bug report and a
        // shrug.
        Dispatcher.UIThread.UnhandledException += (_, e) =>
        {
            Log.Crash("UI thread", e.Exception);
            e.Handled = true;
        };

        Log.Info("--- started " + BuildInfo.Long);

        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            try
            {
                desktop.MainWindow = new MainWindow();
            }
            catch (Exception ex)
            {
                // Nothing to show it in, so the log is the only record there
                // will be.
                Log.Crash("MainWindow", ex);
                throw;
            }

            desktop.ShutdownRequested += (_, _) => Log.Info("--- shutting down");
        }

        base.OnFrameworkInitializationCompleted();
    }
}
