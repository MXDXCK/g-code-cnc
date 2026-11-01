using System.Diagnostics;
using System.Reflection;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace GcodeCNC;

static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

/// <summary>Окно с WebView2: страница приложения распаковывается в %LOCALAPPDATA%\GcodeCNC\web и открывается как https://app.local (работает без интернета).</summary>
class MainForm : Form
{
    readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(15, 17, 21) };
    readonly string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GcodeCNC");
    FormWindowState prevState;
    FormBorderStyle prevBorder;

    public MainForm()
    {
        Text = "Fresa — G-код для ЧПУ";
        BackColor = Color.FromArgb(15, 17, 21);
        Width = 1400; Height = 900;
        StartPosition = FormStartPosition.CenterScreen;
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.ico"))
            if (s != null) Icon = new Icon(s);
        Controls.Add(web);
        KeyPreview = true;
        KeyDown += (_, e) => { if (e.KeyCode == Keys.F11) ToggleFullscreen(); };
        Load += async (_, _) => await StartAsync();
    }

    async Task StartAsync()
    {
        try
        {
            var webDir = Path.Combine(dataDir, "web");
            ExtractWeb(webDir);
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "WebView2"));
            await web.EnsureCoreWebView2Async(env);
            var core = web.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping("app.local", webDir, CoreWebView2HostResourceAccessKind.Allow);
            core.Settings.IsStatusBarEnabled = false;
            // внешние ссылки (Releases на GitHub и т.п.) — в обычном браузере
            core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
            core.NavigationStarting += (_, e) =>
            {
                if (!e.Uri.StartsWith("https://app.local/", StringComparison.OrdinalIgnoreCase)) { e.Cancel = true; OpenExternal(e.Uri); }
            };
            core.ContainsFullScreenElementChanged += (_, _) => { if (core.ContainsFullScreenElement != (FormBorderStyle == FormBorderStyle.None)) ToggleFullscreen(); };
            web.Source = new Uri("https://app.local/index.html");
        }
        catch (WebView2RuntimeNotFoundException)
        {
            if (MessageBox.Show("Нужен компонент Microsoft Edge WebView2 Runtime (в Windows 10/11 обычно уже есть).\n\nОткрыть страницу загрузки?",
                    "Fresa", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/#download-section");
            Close();
        }
        catch (Exception ex)
        {
            MessageBox.Show("Не удалось запустить: " + ex.Message, "Fresa", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    static void ExtractWeb(string dir)
    {
        var asm = Assembly.GetExecutingAssembly();
        foreach (var name in asm.GetManifestResourceNames())
        {
            if (!name.StartsWith("web/")) continue;
            var path = Path.Combine(dir, name.Substring(4).Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            using var src = asm.GetManifestResourceStream(name)!;
            using var dst = File.Create(path);
            src.CopyTo(dst);
        }
    }

    static void OpenExternal(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }

    void ToggleFullscreen()
    {
        if (FormBorderStyle != FormBorderStyle.None)
        {
            prevState = WindowState; prevBorder = FormBorderStyle;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;
            WindowState = FormWindowState.Maximized;
        }
        else
        {
            FormBorderStyle = prevBorder;
            WindowState = prevState;
        }
    }
}
