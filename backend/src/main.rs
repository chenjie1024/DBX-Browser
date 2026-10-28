//! DBX 网页阅读插件 —— 原生 Sidecar。
//!
//! 职责：代替浏览器沙箱去抓取任意站点，把 HTML 清理成可安全渲染的片段，并按站点
//! 规则抽取正文 / 章节导航。所有日志写 stderr，stdout 只输出 JSON-RPC 协议消息。

use std::sync::Mutex;
use std::time::Duration;

use dbx_plugin_sdk::{
    PluginEmitter, PluginError, PluginHandler, PluginMetadata, PluginServer, PluginTransport,
    RequestContext,
};
use engine::cleaner::{clean, CleanOptions, CleanedPage, Engine, RenderMode};
use engine::{history, net, site};
use serde_json::{json, Map, Value};

mod books;
mod browser;
#[cfg(windows)]
mod live;

/// UI ↔ 宿主 JSON 桥单次参数上限是 2 MiB，Sidecar JSON 单条消息上限 8 MiB。
/// 留出安全余量，避免宿主直接拒收。
const MAX_RESPONSE_HTML_BYTES: usize = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_TIMEOUT_SECS: u64 = 60;
/// 合并分页时最多往后抓几页，防止在异常站点上无限连抓。
const MAX_CHAPTER_PAGES: usize = 20;

fn main() -> std::io::Result<()> {
    let metadata = PluginMetadata::new("com.dbx.webview", env!("CARGO_PKG_VERSION"))
        .with_capability("workbench")
        .with_capability("events");
    PluginServer::new(metadata, Plugin::new())
        // 实时画面走二进制通道（manifest 里声明 host.binary + stdio-framed）：
        // 每帧原始 JPEG，不再经过 base64 与 JSON。
        .transport(PluginTransport::Framed)
        .serve()
}

struct Plugin {
    store: Mutex<Store>,
    /// 插件内的实时页面（WebView2）。同一时间只保留一个离屏浏览器；
    /// 切标签页时由 UI 导航到当前标签的地址。
    #[cfg(windows)]
    live: Mutex<Option<live::LiveSession>>,
}

impl Plugin {
    fn new() -> Self {
        Self {
            store: Mutex::new(Store::load()),
            #[cfg(windows)]
            live: Mutex::new(None),
        }
    }

    /// 当前生效的规则表：持久化的自定义规则 + 内置规则（剔除用户删掉的域名）。
    fn rules(&self) -> Vec<site::SiteRule> {
        let (custom, blocked) = self
            .store
            .lock()
            .map(|store| (store.custom_rules.clone(), store.blocked_hosts.clone()))
            .unwrap_or_default();
        site::merge_rules(custom, &blocked)
    }
}

impl PluginHandler for Plugin {
    fn handle(
        &self,
        _context: RequestContext,
        method: &str,
        params: Value,
        emitter: &PluginEmitter,
    ) -> Result<Value, PluginError> {
        match method {
            "webview/check" => Ok(json!({
                "ok": true,
                "plugin": "com.dbx.webview",
                "version": env!("CARGO_PKG_VERSION"),
                "dataDir": store_dir().map(|path| path.display().to_string()),
            })),
            "webview/presets" => Ok(render_presets(&self.rules())),
            #[cfg(windows)]
            "webview/presetDetail" => {
                // 右键"修改"内置预设的某个域名时，需要拿到它的完整选择器，
                // 才能在保存时生成一条等价的用户规则（覆盖那条域名）。
                let id = require_str(&params, "id")?;
                let rules = self.rules();
                match rules.iter().find(|rule| rule.id == id) {
                    Some(rule) => Ok(json!({ "preset": rule.detail() })),
                    None => Err(PluginError::new(-32602, format!("没有这个预设：{id}"))),
                }
            }
            "webview/settings" => Ok(self.settings()),
            "webview/saveSettings" => self.save_settings(&params),
            "webview/render" => self.render(&params),
            "webview/image" => {
                // 沙箱 CSP 是 `img-src 'self' data: blob:`，远端图片必须由
                // Sidecar 取回来转成 data URI。
                let url = require_str(&params, "url")?;
                let max_bytes = params
                    .get("maxBytes")
                    .and_then(Value::as_u64)
                    .unwrap_or(3 * 1024 * 1024)
                    .clamp(64 * 1024, 4 * 1024 * 1024) as usize;
                match net::fetch_image(url, max_bytes) {
                    Ok((content_type, data, size)) => Ok(json!({
                        "ok": true,
                        "url": url,
                        "contentType": content_type,
                        "dataUri": format!("data:{content_type};base64,{data}"),
                        "bytes": size,
                    })),
                    Err(error) => Err(PluginError::new(-32000, error.message)),
                }
            }
            "webview/searchUrl" => self.search_url(&params),
            // 本地小说原文落盘。UI 的 host.storage 单值上限只有 256 KiB，
            // 一本 txt 就超了；而 UI↔宿主的 JSON 桥单次参数上限是 2 MiB，
            // 整本一次发过来会被宿主拒掉（实测 HTTP 400）。所以分三种方式：
            //   saveBook        —— 小文件一次写完
            //   begin/append/finish —— 大文件按字节分块追加
            //   importBookPath  —— 文件本来就在本机时，让 sidecar 直接读路径，零传输
            "webview/saveBook" => {
                let id = require_str(&params, "id")?;
                let text = require_str(&params, "text")?;
                let meta = params.get("meta").and_then(Value::as_str).unwrap_or("{}");
                let directory = data_dir()?;
                match books::save(&directory, id, text, meta) {
                    Ok(bytes) => Ok(json!({ "ok": true, "id": id, "bytes": bytes })),
                    Err(message) => Err(PluginError::new(-32000, message)),
                }
            }
            "webview/beginBook" => {
                let id = require_str(&params, "id")?;
                let meta = params.get("meta").and_then(Value::as_str).unwrap_or("{}");
                let directory = data_dir()?;
                match books::begin_upload(&directory, id, meta) {
                    Ok(offset) => Ok(json!({ "ok": true, "id": id, "offset": offset })),
                    Err(message) => Err(PluginError::new(-32000, message)),
                }
            }
            "webview/appendBook" => {
                let id = require_str(&params, "id")?;
                let chunk = require_str(&params, "chunk")?;
                let offset = params.get("offset").and_then(Value::as_u64).unwrap_or(0);
                let directory = data_dir()?;
                match books::append_chunk(&directory, id, offset, chunk) {
                    Ok(written) => Ok(json!({ "ok": true, "id": id, "offset": written })),
                    Err(message) => Err(PluginError::new(-32000, message)),
                }
            }
            "webview/finishBook" => {
                let id = require_str(&params, "id")?;
                let expected = params.get("bytes").and_then(Value::as_u64).unwrap_or(0);
                let directory = data_dir()?;
                match books::finish_upload(&directory, id, expected) {
                    Ok(bytes) => Ok(json!({ "ok": true, "id": id, "bytes": bytes })),
                    // 把两个数字一起回给 UI：这类"字节数对不上"的问题，
                    // 只有看到期望值与实际值才知道差在哪（曾经因为传了字符数而排查很久）。
                    Err(message) => Ok(json!({
                        "ok": false,
                        "id": id,
                        "reason": "size-mismatch",
                        "expected": expected,
                        "actual": books::size(&directory, id),
                        "message": message,
                    })),
                }
            }
            "webview/importBookPath" => {
                let id = require_str(&params, "id")?;
                let path = require_str(&params, "path")?;
                let meta = params.get("meta").and_then(Value::as_str).unwrap_or("{}");
                let directory = data_dir()?;
                match books::import_from_path(&directory, id, std::path::Path::new(path), meta) {
                    Ok(bytes) => Ok(json!({ "ok": true, "id": id, "bytes": bytes })),
                    Err(message) => Err(PluginError::new(-32000, message)),
                }
            }
            "webview/loadBook" => {
                let id = require_str(&params, "id")?;
                let directory = data_dir()?;
                match books::read_text(&directory, id) {
                    Ok(Some(text)) => Ok(json!({
                        "ok": true,
                        "id": id,
                        "text": text,
                        "meta": books::read_meta(&directory, id).unwrap_or(None),
                    })),
                    Ok(None) => Ok(json!({ "ok": false, "reason": "missing", "id": id })),
                    Err(message) => Err(PluginError::new(-32000, message)),
                }
            }
            "webview/deleteBook" => {
                let id = require_str(&params, "id")?;
                let directory = data_dir()?;
                match books::delete(&directory, id) {
                    Ok(()) => Ok(json!({ "ok": true, "id": id })),
                    // 磁盘上本来就没有也算成功：UI 的索引已经删掉了。
                    Err(message) if message.contains("不在磁盘上") => {
                        Ok(json!({ "ok": true, "id": id, "alreadyGone": true }))
                    }
                    Err(message) => Err(PluginError::new(-32000, message)),
                }
            }
            "webview/checkBook" => {
                let id = require_str(&params, "id")?;
                let Ok(directory) = data_dir() else {
                    return Ok(json!({ "ok": true, "exists": false, "id": id }));
                };
                Ok(json!({
                    "ok": true,
                    "id": id,
                    "exists": books::exists(&directory, id),
                    "bytes": books::size(&directory, id),
                    "digest": books::digest(&directory, id),
                }))
            }
            "webview/listBooks" => {
                let Ok(directory) = data_dir() else {
                    return Ok(json!({ "ok": true, "books": [] }));
                };
                Ok(json!({
                    "ok": true,
                    "dir": books::books_dir(&directory).display().to_string(),
                    "books": books::list(&directory)
                        .into_iter()
                        .map(|(id, bytes)| json!({ "id": id, "bytes": bytes }))
                        .collect::<Vec<_>>(),
                }))
            }
            // 「用真实浏览器打开」：插件沙箱没法内嵌站点（CSP 只放行 frame-src 'self'），
            // 唯一能看到**活页面**的办法是 sidecar 拉起系统浏览器的独立阅读窗口。
            "webview/browser" => {
                let profile = browser::profile_dir();
                Ok(json!({
                    "available": browser::find_browser().is_some(),
                    "executable": browser::find_browser().map(|path| path.display().to_string()),
                    "profile": profile.display().to_string(),
                    "profileInUse": profile.join("lockfile").is_file()
                        || profile.join("SingletonLock").exists(),
                    "envOverride": std::env::var("DBX_WEBVIEW_BROWSER").ok(),
                }))
            }
            "webview/openInBrowser" => {
                let url = require_str(&params, "url")?;
                let profile = browser::profile_dir();
                // 让自定义样式跟着用户当前的阅读设置走。
                if let Some(css) = params.get("css").and_then(Value::as_str) {
                    browser::write_user_css(&profile, css)
                        .map_err(|error| PluginError::new(-32000, format!("写入自定义样式失败：{error}")))?;
                }
                match browser::open(url, &profile) {
                    Ok((executable, profile, already_running)) => Ok(json!({
                        "ok": true,
                        "url": url,
                        "executable": executable.display().to_string(),
                        "profile": profile.display().to_string(),
                        "alreadyRunning": already_running,
                    })),
                    Err(message) => Err(PluginError::new(-32000, message)),
                }
            }
            // 阅读窗口里"现在打开的是哪个地址"。
            //
            // 没有 CDP 可用（本插件的目标环境里调试端口/命名管道都可能被策略拦掉），
            // 所以直接读**我们自己 profile** 的 History —— 那是个标准 SQLite 文件，
            // 读文件既不需要网络也不需要调试通道。
            "webview/browserHistory" => {
                let limit = params
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(20)
                    .clamp(1, 200) as usize;
                let profile = browser::profile_dir();
                let history_file = browser::history_path(&profile);
                match history::recent(&history_file, limit) {
                    Ok(entries) => Ok(json!({
                        "ok": true,
                        "profile": profile.display().to_string(),
                        "historyFile": history_file.display().to_string(),
                        "entries": entries
                            .iter()
                            .map(|entry| json!({
                                "url": entry.url,
                                "title": entry.title,
                                "visitCount": entry.visit_count,
                                "lastVisitTime": entry.last_visit_time,
                            }))
                            .collect::<Vec<_>>(),
                    })),
                    Err(message) => Ok(json!({
                        "ok": false,
                        "reason": message,
                        "profile": profile.display().to_string(),
                        "historyFile": history_file.display().to_string(),
                        "entries": [],
                    })),
                }
            }
            "webview/probe" => {
                let url = require_str(&params, "url")?;
                Ok(net::probe(url))
            }
            // ── 插件内实时页面：离屏 WebView2 + CDP 帧流 ─────────────────
            // 沙箱 iframe 不能嵌站点，所以由 sidecar 起一个屏幕外的 WebView2，
            // 把画面以事件形式发给 UI；输入反过来走 Input.*。
            #[cfg(windows)]
            "webview/liveOpen" => self.live_open(&params, emitter),
            #[cfg(windows)]
            "webview/liveNavigate" => {
                let url = require_str(&params, "url")?.to_string();
                self.live_command(live::Command::Navigate(url))
            }
            #[cfg(windows)]
            "webview/liveBack" => self.live_command(live::Command::Back),
            #[cfg(windows)]
            "webview/liveForward" => self.live_command(live::Command::Forward),
            #[cfg(windows)]
            "webview/liveReload" => self.live_command(live::Command::Reload),
            #[cfg(windows)]
            "webview/livePause" => self.live_command(live::Command::Pause),
            #[cfg(windows)]
            "webview/liveResume" => self.live_command(live::Command::Resume),
            #[cfg(windows)]
            "webview/liveInput" => self.live_input(&params),
            #[cfg(windows)]
            "webview/liveQuality" => {
                // 滚动时降到 60 换帧率，停手恢复 85 换清晰度。
                let quality = params
                    .get("quality")
                    .and_then(Value::as_i64)
                    .unwrap_or(80) as i32;
                self.live_command(live::Command::Quality(quality))
            }
            #[cfg(windows)]
            "webview/liveResize" => {
                let width = params.get("width").and_then(Value::as_i64).unwrap_or(0);
                let height = params.get("height").and_then(Value::as_i64).unwrap_or(0);
                if width <= 0 || height <= 0 {
                    return Err(PluginError::new(-32602, "实时页面尺寸不合法"));
                }
                let scale = params
                    .get("dpr")
                    .and_then(Value::as_f64)
                    .unwrap_or(1.0);
                self.live_command(live::Command::Viewport {
                    width: width as i32,
                    height: height as i32,
                    scale,
                })
            }
            #[cfg(windows)]
            "webview/liveEval" => {
                let expression = require_str(&params, "expression")?.to_string();
                if expression.len() > 64 * 1024 {
                    return Err(PluginError::new(-32602, "实时页面脚本过长"));
                }
                let (reply_tx, reply_rx) = std::sync::mpsc::channel();
                self.live_command(live::Command::Eval {
                    expression,
                    reply: reply_tx,
                })?;
                match reply_rx.recv_timeout(Duration::from_secs(8)) {
                    Ok(Ok(value)) => Ok(json!({ "ok": true, "value": value })),
                    Ok(Err(message)) => Err(PluginError::new(-32000, message)),
                    Err(_) => Err(PluginError::new(-32000, "实时页面执行超时")),
                }
            }
            #[cfg(windows)]
            "webview/liveStatus" => {
                let guard = self
                    .live
                    .lock()
                    .map_err(|_| PluginError::new(-32000, "实时页面状态不可用"))?;
                Ok(json!({
                    "ok": true,
                    "running": guard.is_some(),
                    "viewport": { "width": live::VIEW_WIDTH, "height": live::VIEW_HEIGHT },
                }))
            }
            #[cfg(windows)]
            "webview/liveClose" => {
                let session = self
                    .live
                    .lock()
                    .map_err(|_| PluginError::new(-32000, "实时页面状态不可用"))?
                    .take();
                if let Some(session) = session {
                    session.close();
                }
                Ok(json!({ "ok": true }))
            }
            "connection/test" => Ok(json!({ "success": true, "message": "网页阅读插件就绪" })),
            _ => Err(PluginError::method_not_found(method)),
        }
    }
}

impl Plugin {
    fn settings(&self) -> Value {
        match self.store.lock() {
            Ok(store) => json!({
                "customRules": store.custom_rules,
                "blockedHosts": store.blocked_hosts,
                "bookmarks": store.bookmarks,
            }),
            Err(_) => json!({ "customRules": [], "blockedHosts": [], "bookmarks": [] }),
        }
    }

    fn save_settings(&self, params: &Value) -> Result<Value, PluginError> {
        let mut store = self
            .store
            .lock()
            .map_err(|_| PluginError::new(-32000, "设置存储不可用"))?;
        if let Some(rules) = params.get("customRules") {
            let parsed: Vec<site::SiteRule> = serde_json::from_value(rules.clone())
                .map_err(|error| PluginError::new(-32602, format!("站点规则格式错误：{error}")))?;
            store.custom_rules = parsed;
        }
        if let Some(blocked) = params.get("blockedHosts") {
            let parsed: Vec<String> = serde_json::from_value(blocked.clone())
                .map_err(|error| PluginError::new(-32602, format!("屏蔽域名格式错误：{error}")))?;
            store.blocked_hosts = parsed;
        }
        if let Some(bookmarks) = params.get("bookmarks") {
            store.bookmarks = bookmarks.clone();
        }
        store.persist();
        Ok(json!({ "ok": true }))
    }

    #[cfg(windows)]
    fn live_open(
        &self,
        params: &Value,
        emitter: &PluginEmitter,
    ) -> Result<Value, PluginError> {
        let url = require_str(params, "url")?.to_string();
        let mut guard = self
            .live
            .lock()
            .map_err(|_| PluginError::new(-32000, "实时页面状态不可用"))?;
        if guard.is_none() {
            let profile = data_dir()?.join("live-browser");
            let session = live::LiveSession::start(profile)
                .map_err(|message| PluginError::new(-32000, message))?;
            *guard = Some(session);
        }
        let session = guard
            .as_ref()
            .ok_or_else(|| PluginError::new(-32000, "实时页面启动失败"))?;
        // UI 会带上视口尺寸（CSS 像素）与设备像素比：页面按这个尺寸排版、
        // 按 DPR 栅格化，采集才有足够的物理像素，不会放大发虚。
        if let (Some(width), Some(height)) = (
            params.get("viewportWidth").and_then(Value::as_i64),
            params.get("viewportHeight").and_then(Value::as_i64),
        ) {
            let scale = params
                .get("deviceScaleFactor")
                .and_then(Value::as_f64)
                .unwrap_or(1.0);
            let _ = session.send(live::Command::Viewport {
                width: width as i32,
                height: height as i32,
                scale,
            });
        }
        session
            .send(live::Command::Open {
                url,
                emitter: emitter.clone(),
            })
            .map_err(|message| PluginError::new(-32000, message))?;
        Ok(json!({
            "ok": true,
            "viewport": { "width": live::VIEW_WIDTH, "height": live::VIEW_HEIGHT },
        }))
    }

    #[cfg(windows)]
    fn live_command(&self, command: live::Command) -> Result<Value, PluginError> {
        let guard = self
            .live
            .lock()
            .map_err(|_| PluginError::new(-32000, "实时页面状态不可用"))?;
        let session = guard
            .as_ref()
            .ok_or_else(|| PluginError::new(-32000, "实时页面尚未启动"))?;
        session
            .send(command)
            .map_err(|message| PluginError::new(-32000, message))?;
        Ok(json!({ "ok": true }))
    }

    #[cfg(windows)]
    fn live_input(&self, params: &Value) -> Result<Value, PluginError> {
        let event = params
            .get("event")
            .cloned()
            .unwrap_or_else(|| params.clone());
        let kind = event.get("kind").and_then(Value::as_str).unwrap_or("");
        if !matches!(kind, "mouse" | "key" | "text") {
            return Err(PluginError::new(-32602, "实时页面输入类型不支持"));
        }
        if serde_json::to_vec(&event).map(|bytes| bytes.len()).unwrap_or(0) > 64 * 1024 {
            return Err(PluginError::new(-32602, "实时页面输入过大"));
        }
        if let Some(text) = event.get("text").and_then(Value::as_str) {
            if text.chars().count() > 20_000 {
                return Err(PluginError::new(-32602, "输入文本过长"));
            }
        }
        let x = event.get("x").and_then(Value::as_f64).unwrap_or(0.0);
        let y = event.get("y").and_then(Value::as_f64).unwrap_or(0.0);
        if !x.is_finite() || !y.is_finite() || x < -64.0 || y < -64.0
            || x > (live::VIEW_WIDTH as f64) + 64.0
            || y > (live::VIEW_HEIGHT as f64) + 64.0
        {
            return Err(PluginError::new(-32602, "实时页面输入坐标越界"));
        }
        self.live_command(live::Command::Input(event))
    }

    fn search_url(&self, params: &Value) -> Result<Value, PluginError> {
        let query = require_str(params, "query")?;
        let preset_id = params.get("presetId").and_then(Value::as_str);
        let rules = self.rules();
        let template = preset_id
            .and_then(|id| rules.iter().find(|rule| rule.id == id))
            .and_then(|rule| rule.search_url.clone())
            .or_else(|| {
                rules
                    .iter()
                    .find(|rule| rule.id == "general")
                    .and_then(|rule| rule.search_url.clone())
            })
            .unwrap_or_else(|| "https://www.bing.com/search?q={q}".to_string());
        let encoded = percent_encode(query);
        Ok(json!({ "url": template.replace("{q}", &encoded) }))
    }

    fn render(&self, params: &Value) -> Result<Value, PluginError> {
        let url = require_str(params, "url")?.to_string();
        let mode = RenderMode::parse(params.get("mode").and_then(Value::as_str));
        let engine = Engine {
            inline_stylesheets: params
                .get("options")
                .and_then(|options| options.get("inlineStylesheets"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
            max_gallery_images: params
                .get("options")
                .and_then(|options| options.get("maxImages"))
                .and_then(Value::as_u64)
                .unwrap_or(24) as usize,
            max_html_bytes: MAX_RESPONSE_HTML_BYTES,
        };
        let timeout = Duration::from_secs(
            params
                .get("options")
                .and_then(|options| options.get("timeoutSecs"))
                .and_then(Value::as_u64)
                .unwrap_or(DEFAULT_TIMEOUT_SECS)
                .clamp(5, MAX_TIMEOUT_SECS),
        );

        let started = std::time::Instant::now();
        let fetched = net::fetch(&url, timeout).map_err(|error| {
            PluginError::new(
                -32000,
                match error.status {
                    Some(status) => format!("HTTP {status}：站点拒绝访问或需要登录"),
                    None => error.message,
                },
            )
        })?;

        // 非 HTML：图片 / 文本直接给出可渲染结果。
        let is_html = fetched.content_type.to_ascii_lowercase().contains("html")
            || fetched.body.trim_start().starts_with('<');
        if !is_html {            return Ok(plain_content_response(&fetched, mode, started.elapsed().as_millis() as u64));
        }

        let rules = self.rules();
        let matched = params
            .get("presetId")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .and_then(|id| rules.iter().find(|rule| rule.id == id))
            .or_else(|| site::match_rule(&rules, &fetched.final_url));

        let mut warnings: Vec<String> = Vec::new();
        if fetched.status >= 300 {
            warnings.push(format!("站点返回 HTTP {}", fetched.status));
        }

        let options = CleanOptions {
            base: &fetched.final_url,
            rule: matched,
            mode,
            inline_stylesheets: engine.inline_stylesheets,
            max_gallery_images: engine.max_gallery_images,
            max_html_bytes: engine.max_html_bytes,
        };
        let page = clean(&fetched.body, &options, &engine);
        warnings.extend(page.warnings.iter().cloned());

        let mut html = page.html.clone();
        // 「合并分页」：默认开启，把同一章的 `_1` / `_2` … 后续页抓回来拼上。
        let merge_pages = params
            .get("options")
            .and_then(|options| options.get("mergePages"))
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let mut merged_pages = 0usize;
        if merge_pages && mode != RenderMode::Source && page.text_length > 0 && page.next.is_some() {
            let (combined, count) = merge_chapter_pages(
                &page,
                &fetched.final_url,
                matched,
                mode,
                &engine,
                timeout,
            );
            if count > 0 {
                html = combined;
                merged_pages = count;
                warnings.push(format!("已合并 {} 个分页", count + 1));
            }
        }

        let mut truncated = false;
        if html.len() > MAX_RESPONSE_HTML_BYTES {
            html.truncate(floor_char_boundary(&html, MAX_RESPONSE_HTML_BYTES));
            truncated = true;
            warnings.push("页面体积过大，内容已截断".to_string());
        }

        // 服务端 HTML 里根本没有可读正文（正文由前端脚本渲染），UI 据此给出明确提示。
        let js_required = page.full_text_length < 200 && page.text_length < 200;
        // 有些站点干脆返回一个"请登录 / 人机校验"的中间页，正文为 0；
        // 这种必须说清楚原因，否则用户看到的就是一片空白。
        let blocked = detect_access_wall(&fetched.final_url, &page.meta.title, page.text_length, page.full_text_length);

        let html = if mode == RenderMode::Source {
            escape_html(&html)
        } else {
            html
        };

        Ok(json!({
            "ok": true,
            "url": fetched.final_url.to_string(),
            "requestedUrl": url,
            "title": page.meta.title,
            "siteName": if page.meta.site_name.is_empty() {
                matched.map(|rule| rule.name.clone()).unwrap_or_default()
            } else {
                page.meta.site_name.clone()
            },
            "description": page.meta.description,
            "status": fetched.status,
            "mode": mode.as_str(),
            "contentType": fetched.content_type,
            "presetId": matched.map(|rule| rule.id.clone()),
            "presetName": matched.map(|rule| rule.name.clone()),
            "readerStyle": matched.and_then(|rule| rule.reader.clone()),
            "contentSelector": page.content_selector,
            "html": html,
            "textLength": page.text_length,
            "fullTextLength": page.full_text_length,
            "readerOk": page.reader_ok,
            "jsRequired": js_required,
            "blocked": blocked,
            /* 整页几乎全是链接（首页/导航页），没有可读正文。 */
            "linkWall": page.link_wall,
            "linkRatio": (page.link_ratio * 100.0).round() / 100.0,
            "mergedPages": merged_pages,
            "truncated": truncated,
            "bytes": fetched.bytes,
            "elapsedMs": started.elapsed().as_millis() as u64,
            "fetchedAt": now_iso8601(),
            "baseHref": page.base_href,
            "prevUrl": page.prev.as_ref().map(|link| link.url.clone()),
            "prevTitle": page.prev.as_ref().map(|link| link.text.clone()),
            "nextUrl": page.next.as_ref().map(|link| link.url.clone()),
            "nextTitle": page.next.as_ref().map(|link| link.text.clone()),
            "startUrl": page.start_reading.as_ref().map(|link| link.url.clone()),
            /* 该站章节页要登录才给正文：直接告诉用户换浏览器窗口，别让他猜。 */
            "needsLogin": needs_login(fetched.final_url.host_str().unwrap_or(""))
                && page.text_length < 500,
            "catalogUrl": catalog_hint(&fetched.body, &fetched.final_url),
            "startTitle": page.start_reading.as_ref().map(|link| link.text.clone()),
            "chapters": page.chapters.iter().map(|chapter| json!({
                "title": chapter.text,
                "url": chapter.url,
                "current": chapter.url == fetched.final_url.as_str(),
            })).collect::<Vec<_>>(),
            "images": page.images.iter().map(|(src, alt)| json!({ "src": src, "alt": alt })).collect::<Vec<_>>(),
            "warnings": warnings,
        }))
    }
}

/// 非 HTML 资源的展示：图片直接给 `<img>`，其它给等宽文本块。
fn plain_content_response(fetched: &net::Fetched, mode: RenderMode, elapsed_ms: u64) -> Value {
    let content_type = fetched.content_type.to_ascii_lowercase();
    let html = if content_type.starts_with("image/") {
        format!(
            "<figure><img src=\"{}\" alt=\"\"></figure>",
            escape_attr(&fetched.final_url.to_string())
        )
    } else {
        let mut text = fetched.body.clone();
        if text.len() > 400_000 {
            text.truncate(floor_char_boundary(&text, 400_000));
        }
        format!("<pre class=\"dbx-plain\">{}</pre>", escape_html(&text))
    };
    let html = if mode == RenderMode::Source {
        escape_html(&html)
    } else {
        html
    };
    json!({
        "ok": true,
        "url": fetched.final_url.to_string(),
        "requestedUrl": fetched.final_url.to_string(),
        "title": fetched.final_url.to_string(),
        "siteName": "",
        "description": "",
        "status": fetched.status,
        "mode": mode.as_str(),
        "contentType": fetched.content_type,
        "presetId": Value::Null,
        "presetName": Value::Null,
        "readerStyle": Value::Null,
        "contentSelector": Value::Null,
        "html": html,
        "textLength": fetched.body.chars().count(),
        "fullTextLength": fetched.body.chars().count(),
        "readerOk": true,
        "jsRequired": false,
        "blocked": false,
        "linkWall": false,
        "linkRatio": 0.0,
        "mergedPages": 0,
        "truncated": false,
        "bytes": fetched.bytes,
        "elapsedMs": elapsed_ms,
        "fetchedAt": now_iso8601(),
        "baseHref": fetched.final_url.to_string(),
        "prevUrl": Value::Null,
        "prevTitle": Value::Null,
        "nextUrl": Value::Null,
        "nextTitle": Value::Null,
        "startUrl": Value::Null,
        "needsLogin": false,
        "catalogUrl": Value::Null,
        "startTitle": Value::Null,
        "chapters": Vec::<Value>::new(),
        "images": Vec::<Value>::new(),
        "warnings": Vec::<String>::new(),
    })
}

/// 判断这是不是一个"访问被挡"的中间页（登录墙 / 人机校验 / 频控）。
///
/// 判定依据：页面几乎没有正文，且标题或最终 URL 命中了常见的拦截特征。
/// 只看文本量不够——JS 单页应用同样是"没正文"，但原因和处置方式完全不同。
fn detect_access_wall(final_url: &url::Url, title: &str, text_length: usize, full_text_length: usize) -> bool {
    const TITLE_MARKERS: &[&str] = &[
        "sina visitor system",
        "验证码",
        "安全验证",
        "人机验证",
        "滑动验证",
        "访问过于频繁",
        "just a moment",
        "attention required",
        "access denied",
        "请稍候",
        "正在验证",
        "captcha",
        "are you a robot",
    ];
    const PATH_MARKERS: &[&str] = &[
        "verify",
        "captcha",
        "challenge",
        "security",
        "login",
        "passport",
        "auth",
        "unusual",
    ];

    if full_text_length >= 200 || text_length >= 200 {
        return false;
    }
    let lowered_title = title.to_ascii_lowercase();
    if TITLE_MARKERS.iter().any(|marker| lowered_title.contains(marker)) {
        return true;
    }
    let path = final_url.path().to_ascii_lowercase();
    let query = final_url.query().unwrap_or_default().to_ascii_lowercase();
    if PATH_MARKERS
        .iter()
        .any(|marker| path.contains(marker) || query.contains(marker))
    {
        return true;
    }
    // 一点文字都没有：正常页面（哪怕是纯 JS 应用）至少会有个标题或导航文案，
    // 全空基本就是被挡在门外了，比如抖音返回的验证码页。
    full_text_length == 0
}

/// 同一章的后续分页：`/book/1/abc.html` → `/book/1/abc_1.html` → `_2` …
///
/// 只看 `_N` 这种「下划线 + 数字」的后缀。章节 ID 本身常以数字结尾
/// （`2708313.html`），那不算已分页，仍然要追加 `_1`。
fn next_page_url(url: &url::Url, index: usize) -> Option<url::Url> {
    if index == 0 || index > MAX_CHAPTER_PAGES {
        return None;
    }
    let (stem, extension) = url.path().rsplit_once('.')?;
    if extension.is_empty() || extension.len() > 5 || !extension.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return None;
    }

    let (base, current) = match stem.rsplit_once('_') {
        Some((base, digits)) if !digits.is_empty() && digits.chars().all(|ch| ch.is_ascii_digit()) => {
            (base, digits.parse::<usize>().ok()?)
        }
        _ => (stem, 0),
    };
    // 原页只接 `_1`，已分页只能接下一个连续序号，避免乱猜出不存在的地址。
    if current + 1 != index {
        return None;
    }

    let mut next = url.clone();
    next.set_path(&format!("{base}_{index}.{extension}"));
    Some(next)
}

/// 把同一章被切开的后续分页抓回来，拼成一篇完整正文。
///
/// 中文小说站普遍把一章拆成 5~6 个页面（`_1.html`、`_2.html` …）。不合并的话
/// 「下一章」会直接跳到下一章，中间几页正文永远读不到。
fn merge_chapter_pages(
    first: &CleanedPage,
    url: &url::Url,
    rule: Option<&site::SiteRule>,
    mode: RenderMode,
    engine: &Engine,
    timeout: Duration,
) -> (String, usize) {
    let profile = engine::cleaner::request_profile(rule);
    let mut merged = first.html.clone();
    let mut count = 0usize;

    for index in 1..=MAX_CHAPTER_PAGES {
        let Some(next_url) = next_page_url(url, index) else {
            break;
        };
        let Ok(fetched) = net::fetch_with(next_url.as_str(), timeout, &profile) else {
            break;
        };
        let options = CleanOptions {
            base: &fetched.final_url,
            rule,
            mode,
            inline_stylesheets: engine.inline_stylesheets,
            max_gallery_images: engine.max_gallery_images,
            max_html_bytes: engine.max_html_bytes,
        };
        let page = clean(&fetched.body, &options, engine);
        // 页面上明确标了"下一页"才算真的分页；否则说明已经到底了。
        if page.next.is_none() || page.text_length < 30 {
            break;
        }
        // 小说站经常在句子中间切页：上一页结尾"他抬起"，下一页开头"头来"。
        // 这种就**直接接上**，不要插分隔符——否则每页中间都断一句，读起来很碎。
        if continues_sentence(&merged, &page.html) {
            merged.push_str(&page.html);
        } else {
            merged.push_str("\n<hr class=\"dbx-page-break\">\n");
            merged.push_str(&page.html);
        }
        count += 1;
    }
    (merged, count)
}

/// 取一段 HTML **末尾**最多 `limit` 个可见字符（跳过标签，实体按单字符算）。
fn trailing_text(html: &str, limit: usize) -> String {
    let mut collected: Vec<char> = Vec::new();
    let mut inside_tag = false;
    let mut entity = String::new();
    let mut in_entity = false;

    for ch in html.chars().rev() {
        if ch == '>' {
            inside_tag = true;
            continue;
        }
        if ch == '<' {
            inside_tag = false;
            continue;
        }
        if inside_tag {
            continue;
        }
        // 倒着扫实体：先遇到 ';' 才开始收集
        if ch == ';' {
            in_entity = true;
            entity.clear();
            continue;
        }
        if in_entity {
            if ch == '&' {
                in_entity = false;
                // 常见实体要还原成**真正的字符**：`&nbsp;` 是空格，不是文字。
                // 认不出来就当单个占位字符——它占一个可见位置，但不影响标点判断。
                let name: String = entity.chars().rev().collect();
                let decoded = match name.as_str() {
                    "nbsp" | "#160" => ' ',
                    "amp" => '&',
                    "lt" => '<',
                    "gt" => '>',
                    "quot" => '"',
                    "ldquo" => '“',
                    "rdquo" => '”',
                    "hellip" => '…',
                    _ => 'x',
                };
                if decoded == ' ' {
                    if !matches!(collected.last(), None | Some(' ')) {
                        collected.push(' ');
                    }
                } else {
                    collected.push(decoded);
                }
                if collected.len() >= limit {
                    break;
                }
                continue;
            }
            entity.push(ch);
            continue;
        }
        if ch.is_whitespace() {
            // HTML 里换行/空格都只是排版，落到可见文本里就是一个空格
            if !matches!(collected.last(), None | Some(' ')) {
                collected.push(' ');
            }
        } else {
            collected.push(ch);
        }
        if collected.len() >= limit {
            break;
        }
    }
    collected.reverse();
    collected.into_iter().collect()
}

/// 取一段 HTML **开头**最多 `limit` 个可见字符。
fn leading_text(html: &str, limit: usize) -> String {
    let mut collected = String::new();
    let mut inside_tag = false;
    let mut entity = String::new();
    let mut in_entity = false;
    let mut count = 0usize;

    for ch in html.chars() {
        if in_entity {
            if ch == ';' {
                in_entity = false;
                let decoded = match entity.as_str() {
                    "nbsp" | "#160" => ' ',
                    "amp" => '&',
                    "lt" => '<',
                    "gt" => '>',
                    "quot" => '"',
                    "ldquo" => '“',
                    "rdquo" => '”',
                    "hellip" => '…',
                    _ => 'x',
                };
                if decoded == ' ' {
                    if !collected.ends_with(' ') {
                        collected.push(' ');
                        count += 1;
                    }
                } else {
                    collected.push(decoded);
                    count += 1;
                }
                if count >= limit {
                    break;
                }
                continue;
            }
            entity.push(ch);
            if entity.len() > 12 {
                // 不是实体，退回按普通字符处理
                in_entity = false;
                collected.push('&');
                collected.push_str(&entity);
                count += 2;
                entity.clear();
            }
            continue;
        }
        if inside_tag {
            if ch == '>' {
                inside_tag = false;
            }
            continue;
        }
        if ch == '<' {
            inside_tag = true;
            continue;
        }
        if ch == '&' {
            in_entity = true;
            entity.clear();
            continue;
        }
        if ch.is_whitespace() {
            if !collected.ends_with(' ') {
                collected.push(' ');
                count += 1;
            }
        } else {
            collected.push(ch);
            count += 1;
        }
        if count >= limit {
            break;
        }
    }
    collected
}

/// 下一页是不是紧接上一页的同一句话。
///
/// 判据：上一页结尾**没有**句末标点，且下一页开头不是标点/新段落标记。
/// 这只在能明确判断时才返回 true —— 拿不准就照旧插分隔符。
fn continues_sentence(previous_html: &str, next_html: &str) -> bool {
    const ENDERS: &[char] = &[
        '。', '！', '？', '…', '；', '：', '”', '』', '」', '"', '"', '!', '?', '.', ';', ':',
    ];
    const CONTINUERS: &[char] = &[
        '。', '，', '、', '！', '？', '…', '；', '：', '”', '』', '」', ')', '）', ',', '.', '!', '?',
        ';', ':', ')', ']', '】',
    ];

    let tail = trailing_text(previous_html, 24);
    let head = leading_text(next_html, 12);
    let Some(last) = tail.chars().rev().find(|ch| !ch.is_whitespace()) else {
        return false;
    };
    let Some(first) = head.chars().find(|ch| !ch.is_whitespace()) else {
        return false;
    };

    // 上一页已经收尾，或者下一页以标点开头 → 是真正的分页/新段落。
    if ENDERS.contains(&last) || CONTINUERS.contains(&first) {
        return false;
    }
    // 只处理中文正文：两边都得是汉字，避免把英文单词/数字粘错。
    let is_han = |ch: char| ('\u{4e00}'..='\u{9fff}').contains(&ch);
    is_han(last) && is_han(first)
}

/// 这些站点的章节页**要登录或带 cookie 才给正文**（实测确认），服务端能拿到的
/// 只有推荐位。识别出来是为了直接告诉用户「换浏览器窗口打开」，而不是让他对着
/// "内容太短"发愣。
const LOGIN_ONLY_HOSTS: &[&str] = &[
    "hongxiu.com",
    "readnovel.com",
    "zongheng.com",
    "17k.com",
    "qidian.com",
    "jjwxc.net",
    "ciweimao.com",
    "motie.com",
];

fn needs_login(host: &str) -> bool {
    let host = host.trim_start_matches("www.").to_ascii_lowercase();
    LOGIN_ONLY_HOSTS
        .iter()
        .any(|pattern| host == *pattern || host.ends_with(&format!(".{pattern}")))
}

/// 从页面里找一个"目录/书架/章节目录"链接；找不到就按 URL 形状推。
///
/// 只从**原始 HTML** 里找而不是清理后的片段：`clean` 出来的片段已经丢掉了大量
/// 导航元素，目录入口经常就在被丢掉的那部分里。
///
/// 手写扫描而不是用正则：sidecar 原来没直接依赖 `regex`，为这一处引入新依赖
/// 不划算（而且这台构建机访问不了 crates.io，装不上新 crate）。
fn catalog_hint(raw_html: &str, final_url: &url::Url) -> Option<String> {
    const MARKERS: &[&str] = &["目录", "書目", "章节列表", "全部章节", "章節", "书架", "catalog", "index"];
    let lowered = raw_html.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(offset) = lowered[cursor..].find("<a") {
        let start = cursor + offset;
        let Some(close) = raw_html[start..].find('>') else { break };
        let open_tag_end = start + close;
        let open_tag = &raw_html[start..=open_tag_end];
        cursor = open_tag_end + 1;

        let Some(href) = extract_attr(open_tag, "href") else { continue };
        let Some(text_end) = lowered[cursor..].find("</a>") else { break };
        let label = leading_text(&raw_html[cursor..cursor + text_end], 13);
        let label = label.trim();
        if label.is_empty() {
            continue;
        }
        if !MARKERS.iter().any(|marker| label.contains(marker)) {
            continue;
        }
        if let Ok(resolved) = final_url.join(href.trim()) {
            if matches!(resolved.scheme(), "http" | "https") && resolved.host() == final_url.host() {
                return Some(resolved.to_string());
            }
        }
    }

    // 退回按 URL 形状推：章节页通常就是自己所在书目录下的一层
    let path = final_url.path();
    // 已经以 `/` 结尾的地址本身就是目录页（`/biquge/10806/`），别再往上推。
    if path.ends_with('/') {
        return None;
    }
    let last_is_page = path.rsplit('/').next().is_some_and(|name| {
        name.ends_with(".html") || name.ends_with(".htm") || name.ends_with(".shtml")
    });
    if !last_is_page {
        return None;
    }
    let (prefix, _) = path.rsplit_once('/')?;
    let trimmed = prefix.trim_end_matches('/');
    let (parent, book) = trimmed.rsplit_once('/')?;
    let looks_like_book = !book.is_empty()
        && book.chars().all(|ch| ch.is_ascii_digit() || ch == '_' || ch == '-');
    if !looks_like_book {
        return None;
    }
    let mut base = final_url.clone();
    base.set_path(&format!("{parent}/{book}/"));
    base.set_query(None);
    base.set_fragment(None);
    Some(base.to_string())
}

/// 从一个标签里取属性值，属性名大小写不敏感，引号可省。
fn extract_attr(tag: &str, name: &str) -> Option<String> {
    let lowered = tag.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(offset) = lowered[cursor..].find(name) {
        let at = cursor + offset;
        // 前面必须是空白，避免把 `data-href` 当成 `href`
        let before_ok = at == 0 || tag.as_bytes()[at - 1].is_ascii_whitespace();
        let after = lowered[at + name.len()..].trim_start();
        if before_ok && after.starts_with('=') {
            let value = after[1..].trim_start();
            let quote = value.chars().next()?;
            if quote == '"' || quote == '\'' {
                let rest = &value[1..];
                let end = rest.find(quote)?;
                return Some(rest[..end].to_string());
            }
            let end = value
                .find(|ch: char| ch.is_whitespace() || ch == '>')
                .unwrap_or(value.len());
            return Some(value[..end].to_string());
        }
        cursor = at + name.len();
    }
    None
}

fn render_presets(rules: &[site::SiteRule]) -> Value {    let grouped = site::group_by_category(rules);
    json!({
        "ok": true,
        "presets": rules.iter().map(|rule| rule.summary()).collect::<Vec<_>>(),
        "categories": grouped,
    })
}

// ------------------------------------------------------------------ 设置持久化

/// Sidecar 的专属数据目录由宿主通过 `DBX_PLUGIN_DATA_DIR` 注入。
fn store_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("DBX_PLUGIN_DATA_DIR")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("APPDATA").map(|value| std::path::PathBuf::from(value).join("com.dbx.app")))
}

/// 取插件数据目录；拿不到就明确报错（调用方都在 RPC 里）。
fn data_dir() -> Result<std::path::PathBuf, PluginError> {
    store_dir().ok_or_else(|| {
        PluginError::new(
            -32000,
            "拿不到插件数据目录（DBX_PLUGIN_DATA_DIR 未设置）".to_string(),
        )
    })
}

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Store {
    custom_rules: Vec<site::SiteRule>,
    /// 用户在内置预设上删掉的域名（可恢复）。
    blocked_hosts: Vec<String>,
    bookmarks: Value,
    #[serde(skip)]
    path: Option<std::path::PathBuf>,
}

impl Store {
    fn load() -> Self {
        let Some(directory) = store_dir() else {
            return Self::default();
        };
        let path = directory.join("web-reader-settings.json");
        let mut store = match std::fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str::<Store>(&raw).unwrap_or_default(),
            Err(_) => Store::default(),
        };
        store.path = Some(path);
        store
    }

    fn persist(&self) {
        let Some(path) = &self.path else { return };
        if let Some(parent) = path.parent() {
            if std::fs::create_dir_all(parent).is_err() {
                return;
            }
        }
        match serde_json::to_string_pretty(self) {
            Ok(serialized) => {
                if let Err(error) = std::fs::write(path, serialized) {
                    eprintln!("[webview] 写入设置失败：{error}");
                }
            }
            Err(error) => eprintln!("[webview] 序列化设置失败：{error}"),
        }
    }
}

// ------------------------------------------------------------------ 小工具

fn require_str<'a>(params: &'a Value, key: &str) -> Result<&'a str, PluginError> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| PluginError::new(-32602, format!("缺少参数 {key}")))
}

fn percent_encode(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut output = String::with_capacity(value.len() * 3);
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            output.push(*byte as char);
        } else {
            output.push('%');
            output.push(HEX[(byte >> 4) as usize] as char);
            output.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    output
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_attr(value: &str) -> String {
    escape_html(value).replace('"', "&quot;")
}

fn floor_char_boundary(value: &str, limit: usize) -> usize {
    if value.len() <= limit {
        return value.len();
    }
    let mut index = limit;
    while index > 0 && !value.is_char_boundary(index) {
        index -= 1;
    }
    index
}

/// 不引入 chrono：用系统时间手工格式化 ISO-8601（UTC）。
fn now_iso8601() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let seconds = now.as_secs() as i64;
    let millis = now.subsec_millis();
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3600;
    let minute = (seconds_of_day % 3600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

/// Howard Hinnant 的 civil_from_days 算法。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// 让 `json!` 里可以放任意 Map。
#[allow(dead_code)]
fn object(entries: Vec<(&str, Value)>) -> Value {
    let mut map = Map::new();
    for (key, value) in entries {
        map.insert(key.to_string(), value);
    }
    Value::Object(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_search_queries() {
        assert_eq!(percent_encode("中文 rust"), "%E4%B8%AD%E6%96%87%20rust");
    }

    #[test]
    fn formats_iso_timestamps() {
        let stamp = now_iso8601();
        assert_eq!(stamp.len(), 24, "{stamp}");
        assert!(stamp.ends_with('Z'));
        assert_eq!(&stamp[4..5], "-");
    }

    #[test]
    fn truncates_on_char_boundary() {
        let text = "中文中文";
        let index = floor_char_boundary(text, 3);
        assert!(text.is_char_boundary(index));
    }

    #[test]
    fn builds_next_chapter_page_urls() {
        let url = |value: &str| url::Url::parse(value).unwrap();
        // 未分页的原页 → 追加 _1
        assert_eq!(
            next_page_url(&url("https://x.test/book/1/abc.html"), 1).unwrap().as_str(),
            "https://x.test/book/1/abc_1.html"
        );
        // 已经是 _1 → _2
        assert_eq!(
            next_page_url(&url("https://x.test/book/1/abc_1.html"), 2).unwrap().as_str(),
            "https://x.test/book/1/abc_2.html"
        );
        // 序号不连续就不猜
        assert!(next_page_url(&url("https://x.test/book/1/abc_1.html"), 5).is_none());
        // 章节 ID 本身带数字（2708313.html）不能被当成已分页
        assert_eq!(
            next_page_url(&url("https://x.test/book/1/2708313.html"), 1).unwrap().as_str(),
            "https://x.test/book/1/2708313_1.html"
        );
        // 超过上限就不再往后抓
        assert!(next_page_url(&url("https://x.test/book/1/abc.html"), MAX_CHAPTER_PAGES + 1).is_none());
    }

    #[test]
    fn flags_sites_whose_chapters_need_login() {
        assert!(needs_login("www.hongxiu.com"));
        assert!(needs_login("readnovel.com"));
        assert!(needs_login("www.zongheng.com"));
        assert!(needs_login("passport.qidian.com"));
        assert!(!needs_login("www.bqg221.com"));
        assert!(!needs_login("example.com"));
        // 别把"包含这个词"当成匹配：hongxiu.com.evil.test 不是阅文
        assert!(!needs_login("hongxiu.com.evil.test"));
    }

    #[test]
    fn finds_the_catalog_link_and_falls_back_to_url_shape() {
        let base = url::Url::parse("https://www.bqg221.com/biquge/10806/2708313.html").unwrap();
        // 页面自己有目录链接时优先用它
        let html = r#"<div><a href="/biquge/10806/">《乌龙山修行笔记》目录</a></div>"#;
        assert_eq!(
            catalog_hint(html, &base).as_deref(),
            Some("https://www.bqg221.com/biquge/10806/")
        );

        // 没有目录链接就按 URL 形状推：/biquge/10806/2708313.html -> /biquge/10806/
        assert_eq!(
            catalog_hint("<p>没有链接</p>", &base).as_deref(),
            Some("https://www.bqg221.com/biquge/10806/")
        );

        // 目录页本身（/biquge/10806/）不该再往上推
        let toc = url::Url::parse("https://www.bqg221.com/biquge/10806/").unwrap();
        assert_eq!(catalog_hint("<p>没有链接</p>", &toc), None);

        // 跨站链接不能被采纳：在**没有 URL 形状可推**的页面上（首页）应当返回 None
        let home = url::Url::parse("https://www.bqg221.com/").unwrap();
        let cross = r#"<a href="https://evil.test/toc">目录</a>"#;
        assert_eq!(catalog_hint(cross, &home), None);

        // 站内目录链接才采纳
        let same_host = r#"<a href="/biquge/1694/">目录</a>"#;
        assert_eq!(
            catalog_hint(same_host, &home).as_deref(),
            Some("https://www.bqg221.com/biquge/1694/")
        );

        // 属性名不能被前缀骗到：data-href 不是 href
        assert_eq!(extract_attr(r#"<a data-href="/x">y</a>"#, "href"), None);
        assert_eq!(extract_attr(r#"<a HREF='/x'>y</a>"#, "href").as_deref(), Some("/x"));
        assert_eq!(extract_attr(r#"<a href=/x class="c">y</a>"#, "href").as_deref(), Some("/x"));
    }

    /// 复刻真实的合并决策：这两段拼接时该不该插分隔符。
    #[test]
    fn merge_decision_matches_real_pages() {
        fn join(previous: &str, next: &str) -> String {
            if continues_sentence(previous, next) {
                format!("{previous}{next}")
            } else {
                format!("{previous}\n<hr class=\"dbx-page-break\">\n{next}")
            }
        }
        // 句子中间被切开 → 直接接上，不留分隔符
        let joined = join("<p>他缓缓抬起</p>", "<p>头来，看见了她。</p>");
        assert!(!joined.contains("dbx-page-break"), "{joined}");
        // 断言可见文本：标签之间本来就隔着 </p><p>，不能直接比字符串
        let visible = joined
            .replace("<p>", "")
            .replace("</p>", "");
        assert_eq!(visible, "他缓缓抬起头来，看见了她。", "{joined}");

        // 上一页已经收尾 → 保留分隔符（就像笔趣阁实测到的那种情况）
        let kept = join("<p>但也觉五师兄说的是正理。”</p>", "<p>娄真五看到最后，忽然皱眉。</p>");
        assert!(kept.contains("dbx-page-break"), "{kept}");
    }

    #[test]
    fn joins_pages_that_split_mid_sentence() {
        // 上一页结尾没有句末标点，下一页紧接着同一个句子 → 应当直接接上
        assert!(continues_sentence("<p>他缓缓抬起</p>", "<p>头来，看见了她。</p>"));
        assert!(continues_sentence("<p>这一夜他没能</p>", "<p>睡着，天就亮了</p>"));
    }

    #[test]
    fn keeps_a_break_when_the_page_ends_a_sentence() {
        // 上一页已经收尾 → 是真分页，照旧插分隔符
        assert!(!continues_sentence("<p>他走了。</p>", "<p>第二天一早</p>"));
        assert!(!continues_sentence("<p>她笑了！</p>", "<p>屋里安静下来</p>"));
        // 下一页以标点开头 → 不是接续
        assert!(!continues_sentence("<p>他缓缓抬起</p>", "<p>，然后放下</p>"));
        assert!(!continues_sentence("<p>他缓缓抬起</p>", "<p>。这一章结束</p>"));
    }

    #[test]
    fn does_not_glue_latin_words_or_numbers() {
        // 英文/数字边界不猜，宁可保守地插分隔符
        assert!(!continues_sentence("<p>see the</p>", "<p>next part</p>"));
        assert!(!continues_sentence("<p>共 12</p>", "<p>34 次</p>"));
    }

    #[test]
    fn extracts_visible_text_edges() {
        assert_eq!(trailing_text("<p>你好<span>世界</span></p>", 4), "你好世界");
        assert_eq!(leading_text("<div><p>  开头  文字</p></div>", 6), " 开头 文字");
        // 实体算一个字符，不能把 &nbsp; 拆开当成可见文本
        assert_eq!(trailing_text("<p>结尾&nbsp;</p>", 4).trim(), "结尾");
    }

    #[test]
    fn detects_access_walls_but_not_js_apps() {
        let url = |value: &str| url::Url::parse(value).unwrap();
        // 微博的访客验证页
        assert!(detect_access_wall(
            &url("https://weibo.com/"),
            "Sina Visitor System",
            0,
            0
        ));
        // 抖音的验证码中间页：标题可能为空，但整页一个字都没有
        assert!(detect_access_wall(&url("https://www.douyin.com/"), "", 0, 0));
        // 登录路径
        assert!(detect_access_wall(
            &url("https://example.com/passport/login"),
            "登录",
            12,
            12
        ));
        // 纯 JS 应用：有导航文案，属于 jsRequired 而不是被挡
        assert!(!detect_access_wall(
            &url("https://www.xiaohongshu.com/explore"),
            "小红书 - 你的生活兴趣社区",
            10,
            640
        ));
        // 正常文章页
        assert!(!detect_access_wall(&url("https://example.com/a"), "标题", 4000, 4200));
    }
}
