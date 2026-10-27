//! 「用真实浏览器打开」—— 本插件唯一能拿到**活的网页**的方式。
//!
//! 为什么必须这样做
//! ----------------
//! 插件 UI 是 `sandbox="allow-scripts"` 的 iframe：没有网络、没有父页面 DOM，而且
//! CSP 只放行 `frame-src 'self' blob:`，所以**任何指向站点的 `<iframe>` 都会被浏览器
//! 拒绝**（真实宿主更严，是 `default-src 'none'`）。也就是说"把网站嵌进 DBX 面板"
//! 在插件体系内做不到，换什么内核都一样。
//!
//! Sidecar 是原生进程，可以直接拉起系统已装的 Chrome / Edge，开一个**独立 profile**
//! 的阅读窗口（`--app`，没有地址栏和标签页）。这条路：
//!   * 页面是真渲染的 —— 抖音、小红书、视频、登录墙全都正常；
//!   * 样式可自定义 —— 用户当前的阅读样式会被写进 profile 的
//!     `User StyleSheets/Custom.css`，浏览器原生生效；
//!   * 不碰用户自己的浏览器 —— 独立 `--user-data-dir`，登录态、书签、扩展都不受影响。

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// 浏览器可执行文件：先看环境变量覆盖，再按常见位置找 Chrome / Edge。
pub fn find_browser() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("DBX_WEBVIEW_BROWSER") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    for root in [
        std::env::var_os("ProgramFiles"),
        std::env::var_os("ProgramFiles(x86)"),
        std::env::var_os("LOCALAPPDATA"),
    ]
    .into_iter()
    .flatten()
    {
        let root = PathBuf::from(root);
        candidates.push(root.join("Google/Chrome/Application/chrome.exe"));
        candidates.push(root.join("Microsoft/Edge/Application/msedge.exe"));
    }
    // 非 Windows：常见命令名。
    #[cfg(not(windows))]
    {
        for name in [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ] {
            candidates.push(PathBuf::from(name));
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

/// 阅读窗口专用 profile。放在插件数据目录下，重启 DBX 后登录态仍在。
pub fn profile_dir() -> PathBuf {
    let base = std::env::var_os("DBX_PLUGIN_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("APPDATA").map(|value| PathBuf::from(value).join("com.dbx.app"))
        })
        .unwrap_or_else(std::env::temp_dir);
    base.join("web-reader-browser-profile")
}

/// 把用户当前的阅读样式写进 profile 的 `User StyleSheets/Custom.css`。
///
/// 用自定义样式表而不是 CDP 注入：不需要任何远程调试通道，浏览器原生支持，
/// 而且在那些"调试端口/命名管道被安全策略拦掉"的机器上照样有效。
pub fn write_user_css(profile: &Path, css: &str) -> std::io::Result<PathBuf> {
    let directory = profile.join("User StyleSheets");
    std::fs::create_dir_all(&directory)?;
    let path = directory.join("Custom.css");
    // Chrome 只在启动时读这个文件，所以每次打开前重写一遍。
    let banner = "/* 由 DBX Browser 插件生成：这里的内容会在每次打开阅读窗口时被覆盖。 */\n";
    std::fs::write(&path, format!("{banner}{css}\n"))?;
    Ok(path)
}

/// 阅读窗口 profile 里的 History 文件路径。
///
/// Chrome / Edge 把默认 profile 放在 `Default/` 下；如果那里还没有，就退回根目录
/// （某些启动方式会直接用根目录），调用方拿到不存在的路径时会得到明确的错误信息。
pub fn history_path(profile: &Path) -> PathBuf {
    let default = profile.join("Default").join("History");
    if default.is_file() {
        return default;
    }
    let root = profile.join("History");
    if root.is_file() {
        return root;
    }
    // 都没写出来时返回标准位置，让错误信息指向用户真正会看到的地方。
    default
}

/// 这个 profile 是否已经有浏览器在跑（决定返回给用户哪句提示）。
fn profile_in_use(profile: &Path) -> bool {
    // Chrome / Edge 在 profile 目录里放一个 lockfile 表示"正在使用中"。
    profile.join("lockfile").is_file() || profile.join("SingletonLock").exists()
}

/// 打开一个阅读窗口。
///
/// 返回 (浏览器路径, profile 目录, 之前是否已经开着这个 profile)。
pub fn open(url: &str, profile: &Path) -> Result<(PathBuf, PathBuf, bool), String> {
    let browser = find_browser().ok_or_else(|| {
        "没有找到 Chrome 或 Edge。装一个，或者用 DBX_WEBVIEW_BROWSER 环境变量指定浏览器路径。"
            .to_string()
    })?;
    std::fs::create_dir_all(profile).map_err(|error| format!("创建 profile 目录失败：{error}"))?;
    let already_running = profile_in_use(profile);

    let mut command = Command::new(&browser);
    command
        // `--app` 去掉地址栏与标签页，看起来就是个干净的阅读窗口。
        .arg(format!("--app={url}"))
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--window-size=1180,900")
        // 不让浏览器的输出挂住 sidecar 的管道。
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS(0x8) | CREATE_NEW_PROCESS_GROUP(0x200)：
        // 浏览器要独立于 sidecar 活着，DBX 关掉也不该把它带走。
        command.creation_flags(0x0000_0008 | 0x0000_0200);
    }

    command
        .spawn()
        .map_err(|error| format!("启动浏览器失败：{error}"))?;

    // 注意：如果这个 profile 已经有实例在跑，Chrome 会把 URL 交给它、自己立刻退出。
    // 这不是失败，所以这里不检查退出码，只回报"之前是否已经开着"。
    Ok((browser, profile.to_path_buf(), already_running))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_custom_css_into_the_profile() {
        let profile = std::env::temp_dir().join("dbx-browser-test-profile");
        let _ = std::fs::remove_dir_all(&profile);
        let path = write_user_css(&profile, "body { color: red; }").expect("write css");
        let written = std::fs::read_to_string(&path).expect("read back");
        assert!(written.contains("body { color: red; }"), "{written}");
        assert!(written.contains("DBX Browser"), "应该带一句来源说明：{written}");
        let _ = std::fs::remove_dir_all(&profile);
    }

    #[test]
    fn profile_dir_lives_under_the_plugin_data_dir() {
        std::env::set_var("DBX_PLUGIN_DATA_DIR", r"C:\temp\dbx-test");
        let dir = profile_dir();
        assert!(dir.starts_with(r"C:\temp\dbx-test"), "{}", dir.display());
        assert!(dir.ends_with("web-reader-browser-profile"), "{}", dir.display());
        std::env::remove_var("DBX_PLUGIN_DATA_DIR");
    }

    #[test]
    fn browser_override_wins_when_it_exists() {
        std::env::set_var("DBX_WEBVIEW_BROWSER", r"C:\definitely\not\here.exe");
        // 路径不存在时不应该被采纳
        assert!(find_browser().map(|path| path.display().to_string()) != Some(r"C:\definitely\not\here.exe".into()));
        std::env::remove_var("DBX_WEBVIEW_BROWSER");
    }
}
