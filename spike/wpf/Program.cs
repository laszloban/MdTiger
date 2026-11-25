// MdTiger spike: thin WPF + WebView2 shell around the shared TypeScript front
// end. Implements the same Host interface as the Tauri shell.

using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Windows;

namespace MdTiger.Spike.Wpf;

static class Program
{
    static readonly string PipeName = "MdTiger.Spike.Wpf." + Environment.UserName;

    [STAThread]
    static int Main(string[] args)
    {
        var files = FilesFromArgs(args, Environment.CurrentDirectory);

        // FR-FILE-10: one instance; later launches hand their files over.
        using var mutex = new Mutex(true, @"Local\MdTiger.Spike.Wpf", out bool first);
        if (!first)
        {
            SendToFirstInstance(files);
            return 0;
        }

        // NFR-11: unexpected errors are logged, never shown as crash dialogs.
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Write("error", $"unhandled: {e.ExceptionObject}");
        TaskScheduler.UnobservedTaskException += (_, e) => { Log.Write("error", $"unobserved: {e.Exception}"); e.SetObserved(); };

        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        app.DispatcherUnhandledException += (_, e) => { Log.Write("error", $"dispatcher: {e.Exception}"); e.Handled = true; };

        var window = new MainWindow(files);
        StartPipeServer(window);
        return app.Run(window);
    }

    public static List<string> FilesFromArgs(IEnumerable<string> args, string cwd) =>
        args.Where(a => !a.StartsWith('-'))
            .Select(a => Path.GetFullPath(a, cwd))
            .ToList();

    static void SendToFirstInstance(List<string> files)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            client.Connect(3000);
            var payload = Encoding.UTF8.GetBytes(string.Join("\n", files) + "\n");
            client.Write(payload);
        }
        catch (Exception ex)
        {
            Log.Write("warn", $"could not reach the first instance: {ex.Message}");
        }
    }

    static void StartPipeServer(MainWindow window)
    {
        var thread = new Thread(() =>
        {
            while (true)
            {
                try
                {
                    using var server = new NamedPipeServerStream(PipeName, PipeDirection.In, 1);
                    server.WaitForConnection();
                    using var reader = new StreamReader(server, Encoding.UTF8);
                    var paths = reader.ReadToEnd().Split('\n', StringSplitOptions.RemoveEmptyEntries);
                    window.Dispatcher.BeginInvoke(() => window.OpenFromOtherInstance(paths));
                }
                catch (Exception ex)
                {
                    Log.Write("warn", $"pipe: {ex.Message}");
                    Thread.Sleep(500);
                }
            }
        }) { IsBackground = true, Name = "single-instance pipe" };
        thread.Start();
    }
}

static class Log
{
    static readonly object Gate = new();
    public static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MdTiger");

    public static void Write(string level, string message)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Dir);
                File.AppendAllText(Path.Combine(Dir, "spike-wpf.log"), $"{DateTimeOffset.Now.ToUnixTimeMilliseconds()} [{level}] {message}{Environment.NewLine}");
            }
        }
        catch
        {
            // logging must never throw
        }
    }

    public static double ProcessMs() => (DateTime.Now - Process.GetCurrentProcess().StartTime).TotalMilliseconds;
}
