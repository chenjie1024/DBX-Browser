//! 插件内的「实时页面」：把真正的 WebView2 渲染结果以帧流送进沙箱 UI。
//!
//! 沙箱 iframe 的 CSP 不允许嵌外部站点（`frame-src 'self' blob:`），所以小红书这类
//! 前端渲染站点在阅读视图里永远只有标题和描述。这里换一条路：Sidecar 自己起一个
//! 离屏（屏幕外、无任务栏按钮）的 WebView2，下载真实的 Chromium 页面，再用
//! DevTools Protocol 的 `Page.startScreencast` 把画面帧通过插件事件送给 UI；鼠标、
//! 滚轮、键盘、中文输入通过 `Input.*` 反向送回去。
//!
//! 这样登录态、扫码、评论、翻页都在插件面板里完成；WebView2 的 user data 目录
//! 落在插件数据目录下，登录一次以后一直有效。
//!
//! 设计约束：
//! - WebView2 必须跑在 STA 线程并持续泵消息，所以所有 COM 对象都留在这个线程，
//!   `LiveSession` 只通过 channel 发命令。
//! - 帧事件不能直接在 WebView2 的 UI 线程上写 stdout：UI 线程一卡，画面和输入
//!   都会停顿。帧先进入有界队列，由独立的 emitter 线程写宿主。
//! - 不把原始 CDP 暴露给 UI；只接受白名单里的鼠标 / 键盘 / 文本 / 导航动作。

#![cfg(windows)]

use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;
use std::result::Result as StdResult;
use std::sync::mpsc::{self, Receiver, Sender, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use dbx_plugin_sdk::PluginEmitter;
use serde_json::{json, Value};
use url::Url;
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::*;
use windows::core::*;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Gdi::UpdateWindow;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::HiDpi::*;
use windows::Win32::UI::WindowsAndMessaging::*;

/// 逻辑视口尺寸。UI 按这个比例显示，并把点击坐标按比例换算回来。
pub const VIEW_WIDTH: i32 = 1280;
pub const VIEW_HEIGHT: i32 = 900;
const START_TIMEOUT: Duration = Duration::from_secs(20);
/// 两帧之间至少间隔多久。
///
/// 实测（1210×851 采集、动画页）：16ms → 画出 37.8 fps；完全不节流反而只有 27 fps，
/// 因为 60 个事件/秒把事件循环压住，单帧解码从 13ms 涨到 27ms。所以既不是越慢越省，
/// 也不是越快越好——16ms 是这台机器的甜点。
const FRAME_INTERVAL: Duration = Duration::from_millis(16);
/// JPEG 质量。文本页面 55 与 60 肉眼几乎无差，但体积小一圈、编码更快。
const SCREENCAST_QUALITY: i32 = 55;
/// 隔帧编码。60fps 的动画页没必要逐帧编码——UI 侧解码约 10–20ms/帧，
/// 多出来的帧只会被丢弃。
const SCREENCAST_EVERY_NTH_FRAME: i32 = 1;
const WINDOW_CLASS: PCWSTR = w!("DbxWebviewLive");
const WM_LIVE_COMMAND: u32 = WM_APP + 0x51;

pub enum Command {
    Open {
        url: String,
        emitter: PluginEmitter,
    },
    Navigate(String),
    Back,
    Forward,
    Reload,
    Input(Value),
    Eval {
        expression: String,
        reply: Sender<StdResult<Value, String>>,
    },
    /// 按 UI 的实际显示尺寸调整采集大小。
    ///
    /// 解码成本与像素数成正比（实测 1280×900 每帧 32ms，960×675 只要 12.6ms），
    /// 而采集到头来都要缩进面板里显示。所以按显示尺寸采集：既不掉清晰度，
    /// 又把解码成本压到最低。
    Resize {
        width: i32,
        height: i32,
    },
    Pause,
    Resume,
    Close,
}

pub struct LiveSession {
    tx: Sender<Command>,
    hwnd: isize,
    join: Option<JoinHandle<()>>,
}

impl LiveSession {
    pub fn start(profile: PathBuf) -> StdResult<Self, String> {
        let (tx, rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let join = thread::Builder::new()
            .name("dbx-webview2-live".into())
            .spawn(move || run(profile, rx, ready_tx))
            .map_err(|error| format!("无法启动实时页面线程：{error}"))?;
        match ready_rx.recv_timeout(START_TIMEOUT) {
            Ok(Ok(hwnd)) => Ok(Self {
                tx,
                hwnd,
                join: Some(join),
            }),
            Ok(Err(message)) => {
                let _ = join.join();
                Err(message)
            }
            Err(_) => {
                let _ = tx.send(Command::Close);
                Err("实时页面启动超时（WebView2 没有响应）".to_string())
            }
        }
    }

    pub fn send(&self, command: Command) -> StdResult<(), String> {
        self.tx
            .send(command)
            .map_err(|_| "实时页面线程已经退出".to_string())?;
        unsafe {
            PostMessageW(
                Some(HWND(self.hwnd as *mut core::ffi::c_void)),
                WM_LIVE_COMMAND,
                WPARAM(0),
                LPARAM(0),
            )
            .map_err(|error| format!("无法唤醒实时页面线程：{error}"))?;
        }
        Ok(())
    }

    pub fn close(mut self) {
        let _ = self.send(Command::Close);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

impl Drop for LiveSession {
    fn drop(&mut self) {
        // 不 join：sidecar 退出时线程会随进程结束；主动 close() 才等待。
        let _ = self.tx.send(Command::Close);
        unsafe {
            let _ = PostMessageW(
                Some(HWND(self.hwnd as *mut core::ffi::c_void)),
                WM_LIVE_COMMAND,
                WPARAM(0),
                LPARAM(0),
            );
        }
    }
}

struct FrameSink {
    tx: SyncSender<Value>,
}

impl FrameSink {
    fn new(emitter: Arc<Mutex<Option<PluginEmitter>>>) -> Self {
        let (tx, rx) = mpsc::sync_channel::<Value>(16);
        let _ = thread::Builder::new()
            .name("dbx-webview2-events".into())
            .spawn(move || {
                while let Ok(frame) = rx.recv() {
                    let emitter = emitter.lock().ok().and_then(|guard| guard.clone());
                    if let Some(emitter) = emitter {
                        let _ = emitter.event("webview/liveFrame", frame);
                    }
                }
            });
        Self { tx }
    }
}

struct Context {
    rx: Receiver<Command>,
    webview: ICoreWebView2,
    controller: ICoreWebView2Controller,
    emitter: Arc<Mutex<Option<PluginEmitter>>>,
    screencast: bool,
    /// 当前采集尺寸（像素）。由 UI 按显示尺寸设置，默认用视口大小。
    capture: (i32, i32),
    /// 输入转发失败只报一次（鼠标移动很频繁，否则会刷屏）。
    input_error_once: std::sync::atomic::AtomicBool,
}

thread_local! {
    static CONTEXT: RefCell<Option<Context>> = const { RefCell::new(None) };
}

fn run(profile: PathBuf, rx: Receiver<Command>, ready: Sender<StdResult<isize, String>>) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }

    let hwnd = match create_window() {
        Ok(hwnd) => hwnd,
        Err(error) => {
            let _ = ready.send(Err(format!("无法创建 WebView2 窗口：{error}")));
            return;
        }
    };

    let environment = match create_environment(&profile) {
        Ok(environment) => environment,
        Err(error) => {
            let _ = ready.send(Err(error));
            unsafe {
                let _ = DestroyWindow(hwnd);
            }
            return;
        }
    };

    let controller = match create_controller(&environment, hwnd) {
        Ok(controller) => controller,
        Err(error) => {
            let _ = ready.send(Err(error));
            unsafe {
                let _ = DestroyWindow(hwnd);
            }
            return;
        }
    };

    let webview = match unsafe { controller.CoreWebView2() } {
        Ok(webview) => webview,
        Err(error) => {
            let _ = ready.send(Err(format!("无法取得 WebView2 实例：{error}")));
            unsafe {
                let _ = controller.Close();
                let _ = DestroyWindow(hwnd);
            }
            return;
        }
    };

    if let Err(error) = configure(&webview, &controller) {
        let _ = ready.send(Err(format!("初始化 WebView2 失败：{error}")));
        unsafe {
            let _ = controller.Close();
            let _ = DestroyWindow(hwnd);
        }
        return;
    }

    let emitter: Arc<Mutex<Option<PluginEmitter>>> = Arc::new(Mutex::new(None));
    let sink = FrameSink::new(emitter.clone());
    if let Err(error) = wire_events(&webview, &sink) {
        let _ = ready.send(Err(format!("订阅 WebView2 事件失败：{error}")));
        unsafe {
            let _ = controller.Close();
            let _ = DestroyWindow(hwnd);
        }
        return;
    }

    CONTEXT.with(|context| {
        *context.borrow_mut() = Some(Context {
            rx,
            webview,
            controller,
            emitter,
            screencast: false,
            capture: (VIEW_WIDTH, VIEW_HEIGHT),
            input_error_once: std::sync::atomic::AtomicBool::new(false),
        });
    });

    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let _ = UpdateWindow(hwnd);
    }

    let _ = ready.send(Ok(hwnd.0 as isize));

    let mut message = MSG::default();
    loop {
        let result = unsafe { GetMessageW(&mut message, None, 0, 0).0 };
        if result == -1 || result == 0 {
            break;
        }
        unsafe {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }

    CONTEXT.with(|context| {
        if let Some(context) = context.borrow_mut().take() {
            let _ = unsafe { context.controller.Close() };
            if context.screencast {
                stop_screencast(&context.webview);
            }
        }
    });
    unsafe {
        let _ = DestroyWindow(hwnd);
    }
}

fn configure(webview: &ICoreWebView2, controller: &ICoreWebView2Controller) -> windows::core::Result<()> {
    unsafe {
        controller.SetBounds(RECT {
            left: 0,
            top: 0,
            right: VIEW_WIDTH,
            bottom: VIEW_HEIGHT,
        })?;
        controller.SetIsVisible(true)?;
        let settings = webview.Settings()?;
        let _ = settings.SetAreDevToolsEnabled(true);
        let _ = settings.SetAreDefaultContextMenusEnabled(true);
        let _ = settings.SetIsStatusBarEnabled(false);
        let _ = settings.SetIsZoomControlEnabled(false);
    }
    let _ = cdp(
        webview,
        "Page.enable",
        json!({}),
    );
    let _ = cdp(
        webview,
        "Emulation.setDeviceMetricsOverride",
        json!({
            "width": VIEW_WIDTH,
            "height": VIEW_HEIGHT,
            "deviceScaleFactor": 1,
            "mobile": false
        }),
    );
    Ok(())
}

fn create_environment(profile: &PathBuf) -> StdResult<ICoreWebView2Environment, String> {
    let _ = std::fs::create_dir_all(profile);
    let profile_text = CoTaskMemPWSTR::from(profile.to_string_lossy().as_ref());
    let slot: Rc<RefCell<Option<ICoreWebView2Environment>>> = Rc::new(RefCell::new(None));
    let slot_for_callback = slot.clone();
    CreateCoreWebView2EnvironmentCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            CreateCoreWebView2EnvironmentWithOptions(
                PCWSTR::null(),
                *profile_text.as_ref().as_pcwstr(),
                None,
                &handler,
            )
            .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |error_code, environment| {
            error_code?;
            *slot_for_callback.borrow_mut() = environment;
            Ok(())
        }),
    )
    .map_err(|error| format!("WebView2 运行时不可用：{error}"))?;
    let value = slot
        .borrow_mut()
        .take()
        .ok_or_else(|| "WebView2 没有返回环境对象".to_string())?;
    Ok(value)
}

fn create_controller(
    environment: &ICoreWebView2Environment,
    hwnd: HWND,
) -> StdResult<ICoreWebView2Controller, String> {
    let slot: Rc<RefCell<Option<ICoreWebView2Controller>>> = Rc::new(RefCell::new(None));
    let slot_for_callback = slot.clone();
    let environment = environment.clone();
    CreateCoreWebView2ControllerCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            environment
                .CreateCoreWebView2Controller(hwnd, &handler)
                .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |error_code, controller| {
            error_code?;
            *slot_for_callback.borrow_mut() = controller;
            Ok(())
        }),
    )
    .map_err(|error| format!("创建 WebView2 控制器失败：{error}"))?;
    let value = slot
        .borrow_mut()
        .take()
        .ok_or_else(|| "WebView2 没有返回控制器".to_string())?;
    Ok(value)
}

fn wire_events(webview: &ICoreWebView2, sink: &FrameSink) -> windows::core::Result<()> {
    let receiver = unsafe { webview.GetDevToolsProtocolEventReceiver(w!("Page.screencastFrame"))? };
    let ack_webview = webview.clone();
    let frame_sink = sink.clone_handle();
    let last_frame = Rc::new(Cell::new(Instant::now() - FRAME_INTERVAL));
    let sequence = Rc::new(Cell::new(0u64));
    let mut token = 0i64;
    let last_frame_for_handler = last_frame.clone();
    let sequence_for_handler = sequence.clone();
    let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(
        move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut parameter = PWSTR::null();
            unsafe { args.ParameterObjectAsJson(&mut parameter)? };
            let text = take_pwstr(parameter);
            let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            let session_id = value.get("sessionId").and_then(Value::as_i64).unwrap_or(0);
            if session_id != 0 {
                let _ = cdp(
                    &ack_webview,
                    "Page.screencastFrameAck",
                    json!({ "sessionId": session_id }),
                );
            }
            let data = value.get("data").and_then(Value::as_str).unwrap_or("");
            if data.is_empty() {
                return Ok(());
            }
            let now = Instant::now();
            if now.duration_since(last_frame_for_handler.get()) < FRAME_INTERVAL {
                return Ok(());
            }
            last_frame_for_handler.set(now);
            let width = value
                .pointer("/metadata/deviceWidth")
                .and_then(Value::as_u64)
                .unwrap_or(VIEW_WIDTH as u64);
            let height = value
                .pointer("/metadata/deviceHeight")
                .and_then(Value::as_u64)
                .unwrap_or(VIEW_HEIGHT as u64);
            let seq = sequence_for_handler.get() + 1;
            sequence_for_handler.set(seq);
            frame_sink.frame(json!({
                "data": data,
                "seq": seq,
                "width": width,
                "height": height,
            }));
            Ok(())
        },
    ));
    unsafe {
        receiver.add_DevToolsProtocolEventReceived(&handler, &mut token)?;
    }

    let mut event_token = 0i64;
    let source = SourceChangedEventHandler::create(Box::new(|_sender, _args| {
        emit_current_state();
        Ok(())
    }));
    unsafe {
        webview.add_SourceChanged(&source, &mut event_token)?;
    }

    let mut event_token = 0i64;
    let title = DocumentTitleChangedEventHandler::create(Box::new(|_sender, _args| {
        emit_current_state();
        Ok(())
    }));
    unsafe {
        webview.add_DocumentTitleChanged(&title, &mut event_token)?;
    }

    let mut event_token = 0i64;
    let history = HistoryChangedEventHandler::create(Box::new(|_sender, _args| {
        emit_current_state();
        Ok(())
    }));
    unsafe {
        webview.add_HistoryChanged(&history, &mut event_token)?;
    }

    let mut event_token = 0i64;
    let navigation = NavigationCompletedEventHandler::create(Box::new(|_sender, _args| {
        emit_current_state();
        Ok(())
    }));
    unsafe {
        webview.add_NavigationCompleted(&navigation, &mut event_token)?;
    }

    let new_window_webview = webview.clone();
    let mut event_token = 0i64;
    let new_window = NewWindowRequestedEventHandler::create(Box::new(move |_sender, args| {
        let Some(args) = args else { return Ok(()) };
        let mut uri = PWSTR::null();
        unsafe { args.Uri(&mut uri)? };
        let target = take_pwstr(uri);
        unsafe {
            let _ = args.SetHandled(true);
            if let Ok(parsed) = Url::parse(&target) {
                if parsed.scheme() == "http" || parsed.scheme() == "https" {
                    let url = CoTaskMemPWSTR::from(parsed.as_str());
                    let _ = new_window_webview.Navigate(*url.as_ref().as_pcwstr());
                }
            }
        }
        Ok(())
    }));
    unsafe {
        webview.add_NewWindowRequested(&new_window, &mut event_token)?;
    }
    Ok(())
}

fn emit_current_state() {
    CONTEXT.with(|context| {
        if let Some(context) = context.borrow().as_ref() {
            emit_state(context);
        }
    });
}

impl FrameSink {
    /// 事件回调需要 `'static`，用一个只含 sender 的轻量克隆。
    fn clone_handle(&self) -> FrameHandle {
        FrameHandle {
            tx: self.tx.clone(),
        }
    }
}

struct FrameHandle {
    tx: SyncSender<Value>,
}

impl FrameHandle {
    fn frame(&self, payload: Value) {
        let _ = self.tx.try_send(payload);
    }
}

fn create_window() -> windows::core::Result<HWND> {
    unsafe {
        let instance = GetModuleHandleW(None)?;
        let window_class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: HINSTANCE(instance.0),
            lpszClassName: WINDOW_CLASS,
            ..Default::default()
        };
        let _ = RegisterClassW(&window_class);
        let hwnd = CreateWindowExW(
            WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            WINDOW_CLASS,
            w!("DBX live page"),
            WS_POPUP,
            -20000,
            -20000,
            VIEW_WIDTH,
            VIEW_HEIGHT,
            None,
            None,
            Some(HINSTANCE(instance.0)),
            None,
        )?;
        Ok(hwnd)
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_LIVE_COMMAND => {
            // 先 take 出来再处理：drain_commands 里会触发 WebView2 的同步事件，
            // 事件回调还会再借用 CONTEXT；borrow_mut 的临时值必须在此之前结束。
            let taken = CONTEXT.with(|slot| slot.borrow_mut().take());
            if let Some(mut context) = taken {
                drain_commands(&mut context);
                CONTEXT.with(|slot| {
                    *slot.borrow_mut() = Some(context);
                });
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, message, wparam, lparam),
    }
}

fn drain_commands(context: &mut Context) {
    loop {
        let command = match context.rx.try_recv() {
            Ok(command) => command,
            Err(_) => break,
        };
        match command {
            Command::Open { url, emitter } => {
                if let Ok(mut guard) = context.emitter.lock() {
                    *guard = Some(emitter);
                }
                navigate(context, &url);
                if !context.screencast {
                    start_screencast(&context.webview, context.capture);
                    context.screencast = true;
                }
                emit_state(context);
            }
            Command::Resize { width, height } => {
                let next = clamp_capture(width, height);
                if next != context.capture {
                    context.capture = next;
                    // screencast 的尺寸只能在开始时指定：停掉重开。
                    if context.screencast {
                        stop_screencast(&context.webview);
                        start_screencast(&context.webview, next);
                        context.screencast = true;
                    }
                }
            }
            Command::Navigate(url) => {
                navigate(context, &url);
            }
            Command::Back => {
                let _ = unsafe { context.webview.GoBack() };
                emit_state(context);
            }
            Command::Forward => {
                let _ = unsafe { context.webview.GoForward() };
                emit_state(context);
            }
            Command::Reload => {
                let _ = unsafe { context.webview.Reload() };
            }
            Command::Input(payload) => {
                apply_input(context, &payload);
            }
            Command::Eval { expression, reply } => {
                let webview = context.webview.clone();
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |error_code, result| {
                        let outcome = match error_code {
                            Ok(()) => {
                                let parsed: Value =
                                    serde_json::from_str(&result).unwrap_or(Value::Null);
                                let value = parsed
                                    .get("result")
                                    .and_then(|item| item.get("value"))
                                    .cloned()
                                    .unwrap_or(Value::Null);
                                Ok(value)
                            }
                            Err(error) => Err(format!("实时页面执行失败：{error}")),
                        };
                        let _ = reply.send(outcome);
                        Ok(())
                    },
                ));
                let method = CoTaskMemPWSTR::from("Runtime.evaluate");
                let params = CoTaskMemPWSTR::from(
                    json!({
                        "expression": expression,
                        "returnByValue": true,
                        "awaitPromise": true
                    })
                    .to_string()
                    .as_str(),
                );
                unsafe {
                    let _ = webview.CallDevToolsProtocolMethod(
                        *method.as_ref().as_pcwstr(),
                        *params.as_ref().as_pcwstr(),
                        &handler,
                    );
                }
            }
            Command::Pause => {
                if context.screencast {
                    stop_screencast(&context.webview);
                    context.screencast = false;
                }
            }
            Command::Resume => {
                if !context.screencast {
                    start_screencast(&context.webview, context.capture);
                    context.screencast = true;
                    emit_state(context);
                }
            }
            Command::Close => {
                if context.screencast {
                    stop_screencast(&context.webview);
                    context.screencast = false;
                }
                unsafe {
                    let _ = context.controller.Close();
                }
                // 让消息循环退出；窗口在该线程里由 run() 统一销毁。
                unsafe {
                    PostQuitMessage(0);
                }
                break;
            }
        }
    }
}

fn navigate(context: &Context, url: &str) {
    let Ok(parsed) = Url::parse(url) else {
        emit_error(context, format!("地址不合法：{url}"));
        return;
    };
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        emit_error(context, format!("实时页面只允许 http/https：{url}"));
        return;
    }
    let url = CoTaskMemPWSTR::from(parsed.as_str());
    unsafe {
        if let Err(error) = context.webview.Navigate(*url.as_ref().as_pcwstr()) {
            emit_error(context, format!("打开页面失败：{error}"));
        }
    }
}

/// 采集尺寸的合法范围。
///
/// 下限保证画面还能看清文字，上限等于视口（再大没有意义，页面就那么大）。
/// 注意 screencast 会**保持视口宽高比**缩放到这个框里，所以高度通常才是瓶颈。
fn clamp_capture(width: i32, height: i32) -> (i32, i32) {
    let width = width.clamp(480, VIEW_WIDTH);
    let height = height.clamp(360, VIEW_HEIGHT);
    (width, height)
}

fn start_screencast(webview: &ICoreWebView2, capture: (i32, i32)) {
    let (max_width, max_height) = capture;
    let _ = cdp(
        webview,
        "Page.startScreencast",
        json!({
            "format": "jpeg",
            // 解码成本与**像素数**成正比（实测：1280×900 每帧 31.9ms，960×675 只要 12.6ms），
            // 而画面最终都要缩进面板显示。所以采集尺寸由 UI 按面板实际大小给出：
            // 既不牺牲清晰度，又不会解码一堆屏幕上根本显示不出来的像素。
            "quality": SCREENCAST_QUALITY,
            "maxWidth": max_width,
            "maxHeight": max_height,
            "everyNthFrame": SCREENCAST_EVERY_NTH_FRAME
        }),
    );
}

fn stop_screencast(webview: &ICoreWebView2) {
    let _ = cdp(webview, "Page.stopScreencast", json!({}));
}

fn emit_state(context: &Context) {
    let webview = &context.webview;
    let mut url = PWSTR::null();
    let mut title = PWSTR::null();
    let mut can_back = BOOL(0);
    let mut can_forward = BOOL(0);
    unsafe {
        let _ = webview.Source(&mut url);
        let _ = webview.DocumentTitle(&mut title);
        let _ = webview.CanGoBack(&mut can_back);
        let _ = webview.CanGoForward(&mut can_forward);
    }
    let url = take_pwstr(url);
    let title = take_pwstr(title);
    let payload = json!({
        "url": url,
        "title": title,
        "canGoBack": can_back.as_bool(),
        "canGoForward": can_forward.as_bool(),
        "screencast": context.screencast,
    });
    let emitter = context.emitter.lock().ok().and_then(|guard| guard.clone());
    if let Some(emitter) = emitter {
        let _ = emitter.event("webview/liveState", payload);
    }
}

fn emit_error(context: &Context, message: impl Into<String>) {
    let emitter = context.emitter.lock().ok().and_then(|guard| guard.clone());
    if let Some(emitter) = emitter {
        let _ = emitter.event(
            "webview/liveError",
            json!({ "message": message.into() }),
        );
    }
}

/// 实时页面的输入转发失败时，把原因送到 UI（并打到 stderr）。
///
/// 只报第一次：鼠标移动很频繁，真出问题会连着失败，刷屏没有意义。
fn report_input_error(context: &Context, kind: &str, error: &impl std::fmt::Display) {
    let already = context
        .input_error_once
        .swap(true, std::sync::atomic::Ordering::Relaxed);
    if already {
        return;
    }
    let message = format!("实时页面{kind}输入转发失败：{error}");
    eprintln!("[dbx-webview] {message}");
    emit_error(context, message);
}

fn apply_input(context: &Context, payload: &Value) {
    let kind = payload.get("kind").and_then(Value::as_str).unwrap_or("");
    match kind {
        "mouse" => {
            let raw_type = payload
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("moved");
            // The UI uses short names ("pressed"/"released"/"moved"/"wheel");
            // CDP's Input.dispatchMouseEvent only accepts the "mouse*" names.
            let event_type = match raw_type {
                "pressed" => "mousePressed",
                "released" => "mouseReleased",
                "moved" => "mouseMoved",
                "wheel" => "mouseWheel",
                other => other,
            };
            let mut params = json!({
                "type": event_type,
                "x": payload.get("x").and_then(Value::as_f64).unwrap_or(0.0),
                "y": payload.get("y").and_then(Value::as_f64).unwrap_or(0.0),
                "button": match raw_type {
                    "moved" | "wheel" => "none",
                    _ => payload.get("button").and_then(Value::as_str).unwrap_or("left"),
                },
                "buttons": if raw_type == "pressed" { 1 } else { 0 },
                "pointerType": "mouse",
                "clickCount": payload.get("clickCount").and_then(Value::as_i64).unwrap_or(1),
                "modifiers": payload.get("modifiers").and_then(Value::as_i64).unwrap_or(0),
            });
            if raw_type == "wheel" {
                params["deltaX"] = json!(payload.get("deltaX").and_then(Value::as_f64).unwrap_or(0.0));
                params["deltaY"] = json!(payload.get("deltaY").and_then(Value::as_f64).unwrap_or(0.0));
            }
            // 以前这里是 `let _ = cdp(...)`：调用失败会被完全吞掉，用户只看到
            // "点了没反应"，日志里什么都没有。这类"静默失败"必须报出来。
            if let Err(error) = cdp(&context.webview, "Input.dispatchMouseEvent", params) {
                report_input_error(context, "鼠标", &error);
            }
        }
        "key" => {
            let mut params = json!({
                "type": payload.get("type").and_then(Value::as_str).unwrap_or("keyDown"),
                "key": payload.get("key").and_then(Value::as_str).unwrap_or(""),
                "code": payload.get("code").and_then(Value::as_str).unwrap_or(""),
                "windowsVirtualKeyCode": payload.get("windowsVirtualKeyCode").and_then(Value::as_i64).unwrap_or(0),
                "nativeVirtualKeyCode": payload.get("windowsVirtualKeyCode").and_then(Value::as_i64).unwrap_or(0),
                "modifiers": payload.get("modifiers").and_then(Value::as_i64).unwrap_or(0),
            });
            if let Some(text) = payload.get("text").and_then(Value::as_str) {
                if !text.is_empty() {
                    params["text"] = json!(text);
                    params["unmodifiedText"] = json!(text);
                }
            }
            if let Err(error) = cdp(&context.webview, "Input.dispatchKeyEvent", params) {
                report_input_error(context, "键盘", &error);
            }
        }
        "text" => {
            let text = payload.get("text").and_then(Value::as_str).unwrap_or("");
            if !text.is_empty() {
                if let Err(error) = cdp(&context.webview, "Input.insertText", json!({ "text": text })) {
                    report_input_error(context, "文字", &error);
                }
            }
        }
        _ => {}
    }
}

fn cdp(webview: &ICoreWebView2, method: &str, params: Value) -> windows::core::Result<()> {
    let method = CoTaskMemPWSTR::from(method);
    let params = CoTaskMemPWSTR::from(params.to_string().as_str());
    unsafe {
        webview.CallDevToolsProtocolMethod(
            *method.as_ref().as_pcwstr(),
            *params.as_ref().as_pcwstr(),
            None::<&ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>,
        )
    }
}
