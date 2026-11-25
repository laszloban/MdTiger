using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;

namespace MdTiger.Spike.Wpf;

/// <summary>
/// Hosts the front end in WebView2 and answers its bridge calls:
/// requests arrive as {id, method, args}; replies go back as {id, result}
/// or {id, error}; events are pushed as {event: {...}}.
/// </summary>
sealed class MainWindow : Window
{
    const string AppHost = "app.mdtiger";
    const string FileHost = "https://local.mdtiger/";

    WebView2 _web = new();
    readonly List<string> _initialFiles;
    readonly Dictionary<string, FileSystemWatcher> _watchers = new(StringComparer.OrdinalIgnoreCase);
    readonly List<string> _pendingOpens = new();
    bool _frontEndReady;

    public MainWindow(List<string> initialFiles)
    {
        _initialFiles = initialFiles;
        Title = "MdTiger spike (WPF + WebView2)";
        Width = 1280;
        Height = 860;
        Content = _web;
        Loaded += async (_, _) => await InitAsync();
        // NFR-10: tell the front end when the machine wakes up.
        SystemEvents.PowerModeChanged += (_, e) =>
        {
            if (e.Mode == PowerModes.Resume) Dispatcher.BeginInvoke(() => PostEvent(new JsonObject { ["type"] = "resumed" }));
        };
    }

    async Task InitAsync()
    {
        try
        {
            var dataDir = Path.Combine(Log.Dir, "spike-wpf-webview");
            var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
            await _web.EnsureCoreWebView2Async(env);
            var core = _web.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = true;
            core.SetVirtualHostNameToFolderMapping(AppHost, Path.Combine(AppContext.BaseDirectory, "wwwroot"), CoreWebView2HostResourceAccessKind.Allow);
            core.AddWebResourceRequestedFilter(FileHost + "*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += ServeLocalFile;
            core.WebMessageReceived += (_, e) => _ = HandleMessage(e.WebMessageAsJson);
            core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
            core.ProcessFailed += OnProcessFailed;
            core.Navigate($"https://{AppHost}/index.html");
        }
        catch (Exception ex)
        {
            Log.Write("error", $"WebView2 init failed: {ex}");
            Content = new System.Windows.Controls.TextBlock { Text = "WebView2 could not start. See the log in %LOCALAPPDATA%\\MdTiger.", Margin = new Thickness(20) };
        }
    }

    /// NFR-10: if the web engine's render process dies, reload. The front end
    /// restores unsaved edits from its drafts.
    void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        Log.Write("error", $"WebView2 process failed: {e.ProcessFailedKind} ({e.Reason})");
        _frontEndReady = false;
        if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
        {
            // The whole engine is gone: create a new control.
            Dispatcher.BeginInvoke(async () =>
            {
                _web.Dispose();
                _web = new WebView2();
                Content = _web;
                await InitAsync();
            });
        }
        else if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
        {
            Dispatcher.BeginInvoke(() => _web.CoreWebView2?.Reload());
        }
    }

    public void OpenFromOtherInstance(IEnumerable<string> paths)
    {
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        foreach (var p in paths)
        {
            if (_frontEndReady) PostEvent(new JsonObject { ["type"] = "open", ["path"] = p });
            else _pendingOpens.Add(p);
        }
    }

    void PostEvent(JsonObject ev) =>
        _web.CoreWebView2?.PostWebMessageAsJson(new JsonObject { ["event"] = ev }.ToJsonString());

    // ------------------------------------------------------------ bridge

    async Task HandleMessage(string json)
    {
        JsonNode? id = null;
        try
        {
            var msg = JsonNode.Parse(json)!.AsObject();
            id = msg["id"]?.DeepClone();
            var method = (string)msg["method"]!;
            var args = msg["args"] as JsonObject ?? new JsonObject();
            var result = await Dispatch(method, args);
            Reply(new JsonObject { ["id"] = id, ["result"] = result });
        }
        catch (Exception ex)
        {
            Log.Write("warn", $"bridge: {ex.Message}");
            Reply(new JsonObject { ["id"] = id, ["error"] = ex.Message });
        }
    }

    void Reply(JsonObject o) => _web.CoreWebView2?.PostWebMessageAsJson(o.ToJsonString());

    static string Str(JsonObject a, string key) => (string?)a[key] ?? throw new ArgumentException($"missing {key}");

    async Task<JsonNode?> Dispatch(string method, JsonObject a)
    {
        switch (method)
        {
            case "initialFiles":
                _frontEndReady = true;
                // Same answer on every call (the page asks again after a reload);
                // files handed over by later launches are merged in once.
                _initialFiles.AddRange(_pendingOpens.Where(p => !_initialFiles.Contains(p, StringComparer.OrdinalIgnoreCase)));
                _pendingOpens.Clear();
                var all = _initialFiles.ToList();
                return new JsonArray(all.Select(p => (JsonNode?)JsonValue.Create(p)).ToArray());

            case "readFile":
            {
                var path = Str(a, "path");
                var bytes = await File.ReadAllBytesAsync(path);
                bool bom = bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;
                var text = new UTF8Encoding(false).GetString(bytes, bom ? 3 : 0, bytes.Length - (bom ? 3 : 0));
                return new JsonObject { ["text"] = text, ["bom"] = bom, ["mtime"] = Mtime(path) };
            }

            case "writeFile":
            {
                var path = Str(a, "path");
                var text = Str(a, "text");
                bool bom = (bool?)a["bom"] ?? false;
                var tmp = path + ".mdtiger-tmp";
                await using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write))
                {
                    if (bom) await fs.WriteAsync(new byte[] { 0xEF, 0xBB, 0xBF });
                    await fs.WriteAsync(new UTF8Encoding(false).GetBytes(text));
                    await fs.FlushAsync();
                }
                File.Move(tmp, path, overwrite: true);
                return new JsonObject { ["mtime"] = Mtime(path) };
            }

            case "stat":
            {
                var path = Str(a, "path");
                return File.Exists(path) ? new JsonObject { ["mtime"] = Mtime(path) } : null;
            }

            case "watch":
                Watch(Str(a, "path"));
                return null;

            case "unwatch":
                if (_watchers.Remove(Str(a, "path"), out var w)) w.Dispose();
                return null;

            case "pickFile":
            {
                var dlg = new OpenFileDialog { Filter = "Markdown (*.md;*.markdown)|*.md;*.markdown|All files (*.*)|*.*" };
                return dlg.ShowDialog(this) == true ? JsonValue.Create(dlg.FileName) : null;
            }

            case "openExternal":
                OpenExternal(Str(a, "url"));
                return null;

            case "defaultAppStatus":
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice");
                var prog = key?.GetValue("ProgId") as string;
                return new JsonObject
                {
                    ["isDefault"] = prog?.Contains("mdtiger", StringComparison.OrdinalIgnoreCase) == true,
                    ["currentProgId"] = prog,
                };
            }

            case "openDefaultAppsSettings":
                OpenExternal("ms-settings:defaultapps");
                return null;

            case "ready":
            {
                double nav = (double?)a["msSinceNavigation"] ?? 0;
                double proc = Log.ProcessMs();
                Log.Write("info", $"ready: {proc:0} ms since process start, {nav:0} ms since navigation");
                var resultFile = Environment.GetEnvironmentVariable("MDTIGER_SPIKE_RESULT");
                if (resultFile != null) File.WriteAllText(resultFile, $"{proc:0};{nav:0}");
                if (Environment.GetEnvironmentVariable("MDTIGER_SPIKE_EXIT_ON_READY") != null)
                    _ = Dispatcher.BeginInvoke(() => Application.Current.Shutdown());
                return null;
            }

            case "log":
                Log.Write(Str(a, "level"), Str(a, "message"));
                return null;

            default:
                throw new NotSupportedException($"unknown method {method}");
        }
    }

    static double Mtime(string path) =>
        new DateTimeOffset(File.GetLastWriteTimeUtc(path)).ToUnixTimeMilliseconds();

    /// Watches the folder, so temp-file-and-rename saves by other editors are seen.
    void Watch(string path)
    {
        if (_watchers.ContainsKey(path)) return;
        var w = new FileSystemWatcher(Path.GetDirectoryName(path)!, Path.GetFileName(path))
        {
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size,
        };
        void Changed() => Dispatcher.BeginInvoke(() => PostEvent(new JsonObject { ["type"] = "changed", ["path"] = path }));
        w.Changed += (_, _) => Changed();
        w.Created += (_, _) => Changed();
        w.Renamed += (_, _) => Changed();
        w.Deleted += (_, _) => Changed();
        // Buffer overflow or a lost handle (e.g. around sleep): just re-check.
        w.Error += (_, e) => { Log.Write("warn", $"watcher: {e.GetException().Message}"); Changed(); };
        w.EnableRaisingEvents = true;
        _watchers[path] = w;
    }

    void ServeLocalFile(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        try
        {
            var query = new Uri(e.Request.Uri).Query.TrimStart('?');
            var pathParam = query.Split('&').Select(p => p.Split('=', 2)).FirstOrDefault(p => p[0] == "path");
            var path = pathParam is { Length: 2 } ? Uri.UnescapeDataString(pathParam[1]) : null;
            if (path == null || !File.Exists(path))
            {
                e.Response = _web.CoreWebView2.Environment.CreateWebResourceResponse(null, 404, "Not Found", "");
                return;
            }
            var type = Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".gif" => "image/gif",
                ".svg" => "image/svg+xml",
                ".webp" => "image/webp",
                ".bmp" => "image/bmp",
                _ => "application/octet-stream",
            };
            var stream = File.OpenRead(path);
            e.Response = _web.CoreWebView2.Environment.CreateWebResourceResponse(stream, 200, "OK", $"Content-Type: {type}");
        }
        catch (Exception ex)
        {
            Log.Write("warn", $"serve file: {ex.Message}");
        }
    }

    static void OpenExternal(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            Log.Write("warn", $"open {url}: {ex.Message}");
        }
    }
}
