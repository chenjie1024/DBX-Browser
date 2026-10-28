/* =============================================================================
 * DBX 网页浏览 · DBX Web Reader — workbench front-end
 * -----------------------------------------------------------------------------
 * Runs inside an iframe sandboxed with `allow-scripts` only:
 *   - the origin is OPAQUE  -> no localStorage / sessionStorage / indexedDB / cookies
 *   - the CSP blocks fetch   -> every byte of data arrives through window.dbxPlugin.invoke
 *   - no alert/confirm/prompt (unreliable) -> inline panels only
 *   - classic script only, no import / no build step
 *
 * Sidecar contract (see README / manifest):
 *   invoke("webview/render",    { url, mode, presetId, options }) -> page payload
 *   invoke("webview/presets",   {})                               -> { presets: [...] }
 *   invoke("webview/check",     {})                               -> { ok, plugin, version }
 *   invoke("webview/searchUrl", { presetId, query })              -> { url }
 * ========================================================================== */
(function () {
  "use strict";

  /* ── captured natives (captured before any remote HTML can shadow them) ── */
  var NativeUrl = window.URL;

  /* ═══════════════════════════════════════════════════════════════════════
   * 1. Copy — every user-visible string, zh-CN + en
   * ═══════════════════════════════════════════════════════════════════════ */
  var COPY = {
    "zh-CN": {
      appName: "Browser",
      untitledTab: "新标签页",
      presetNewTitle: "新建站点预设",
      presetEditTitle: "编辑站点预设",
      presetEdit: "编辑",
      presetDelete: "删除",
      presetSaved: "站点预设已保存",
      presetSaveFailed: "站点预设保存失败",
      presetNeedName: "请填一个名字，否则列表里认不出来",
      presetNeedHost: "至少要有一个域名，否则这条规则永远匹配不到页面",
      presetBadHost: "域名格式不对：{host}",
      presetFormHint:
        "域名支持 example.com、*.example.com、example.com/path。正文/删除选择器用逗号分隔，留空表示按通用规则处理。",
      presetCustomCategory: "自定义",
      presetCustomDesc: "自定义规则：{hosts}",
      presetCopySuffix: "（副本）",
      presetHostEdit: "修改",
      presetHostEditTitle: "修改域名",
      presetHostRemoved: "已从匹配中移除（右键可恢复）",
      presetHostRestore: "恢复",
      presetHostDeleteConfirm: "确认删除 {host}？",
      presets: "站点预设",
      bookmarks: "书签",
      history: "历史",
      newTab: "新建标签页",
      auto: "自动",
      autoPreset: "自动识别",
      reader: "阅读模式",
      full: "整页模式",
      source: "源码",
      mode: "模式",
      modeHint: "阅读模式适合文章/小说章节，整页模式保留原站排版",
      back: "后退",
      forward: "前进",
      reload: "刷新",
      sidebarToggle: "显示/收起侧栏",
      address: "地址",
      addressPlaceholder: "输入网址或搜索关键词",
      go: "打开",
      bookmarkAdd: "收藏此页",
      bookmarkRemove: "取消收藏",
      style: "样式",
      stylePanel: "阅读样式",
      close: "关闭",
      perSite: "仅当前站点",
      fontFamily: "字体",
      fontSystem: "系统默认",
      fontSerif: "宋体 / Serif",
      fontSans: "黑体 / Sans",
      fontKai: "楷体 / Kai",
      fontSize: "字号",
      lineHeight: "行高",
      pageWidth: "页面宽度",
      contentWidth: "正文宽度",
      textColor: "文字颜色",
      bgColor: "背景颜色",
      followTheme: "跟随 DBX 主题",
      paraSpacing: "段间距",
      letterSpacing: "字间距",
      indent: "首行缩进 2 字符",
      darkRead: "夜间阅读模式",
      customCss: "自定义 CSS",
      customCssHint:
        "样式会直接注入当前文档，请在每条规则前加 `.page-content ` 前缀（例如 .page-content p { text-align: justify }），否则会影响插件界面。",
      customCssHintEmpty:
        "留空表示不使用自定义样式。写了之后这里会告诉你它是否真的生效。",
      customCssApplied:
        "✓ 语法通过，且实测已在本页生效（同样的规则也会注入「浏览器窗口」打开的那个窗口）。",
      customCssBlocked:
        "⚠ 语法没问题，但实测这条规则没有生效（宿主可能拦了内联样式）。样式仍会尝试注入浏览器窗口。",
      resetAll: "恢复默认",
      emptyTitle: "在 DBX 中浏览网页",
      emptyText:
        "在上方输入网址或搜索关键词，Rust sidecar 会抓取该页面、抽取正文并按站点预设重新排版，只把安全的 HTML 交给界面渲染。",
      emptyTextDetail:
        "网站首页和列表页通常没什么正文，会自动回退为整页模式；文章、小说章节、视频与笔记详情页的阅读效果最好。",
      examplesLabel: "示例站点",
      loading: "正在抓取",
      errorTitle: "打开失败",
      retry: "重试",
      viewSource: "用源码模式查看",
      errGeneric: "未知错误",
      errTimeout: "请求超时",
      errUnknownHost: "无法解析该域名",
      errNoPreset: "没有匹配的站点预设",
      errEmpty: "该地址无法打开",
      err403:
        "站点拒绝访问（403）——最常见的原因按顺序排查：① 开着 VPN / 代理（换了出口 IP，站点直接拒绝，实测过）；② 反爬拦截，改用详情页链接、或先在浏览器里登录该站点；③ 该站要求登录。",
      err404: "页面不存在（404）——检查链接是否完整",
      err429: "请求过于频繁（429）——稍等一会儿再试",
      err5xx: "站点服务器出错（5xx）——这是对方的问题，稍后重试",
      errConnect: "连不上这个站点——检查网络或代理设置",
      yourBookmarks: "还没有书签，点击工具栏的 ☆ 收藏当前页面。",
      yourHistory: "还没有浏览记录。",
      urlEmpty: "当前标签没有网址。",
      urlInAddressBar: "网址已放到地址栏并全选，可直接复制。",
      browserOpen: "浏览器打开",
      browserOpenHint: "在真实浏览器窗口中打开当前页面（完整渲染，支持视频与登录）",
      browserOpenHintUrl: "在浏览器窗口中打开：{url}",
      browserSection: "浏览器窗口",
      browserOpenAction: "用浏览器窗口打开当前页面",
      browserSectionHint:
        "已找到 {name}。插件沙箱内嵌不了外部站点（CSP 只放行 frame-src 'self'），所以「活的页面」只能这样看：真实渲染、视频可播、可登录。阅读样式会一并写进这个窗口。",
      browserProfileHint: "阅读专用 profile（独立于你自己的浏览器）：{dir}",
      browserCurrentUrl: "将要在浏览器窗口中打开的地址：{url}",
      browserNoUrl: "先打开一个网页，这里会显示将要打开的地址。",
      browserFetch: "取回浏览器窗口的当前地址",
      cssIssueAt: "第 {line} 行第 {column} 列：{message}",
      catalogMissing: "没有从这一页找到目录地址，可以在书的首页或章节列表页里手动点。",
      catalog: "目录",
      catalogHint: "回到这本书的目录：{url}",
      needsLoginNotice: "这个站点的章节页要登录才给正文，插件抓不到内容。",
      needsLoginAction: "用浏览器窗口打开",
      browserFetching: "正在读取阅读窗口的访问记录…",
      browserFetchGot: "已读到 {n} 条记录，最新的已在插件里打开；清单里可以点别的。",
      browserFetchEmpty:
        "还没有读到阅读窗口的访问记录。先在浏览器窗口里打开一个页面，再回来取。",
      browserFetchLoading: "打开浏览器窗口里的地址：{url}",
      browserNeedUrl: "先打开一个网页，再用浏览器窗口查看。",
      browserOpening: "正在打开浏览器窗口…",
      browserOpened: "已在浏览器窗口中打开。",
      browserFocused: "阅读窗口已经开着，已把这一页交给它。",
      browserUnavailable: "没找到 Chrome 或 Edge，无法打开浏览器窗口。",
      live: "实时页面",
      liveExit: "退出实时",
      liveBadge: "实时渲染",
      liveOpening: "正在启动真实浏览器…",
      liveHint: "首次打开需要几秒；登录一次后会记住",
      liveTips: "点击页面即可操作 · 中文输入法直接输入 · 滚轮翻页",
      liveLoginHint: "要登录或评论，直接在画面上点击输入即可。",
      liveUnavailable: "实时页面不可用：WebView2 运行时缺失或启动失败。",
      liveError: "实时页面出错",
      liveRetry: "重试",
      liveFallback: "实时页面启动失败，已切回阅读模式：{error}",
      liveStatus: "实时 · {host}",
      liveConnected: "实时页面已连接",
      noPresets: "未读取到站点预设。",
      openPresetSite: "打开 {host}",
      clear: "清空",
      clearHistoryConfirm: "确定清空全部历史记录吗？",
      chapter: "章节",
      prevChapter: "上一章",
      nextChapter: "下一章",
      startReading: "开始阅读",
      catalogue: "目录",
      toc: "本页目录",
      gallery: "图片",
      brokenImage: "图片无法显示",
      fallbackNotice: "阅读模式内容较少，已自动切换为整页模式。",
      statusReady: "就绪",
      statusLoading: "抓取中",
      statusLoaded: "完成",
      statusEmpty: "空闲",
      statusError: "失败",
      sourceNotice: "源码模式：以下为该地址的原始 HTML 转义文本。",
      warnMore: "另有 {n} 条提示",
      dismiss: "关闭提示",
      backendMissing: "未能连接 sidecar：网页渲染后端不可用。请确认插件后端已启动后重试。",
      bridgeMissing: "当前页面不在 DBX 插件宿主中，window.dbxPlugin 不可用，所有数据调用已禁用。",
      storageOff: "未获得 host.storage 权限，本次会话的设置不会被保存。",
      truncated: "已截断",
      /* 伪装层 / 设置面板 */
      coverCopy: "复制",
      coverExport: "导出 CSV",
      coverCopyText: "复制",
      coverExportText: "导出 CSV",
      coverCopyShort: "复制",
      coverFilterLabel: "筛选",
      tabStyle: "样式",
      tabBrowser: "浏览器窗口",
      tabGeneral: "设置",
      coverCopied: "已复制结果（可直接粘到 Excel）",
      coverExported: "已按 CSV 复制 {n} 行（粘到 Excel 即可）",
      coverFiltered: "筛选后",
      coverSearchPlaceholder: "按状态 / 标识检索",
      coverSwitched: "已切换连接",
      coverRun: "运行",
      coverReady: "就绪",
      coverRunning: "执行中…",
      coverDone: "查询完成",
      coverConn: "连接",
      coverDb: "数据库",
      coverResult: "结果",
      coverRows: "{n} 行",
      coverFootLeft: "只读事务 · autocommit off",
      settings: "设置",
      themeLegend: "外观",
      themeLight: "日间",
      themeDark: "夜间",
      themeFollow: "跟随 DBX",
      hotkeyLegend: "切换热键",
      hotkeyHint: "在这个界面内按下组合键即可切换（例如 Escape、Alt+Q、Ctrl+Shift+H）。点输入框后直接按键录制。需要先点一下工作台内部，键盘事件才会送到插件。",
      hotkeyReset: "恢复默认",
      hotkeyRecording: "请按键…",
      coverOnStart: "打开工作台时先显示这个界面",
      coverHideOnFocus: "切回 DBX 时自动显示这个界面",
      coverHideOnBlur: "离开工作台时自动显示这个界面（推荐）",
      readerLegend: "阅读",
      optMergePages: "合并分页（把同一章被切开的几页拼起来）",
      optTradToSimp: "繁体转简体",
      enterReader: "进入阅读界面",
      /* 访问被挡 / 内容为空 */
      blockedTitle: "这个页面被站点拦截了",
      blockedText:
        "站点返回的是登录墙、人机验证或频控页，服务端 HTML 里没有正文。换一个详情页链接、或者先在浏览器里登录该站点，再回来重试通常就能打开。",
      emptyPageTitle: "这个页面没有抓到可读内容",
      emptyPageText:
        "正文可能完全由 JavaScript 渲染。可以试试整页模式，或者换一个文章 / 章节 / 视频 / 笔记的详情页链接——详情页的抓取效果通常好很多。",
      linkWallText:
        "这是首页 / 频道页 / 列表页，本身没有正文。直接点下面的链接就能进到目录或章节 —— 链接在插件里是可点的。",
      tryFullMode: "试试整页模式",
      openInNewTab: "在浏览器打开",
      localBook: "本地小说",
      localHead: "本地小说",
      localImport: "导入 txt",
      localShelf: "书架",
      localRecent: "浏览记录",
      localToc: "目录",
      localRemove: "从书架移除",
      localImporting: "正在导入…",
      localImported: "已导入，切出 {n} 章",
      localImportFailed: "导入失败：{reason}",
      localNone: "还没有导入本地小说，先在侧栏「本地小说」里选一个 txt。",
      localNoneHint: "点右上角「导入 txt」选一个 .txt 文件。文件只在本机读取，不会上传。",
      localLoadingBook: "正在从本地读取这本书…",
      localBookMissing: "这本书的正文不在磁盘上了，请重新导入。",
      localBookMissingNamed: "《{name}》的正文不在磁盘上了，请重新导入这一卷。",
      localVolumesGone: "这几卷的正文不在磁盘上了，请重新导入：{names}",
      localUploading: "正在写入这本书… {done}/{all}",
      localActionFailed: "操作失败：{reason}",
      localTapToLoad: "目录共 {n} 章，正在读取…",
      storageWriteFailed: "保存失败（{key}）：宿主存储单值上限 256 KiB，这条没写进去。",
      localChapterCount: "{n} 章",
      localChars: "{n} 字",
      localChapterOf: "第 {n} / {m} 章",
      localVolumeCount: "{n} 卷",
      localVolumeAt: "第 {n}/{m} 卷",
      localVolumeLoaded: "已载入 {done}/{all} 卷",
      localLoadAllVolumes: "载入其余各卷（可跨卷连读）",
      localLoadingSeries: "正在载入这套书的 {n} 卷…",
      localSeriesPartial: "有 {n} 卷的正文不在磁盘上，其余各卷照常可读。",
      localFinished: "读完",
      localFinishedHint: "最后一章已读过",
      bookmarkAdded: "已收藏（本地书收藏的是这一章）",
      sparseTitle: "这一条只是分卷标记，本身没有正文",
      sparseText:
        "txt 里「第一卷 ……」这类行会被当成一个分章点，但它是全书结构而不是内容。它在目录里用斜体标出，点进去就是这样一页空白——不是文件读错了。",
      sparseFacts: "本行正文 {n} 字 · 第 {at} / {total} 条",
      sparseNext: "去下一章",
      sparsePrev: "回上一章",
      diagLegend: "状态自检",
      diagChecking: "正在检测…",
      diagRefreshText: "重新检测",
      diagStorage: "宿主存储",
      diagStorageOk: "可用 — 书架与阅读位置会保存",
      diagStorageMissing: "未授权 — 书架和阅读位置都不会保存",
      diagStorageHint: "需要 manifest 里的 host.storage 权限；旧宿主可能不提供该能力。",
      diagIndex: "书架索引",
      diagIndexValue: "{n} 本 · {kb} KB",
      diagIndexNearLimit: "接近宿主单值上限（256 KB），建议删掉几本不读的。",
      diagFiles: "原文文件",
      diagFilesValue: "{n} 个 · {mb} MB",
      diagFilesMissing: "有 {n} 本的原文不在磁盘上了，需要重新导入。",
      diagBackendDown: "后端无响应",
      diagBackendDownHint: "sidecar 没跑起来，抓网页和读写本地小说都会失败。",
      diagTrad: "繁简字库",
      diagTradValue: "{c} 单字 + {p} 词组",
      diagPresets: "站点预设",
      diagPresetsValue: "{n} 条",
      localFirstChapter: "已经是第一章了。",
      localLastChapter: "已经是最后一章了。",
      localUnsupported: "当前环境不支持选择本地文件。",
      "localReason_no-file": "没有选到文件",
      "localReason_bad-type": "只支持 .txt / .md",
      "localReason_too-large": "文件太大",
      "localReason_read-failed": "读取失败",
      "localReason_sidecar-failed": "后端写入失败",
      "localReason_sidecar-rejected": "后端拒绝了这本书",
      "localReason_incomplete": "写入不完整（分块丢失）",
      "localReason_no-chapters": "没有识别出章节（需要「第N章」这类标题行）",
      charsCount: "{n} 字",
      resumed: "已回到上次读到的地方"
    },
    en: {
      appName: "Browser",
      untitledTab: "New tab",
      presetNewTitle: "New site preset",
      presetEditTitle: "Edit site preset",
      presetEdit: "Edit",
      presetDelete: "Delete",
      presetSaved: "Site preset saved",
      presetSaveFailed: "Could not save the site preset",
      presetNeedName: "Give it a name so it is recognisable in the list",
      presetNeedHost: "At least one host is required, otherwise this rule never matches",
      presetBadHost: "Invalid host: {host}",
      presetFormHint:
        "Hosts accept example.com, *.example.com, example.com/path. Separate selectors with commas; leave them empty to use the generic rules.",
      presetCustomCategory: "Custom",
      presetCustomDesc: "Custom rule: {hosts}",
      presetCopySuffix: " (copy)",
      presetHostEdit: "Edit",
      presetHostEditTitle: "Edit host",
      presetHostRemoved: "Removed from matching (right-click to restore)",
      presetHostRestore: "Restore",
      presetHostDeleteConfirm: "Delete {host}?",
      presets: "Site presets",
      bookmarks: "Bookmarks",
      history: "History",
      newTab: "New tab",
      auto: "Auto",
      autoPreset: "Auto detect",
      reader: "Reader",
      full: "Full page",
      source: "Source",
      mode: "Mode",
      modeHint: "Reader fits articles and novel chapters; Full page keeps the site layout",
      back: "Back",
      forward: "Forward",
      reload: "Reload",
      sidebarToggle: "Toggle sidebar",
      address: "Address",
      addressPlaceholder: "Enter a URL or search terms",
      go: "Go",
      bookmarkAdd: "Bookmark this page",
      bookmarkRemove: "Remove bookmark",
      style: "Style",
      stylePanel: "Reading style",
      close: "Close",
      perSite: "This site only",
      fontFamily: "Font",
      fontSystem: "System default",
      fontSerif: "Serif / 宋体",
      fontSans: "Sans / 黑体",
      fontKai: "Kai / 楷体",
      fontSize: "Font size",
      lineHeight: "Line height",
      pageWidth: "Page width",
      contentWidth: "Text width",
      textColor: "Text colour",
      bgColor: "Background",
      followTheme: "Follow DBX theme",
      paraSpacing: "Paragraph gap",
      letterSpacing: "Letter spacing",
      indent: "Indent first line (2em)",
      darkRead: "Dark reading mode",
      customCss: "Custom CSS",
      customCssHint:
        "Injected straight into this document — prefix every rule with `.page-content ` (for example .page-content p { text-align: justify }), otherwise it will repaint the plugin UI.",
      customCssHintEmpty:
        "Empty means no custom styles. Once you write some, this line tells you whether it actually took effect.",
      customCssApplied:
        "✓ Parsed fine, and it is verified as active on this page (the same rules are also written into the browser window).",
      customCssBlocked:
        "⚠ Syntax is fine, but the rule did NOT take effect here (the host may block inline styles). It will still be attempted in the browser window.",
      resetAll: "Reset",
      emptyTitle: "Browse the web inside DBX",
      emptyText:
        "Type a URL or search terms above. The Rust sidecar fetches the page, extracts and rewrites it, then hands sanitized HTML back for rendering.",
      emptyTextDetail:
        "Home and listing pages rarely carry body text and fall back to full-page mode; article, novel-chapter, video and note detail pages read best.",
      examplesLabel: "Example sites",
      loading: "Fetching",
      errorTitle: "Could not open",
      retry: "Retry",
      viewSource: "View as source",
      errGeneric: "Unknown error",
      errTimeout: "Request timed out",
      errUnknownHost: "Domain could not be resolved",
      errNoPreset: "No matching site preset",
      errEmpty: "This address cannot be opened",
      err403:
        "The site refused the request (403). Check, in order: (1) a VPN/proxy is on — it changes your exit IP and the site may reject it outright (measured); (2) anti-bot blocking — use a detail-page URL, or sign in to the site in a browser first; (3) the site requires a login.",
      err404: "Page not found (404) — check the URL",
      err429: "Too many requests (429) — wait a moment and retry",
      err5xx: "The site's server failed (5xx) — that is on their side, retry later",
      errConnect: "Cannot reach this site — check your network or proxy",
      yourBookmarks: "No bookmarks yet — press ☆ in the toolbar to save this page.",
      yourHistory: "No browsing history yet.",
      urlEmpty: "This tab has no URL yet.",
      urlInAddressBar: "URL put in the address bar and selected — copy it directly.",
      browserOpen: "Open in browser",
      browserOpenHint: "Open the current page in a real browser window (fully rendered; video and login work)",
      browserOpenHintUrl: "Open in a browser window: {url}",
      browserSection: "Browser window",
      browserOpenAction: "Open the current page in a browser window",
      browserSectionHint:
        "Found {name}. The plugin sandbox cannot embed external sites (CSP allows only frame-src 'self'), so this is how you see a live page: fully rendered, video playable, login works. Your reading style is copied into that window.",
      browserProfileHint: "Dedicated reading profile (separate from your own browser): {dir}",
      browserCurrentUrl: "Address that will open in the browser window: {url}",
      browserNoUrl: "Open a page first; the address to be opened will be shown here.",
      browserFetch: "Fetch the browser window's current address",
      cssIssueAt: "Line {line}, column {column}: {message}",
      catalogMissing: "No catalogue address could be derived from this page — open the book page and pick one there.",
      catalog: "Contents",
      catalogHint: "Back to this book's contents: {url}",
      needsLoginNotice: "This site only serves chapter text to a logged-in browser, so the plugin cannot fetch it.",
      needsLoginAction: "Open in browser window",
      browserFetching: "Reading the reading window's visit history…",
      browserFetchGot: "Read {n} records; the newest is open in the plugin — pick another from the list.",
      browserFetchEmpty:
        "No visit history from the reading window yet. Open a page in that window first, then try again.",
      browserFetchLoading: "Opening the address from the browser window: {url}",
      browserNeedUrl: "Open a page first, then view it in a browser window.",
      browserOpening: "Opening a browser window…",
      browserOpened: "Opened in a browser window.",
      browserFocused: "The reading window was already open — handed this page to it.",
      browserUnavailable: "Chrome or Edge was not found, so a browser window cannot be opened.",
      live: "Live page",
      liveExit: "Leave live",
      liveBadge: "Live render",
      liveOpening: "Starting a real browser…",
      liveHint: "The first open takes a few seconds; signing in is remembered",
      liveTips: "Click the page to interact · type Chinese directly · scroll with the wheel",
      liveLoginHint: "To sign in or comment, just click and type on the page.",
      liveUnavailable: "Live page unavailable: the WebView2 runtime is missing or failed to start.",
      liveError: "Live page error",
      liveRetry: "Retry",
      liveFallback: "The live page failed to start and fell back to reader mode: {error}",
      liveStatus: "Live · {host}",
      liveConnected: "Live page connected",
      noPresets: "No site presets were returned.",
      openPresetSite: "Open {host}",
      clear: "Clear",
      clearHistoryConfirm: "Clear the entire history?",
      chapter: "Chapter",
      prevChapter: "Previous",
      nextChapter: "Next",
      startReading: "Start reading",
      catalogue: "Chapters",
      toc: "On this page",
      gallery: "Images",
      brokenImage: "Image unavailable",
      fallbackNotice: "Reader mode returned little content — switched to full page automatically.",
      statusReady: "Ready",
      statusLoading: "Fetching",
      statusLoaded: "Done",
      statusEmpty: "Idle",
      statusError: "Failed",
      sourceNotice: "Source mode: escaped raw HTML of the address below.",
      warnMore: "{n} more notice(s)",
      dismiss: "Dismiss notices",
      backendMissing: "Sidecar unreachable: the rendering backend is not available. Make sure the plugin backend is running, then retry.",
      bridgeMissing: "This page is not running inside the DBX plugin host, so window.dbxPlugin is missing and every data call is disabled.",
      storageOff: "host.storage is not granted; settings will not be persisted for this session.",
      truncated: "truncated",
      /* cover layer / settings panel */
      coverFilterLabel: "Filter",
      tabStyle: "Style",
      tabBrowser: "Browser window",
      tabGeneral: "Settings",
      coverCopied: "Result copied (paste straight into Excel)",
      coverExported: "{n} rows copied as CSV (paste into Excel)",
      coverFiltered: "Filtered",
      coverSearchPlaceholder: "Search by status / identifier",
      coverSwitched: "Connection switched",
      coverRun: "Run",
      coverReady: "Ready",
      coverRunning: "Executing…",
      coverDone: "Query finished",
      coverConn: "Connection",
      coverDb: "Database",
      coverResult: "Result",
      coverRows: "{n} rows",
      coverFootLeft: "read-only transaction · autocommit off",
      settings: "Settings",
      themeLegend: "Appearance",
      themeLight: "Light",
      themeDark: "Dark",
      themeFollow: "Follow DBX",
      hotkeyLegend: "Toggle hotkey",
      hotkeyHint: "Press a combination while this workbench has focus (Escape, Alt+Q, Ctrl+Shift+H…). Click the field and press keys to record. Click inside the workbench first so keyboard events reach the plugin.",
      hotkeyReset: "Reset",
      hotkeyRecording: "Press keys…",
      coverOnStart: "Show this view first when the workbench opens",
      coverHideOnFocus: "Show this view again when DBX regains focus",
      coverHideOnBlur: "Show this view when the workbench loses focus (recommended)",
      readerLegend: "Reading",
      optMergePages: "Merge pagination (join a chapter split across pages)",
      optTradToSimp: "Traditional → Simplified Chinese",
      enterReader: "Open the reader",
      blockedTitle: "The site blocked this request",
      blockedText:
        "The server returned a login wall, captcha or rate-limit page with no article in the HTML. A detail-page URL usually works, and so does signing in to the site in a normal browser first.",
      emptyPageTitle: "No readable content on this page",
      emptyPageText:
        "The body is probably rendered entirely by JavaScript. Try full-page mode, or use an article / chapter / video / note detail URL — detail pages extract far better than home pages.",
      linkWallText:
        "It is a home / channel / listing page, so it has no article of its own. Click a link below to go to the contents or a chapter — links work inside the plugin.",
      tryFullMode: "Try full-page mode",
      openInNewTab: "Open in a browser",
      charsCount: "{n} chars",
      resumed: "Resumed where you left off",
      localBook: "Local novel",
      localHead: "Local novel",
      localImport: "Import txt",
      localShelf: "Shelf",
      localRecent: "Recently read",
      localToc: "Contents",
      localRemove: "Remove from shelf",
      localImporting: "Importing…",
      localImported: "Imported — {n} chapters",
      localImportFailed: "Import failed: {reason}",
      localNone: "No local novel yet — pick a txt in the sidebar's “Local novel” tab.",
      localNoneHint: "Click “Import txt” and choose a .txt file. It is read on this machine only; nothing is uploaded.",
      localLoadingBook: "Reading this book from disk…",
      localBookMissing: "This book's text is no longer on disk — import it again.",
      localBookMissingNamed: "“{name}” is no longer on disk — re-import this volume.",
      localVolumesGone: "These volumes are missing from disk — re-import them: {names}",
      localUploading: "Saving this book… {done}/{all}",
      localTapToLoad: "{n} chapters — loading…",
      localActionFailed: "Action failed: {reason}",
      storageWriteFailed: "Save failed ({key}): host storage caps a single value at 256 KiB, so it was not written.",
      localChapterCount: "{n} chapters",
      localChars: "{n} chars",
      localChapterOf: "Chapter {n} of {m}",
      localVolumeCount: "{n} volumes",
      localVolumeAt: "vol {n}/{m}",
      localVolumeLoaded: "{done}/{all} volumes loaded",
      localLoadAllVolumes: "Load the remaining volumes (enables cross-volume reading)",
      localLoadingSeries: "Loading all {n} volumes…",
      localSeriesPartial: "{n} volume(s) are missing from disk; the rest still work.",
      localFinished: "Finished",
      localFinishedHint: "The last chapter has been read",
      bookmarkAdded: "Bookmarked (for a local book this marks the chapter)",
      sparseTitle: "This entry is just a volume marker — it has no text of its own",
      sparseText:
        "Lines like “Volume 1 …” become chapter entries, but they are structure, not content. They are marked in italics in the contents; opening one shows this empty page, and nothing is broken.",
      sparseFacts: "{n} chars on this line · entry {at} of {total}",
      sparseNext: "Go to next chapter",
      sparsePrev: "Back to previous chapter",
      diagLegend: "Self-check",
      diagChecking: "Checking…",
      diagRefreshText: "Check again",
      diagStorage: "Host storage",
      diagStorageOk: "available — shelf and reading position are saved",
      diagStorageMissing: "not granted — the shelf and reading position will NOT be saved",
      diagStorageHint: "Requires the host.storage permission; older hosts may not offer it.",
      diagIndex: "Shelf index",
      diagIndexValue: "{n} books · {kb} KB",
      diagIndexNearLimit: "Close to the host's 256 KB per-value cap — remove a few books.",
      diagFiles: "Text files",
      diagFilesValue: "{n} files · {mb} MB",
      diagFilesMissing: "{n} book(s) lost their text on disk — re-import them.",
      diagBackendDown: "backend not responding",
      diagBackendDownHint: "The sidecar is not running; fetching pages and local books will fail.",
      diagTrad: "Trad→simp tables",
      diagTradValue: "{c} chars + {p} phrases",
      diagPresets: "Site presets",
      diagPresetsValue: "{n}",
      localFirstChapter: "This is already the first chapter.",
      localLastChapter: "This is already the last chapter.",
      localUnsupported: "This environment cannot open a local file picker.",
      "localReason_no-file": "no file selected",
      "localReason_bad-type": "only .txt / .md are supported",
      "localReason_too-large": "file is too large",
      "localReason_read-failed": "read failed",
      "localReason_sidecar-failed": "backend write failed",
      "localReason_sidecar-rejected": "the backend rejected this book",
      "localReason_incomplete": "the upload was incomplete (a chunk was lost)",
      "localReason_no-chapters": "no chapter headings found (needs lines like “Chapter 12”)"
    }
  };

  /* ═══════════════════════════════════════════════════════════════════════
   * 2. Reader style model
   * ═══════════════════════════════════════════════════════════════════════ */
  var STYLE_FONT_STACKS = {
    system: 'var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif)',
    serif: 'Songti SC, SimSun, "Noto Serif SC", Georgia, "Times New Roman", serif',
    sans: '"PingFang SC", "Microsoft YaHei", "Heiti SC", "Noto Sans SC", system-ui, sans-serif',
    kai: 'Kaiti SC, KaiTi, STKaiti, "Noto Serif SC", serif'
  };

  /* 浏览器窗口用的字体栈：普通网页里没有 DBX 的 CSS 变量，
     所以这里必须是**具体字体名**，不能带 var()。 */
  var BROWSER_FONT_STACKS = {
    system: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
    serif: 'Songti SC, SimSun, "Noto Serif SC", Georgia, "Times New Roman", serif',
    sans: '"PingFang SC", "Microsoft YaHei", "Heiti SC", "Noto Sans SC", system-ui, sans-serif',
    kai: 'Kaiti SC, KaiTi, STKaiti, "Noto Serif SC", serif'
  };

  var STYLE_DEFAULTS = {
    fontFamily: "system",
    fontSize: 17,
    lineHeight: 1.75,
    pageWidth: 860,
    contentWidth: 72,
    textColor: "",
    bgColor: "",
    paraSpacing: 0.9,
    indent: false,
    letterSpacing: 0,
    dark: false,
    customCss: "",
    perSite: false
  };

  var STORAGE_KEYS = {
    readerStyle: "readerStyle",
    readerStylePerSite: "readerStylePerSite",
    siteStyles: "siteStyles",
    history: "history",
    bookmarks: "bookmarks",
    lastUrl: "lastUrl",
    tabs: "tabs",
    activeTab: "activeTab",
    /* 伪装层设置：热键、外观模式、是否优先显示 */
    disguise: "disguise",
    /* 每个地址的阅读位置（滚动百分比） */
    progress: "progress",
    /* 最近导入的本地 txt 小说（原文 + 切好的章节），存在宿主 storage 里。 */
    localLibrary: "localLibrary",
    /* 旧版单本 key：只用于迁移，不再写入 */
    localBook: "localBook"
  };

  var HISTORY_LIMIT = 200;
  var RENDER_TIMEOUT_MS = 60000; // clamped by the host to 1..120000
  var READER_MIN_CHARS = 200; // below this a reader result counts as "empty"

  /* 繁简转换：映射表是**内联在 index.html 里的惰性 JSON**（`#trad2simpData`）。
     字库是打包内置的：2797 个繁→简单字 + 1261 条词组映射，常用繁体字基本覆盖，
     所以默认就开着——打开一个繁体小说站不该还要先手动找开关。
     用户在设置里关掉后会被持久化，下次仍按他的选择。

     为什么不用 `ui/trad2simp.js` 这个外部脚本：真实 DBX 宿主里它没有被执行，
     反而把**整段源码当文本显示**在界面上（用户看到的就是这个）。数据内联之后
     既没有那次外部请求，宿主也无从"显示"它。 */
  var TRAD2SIMP_FALLBACK_TEXT = "繁简字库未能加载（index.html 里的 #trad2simpData 缺失或损坏）";

  function readTrad2SimpData() {
    try {
      var node = document.getElementById("trad2simpData");
      if (!node) return null;
      var data = JSON.parse(node.textContent || "{}");
      if (!data || typeof data.chars !== "object" || typeof data.phrases !== "object") return null;
      return data;
    } catch (error) {
      return null;
    }
  }

  /** 用内联的两张表拼出与原实现等价的 convert()。
   *
   *  算法必须和原实现一致：**按首字建索引、每处优先最长匹配**，一次从左到右扫描。
   *  不能用"逐条全局替换"——那样 `著` 的单字映射会把 `著名` 变成 `着名`，
   *  而正确结果是词组 `著名` 原样保留（实测差 71 条词组）。 */
  function buildTrad2SimpConverter(data) {
    var chars = data.chars;
    var phrases = data.phrases;
    var index = {};
    var maxLength = 0;
    Object.keys(phrases).forEach(function (key) {
      var first = key.charAt(0);
      if (!index[first]) index[first] = [];
      index[first].push(key);
      if (key.length > maxLength) maxLength = key.length;
    });
    Object.keys(index).forEach(function (first) {
      // 最长优先：每个位置先试最长的候选，命中即用，不回溯。
      index[first].sort(function (a, b) {
        return b.length - a.length;
      });
    });

    return {
      chars: chars,
      phrases: phrases,
      convert: function (text) {
        if (typeof text !== "string") {
          if (text === null || text === undefined) return "";
          if (Object.prototype.toString.call(text) === "[object String]") text = String(text);
          else return "";
        }
        var length = text.length;
        if (length === 0) return "";
        var out = "";
        var i = 0;
        while (i < length) {
          var ch = text.charAt(i);
          var hit = null;
          var candidates = index[ch];
          if (candidates !== undefined && maxLength > 1) {
            for (var j = 0; j < candidates.length; j += 1) {
              var key = candidates[j];
              if (i + key.length <= length && text.substr(i, key.length) === key) {
                hit = key;
                break;
              }
            }
          }
          if (hit !== null) {
            out += phrases[hit];
            i += hit.length;
            continue;
          }
          out += Object.prototype.hasOwnProperty.call(chars, ch) ? chars[ch] : ch;
          i += 1;
        }
        return out;
      }
    };
  }

  var trad2Simp = (function () {
    var data = readTrad2SimpData();
    if (!data) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[dbx-webview] " + TRAD2SIMP_FALLBACK_TEXT);
      }
      return { api: null, problem: TRAD2SIMP_FALLBACK_TEXT };
    }
    return { api: buildTrad2SimpConverter(data), problem: "" };
  })();

  var tradToSimp = {
    available: !!trad2Simp.api,
    enabled: true
  };

  /* 按需把一段文本转成简体；功能关闭或表缺失时原样返回。 */
  function toSimplified(text) {
    if (!tradToSimp.enabled || !tradToSimp.api) return text;
    try {
      return tradToSimp.api.convert(text);
    } catch (error) {
      return text;
    }
  }

  /* 就地转换渲染出来的正文：只动文本节点，不碰标签与属性。 */
  function convertContentToSimplified(root) {
    if (!root || !tradToSimp.enabled || !tradToSimp.api) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (textNode) {
      var value = textNode.nodeValue;
      if (!value || !value.trim()) return;
      // 纯 ASCII 的节点（代码块、数字、URL）直接跳过，省掉整表扫描。
      if (!/[\u3400-\u9fff]/.test(value)) return;
      var converted = toSimplified(value);
      if (converted !== value) textNode.nodeValue = converted;
    });
  }
  var SECONDARY_SEARCH = "https://www.bing.com/search?q=";

  /* ═══════════════════════════════════════════════════════════════════════
   * 伪装层（cover view）
   * -----------------------------------------------------------------------
   * 工作台默认显示一个看起来完全普通的 SQL 工作台；右上角齿轮进入设置，
   * 以及真实的阅读界面。热键（默认 Escape）在这两个界面之间切换。
   * 样式与文案刻意不出现任何“阅读 / 网页”字样。
   * ═══════════════════════════════════════════════════════════════════════ */
  var DEFAULT_HOTKEY = "escape";
  var coverRunBump = 0; // 点一次「运行」加一，让结果数字有变化
  var disguise = {
    active: true,          // 当前是否显示伪装层
    onStart: true,         // 打开工作台时是否先显示伪装层
    hideOnFocus: false,    // 窗口重新获得焦点时是否自动切回伪装层（默认关闭）
    hideOnBlur: false,     // 离开工作台（失焦）时是否自动切回伪装层（默认关闭）
    mergePages: true,      // 合并同一章的分页（默认开启）
    hotkey: DEFAULT_HOTKEY,
    themeChoice: "follow", // light | dark | follow
    version: "",           // sidecar/包版本，设置面板里显示
    recording: false,
    settingsOpen: false
  };
  /* Detail pages (article / chapter / video / note) extract far better than
     JS-driven home pages, so the examples below point at detail URLs.
     Every URL here was verified through the sidecar: it returns real text.
     Sites behind anti-bot walls (douyin.com, weibo.com, zhihu.com, 23qb.com)
     are deliberately absent — they answer with a captcha or a login page, and
     their presets were removed for the same reason. */
  var EXAMPLES = [
    { name: { "zh-CN": "澎湃文章", en: "News article" }, url: "https://www.thepaper.cn/newsDetail_forward_31713979" },
    { name: { "zh-CN": "小说章节", en: "Novel chapter" }, url: "https://www.bqg221.com/biquge/10806/2708313.html" },
    { name: { "zh-CN": "CSDN 博客", en: "Tech blog" }, url: "https://blog.csdn.net/" },
    { name: { "zh-CN": "博客园", en: "Cnblogs" }, url: "https://www.cnblogs.com/" },
    { name: { "zh-CN": "B 站视频", en: "Bilibili video" }, url: "https://www.bilibili.com/video/BV1GJ411x7h7" },
    { name: { "zh-CN": "豆瓣条目", en: "Douban item" }, url: "https://book.douban.com/subject/1084336/" }
  ];

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. State
   * ═══════════════════════════════════════════════════════════════════════ */
  var plugin = null;
  var locale = "zh-CN";
  var strings = COPY["zh-CN"];
  var store = null; // { available, get, set }
  var state = {
    tabs: [],
    activeTabId: null,
    presets: [],
    bookmarks: [],
    history: [],
    lastUrl: "",
    sidePanel: "tabs",
    /* 设置抽屉当前页签：style / browser / general */
    drawerTab: "style",
    bootError: ""
  };

  /* 本地书架：已导入的书、当前书、浏览记录。见 loadLocalLibrary。 */
  var styleState = {
    global: assign({}, STYLE_DEFAULTS),
    site: {}, // host -> style patch
    /* The applied site preset's own typography (payload.readerStyle). It sits
       between the built-in defaults and the user's settings, so a novel preset
       can ship 楷体/20px while the user's explicit choices still win. */
    preset: {},
    perSite: false,
    host: "",
    effective: assign({}, STYLE_DEFAULTS),
    customCssActive: false
  };
  var persist = { pending: null, timer: null };
  var addressEdited = false; // user typed in the omnibox without submitting yet
  var renderSeq = {}; // tabId -> request token, keeps stale responses out
  var posSeq = {}; // tabId -> request token, keeps stale scroll restores out
  var tabCounter = 0;
  var el = {};

  /* 插件内实时页面（WebView2 帧流）的状态。
     只有一个离屏 WebView2；切标签 / 切页面时复用同一个，避免反复启动。 */
  var liveState = {
    active: false,
    tabId: "",
    width: 1280,
    height: 900,
    lastSeq: 0,
    ready: false,
    paused: false,
    starting: false,
    state: null,
    pendingFrame: null,
    frameBusy: false,
    hideTipsTimer: null,
    closing: false
  };
  var LIVE_HOSTS = ["xiaohongshu.com", "xhslink.com"];

  /* ═══════════════════════════════════════════════════════════════════════
   * 4. Tiny helpers
   * ═══════════════════════════════════════════════════════════════════════ */
  function assign(target) {
    for (var i = 1; i < arguments.length; i += 1) {
      var source = arguments[i];
      if (!source || typeof source !== "object") continue;
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
      }
    }
    return target;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function clear(nodeRef) {
    if (!nodeRef) return;
    while (nodeRef.firstChild) nodeRef.removeChild(nodeRef.firstChild);
  }

  function setText(nodeRef, text) {
    if (nodeRef) nodeRef.textContent = text === undefined || text === null ? "" : String(text);
  }

  function num(value, fallback) {
    var parsed = typeof value === "number" ? value : parseFloat(value);
    return isFinite(parsed) ? parsed : fallback;
  }

  function bool(value) {
    return value === true || value === "true";
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fn.apply(self, args);
      }, wait);
    };
  }

  function hostOf(url) {
    try {
      return new NativeUrl(url).host || "";
    } catch (error) {
      return "";
    }
  }

  function isHttpUrl(value) {
    if (typeof value !== "string" || value === "") return false;
    try {
      var parsed = new NativeUrl(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  /* 小红书这类前端渲染站点：服务端 HTML 里没有正文，直接走实时页面。 */
  function isLiveSite(url) {
    var host = hostOf(url).toLowerCase();
    if (!host) return false;
    return LIVE_HOSTS.some(function (suffix) {
      return host === suffix || host.slice(-(suffix.length + 1)) === "." + suffix;
    });
  }

  function trimUrl(value) {
    var text = typeof value === "string" ? value.trim() : "";
    return text.replace(/^[<\u300a("'\s]+/, "").replace(/[>\u300b)"'\s]+$/, "");
  }

  function shorten(value, max) {
    var text = typeof value === "string" ? value : "";
    if (text.length <= max) return text;
    return text.slice(0, Math.max(1, max - 1)) + "…";
  }

  function formatBytes(value) {
    var bytes = num(value, 0);
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function formatElapsed(value) {
    var ms = num(value, 0);
    if (ms < 1000) return Math.round(ms) + " ms";
    return (ms / 1000).toFixed(2) + " s";
  }

  function formatTime(iso) {
    if (typeof iso !== "string" || iso === "") return "";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    var pad = function (part) {
      return part < 10 ? "0" + part : String(part);
    };
    return (
      date.getFullYear() +
      "-" +
      pad(date.getMonth() + 1) +
      "-" +
      pad(date.getDate()) +
      " " +
      pad(date.getHours()) +
      ":" +
      pad(date.getMinutes())
    );
  }

  function relativeTime(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    var diff = Date.now() - date.getTime();
    if (diff < 60000) return Math.max(1, Math.round(diff / 1000)) + "s";
    if (diff < 3600000) return Math.round(diff / 60000) + "m";
    if (diff < 86400000) return Math.round(diff / 3600000) + "h";
    return Math.round(diff / 86400000) + "d";
  }

  function hexColor(value, fallback) {
    return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  }

  function cssLength(value, fallback, min, max, unit) {
    var parsed = num(value, NaN);
    if (!isFinite(parsed)) return fallback;
    return String(clamp(parsed, min, max)) + (unit || "");
  }

  function byId(list, id) {
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function localeOf(raw) {
    return typeof raw === "string" && raw.toLowerCase().indexOf("zh") === 0 ? "zh-CN" : "en";
  }

  function t(key) {
    return strings[key] !== undefined ? strings[key] : COPY["zh-CN"][key] !== undefined ? COPY["zh-CN"][key] : key;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 5. Host bridge wrappers — every invoke is guarded, nothing ever escapes
   * ═══════════════════════════════════════════════════════════════════════ */
  function setupPlugin() {
    plugin = typeof window.dbxPlugin === "object" && window.dbxPlugin !== null ? window.dbxPlugin : null;
    if (!plugin) {
      locale = localeOf(navigator.language);
      strings = COPY[locale];
      store = memoryStore(false);
      state.bootError = t("bridgeMissing");
      return Promise.resolve(false);
    }
    locale = localeOf(plugin.locale);
    strings = COPY[locale];
    var ready = plugin.ready;
    if (!ready || typeof ready.then !== "function") return Promise.resolve(true);
    return Promise.resolve(ready).then(
      function () {
        locale = localeOf(plugin.locale);
        strings = COPY[locale];
        return true;
      },
      function () {
        return true;
      }
    );
  }

  function invoke(method, params, timeoutMs) {
    if (!plugin || typeof plugin.invoke !== "function") {
      return Promise.reject(new Error(state.bootError || t("bridgeMissing")));
    }
    try {
      var options = typeof timeoutMs === "number" ? { timeoutMs: timeoutMs } : undefined;
      return Promise.resolve(plugin.invoke(method, params || {}, options));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function softInvoke(method, params, timeoutMs) {
    return invoke(method, params, timeoutMs).then(
      function (result) {
        return result;
      },
      function (error) {
        return { __error: error && error.message ? error.message : String(error) };
      }
    );
  }

  function memoryStore(available) {
    var map = {};
    return {
      available: available,
      get: function (key) {
        return Promise.resolve(map[key] === undefined ? null : map[key]);
      },
      set: function (key, value) {
        map[key] = value;
        return Promise.resolve();
      }
    };
  }

  function setupStore() {
    var capabilities = plugin && plugin.capabilities;
    var granted = !!(capabilities && capabilities.storage);
    var api = plugin && plugin.storage;
    if (!granted || !api || typeof api.get !== "function" || typeof api.set !== "function") {
      store = memoryStore(false);
      return;
    }
    store = {
      available: true,
      get: function (key) {
        try {
          return Promise.resolve(api.get(key)).then(
            function (value) {
              return value === undefined ? null : value;
            },
            function () {
              return null;
            }
          );
        } catch (error) {
          return Promise.resolve(null);
        }
      },
      set: function (key, value) {
        try {
          return Promise.resolve(api.set(key, value)).then(
            function () {
              return true;
            },
            function () {
              return false;
            }
          );
        } catch (error) {
          return Promise.resolve(false);
        }
      }
    };
  }

  function storeGet(key, fallback) {
    if (!store) return Promise.resolve(fallback);
    return store.get(key).then(
      function (value) {
        return value === undefined || value === null ? fallback : value;
      },
      function () {
        return fallback;
      }
    );
  }

  function storeSet(key, value) {
    if (!store) return;
    store.set(key, value).catch(function (error) {
      // 以前这里完全静默，结果"值超过 256 KiB 上限"这种错误被吞掉，
      // 表现出来就是"关掉重开数据没了"。现在至少在状态栏说一句。
      setStorageProblem(key, error);
    });
  }

  /* 记录最近一次 storage 写入失败，避免反复刷提示。 */
  var storageProblem = { key: "", reported: false };

  function setStorageProblem(key, error) {
    var message = error && error.message ? error.message : String(error || "");
    if (storageProblem.key === key && storageProblem.reported) return;
    storageProblem.key = key;
    storageProblem.reported = true;
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[dbx-webview] storage.set 失败", key, message);
    }
    showStatusNotice(t("storageWriteFailed").replace("{key}", key));
  }

  /** 写成功时清掉"写失败"的标记，后续再失败还能提示一次。 */
  function clearStorageProblem(key) {
    if (storageProblem.key === key) {
      storageProblem.key = "";
      storageProblem.reported = false;
    }
  }

  function flushPersist() {
    if (!persist.pending) return;
    var payload = persist.pending;
    persist.pending = null;
    storeSet(STORAGE_KEYS.tabs, payload.tabs);
    storeSet(STORAGE_KEYS.activeTab, payload.activeTabId);
    storeSet(STORAGE_KEYS.lastUrl, payload.lastUrl);
  }

  function queuePersist() {
    var active = activeTab();
    persist.pending = {
      tabs: state.tabs.map(function (tab) {
        return {
          id: tab.id,
          url: tab.url,
          title: tab.title ? shorten(tab.title, 160) : "",
          mode: tab.mode,
          presetId: tab.presetId,
          live: tab.live === true,
          history: tab.history.slice(-60),
          historyIndex: tab.historyIndex
        };
      }),
      activeTabId: state.activeTabId,
      lastUrl: (active && active.url) || state.lastUrl || "",
      progress: progress.map
    };
    if (persist.timer) clearTimeout(persist.timer);
    persist.timer = setTimeout(function () {
      persist.timer = null;
      flushPersist();
    }, 400);
  }

  window.addEventListener("pagehide", function () {
    if (persist.timer) clearTimeout(persist.timer);
    flushPersist();
    // 页面被销毁后没人再需要帧；先停掉 screencast，别让 sidecar 一直烧 CPU。
    try {
      if (plugin && typeof plugin.notify === "function") {
        plugin.notify("webview/livePause", {});
      }
    } catch (error) {
      /* fire-and-forget */
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════
   * 6. Tabs
   * ═══════════════════════════════════════════════════════════════════════ */
  function nextTabId() {
    tabCounter += 1;
    return "tab-" + Date.now().toString(36) + "-" + tabCounter;
  }

  function makeTab(seed) {
    var url = seed && typeof seed.url === "string" ? seed.url : "";
    var history = seed && Array.isArray(seed.history) ? seed.history.filter(isHttpUrl) : [];
    var start = url && history.indexOf(url) === -1 ? [url].concat(history) : history;
    return {
      id: nextTabId(),
      url: url,
      title: seed && seed.title ? seed.title : "",
      mode: seed && isMode(seed.mode) ? seed.mode : "reader",
      presetId: seed && typeof seed.presetId === "string" ? seed.presetId : null,
      live: !!(seed && seed.live === true) || isLiveSite(url),
      liveCanGoBack: false,
      liveCanGoForward: false,
      payload: null,
      error: null,
      notice: "",
      warnings: [],
      loading: false,
      history: start,
      historyIndex: start.length - 1,
      scrollTop: 0
    };
  }

  function isMode(value) {
    return value === "reader" || value === "full" || value === "source";
  }

  function createTab(seed) {
    var tab = makeTab(seed);
    state.tabs.push(tab);
    state.activeTabId = tab.id;
    return tab;
  }

  function tabsWithUrl(url) {
    return state.tabs.filter(function (tab) {
      return tab.url === url;
    });
  }

  function closeTab(tab) {
    var index = state.tabs.indexOf(tab);
    if (index === -1) return;
    var wasLive = !!tab.live;
    state.tabs.splice(index, 1);
    if (state.tabs.length === 0) state.tabs.push(makeTab(null));
    if (state.activeTabId === tab.id) {
      var next = state.tabs[Math.min(index, state.tabs.length - 1)];
      state.activeTabId = next.id;
    }
    if (wasLive) {
      if (liveState.tabId === tab.id) {
        liveState.active = false;
        liveState.tabId = "";
        liveState.ready = false;
        hideLiveChrome();
      }
      var stillLive = state.tabs.some(function (item) {
        return item.live;
      });
      if (!stillLive) invoke("webview/liveClose", {}, 8000).catch(function () {});
    }
    queuePersist();
    renderTabs();
    renderSidebar();
    refreshActiveTab(true);
  }

  function activeTab() {
    return byId(state.tabs, state.activeTabId);
  }

  function labelOf(tab) {
    if (!tab) return t("untitledTab");
    if (tab.payload && tab.payload.title) return tab.payload.title;
    if (tab.payload && tab.payload.siteName) return tab.payload.siteName;
    if (tab.title) return tab.title;
    if (tab.url) return hostOf(tab.url) || tab.url;
    return t("untitledTab");
  }

  function syncActiveHost() {
    var tab = activeTab();
    var host = (tab && hostOf(tab.url)) || hostOf(state.lastUrl) || "";
    if (host !== styleState.host) styleState.host = host;
    return host;
  }

  function refreshActiveTab(force) {
    var tab = activeTab();
    if (!tab) return;
    syncActiveHost();
    if (tab.live) {
      if (liveState.tabId !== tab.id || !liveState.active) {
        showLiveView(tab, {});
      } else {
        showLiveChrome(tab);
        liveStatus(tab);
        syncToolbar();
        syncDocTitle();
      }
      return;
    }
    syncToolbar();
    syncDocTitle();
    // 换了站点预设时不能只重绘：规则和排版都来自服务端，必须重新解析。
    var presetChanged = tab.payload && (tab.lastRenderPreset || "") !== (tab.presetId || "");
    if (tab.payload && !presetChanged) {
      renderPage(tab);
      return;
    }
    // 本地书只认内存里的 payload：没有就重新铺一次当前章，绝不去"抓空地址"。
    if (tab.mode === "local") {
      var book = localBookById(tab.localBookId);
      if (book) {
        var resume = readLocalProgress(book.id);
        openLocalChapter(resume >= 0 ? resume : 0, { bookId: book.id, keepScroll: resume >= 0 });
        return;
      }
      renderEmpty(tab);
      return;
    }
    if (presetChanged && tab.url && !tab.loading) {
      loadTab(tab, { push: false });
      return;
    }
    if (tab.error) {
      renderError(tab);
      return;
    }
    if (tab.loading && !force) return;
    if (tab.loading && force) {
      renderLoading(tab);
      return;
    }
    renderEmpty(tab);
  }

  function syncDocTitle(tab) {
    var target = tab || activeTab();
    var label = target ? labelOf(target) : "";
    document.title = label ? label + " — " + t("appName") : t("appName");
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 7. History + bookmarks
   * ═══════════════════════════════════════════════════════════════════════ */
  function recordHistory(url, title) {
    if (!isHttpUrl(url)) return;
    var entry = { url: url, title: title || hostOf(url), at: new Date().toISOString() };
    state.history = [entry].concat(
      state.history.filter(function (item) {
        return item && item.url !== url;
      })
    ).slice(0, HISTORY_LIMIT);
    storeSet(STORAGE_KEYS.history, state.history);
    if (state.sidePanel === "history") renderSidebar();
  }

  function clearHistory() {
    state.history = [];
    storeSet(STORAGE_KEYS.history, []);
    renderSidebar();
  }

  /* ── 收藏 ────────────────────────────────────────────────────────────────
   *
   * 两类收藏共用一个列表：
   *   * 网页 —— `{ url, title }`（一直没有变）；
   *   * 本地书某一章 —— `{ local: { bookId, chapter, name, chapterTitle } }`。
   *
   * 本地书没有网址，以前 ⭐ 按钮对它完全无效（`isHttpUrl` 直接 return）。
   * 用一个 `local:` 前缀的合成 key 让两者在同一份数据里共存。
   */

  function localBookmarkKey(bookId, chapter) {
    return "local:" + bookId + "#" + num(chapter, 0);
  }

  function bookmarkKeyOf(bookmark) {
    if (!bookmark) return "";
    if (bookmark.local) return localBookmarkKey(bookmark.local.bookId, bookmark.local.chapter);
    return bookmark.url || "";
  }

  function isBookmarked(key) {
    return state.bookmarks.some(function (item) {
      return item && bookmarkKeyOf(item) === key;
    });
  }

  /** 当前标签对应的收藏 key；本地书用合成 key。 */
  function currentBookmarkKey(tab) {
    if (!tab) return "";
    if (tab.mode === "local" && tab.payload && tab.payload.localBook) {
      return localBookmarkKey(tab.payload.localBook.id, tab.payload.localBook.index);
    }
    return isHttpUrl(tab.url) ? tab.url : "";
  }

  function toggleBookmark() {
    var tab = activeTab();
    var key = currentBookmarkKey(tab);
    if (!key) return;
    if (isBookmarked(key)) {
      removeBookmark(key);
      return;
    }
    var entry;
    if (tab.mode === "local" && tab.payload && tab.payload.localBook) {
      var info = tab.payload.localBook;
      var chapter = tab.payload.chapters && tab.payload.chapters[info.index];
      entry = {
        local: {
          bookId: info.id,
          chapter: info.index,
          name: info.name,
          chapterTitle: chapter ? chapter.title : "",
          total: info.total
        },
        title: info.name,
        at: new Date().toISOString()
      };
    } else {
      entry = {
        url: tab.url,
        title: tab.payload && tab.payload.title ? tab.payload.title : hostOf(tab.url),
        at: new Date().toISOString()
      };
    }
    state.bookmarks = [entry].concat(state.bookmarks);
    storeSet(STORAGE_KEYS.bookmarks, state.bookmarks);
    syncToolbar();
    renderSidebar();
    showStatusNotice(t("bookmarkAdded"));
  }

  function removeBookmark(key) {
    state.bookmarks = state.bookmarks.filter(function (item) {
      return bookmarkKeyOf(item) !== key;
    });
    storeSet(STORAGE_KEYS.bookmarks, state.bookmarks);
    syncToolbar();
    renderSidebar();
  }

  /**
   * 把旧格式的收藏清洗一遍。
   *
   * 旧代码只收 http 网址，且没有校验；这里顺手兼容"本地书"条目，
   * 并丢掉结构不对的（否则渲染时会炸在 null 上）。
   */
  function normalizeBookmarks(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (item) {
      if (!item || typeof item !== "object") return false;
      if (item.local && typeof item.local.bookId === "string") return true;
      return typeof item.url === "string" && isHttpUrl(item.url);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 8. URL resolution (scheme, domain, search fallback)
   * ═══════════════════════════════════════════════════════════════════════ */
  function looksLikeDomain(text) {
    var candidate = text.split(/[\s/?#]/)[0];
    if (!candidate) return false;
    if (candidate === "localhost") return true;
    if (candidate.indexOf(".") === -1) return false;
    return /^[^\s.]+(\.[^\s.]+)+$/.test(candidate) && !/^\.|\.$/.test(candidate);
  }

  function isHostname(value) {
    if (typeof value !== "string" || value === "" || value.length > 253) return false;
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(value);
  }

  /* "host[:port][/path]" -> "https://host[:port][/path]".
     Rejects anything that does not parse into a real ASCII host, so free text
     never leaks into the address bar as a hostname with spaces in it. */
  function withScheme(text) {
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) {
      if (!looksLikeDomain(text)) return "";
    }
    var candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text) ? text : "https://" + text;
    if (!isHttpUrl(candidate)) return "";
    try {
      return isHostname(new NativeUrl(candidate).hostname) ? candidate : "";
    } catch (error) {
      return "";
    }
  }

  function fallbackSearchUrl(query) {
    var text = query.trim();
    if (text === "") return "";
    if (isHttpUrl(text)) return text;
    return SECONDARY_SEARCH + encodeURIComponent(text);
  }

  /* Address-bar resolution, in order:
     1. an explicit http(s) URL is used as typed
     2. a bare domain / host (optionally with port and path) gets https://
     3. anything else is a search query: the preset's search URL when available,
        otherwise https://www.bing.com/search?q= */
  function resolveInput(raw) {
    var text = trimUrl(raw);
    if (text === "") return Promise.resolve("");
    if (/^https?:\/\//i.test(text)) return Promise.resolve(isHttpUrl(text) ? text : "");
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) return Promise.resolve("");
    var direct = withScheme(text);
    if (direct) return Promise.resolve(direct);
    var preferred = presetForUrl(state.lastUrl) || state.presets[0] || null;
    if (preferred) {
      return softInvoke("webview/searchUrl", { presetId: preferred.id, query: text }, 10000).then(function (result) {
        if (result && !result.__error && typeof result.url === "string" && isHttpUrl(result.url)) return result.url;
        return fallbackSearchUrl(text);
      });
    }
    return Promise.resolve(fallbackSearchUrl(text));
  }

  /**
   * 找出这个地址该用哪条站点预设。
   *
   * 必须和 sidecar 的 `match_rule` 语义一致，否则会出现"后端匹配到了、UI 没匹配到"：
   * `tab.presetId` 保持为空，界面显示"通用网页"，用户以为自定义规则没生效。
   *
   * 与后端对齐的三点：
   *   1. 用 **hostname** 而不是 host —— `host` 带端口，`127.0.0.1:8898` 就匹配不到
   *      `127.0.0.1`（这个坑真实踩过）；
   *   2. 支持 `bqg*` 这种前缀通配；
   *   3. 支持 `example.com/path` 这种带路径的前缀。
   * 自定义规则排在内置规则前面（后端也是这么排的），所以它们优先命中。
   */
  function presetForUrl(url) {
    var parsed;
    try {
      parsed = new NativeUrl(url);
    } catch (error) {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    var host = parsed.hostname.toLowerCase();
    var path = parsed.pathname || "/";
    if (!host) return null;
    var found = null;
    state.presets.some(function (preset) {
      var patterns = preset && Array.isArray(preset.hostPatterns) ? preset.hostPatterns : [];
      var hit = patterns.some(function (pattern) {
        return presetMatches(host, path, pattern);
      });
      if (hit) {
        found = preset;
        return true;
      }
      return false;
    });
    return found;
  }

  /** 单条 host 规则匹配（对齐 sidecar 的 host_matches_pattern）。 */
  function presetMatches(host, path, pattern) {
    var value = typeof pattern === "string" ? pattern.trim().toLowerCase() : "";
    if (value === "") return false;

    // 带路径：先比域名，再比路径前缀。
    var slash = value.indexOf("/");
    if (slash > 0) {
      return presetMatches(host, path, value.slice(0, slash)) && path.indexOf(value.slice(slash)) === 0;
    }
    // `*.example.com` / `.example.com`：任意子域。
    if (value.indexOf("*.") === 0 || value.charAt(0) === ".") {
      var suffix = value.charAt(0) === "." ? value.slice(1) : value.slice(2);
      return host === suffix || host.slice(-(suffix.length + 1)) === "." + suffix;
    }
    // `bqg*`：前缀必须在域名标签边界上，`xbqg.com` 不算。
    if (value.charAt(value.length - 1) === "*") {
      var prefix = value.slice(0, -1);
      if (!prefix) return true;
      if (host.indexOf(prefix) !== 0) return false;
      var next = host.charAt(prefix.length);
      return next === "" || next === "." || next === "-";
    }
    return host === value || host.slice(-(value.length + 1)) === "." + value;
  }

  function presetNameOf(id) {
    var preset = id ? byId(state.presets, id) : null;
    return preset ? preset.name || preset.id : null;
  }

  function presetLabel(preset) {
    return preset ? preset.name || preset.id : t("autoPreset");
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 「用真实浏览器打开」
   *
   * 插件沙箱内嵌不了站点：CSP 只放行 `frame-src 'self' blob:`，任何指向外部站点的
   * iframe 都会被浏览器拒绝。所以要看**活的页面**（抖音、小红书、视频、登录墙），
   * 只能让 sidecar 拉起系统浏览器的独立阅读窗口。
   * ═══════════════════════════════════════════════════════════════════════ */
  var browserSupport = { checked: false, available: false, executable: "", profile: "" };

  /** 把当前阅读样式翻成给浏览器窗口用的 CSS。 */
  function browserWindowCss() {
    var style = mergeStyle();
    var stack = BROWSER_FONT_STACKS[style.fontFamily] || BROWSER_FONT_STACKS.system;
    var dark = style.dark === true;
    var bg = hexColor(style.bgColor, "") || (dark ? "#15161a" : "#faf9f6");
    var fg = hexColor(style.textColor, "") || (dark ? "#e7e8ec" : "#23201c");
    var fontSize = cssLength(style.fontSize, "17px", 12, 28, "px");
    var lineHeight = cssLength(style.lineHeight, "1.75", 1.2, 2.6, "");
    var spacing = cssLength(style.paraSpacing, "0.9", 0, 3, "em");
    // contentWidth 是"字数"，按经验折成像素；pageWidth 是像素上限。
    var widthChars = num(style.contentWidth, 72);
    var byChars = Math.round(widthChars * parseFloat(fontSize) * 0.62);
    var maxWidth = Math.min(num(style.pageWidth, 860), Math.max(420, byChars));

    var rules = [
      "html { background: " + bg + " !important; }",
      "body {",
      "  max-width: " + maxWidth + "px !important;",
      "  margin: 0 auto !important;",
      "  padding: 44px 26px 110px !important;",
      "  background: " + bg + " !important;",
      "  color: " + fg + " !important;",
      "  font-family: " + stack + " !important;",
      "  font-size: " + fontSize + " !important;",
      "  line-height: " + lineHeight + " !important;",
      style.letterSpacing ? "  letter-spacing: " + style.letterSpacing + "px !important;" : "",
      "}",
      "p, li, dd, blockquote { margin-bottom: " + spacing + " !important; }",
      style.indent === true ? "p { text-indent: 2em !important; }" : "",
      // 站点自己的浮层 / 弹窗 / 吸底栏常常盖住正文，这里一并压掉。
      "[class*=fixed-bar], [class*=float-bar], [class*=app-guide], [class*=download-app], [class*=open-app] { display: none !important; }",
      "img, video, canvas { max-width: 100% !important; height: auto !important; }"
    ].filter(Boolean);

    var custom = typeof style.customCss === "string" ? style.customCss.trim() : "";
    if (custom) rules.push(custom);
    return rules.join("\n");
  }

  /** 「浏览器窗口」页签的内容。 */
  function syncBrowserPanel() {
    if (el.browserOpenText) setText(el.browserOpenText, t("browserOpenAction"));
    if (el.browserFetchText) setText(el.browserFetchText, t("browserFetch"));
    if (el.btnLiveExit) setText(el.btnLiveExit, t("liveExit"));
    if (el.liveBadge) setText(el.liveBadge, t("liveBadge"));
    if (el.liveTips) setText(el.liveTips, t("liveTips"));
    var name = "";
    if (browserSupport.available) {
      var path = browserSupport.executable || "";
      name = path.split(/[\\/]/).pop() || path;
    }
    if (el.browserHint) {
      setText(
        el.browserHint,
        browserSupport.available
          ? t("browserSectionHint").replace("{name}", name)
          : t("browserUnavailable")
      );
    }
    if (el.browserProfile) {
      setText(
        el.browserProfile,
        browserSupport.profile ? t("browserProfileHint").replace("{dir}", browserSupport.profile) : ""
      );
    }
    // 明确写出"待会儿会打开哪个地址"：--app 窗口的标题栏显示的是**网页标题**，
    // 不是网址，所以网址要在这里给出来。
    if (el.browserCurrent) {
      var tab = activeTab();
      var url = (tab && tab.url) || "";
      setText(
        el.browserCurrent,
        url ? t("browserCurrentUrl").replace("{url}", url) : t("browserNoUrl")
      );
    }
    if (el.btnBrowserOpen) el.btnBrowserOpen.disabled = !browserSupport.available;
    if (el.btnBrowserFetch) el.btnBrowserFetch.disabled = !browserSupport.available;
  }

  function probeBrowser() {
    browserSupport.checked = true;
    return invoke("webview/browser", {}, 10000).then(
      function (result) {
        browserSupport.available = result && result.available === true;
        browserSupport.executable = (result && result.executable) || "";
        browserSupport.profile = (result && result.profile) || "";
        syncToolbar();
        syncBrowserPanel();
        return browserSupport;
      },
      function () {
        browserSupport.available = false;
        syncToolbar();
        syncBrowserPanel();
        return browserSupport;
      }
    );
  }

  function openInRealBrowser() {
    var tab = activeTab();
    if (!tab || !tab.url) {
      showStatusNotice(t("browserNeedUrl"));
      return;
    }
    var url = tab.url;
    showStatusNotice(t("browserOpening"));
    invoke(
      "webview/openInBrowser",
      { url: url, css: browserWindowCss() },
      20000
    ).then(
      function (result) {
        showStatusNotice(
          result && result.alreadyRunning ? t("browserFocused") : t("browserOpened")
        );
        void result;
      },
      function (error) {
        showStatusNotice(humanError(error, url));
      }
    );
  }

  /** 一键把当前网址放回地址栏：填好并全选，方便直接复制或改一段再打开。 */
  function putUrlInAddressBar() {
    var tab = activeTab();
    var url = (tab && tab.url) || "";
    if (!url) {
      showStatusNotice(t("urlEmpty"));
      return;
    }
    if (el.addressInput) {
      addressEdited = true;
      el.addressInput.value = url;
      el.addressInput.focus();
      // 全选，这样 Ctrl+C 直接拿走整个地址，或者直接输入覆盖。
      if (typeof el.addressInput.select === "function") el.addressInput.select();
      else if (typeof el.addressInput.setSelectionRange === "function") {
        el.addressInput.setSelectionRange(0, url.length);
      }
    }
    // 桥的复制能力失败也无所谓：地址栏已经填好了，用户可以自己 Ctrl+C。
    try {
      if (plugin && typeof plugin.copy === "function") plugin.copy(url);
    } catch (error) {
      void error;
    }
    showStatusNotice(t("urlInAddressBar"));
  }

  /** 回到这本书的目录页（地址由 sidecar 从页面链接或 URL 形状推出来）。 */
  function goToCatalog() {
    var tab = activeTab();
    var catalog = (tab && tab.payload && tab.payload.catalogUrl) || "";
    if (!catalog) {
      showStatusNotice(t("catalogMissing"));
      return;
    }
    openInPlugin(catalog);
  }

  /**
   * 从阅读窗口取回访问记录，**列成可点的清单**。
   *
   * 只取最近一条常常不够用：在窗口里连点几页之后，想回去的是其中某一页。
   * 所以这里把最近若干条都列出来，点哪条开哪条。
   */
  function fetchBrowserHistory() {
    if (el.browserFetchHint) setText(el.browserFetchHint, t("browserFetching"));
    invoke("webview/browserHistory", { limit: 30 }, 15000).then(
      function (result) {
        var entries = (result && result.entries) || [];
        renderBrowserHistory(entries);
        if (!entries.length) {
          if (el.browserFetchHint) {
            setText(el.browserFetchHint, (result && result.reason) || t("browserFetchEmpty"));
          }
          return;
        }
        if (el.browserFetchHint) {
          setText(el.browserFetchHint, t("browserFetchGot").replace("{n}", String(entries.length)));
        }
      },
      function (error) {
        var message = humanError(error, "");
        if (el.browserFetchHint) setText(el.browserFetchHint, message);
        showStatusNotice(message);
      }
    );
  }

  function renderBrowserHistory(entries) {
    var list = el.browserHistoryList;
    if (!list) return;
    list.textContent = "";
    if (!entries.length) {
      list.hidden = true;
      return;
    }
    list.hidden = false;
    var seen = {};
    var shown = 0;
    entries.forEach(function (entry) {
      var url = entryUrl(entry);
      if (!url || seen[url] || shown >= 10) return;
      seen[url] = true;
      shown += 1;
      var row = node("button", "dr__history-row");
      row.type = "button";
      row.title = url;
      var title = (entry && entry.title) || url;
      row.appendChild(node("span", "dr__history-title", shorten(title, 34)));
      var host = "";
      try {
        host = new URL(url).hostname;
      } catch (error) {
        host = url;
      }
      row.appendChild(node("span", "dr__history-host", host));
      row.addEventListener("click", function () {
        if (el.browserFetchHint) {
          setText(el.browserFetchHint, t("browserFetchLoading").replace("{url}", shortenUrl(url, 40)));
        }
        openInPlugin(url);
      });
      list.appendChild(row);
    });
    // 只有一条时不必展开清单
    if (shown <= 1) list.hidden = true;
  }

  /**
   * 把阅读窗口里**当前**的地址取回来，填进地址栏并直接打开。
   *
   * 阅读窗口是 `--app` 模式，没有地址栏，所以在窗口里点着点着就"回不到插件里"了。
   * 没有 CDP 可用（本插件的目标环境里调试端口/命名管道都可能被策略拦掉），
   * 但那个窗口用的是**我们自己的 profile**，它的 History 是标准 SQLite 文件，
   * 让 sidecar 直接读文件就能知道现在在哪一页。
   */
  function fetchBrowserUrl() {
    if (el.browserFetchHint) setText(el.browserFetchHint, t("browserFetching"));
    invoke("webview/browserHistory", { limit: 30 }, 15000).then(
      function (result) {
        var entries = (result && result.entries) || [];
        renderBrowserHistory(entries);
        var latest = entries.length ? entryUrl(entries[0]) : "";
        if (!latest) {
          if (el.browserFetchHint) {
            setText(el.browserFetchHint, (result && result.reason) || t("browserFetchEmpty"));
          }
          showStatusNotice(t("browserFetchEmpty"));
          return;
        }
        if (el.browserFetchHint) {
          setText(el.browserFetchHint, t("browserFetchGot").replace("{n}", String(entries.length)));
        }
        // 填进地址栏并直接打开，这样"在窗口里翻到的章节"能一键回到插件里读。
        if (el.addressInput) {
          addressEdited = true;
          el.addressInput.value = latest;
        }
        showStatusNotice(t("browserFetchLoading").replace("{url}", shortenUrl(latest, 46)));
        openInPlugin(latest);
      },
      function (error) {
        var message = humanError(error, "");
        if (el.browserFetchHint) setText(el.browserFetchHint, message);
        showStatusNotice(message);
      }
    );
  }

  /** 历史记录里的一条可能是字符串，也可能是对象。 */
  function entryUrl(entry) {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry.url === "string") return entry.url;
    return "";
  }

  function shortenUrl(url, limit) {
    if (typeof url !== "string" || url.length <= limit) return url || "";
    return url.slice(0, limit) + "…";
  }

  /** 在插件里打开一个地址（新标签或当前标签，沿用现有导航逻辑）。 */
  function openInPlugin(url) {
    if (!url) return;
    var tab = activeTab();
    if (tab) {
      navigate(tab, url, { push: true });
    } else {
      openInTab(url);
    }
    if (el.addressInput) el.addressInput.blur();
    addressEdited = false;
  }

  /**
   * 校验用户写的自定义 CSS，返回人类可读的问题列表。
   *
   * 不做完整 CSS 解析——只查最容易写错、而且**一定会让样式整段失效**的几类问题：
   * 括号不配平、声明缺分号、缺冒号、属性名不像属性名、值里有多余分号。
   * 目标是"写错了立刻知道"，而不是当编译器。
   */
  function validateCss(text) {
    var issues = [];
    if (typeof text !== "string") return issues;
    var source = text;
    if (source.trim() === "") return issues;

    var braceStack = [];
    var parenStack = [];
    var line = 1;
    var lineStart = 0;
    var inComment = false;
    var inString = null;
    var declarationStart = 0;

    function locate(index) {
      var current = 1;
      var start = 0;
      for (var cursor = 0; cursor < index && cursor < source.length; cursor += 1) {
        if (source.charAt(cursor) === "\n") {
          current += 1;
          start = cursor + 1;
        }
      }
      return { line: current, column: index - start + 1 };
    }

    function report(index, message) {
      var spot = locate(index);
      issues.push({ line: spot.line, column: spot.column, message: message });
    }

    /** 检查一段"声明"（两个 ; 或 {} 之间）是否有毛病。 */
    function checkDeclaration(from, to) {
      var chunk = source.slice(from, to);
      if (chunk.trim() === "") return;
      var colon = chunk.indexOf(":");
      if (colon < 0) {
        report(from + chunk.search(/\S/), "缺少冒号：`" + chunk.trim().slice(0, 24) + "` 不是有效的声明");
        return;
      }
      var prop = chunk.slice(0, colon).trim();
      var value = chunk.slice(colon + 1).trim();
      if (!/^[-a-zA-Z_][-a-zA-Z0-9_]*$/.test(prop)) {
        report(from, "属性名不合法：`" + prop.slice(0, 20) + "`");
      }
      if (value === "") {
        report(from + colon, "`" + prop + "` 没有值");
      }
    }

    for (var index = 0; index < source.length; index += 1) {
      var ch = source.charAt(index);
      var next = source.charAt(index + 1);

      if (ch === "\n") {
        line += 1;
        lineStart = index + 1;
      }
      if (inComment) {
        if (ch === "*" && next === "/") {
          inComment = false;
          index += 1;
        }
        continue;
      }
      if (inString) {
        if (ch === "\\") {
          index += 1;
          continue;
        }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === "/" && next === "*") {
        inComment = true;
        index += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
        continue;
      }

      if (ch === "{") {
        checkDeclaration(declarationStart, index);
        braceStack.push(index);
        declarationStart = index + 1;
      } else if (ch === "}") {
        if (braceStack.length === 0) {
          report(index, "多了一个 `}`");
        } else {
          checkDeclaration(declarationStart, index);
          declarationStart = index + 1;
          braceStack.pop();
        }
      } else if (ch === ";") {
        checkDeclaration(declarationStart, index);
        declarationStart = index + 1;
      } else if (ch === "(") {
        parenStack.push(index);
      } else if (ch === ")") {
        if (parenStack.length === 0) report(index, "多了一个 `)`");
        else parenStack.pop();
      }
    }

    // 收尾：块里最后一条声明可以不带分号
    if (declarationStart < source.length && braceStack.length > 0) {
      checkDeclaration(declarationStart, source.length);
    }
    if (braceStack.length) {
      report(braceStack[braceStack.length - 1], "`{` 没有对应的 `}`");
    }
    if (parenStack.length) {
      report(parenStack[parenStack.length - 1], "`(` 没有对应的 `)`");
    }
    if (inComment) {
      report(source.length - 1, "注释 `/*` 没有收尾（`*/`）");
    }
    if (inString) {
      report(source.length - 1, "引号没有配对");
    }

    // 最多报 6 条，多了看不过来
    return issues.slice(0, 6);
  }

  /**
   * 探针：自定义 CSS 到底有没有生效？
   *
   * 用户写了一段 CSS，最想知道的是"它起作用了吗"，而不只是"语法对不对"。
   * 语法正确但选择器写错的规则是完全静默的，所以这里真的插一条规则、真的读回
   * 计算样式再比对一次。
   *
   * 探针元素放在文档末尾（不在 Shadow DOM 里），因为自定义 CSS 是注入到
   * **整个文档**的；用 `all: initial` 先把继承影响清掉，只留下探针自己那条规则。
   * 读完之后无论成败都把探针和样式标签删掉。
   */
  var CSS_PROBE_PROPERTY = "letter-spacing";
  var CSS_PROBE_VALUE = "13.37px";

  function probeCustomCssEffect() {
    if (typeof document === "undefined" || !document.body) return false;
    var probe = null;
    var style = null;
    try {
      probe = document.createElement("div");
      // 不进布局：绝对定位 + 零尺寸，不会闪一下。
      probe.style.cssText = "position:absolute;left:-9999px;top:0;width:0;height:0;";
      probe.className = "dbx-css-probe";
      document.body.appendChild(probe);

      style = document.createElement("style");
      // `all: initial` 很关键：否则探针会继承正文的字号/字距，读到的值真假难分。
      style.textContent =
        ".dbx-css-probe{all:initial;" +
        CSS_PROBE_PROPERTY +
        ":" +
        CSS_PROBE_VALUE +
        " !important;}";
      document.head.appendChild(style);

      var applied = window.getComputedStyle(probe).getPropertyValue(CSS_PROBE_PROPERTY);
      return String(applied).replace(/\s+/g, "") === CSS_PROBE_VALUE;
    } catch (error) {
      return false;
    } finally {
      if (probe && probe.parentNode) probe.parentNode.removeChild(probe);
      if (style && style.parentNode) style.parentNode.removeChild(style);
    }
  }

  function syncCssValidation() {
    if (!el.styleCustomCss) return;
    var issues = validateCss(el.styleCustomCss.value);
    styleState.customCssIssues = issues.length;
    if (el.customCssIssues) {
      el.customCssIssues.hidden = issues.length === 0;
      if (issues.length) {
        var lines = issues.map(function (issue) {
          return t("cssIssueAt")
            .replace("{line}", String(issue.line))
            .replace("{column}", String(issue.column))
            .replace("{message}", issue.message);
        });
        setText(el.customCssIssues, lines.join("\n"));
      } else {
        setText(el.customCssIssues, "");
      }
    }
    if (el.styleCustomCss) {
      el.styleCustomCss.classList.toggle("dr__textarea--invalid", issues.length > 0);
    }
    // 语法没问题时，进一步告诉用户"它到底会不会生效"。
    if (el.customCssStatus) {
      var text = String(el.styleCustomCss.value || "").trim();
      if (!text || issues.length) {
        el.customCssStatus.hidden = true;
        setText(el.customCssStatus, "");
      } else {
        var applied = probeCustomCssEffect();
        el.customCssStatus.hidden = false;
        setText(el.customCssStatus, applied ? t("customCssApplied") : t("customCssBlocked"));
        el.customCssStatus.className = "dr__hint " + (applied ? "dr__hint--ok" : "dr__hint--bad");
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 本地小说：导入 .txt、切分章节、记忆阅读位置
   *
   * 为什么放在 UI 侧做：沙箱 iframe 里 `<input type="file">` + `File.text()`
   * 是唯一能拿到用户本地文件内容的途径（没有文件系统权限）。文本只在内存和
   * 宿主 storage 里，不上传、不发网络。
   * ═══════════════════════════════════════════════════════════════════════ */

  /* 章标题的识别规则。中文小说站的 txt 常见四五种写法，都覆盖一下。 */
  var CHAPTER_PATTERNS = [
    // 第123章 / 第123节 / 第123回 / 第十二章（汉字数字）
    /^第\s*[0-9０-９一二三四五六七八九十百千万零两〇]+\s*[章节節回卷篇]\s*[^\s].{0,40}$/,
    // 第十二章 标题
    /^第\s*[0-9０-９一二三四五六七八九十百千万零两〇]+\s*[章节節回卷篇]\s*$/,
    // 卷首 / 序章 / 楔子 / 尾声 / 番外
    /^(序章|序言|序|楔子|引子|前言|后记|後記|尾声|尾聲|番外|终章|終章|大结局|大結局)\s*.{0,30}$/,
    // Chapter 12 / CHAPTER 12
    /^chapter\s*[0-9ivxlcdm]+\b.{0,40}$/i,
    // 卷一 / 第一卷
    /^第?\s*[0-9０-９一二三四五六七八九十百千万零两〇]+\s*卷\s*.{0,30}$/,
  ];

  /** 这一行像不像章标题？返回去掉空白后的标题或 null。 */
  function chapterTitleOf(line) {
    var text = line.replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
    if (!text || text.length > 60) return null;
    // 太长的行一定不是标题（章节正文里偶尔也会出现"第X章"字样）
    for (var i = 0; i < CHAPTER_PATTERNS.length; i += 1) {
      if (CHAPTER_PATTERNS[i].test(text)) return text;
    }
    return null;
  }

  /**
   * 把整本 txt 切成章节。
   *
   * 返回 `{ chapters: [{ title, start, end }], preface }`，offset 是**字符**下标
   * （不是字节），因为后面直接按字符切片。
   * 一个章标题都识别不出来时返回空数组——由调用方决定怎么提示，别假装切好了。
   */
  function splitChapters(text) {
    var lines = text.split(/\r\n|\r|\n/);
    var chapters = [];
    var prefaceEnd = 0;
    var offset = 0;

    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      var title = chapterTitleOf(line);
      if (title) {
        if (chapters.length) {
          chapters[chapters.length - 1].end = offset;
        } else {
          prefaceEnd = offset;
        }
        chapters.push({ title: title, start: offset + line.length, end: text.length });
      }
      offset += line.length + 1; // +1 补回被 split 掉的那个换行
    }
    return { chapters: chapters, preface: text.slice(0, prefaceEnd) };
  }

  /** 纯文本 -> 安全 HTML。逐段包 <p>，不解析任何标记。 */
  function textToHtml(text) {
    var paragraphs = String(text || "")
      .split(/\r\n|\r|\n/)
      .map(function (line) {
        return line.replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
      })
      .filter(function (line) {
        return line !== "";
      });
    if (!paragraphs.length) return "";
    return paragraphs
      .map(function (line) {
        // 只做转义：这是纯文本，不是 HTML。
        return "<p>" + escapeHtml(line) + "</p>";
      })
      .join("\n");
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** 本地书在宿主 storage 里的 key。 */
  var LOCAL_BOOK_LIMIT = 48 * 1024 * 1024; // 单本 48 MiB 原文上限
  /* 书架上最多留几本。每本都存全文，多了会把宿主 storage 撑爆。 */
  var LOCAL_LIBRARY_LIMIT = 6;
  /* 浏览记录条数。 */
  var LOCAL_RECENT_LIMIT = 12;
  /* 解码后的**字符数**上限。真正的内存与 storage 压力在字符上，不在磁盘字节上：
     GBK 的小说 48 MiB 解出来约 2500 万字，比 UTF-8 的同尺寸文件多一倍。 */
  var LOCAL_BOOK_CHAR_LIMIT = 24 * 1000 * 1000;

  /* 书架索引：只放小字段（书名/章节数/字数），**不放正文**。
     host.storage 单值上限 256 KiB，一本 txt 就超了——这正是"重开 DBX 书架没了"的原因。 */
  var localLibrary = { books: [], currentId: "", recent: [] };
  /* 已取回正文的书：id -> { text, chapters, preface, ... }。正文由 sidecar 落盘，按需加载。 */
  var bookCache = {};

  /** 当前正在读的书（需要已经加载正文）。 */
  function currentLocalBook() {
    var id = localLibrary.currentId;
    if (!id && localLibrary.books.length) id = localLibrary.books[0].id;
    if (!id) return null;
    // 系列：即使正文还没取回来，也要能拼出一本"骨架"供书架/目录显示。
    if (id.indexOf("series:") === 0) return buildMergedBook(id);
    return bookCache[id] || null;
  }

  function localBookById(id) {
    return id ? bookCache[id] || null : null;
  }

  function indexById(id) {
    for (var i = 0; i < localLibrary.books.length; i += 1) {
      if (localLibrary.books[i].id === id) return localLibrary.books[i];
    }
    return null;
  }

  /**
   * 问后端这本书的正文还在不在磁盘上。
   *
   * 之前"某卷文件没了"只会表现为：状态栏停在"正在载入…"，然后**静默**用剩余各卷
   * 拼出一本残缺的书（章号看着对不上）。所以加载之前先问一句，缺什么就明说什么。
   */
  function checkBookOnDisk(id) {
    return invoke("webview/checkBook", { id: id }, 15000).then(
      function (result) {
        return !!(result && result.ok === true && result.exists === true);
      },
      function () {
        // 探测本身失败（后端没起来）时不要谎报"文件不见了"，交给后面的加载去报错。
        return true;
      }
    );
  }

  /* ── 分卷识别 ────────────────────────────────────────────────────────────
   *
   * 一部小说常被切成 `书名_1.txt` / `书名_2.txt`（或 上/中/下、第一卷…）。
   * 识别出「同一部书的第几卷」之后，书架能把它们折成一条，读的时候也能跨卷续上。
   * 判据是**文件名**：扩展名去掉、卷号记号去掉，剩下的基名相同才算同一个系列。
   * 宁可漏判也不能错判——把两本不相干的书并成一本比不合并更糟。
   */

  /* 卷号记号：_1 / -2 / (3) / 上 / 中 / 下 / 第一卷 / 第4部 / part5 */
  var VOLUME_ORDINALS = { "上": 1, "中": 2, "下": 3, "上卷": 1, "中卷": 2, "下卷": 3 };
  var CN_DIGITS = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };

  /** 把「十二」这类中文数字转成阿拉伯数字；识别不了返回 0。 */
  function chineseNumber(text) {
    var value = String(text || "");
    if (!value) return 0;
    if (CN_DIGITS[value] !== undefined) return CN_DIGITS[value];
    var match = value.match(/^十([一二三四五六七八九])?$/);
    if (match) return 10 + (match[1] ? CN_DIGITS[match[1]] : 0);
    match = value.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/);
    if (match) return CN_DIGITS[match[1]] * 10 + (match[2] ? CN_DIGITS[match[2]] : 0);
    return 0;
  }

  /**
   * 从文件名解析出 `{ base, volume }`。
   *
   * 只在**结尾**找卷号记号，避免把书名里本来就有数字的情况误判（例如「第5人格」）。
   * `volume` 为 0 表示这个文件名看不出卷号。
   */
  function parseVolumeFromName(fileName) {
    var name = String(fileName || "").replace(/\.(txt|text|md)$/i, "");
    var volume = 0;
    var base = name;

    // 1) _1 / -2 / （3） / (4) / 空格 5 —— 结尾的数字
    var trailingNumber = base.match(/^(.*?)[\s_\-·（(]*(\d{1,2})[）)]?$/);
    if (trailingNumber && trailingNumber[1]) {
      volume = parseInt(trailingNumber[2], 10);
      base = trailingNumber[1];
    }

    // 2) 上 / 中 / 下（含「上卷」这类）
    if (!volume) {
      var ordinal = base.match(/^(.*?)[\s_\-·（(]*(上卷|中卷|下卷|上|中|下)[）)]?$/);
      if (ordinal && ordinal[1]) {
        volume = VOLUME_ORDINALS[ordinal[2]] || 0;
        base = ordinal[1];
      }
    }

    // 3) 第N卷 / 第N部 / 第N册 / 第N集 / Part N / Volume N / Book N
    if (!volume) {
      var marked = base.match(
        /^(.*?)[\s_\-·（(]*第\s*([0-9]{1,2}|[一二三四五六七八九十]+)\s*[卷部册集篇][）)]?$/i
      );
      if (!marked) {
        marked = base.match(/^(.*?)[\s_\-·（(]*(?:part|volume|vol|book)\.?\s*([0-9]{1,2})[）)]?$/i);
      }
      if (marked && marked[1]) {
        volume = /^[0-9]+$/.test(marked[2]) ? parseInt(marked[2], 10) : chineseNumber(marked[2]);
        base = marked[1];
      }
    }

    // 尾部残留的括号与分隔符去掉，否则「书名（」和「书名」会算成两个系列
    base = base.replace(/[\s_\-·（(【\[]+$/g, "").replace(/[\s\u3000]+/g, "");
    if (!base) base = name;
    return { base: base, volume: volume };
  }

  /** 系列 id：基名的稳定哈希，避免把中文名放进 storage key。 */
  function seriesIdOf(base) {
    var hash = 0;
    var text = String(base || "");
    for (var i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    return "series:" + (hash >>> 0).toString(16) + ":" + text.length;
  }

  /**
   * 按系列给书架分组。只有**同一基名下至少两卷、且卷号能从 1 连续排下来**才算一个系列，
   * 否则每本书各自成组——宁可漏判也不要把不相干的书并到一起。
   */
  function localSeriesGroups() {
    var singles = [];
    var byBase = {};
    localLibrary.books.forEach(function (entry) {
      var parsed = parseVolumeFromName(entry.name);
      if (!parsed.volume) {
        singles.push({ seriesId: "", base: "", volumes: [entry] });
        return;
      }
      var key = parsed.base;
      if (!byBase[key]) {
        byBase[key] = { seriesId: seriesIdOf(key), base: key, volumes: [] };
      }
      byBase[key].volumes.push(entry);
      entry.__volume = parsed.volume;
    });

    var groups = [];
    Object.keys(byBase).forEach(function (key) {
      var group = byBase[key];
      // 卷号排序（1、2、3…），同号按导入时间
      group.volumes.sort(function (a, b) {
        if (a.__volume !== b.__volume) return a.__volume - b.__volume;
        return num(a.importedAt, 0) - num(b.importedAt, 0);
      });
      if (group.volumes.length >= 2) groups.push(group);
      else singles.push({ seriesId: "", base: "", volumes: group.volumes });
    });

    // 系列在前，单本在后；各自按最近导入排
    groups.sort(function (a, b) {
      return num(b.volumes[0].importedAt, 0) - num(a.volumes[0].importedAt, 0);
    });
    singles.sort(function (a, b) {
      return num(b.volumes[0].importedAt, 0) - num(a.volumes[0].importedAt, 0);
    });
    return groups.concat(singles);
  }

  /** 系列 id -> 分组。 */
  function seriesGroupById(seriesId) {
    if (!seriesId) return null;
    var groups = localSeriesGroups();
    for (var i = 0; i < groups.length; i += 1) {
      if (groups[i].seriesId === seriesId) return groups[i];
    }
    return null;
  }

  /**
   * 把同系列的各卷拼成一本"连续的书"。
   *
   * 返回 `{ id, name, chapters, merged, volumes }`：
   *   * `chapters[i]` 是**扁平**的章节表，每项带 `volumeIndex` 与 `chapterIndex`，
   *     所以"第 1340 章"这种全局章号可以直接定位；
   *   * `merged` 为 false 表示只有一卷（或正文没取回来），行为跟以前一样。
   *
   * 正文按卷缓存：只有当前读的那一卷会被真正取回（`ensureVolumeLoaded`）。
   */
  function buildMergedBook(seriesId) {
    var group = seriesGroupById(seriesId);
    if (!group) return null;
    var chapters = [];
    var volumes = [];
    group.volumes.forEach(function (entry, volumeIndex) {
      var cached = bookCache[entry.id];
      volumes.push({
        id: entry.id,
        name: entry.name,
        volume: num(entry.__volume, volumeIndex + 1),
        chapterCount: cached ? cached.chapters.length : num(entry.chapterCount, 0),
        loaded: !!cached,
        offset: chapters.length
      });
      if (!cached) return;
      cached.chapters.forEach(function (chapter, chapterIndex) {
        chapters.push({
          title: chapter.title,
          start: chapter.start,
          end: chapter.end,
          volumeIndex: volumeIndex,
          volumeId: entry.id,
          chapterIndex: chapterIndex
        });
      });
    });
    if (volumes.length < 2) return null;
    return {
      id: seriesId,
      name: group.base,
      merged: true,
      volumes: volumes,
      chapters: chapters,
      // 已加载的卷数少于总卷数时，章节表是**残缺**的，渲染时要说明。
      partial: volumes.some(function (volume) {
        return !volume.loaded;
      })
    };
  }

  /** 把某一卷的正文取回来并塞进 bookCache。 */
  function ensureVolumeLoaded(volumeId) {
    if (bookCache[volumeId]) return Promise.resolve(bookCache[volumeId]);
    return loadBookText(volumeId);
  }

  /**
   * 把整个系列都取回来。
   *
   * **尽力而为**：某一卷的文件丢了不能拖垮整套书。返回实际加载成功的卷数，
   * 调用方据此决定要不要提示"有卷缺失"，但目录和能读的卷照常可用。
   */
  function ensureSeriesLoaded(seriesId) {
    var group = seriesGroupById(seriesId);
    if (!group) return Promise.resolve(0);
    return Promise.all(
      group.volumes.map(function (entry) {
        return ensureVolumeLoaded(entry.id);
      })
    ).then(function (results) {
      return results.filter(Boolean).length;
    });
  }

  /** 系列里已经取回正文的卷数。 */
  function loadedVolumeCount(group) {
    if (!group) return 0;
    return group.volumes.filter(function (entry) {
      return !!bookCache[entry.id];
    }).length;
  }

  /**
   * 把一本（已加载正文的）书压成索引条目。
   *
   * 索引里**绝不能**出现 text/chapters —— host.storage 单值上限 256 KiB，
   * 一本小说会把整条记录顶爆，连带把书架其它信息一起弄丢。
   */
  function bookIndexEntry(book) {
    return {
      id: book.id,
      name: book.name,
      encoding: book.encoding || "utf-8",
      chars: book.chars || 0,
      chapterCount: book.chapters ? book.chapters.length : num(book.chapterCount, 0),
      importedAt: book.importedAt || Date.now()
    };
  }

  function persistLocalLibrary() {
    // 只写索引：正文在 sidecar 磁盘上，storage 放不下。
    var payload = {
      books: localLibrary.books.map(function (entry) {
        // 兜底：万一旧数据里混进了 text/chapters，也不要写到 storage 里。
        return {
          id: entry.id,
          name: entry.name,
          encoding: entry.encoding,
          chars: entry.chars,
          chapterCount: entry.chapterCount,
          importedAt: entry.importedAt
        };
      }),
      currentId: localLibrary.currentId,
      recent: localLibrary.recent
    };
    if (!store) return;
    store.set(STORAGE_KEYS.localLibrary, payload).then(
      function () {
        clearStorageProblem(STORAGE_KEYS.localLibrary);
      },
      function (error) {
        setStorageProblem(STORAGE_KEYS.localLibrary, error);
      }
    );
  }

  /** 记一条浏览记录（书 + 章号 + 时间），同一本书只留最近一次。 */
  function touchLocalRecent(bookId, chapter) {
    if (!bookId) return;
    localLibrary.recent = localLibrary.recent.filter(function (entry) {
      return entry && entry.id !== bookId;
    });
    localLibrary.recent.unshift({ id: bookId, chapter: num(chapter, 0), at: Date.now() });
    if (localLibrary.recent.length > LOCAL_RECENT_LIMIT) {
      localLibrary.recent = localLibrary.recent.slice(0, LOCAL_RECENT_LIMIT);
    }
  }

  /**
   * 读回书架索引。
   *
   * 新格式只存索引（id/书名/章节数）。旧的两种格式都兼容：
   *   * 更早的单本 key（`localBook`，带整本 text）；
   *   * v0.6.x 的书架（books 里带 text/chapters）。
   * 这两种都把正文迁到 sidecar 磁盘上，索引留在 storage。
   */
  function loadLocalLibrary(raw, legacyRaw) {
    var library = { books: [], currentId: "", recent: [] };
    var pending = [];

    if (raw && typeof raw === "object" && Array.isArray(raw.books)) {
      raw.books.forEach(function (book) {
        if (!book || typeof book.id !== "string" || !book.id) return;
        if (typeof book.text === "string" && book.text.length) {
          // 旧格式带正文：稍后交给 sidecar 落盘
          pending.push(book);
          library.books.push(bookIndexEntry(book));
          return;
        }
        library.books.push(book);
      });
      library.currentId = typeof raw.currentId === "string" ? raw.currentId : "";
      library.recent = Array.isArray(raw.recent) ? raw.recent : [];
    }

    var legacy = loadLocalBook(legacyRaw);
    if (legacy && !library.books.some(function (book) { return book.id === legacy.id; })) {
      pending.push(legacy);
      library.books.unshift(bookIndexEntry(legacy));
      library.currentId = legacy.id;
    }

    if (!library.books.some(function (book) { return book.id === library.currentId; })) {
      library.currentId = library.books.length ? library.books[0].id : "";
    }
    return { library: library, pending: pending };
  }

  function loadLocalBook(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.text !== "string" || !Array.isArray(raw.chapters) || !raw.chapters.length) {
      return null;
    }
    return raw;
  }

  /**
   * 从 sidecar 磁盘取回一本书的正文并切好章节，放进 `bookCache`。
   *
   * 正文不进 host.storage（单值上限 256 KiB），所以每次启动都要按需取回。
   *
   * **同一本书只允许有一个在飞的请求**：渲染侧栏、切标签、补卷都会调用它，
   * 没有去重的话同一本 4.5 MB 的书会被同时拉好几遍（既慢又容易把状态栏卡在
   * "正在载入…"）。这里用一个 id -> Promise 的表兜住。
   */
  var bookLoads = {};

  function loadBookText(id) {
    if (bookCache[id]) return Promise.resolve(bookCache[id]);
    if (bookLoads[id]) return bookLoads[id];
    var pending = invoke("webview/loadBook", { id: id }, 30000).then(
      function (result) {
        if (!result || result.ok !== true || typeof result.text !== "string") {
          return null;
        }
        var text = result.text;
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        // 落盘时已经归一化成 \n；这里再兜一次，兼容早期的文件。
        text = text.replace(/\r\n?/g, "\n");
        var split = splitChapters(text);
        if (!split.chapters.length) return null;
        var index = indexById(id) || {};
        var book = {
          id: id,
          name: index.name || "未命名.txt",
          encoding: index.encoding || "utf-8",
          chars: text.length,
          importedAt: index.importedAt || Date.now(),
          text: text,
          chapters: split.chapters,
          preface: split.preface
        };
        bookCache[id] = book;
        return book;
      },
      function () {
        return null;
      }
    );
    bookLoads[id] = pending;
    // 无论成败都要把在飞标记清掉，否则一次失败会让这本书永远"加载中"。
    pending.then(
      function () {
        delete bookLoads[id];
      },
      function () {
        delete bookLoads[id];
      }
    );
    return pending;
  }

  /** 字符串的 UTF-8 字节数（不能用 .length，那是字符数）。 */
  function utf8ByteLength(text) {
    var bytes = 0;
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      // 代理对：两个 UTF-16 单元合成一个 4 字节字符
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        var next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          i += 1;
        } else {
          bytes += 3;
        }
      } else bytes += 3;
    }
    return bytes;
  }

  /* 分块大小（**字符**数）。宿主 JSON 桥单次参数上限 2 MiB，而换行与中文在 JSON 里
     要转义，最坏会膨胀到 6 倍左右。25 万字符即使全是最坏情况也只有约 1.5 MB，
     留足余量；一本 470 万字的小说约 19 块。 */
  var BOOK_CHUNK_CHARS = 250000;

  /**
   * 把正文写到 sidecar 磁盘。
   *
   * 为什么不能一次发完：实测把 4.5 MB 的 txt 整本塞进一个 RPC 参数，宿主直接回
   * HTTP 400（超过 2 MiB 上限）。所以按字符分块，逐块 append。
   */
  function saveBookText(id, text, meta) {
    var total = text.length;
    // 收尾校验比的是**字节**，不是字符数：一个汉字占 3 字节，用字符数比会必然不符。
    var expectedBytes = utf8ByteLength(text);
    var metaJson = JSON.stringify(meta || {});

    return invoke("webview/beginBook", { id: id, meta: metaJson }, 20000).then(
      function (started) {
        if (!started || started.ok !== true) {
          return { ok: false, reason: "sidecar-rejected" };
        }
        // 两个游标必须分开（曾经踩过坑）：
        //   `cursor` —— 字符下标，用来切 `text`；
        //   `offset` —— **字节**偏移，sidecar 用它做顺序校验与追加。
        // 把 sidecar 返回的字节偏移当字符下标用，会让第 2 块就跳到 71 万"字符"处：
        // 半个文本被跳过、后续块越界截断，最后表现成"写入不完整"。
        var cursor = 0;
        var offset = 0;
        var index = 0;
        var totalChunks = Math.max(1, Math.ceil(total / BOOK_CHUNK_CHARS));

        function sendNext() {
          if (cursor >= total) return Promise.resolve({ ok: true });
          var chunk = text.slice(cursor, cursor + BOOK_CHUNK_CHARS);
          index += 1;

          if (totalChunks > 3 && index % 5 === 0) {
            showStatusNotice(
              t("localUploading")
                .replace("{done}", String(index))
                .replace("{all}", String(totalChunks))
            );
          }
          return invoke(
            "webview/appendBook",
            { id: id, offset: offset, chunk: chunk },
            30000
          ).then(
            function (step) {
              if (!step || step.ok !== true || typeof step.offset !== "number") {

                return { ok: false, reason: "sidecar-rejected" };
              }
              // step.offset 是字节偏移；字符游标要自己按块长前进。
              offset = step.offset;
              cursor += chunk.length;
              return sendNext();
            },
            function (error) {

              return { ok: false, reason: "sidecar-failed", message: humanError(error) };
            }
          );
        }

        return sendNext().then(function (result) {

          if (!result.ok) return result;
          // 收尾校验字节数：对不上说明有块丢了，宁可报错也不要存半本书。
          return invoke(
            "webview/finishBook",
            { id: id, bytes: expectedBytes },
            30000
          ).then(
            function (done) {

              if (done && done.ok === true) return { ok: true, bytes: done.bytes };
              return {
                ok: false,
                reason: "incomplete",
                // 把期望/实际字节数带上，便于一眼看出差在哪。
                message:
                  done && typeof done.expected === "number"
                    ? "期望 " + done.expected + " 字节，实际 " + done.actual
                    : (done && done.message) || ""
              };
            },
            function (error) {

              return { ok: false, reason: "sidecar-failed", message: humanError(error) };
            }
          );
        });
      },
      function (error) {

        return { ok: false, reason: "sidecar-failed", message: humanError(error) };
      }
    );
  }

  /** 从书架和磁盘上一起移除。 */
  function deleteBookEverywhere(id) {
    invoke("webview/deleteBook", { id: id }, 15000).catch(function () {
      /* 磁盘上本来就没有也无所谓 */
    });
  }

  /** 把旧格式里自带的正文搬到 sidecar 磁盘上，索引留在 storage。 */
  function migrateLegacyBooks(pending) {
    pending.forEach(function (book) {
      if (!book || typeof book.text !== "string" || !book.text.length) return;
      bookCache[book.id] = {
        id: book.id,
        name: book.name || "未命名.txt",
        encoding: book.encoding || "utf-8",
        chars: book.text.length,
        importedAt: book.importedAt || Date.now(),
        text: book.text,
        chapters: book.chapters,
        preface: book.preface || ""
      };
      saveBookText(book.id, book.text).then(function (saved) {
        if (saved.ok) {
          // 迁移成功：立刻用纯索引覆盖 storage，把正文从里面去掉。
          persistLocalLibrary();
          if (typeof console !== "undefined" && console.info) {
            console.info("[dbx-webview] 已把旧书移到磁盘", book.name);
          }
        }
      });
    });
  }

  /** 把 txt 的字节解成文本。
   *
   * 中文小说 txt 有两种主流编码：UTF-8 和 GBK/GB18030（老资源站几乎全是 GBK）。
   * 先按严格 UTF-8 试解，失败再退回 GB18030 —— GB18030 是 GBK 的超集，
   * 能覆盖两种。浏览器自带这两个解码器，不需要额外字库。
   *
   * 顺序不能反：GB18030 几乎不会解码失败（任何字节序列都能凑出字符），
   * 先试它会把 UTF-8 文件解成乱码。
   */
  function decodeBookBuffer(buffer) {
    if (typeof TextDecoder !== "function") {
      return { text: new TextDecoder().decode(buffer), encoding: "utf-8" };
    }
    try {
      var strict = new TextDecoder("utf-8", { fatal: true });
      return { text: strict.decode(buffer), encoding: "utf-8" };
    } catch (error) {
      void error;
    }
    try {
      return { text: new TextDecoder("gb18030").decode(buffer), encoding: "gb18030" };
    } catch (error) {
      void error;
    }
    // 两个都不行就宽松 UTF-8，至少让用户看到内容与替换字符。
    return { text: new TextDecoder("utf-8").decode(buffer), encoding: "utf-8-lossy" };
  }

  /**
   * 导入一个 txt 文件，切成章节后存进宿主 storage。
   * 返回 `{ ok, id, name, chapters }` 或 `{ ok: false, reason }`。
   */
  function importLocalBook(file) {
    if (!file) return Promise.resolve({ ok: false, reason: "no-file" });
    var name = file.name || "未命名.txt";
    if (!/\.(txt|text|md)$/i.test(name)) {
      return Promise.resolve({ ok: false, reason: "bad-type", name: name });
    }
    if (file.size > LOCAL_BOOK_LIMIT) {
      return Promise.resolve({ ok: false, reason: "too-large", name: name, size: file.size });
    }
    var read = typeof file.arrayBuffer === "function"
      ? file.arrayBuffer()
      : new Promise(function (resolve, reject) {
          var legacy = new FileReader();
          legacy.onload = function () {
            resolve(legacy.result);
          };
          legacy.onerror = function () {
            reject(legacy.error || new Error("read failed"));
          };
          legacy.readAsArrayBuffer(file);
        });

    return read.then(
      function (buffer) {
        var decoded = decodeBookBuffer(buffer);
        var text = decoded.text;
        // 去掉 BOM，否则第一行标题会带一个看不见的字符
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        // 统一换行。
        //
        // 宿主把 RPC 参数里的字符串做了换行归一化：`\r\n` 变成 `\n`。
        // 分块上传时，如果某一块正好切在 `\r\n` 中间，那个 `\r` 就没了 ——
        // 实测 4.5 MB 的 txt 丢掉 3 个字节对，收尾校验因此失败（而且文件已经写坏了）。
        // 与其和宿主较劲，不如一开始就把正文归一化成 `\n`：落盘内容与内存内容
        // 完全一致，字节校验也才有意义。
        text = text.replace(/\r\n?/g, "\n");
        if (text.length > LOCAL_BOOK_CHAR_LIMIT) {
          return { ok: false, reason: "too-large", name: name, chars: text.length };
        }
        var split = splitChapters(text);
        if (!split.chapters.length) {
          return { ok: false, reason: "no-chapters", name: name, chars: text.length };
        }
        var id = "local:" + name + ":" + text.length;
        var book = {
          id: id,
          name: name,
          encoding: decoded.encoding,
          chars: text.length,
          importedAt: Date.now(),
          text: text,
          chapters: split.chapters,
          preface: split.preface
        };
        // 正文交给 sidecar 落盘；host.storage 只放索引（它单值上限 256 KiB）。
        return saveBookText(id, text, {
          name: name,
          encoding: decoded.encoding,
          chapterCount: split.chapters.length
        }).then(function (saved) {
          if (!saved.ok) {
            return {
              ok: false,
              reason: saved.reason,
              name: name,
              message: saved.message || ""
            };
          }
          // 加进书架：同 id（同名同长度）视为同一本，替换而不重复；超上限时丢最旧的。
          var existing = localLibrary.books.findIndex(function (item) {
            return item.id === id;
          });
          if (existing >= 0) localLibrary.books.splice(existing, 1);
          localLibrary.books.unshift(bookIndexEntry(book));
          if (localLibrary.books.length > LOCAL_LIBRARY_LIMIT) {
            var dropped = localLibrary.books.splice(LOCAL_LIBRARY_LIMIT);
            dropped.forEach(function (item) {
              deleteBookEverywhere(item.id);
              delete bookCache[item.id];
            });
            localLibrary.recent = localLibrary.recent.filter(function (entry) {
              return !dropped.some(function (item) {
                return item.id === entry.id;
              });
            });
          }
          localLibrary.currentId = id;
          bookCache[id] = book;
          touchLocalRecent(id, 0);
          persistLocalLibrary();
          return {
            ok: true,
            id: id,
            name: name,
            chapters: split.chapters.length,
            encoding: decoded.encoding,
            replaced: existing >= 0
          };
        });
      },
      function () {
        return { ok: false, reason: "read-failed", name: name };
      }
    );
  }

  /**
   * 这一"章"是不是只有个标题、几乎没有正文？
   *
   * txt 里常出现 `第一卷 《凡尘神域》` 这种**卷标记行**：它们确实该被当成分章点，
   * 但点进去只有几个字，页面上就是一片空白 —— 用户会以为文件坏了。
   * 判据很保守（正文 < 60 字），只用来"跳过"和"标记"，不改变章节表本身。
   */
  function isSparseChapter(book, index) {
    if (!book || !book.chapters || index < 0 || index >= book.chapters.length) return false;
    var chapter = book.chapters[index];
    return chapter.end - chapter.start < 60;
  }

  /** 从 index 开始找一个有正文的章节（先往后，再往前）；找不到就返回原值。 */
  function firstReadableChapter(book, index) {
    if (!book || !book.chapters || !book.chapters.length) return 0;
    var total = book.chapters.length;
    var start = Math.max(0, Math.min(total - 1, index));
    for (var i = start; i < total; i += 1) {
      if (!isSparseChapter(book, i)) return i;
    }
    for (var j = start; j >= 0; j -= 1) {
      if (!isSparseChapter(book, j)) return j;
    }
    return start;
  }

  /** 取第 index 章的内容，拼成渲染管线认识的 payload。
   *
   * `book` 可以是一本单卷书，也可以是 `buildMergedBook` 出来的**多卷合订本**：
   * 后者的 `chapters[i]` 带 `volumeIndex`，正文要去对应那一卷的 text 里切。
   */
  function localChapterPayload(book, index) {
    var total = book.chapters.length;
    var safe = Math.max(0, Math.min(total - 1, index));
    var chapter = book.chapters[safe];

    // 定位正文：单卷书直接用 book.text；合订本先找到所属卷。
    var source = book;
    if (chapter.volumeIndex !== undefined && book.volumes) {
      var volume = book.volumes[chapter.volumeIndex];
      source = volume ? bookCache[volume.id] : null;
    }
    if (!source || typeof source.text !== "string") source = book;
    var body = source && typeof source.text === "string" ? source.text.slice(chapter.start, chapter.end) : "";

    var list = book.chapters.map(function (item, position) {
      return { title: item.title, url: "#chapter-" + position, current: position === safe };
    });
    // 跨卷时在章标题前标出卷号，否则读者不知道自己在第几卷。
    var chapterLabel = chapter.title;
    if (book.merged && book.volumes && book.volumes.length > 1) {
      var volumeInfo = book.volumes[chapter.volumeIndex];
      if (volumeInfo) chapterLabel = "卷" + volumeInfo.volume + " · " + chapter.title;
    }
    return {
      ok: true,
      /* 本地书没有网址：地址栏留空，工具栏改为显示书名与章号。 */
      url: "",
      finalUrl: "",
      status: 200,
      title: book.name + " · " + chapterLabel,
      mode: "reader",
      presetId: "local-book",
      html: textToHtml(body),
      textLength: body.length,
      fullTextLength: body.length,
      readerOk: true,
      jsRequired: false,
      blocked: false,
      linkWall: false,
      linkRatio: 0,
      mergedPages: 0,
      truncated: false,
      bytes: body.length,
      elapsedMs: 0,
      fetchedAt: new Date().toISOString(),
      baseHref: "",
      prevUrl: safe > 0 ? "#chapter-" + (safe - 1) : null,
      prevTitle: safe > 0 ? book.chapters[safe - 1].title : null,
      nextUrl: safe < total - 1 ? "#chapter-" + (safe + 1) : null,
      nextTitle: safe < total - 1 ? book.chapters[safe + 1].title : null,
      startUrl: null,
      needsLogin: false,
      catalogUrl: null,
      chapters: list,
      images: [],
      warnings: [],
      /* 本地书专用字段：渲染器靠它们显示"第 n / 共 m 章"。 */
      localBook: {
        id: book.id,
        name: book.name,
        index: safe,
        total: total,
        chars: chapter.end - chapter.start,
        /* 只有标题、几乎没有正文的行（txt 里的"分卷标记行"）：
           点进去会是空白页，渲染时得给用户一个交代，否则看起来像"点了没反应"。 */
        sparse: chapter.end - chapter.start < 60,
        merged: !!book.merged,
        volumeIndex: num(chapter.volumeIndex, 0),
        volumeCount: book.volumes ? book.volumes.length : 1,
        /* 合订本但还有卷没取回正文时，章节表是残缺的，界面要说明。 */
        partial: !!book.partial
      }
    };
  }

  /**
   * 打开本地书的某一章。
   *
   * 第一次调用会把当前标签切到 `local` 模式（不落地成 URL，历史记录里也不掺假地址）；
   * 之后翻章只换 payload，不新建标签。
   *
   * `index` 的含义取决于目标是不是"多卷合订本"：
   *   * 单卷书 —— 该卷第几章；
   *   * 系列   —— **全书连续章号**（第 1 卷到最后一卷顺序数下来），
   *              所以读完第 1 卷的最后一章，下一章自然是第 2 卷的第一章。
   */
  function openLocalChapter(index, options) {
    var opts = options || {};
    var bookId = opts.bookId || localLibrary.currentId;
    if (!bookId) {
      showStatusNotice(t("localNone"));
      return;
    }

    // 1) 目标是不是某个系列里的卷？是就尽量把全系列正文都取回来，好跨卷连读。
    //    注意：**缺卷不能阻断**——某一卷的文件丢了，其他卷仍应能正常读。
    var seriesGroup = null;
    var volumeIndexInSeries = 0;
    if (bookId.indexOf("series:") === 0) {
      seriesGroup = seriesGroupById(bookId);
    } else {
      var entry = indexById(bookId);
      if (entry) {
        var parsed = parseVolumeFromName(entry.name);
        if (parsed.volume) {
          var group = seriesGroupById(seriesIdOf(parsed.base));
          if (group && group.volumes.length > 1) {
            seriesGroup = group;
            group.volumes.forEach(function (item, position) {
              if (item.id === bookId) volumeIndexInSeries = position;
            });
          }
        }
      }
    }

    // 目标那一卷必须有正文，否则这次点击没有意义。
    if (!bookCache[bookId] && bookId.indexOf("series:") !== 0) {
      showStatusNotice(t("localLoadingBook"));
      checkBookOnDisk(bookId).then(function (exists) {
        if (!exists) {
          // 文件确实不在了：明确说出来，并把书架/面板刷成真实状态。
          showStatusNotice(t("localBookMissingNamed").replace("{name}", (indexById(bookId) || {}).name || bookId));
          renderLocalBookPanel();
          return;
        }
        loadBookText(bookId).then(function (loaded) {
          if (!loaded) {
            showStatusNotice(t("localBookMissingNamed").replace("{name}", (indexById(bookId) || {}).name || bookId));
            renderLocalBookPanel();
            return;
          }
          openLocalChapter(index, opts);
        });
      });
      return;
    }

    // 系列里还有卷没取回来就先补齐。
    // **先查磁盘**：缺卷要说清楚是哪一卷，不能静默拼出一本残缺的书。
    if (seriesGroup && loadedVolumeCount(seriesGroup) < seriesGroup.volumes.length) {
      var groupId = seriesGroup.seriesId;
      var pendingVolumes = seriesGroup.volumes.filter(function (entry) {
        return !bookCache[entry.id];
      });
      showStatusNotice(
        t("localLoadingSeries").replace("{n}", String(pendingVolumes.length))
      );
      Promise.all(
        pendingVolumes.map(function (entry) {
          return checkBookOnDisk(entry.id).then(function (exists) {
            return { entry: entry, exists: exists };
          });
        })
      ).then(function (checked) {
        var gone = checked.filter(function (item) {
          return !item.exists;
        });
        return ensureSeriesLoaded(groupId).then(function (loadedCount) {
          if (gone.length) {
            // 明确点名缺了哪几卷，而不是只说"有 N 卷缺失"。
            showStatusNotice(
              t("localVolumesGone").replace(
                "{names}",
                gone
                  .map(function (item) {
                    return item.entry.name;
                  })
                  .join("、")
              )
            );
          } else if (loadedCount < seriesGroup.volumes.length) {
            showStatusNotice(
              t("localSeriesPartial").replace("{n}", String(seriesGroup.volumes.length - loadedCount))
            );
          }
          if (loadedCount === 0) {
            renderLocalBookPanel();
            return;
          }
          openLocalChapter(index, opts);
        });
      });
      return;
    }

    // 3) 合订本优先：这样"下一章"能自然跨卷。
    var book = seriesGroup ? buildMergedBook(seriesGroup.seriesId) : null;
    var wantsChapterOfSeries = false;
    if (book) {
      wantsChapterOfSeries = true;
    } else {
      book = bookCache[bookId];
    }
    if (!book) {
      showStatusNotice(t("localBookMissing"));
      return;
    }
    // 单卷书的 index 是章号；系列则是连续章号。系列里也可以按"第几卷 + 该卷第几章"打开。
    var target = index;
    if (wantsChapterOfSeries && opts.volumeChapter !== undefined) {
      var offset = book.volumes[volumeIndexInSeries] ? book.volumes[volumeIndexInSeries].offset : 0;
      target = offset + opts.volumeChapter;
    }
    // 别停在只有卷标题的行上（正文不足 60 字）：往后找一章真正有正文的。
    // 只在**没有明确章节号**的入口（恢复进度 / 打开书）做这件事；
    // 用户自己点目录里的某一章时按他点的来。
    if (opts.exact !== true && isSparseChapter(book, target)) {
      target = firstReadableChapter(book, target);
    }
    localLibrary.currentId = book.id;

    var tab = activeTab();
    if (!tab || tab.mode !== "local") {
      tab = openLocalTab();
    }
    if (!tab) return;
    var payload = localChapterPayload(book, target);
    tab.mode = "local";
    tab.localBookId = book.id;
    tab.payload = payload;
    tab.error = null;
    tab.loading = false;
    tab.warnings = [];
    tab.title = payload.localBook.name;
    tab.url = "";
    tab.presetId = "local-book";
    // 翻章要回到顶部；如果是恢复位置则留给 restoreProgress 处理。
    if (opts.keepScroll !== true) tab.scrollTop = 0;
    state.lastUrl = "";
    touchLocalRecent(book.id, payload.localBook.index);
    persistLocalLibrary();
    queuePersist();
    renderTabs();
    syncToolbar();
    syncDocTitle(tab);
    renderPage(tab);
    renderLocalBookPanel();
    void scrollIntoViewTop();
  }

  function scrollIntoViewTop() {
    if (el.contentView) el.contentView.scrollTop = 0;
  }

  /** 建一个本地书标签。 */
  function openLocalTab() {
    var tab = {
      id: "tab-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      url: "",
      title: currentLocalBook() ? currentLocalBook().name : t("localBook"),      mode: "local",
      presetId: "local-book",
      payload: null,
      error: null,
      loading: false,
      warnings: [],
      history: [],
      historyIndex: -1,
      scrollTop: 0,
      notice: "",
      lastRenderPreset: ""
    };
    state.tabs.push(tab);
    state.activeTabId = tab.id;
    return tab;
  }

  /** 「下一章 / 上一章」。两处入口共用（工具栏按钮与章节下拉）。 */
  function goLocalChapter(delta) {
    var tab = activeTab();
    if (!tab || !tab.payload || !tab.payload.localBook) return false;
    var info = tab.payload.localBook;
    var next = info.index + delta;
    if (next < 0 || next >= info.total) {
      showStatusNotice(delta > 0 ? t("localLastChapter") : t("localFirstChapter"));
      return true;
    }
    openLocalChapter(next);
    return true;
  }

  /** 打开系统的文件选择框（沙箱里唯一能读本地文件的途径）。 */
  function pickLocalBook() {
    if (!el.localBookFile) {
      showStatusNotice(t("localUnsupported"));
      return;
    }
    el.localBookFile.click();
  }

  function onLocalBookPicked() {
    var input = el.localBookFile;
    var file = input && input.files && input.files[0];
    if (!file) return;
    if (el.localImportText) {
      setText(el.localImportText, t("localImporting"));
      if (el.btnLocalImport) el.btnLocalImport.disabled = true;
    }
    importLocalBook(file).then(function (result) {
      // 同一个文件可以再次选中，清掉 value 才能重新触发 change。
      if (el.localBookFile) el.localBookFile.value = "";
      if (el.localImportText) {
        setText(el.localImportText, t("localImport"));
        if (el.btnLocalImport) el.btnLocalImport.disabled = false;
      }
      if (!result.ok) {
        var detail = result.message ? "（" + result.message + "）" : "";
        showStatusNotice(
          t("localImportFailed")
            .replace("{reason}", t("localReason_" + result.reason) || result.reason) + detail
        );
        return;
      }
      renderLocalBookPanel();
      showStatusNotice(t("localImported").replace("{n}", String(result.chapters)));
      // 从上次读到的地方继续（按书 id 记）。
      var saved = readLocalProgress(result.id);
      openLocalChapter(saved >= 0 ? saved : 0);

    }).catch(function (error) {
      // 这个 then 里如果抛异常，以前会彻底静默——导入看起来"卡住了"。
      if (el.localImportText) {
        setText(el.localImportText, t("localImport"));
        if (el.btnLocalImport) el.btnLocalImport.disabled = false;
      }
      showStatusNotice(t("localImportFailed").replace("{reason}", humanError(error)));
    });
  }

  /* 本地书进度：存"读到第几章"，比滚动百分比更有意义。 */
  function localProgressKey(id) {
    return "local:" + id;
  }

  function readLocalProgress(id) {
    var entry = progress.map[localProgressKey(id)];
    if (!entry || typeof entry.chapter !== "number") return -1;
    return entry.chapter;
  }

  function saveLocalProgress(id, chapter) {
    if (!id) return;
    progress.map[localProgressKey(id)] = { chapter: chapter, at: Date.now() };
    queuePersist();
    // 目录里"当前章"的高亮跟着走，否则翻到第 900 章，列表还停在开头那行。
    syncTocCurrent(id, chapter);
  }

  /**
   * 只更新当前章高亮，不重建整个目录。
   *
   * 章在可视窗口外时把列表滚过去（读者翻章通常想看上下文）；
   * 在窗口内就只切 class，避免打断用户自己正在浏览的位置。
   */
  function syncTocCurrent(bookId, chapter) {
    var list = el.localChapterList;
    if (!list || !localToc.count) return;
    if (localToc.bookId && bookId && localToc.bookId !== bookId) return;
    var index = num(chapter, -1);
    if (index < 0 || index >= localToc.count || index === localToc.current) return;
    localToc.current = index;
    if (!localToc.offsets) {
      // 小书全量渲染：直接改 class。
      var rows = list.querySelectorAll(".lb__item");
      for (var i = 0; i < rows.length; i += 1) {
        rows[i].classList.toggle("lb__item--current", i === index);
      }
      return;
    }
    if (index >= localToc.start && index < localToc.end) {
      refreshVirtualToc(true);
      return;
    }
    list.scrollTop = Math.max(0, localToc.offsets[index] - list.clientHeight / 2 + localToc.rowHeight);
    refreshVirtualToc(true);
  }

  /** 书架里的一行（单本）。副标题可选，用来放"卷"这类补充信息。 */
  function buildShelfRow(entry, title, subtitle) {
    var isCurrent = entry.id === localLibrary.currentId;
    var row = node("div", "lb__book" + (isCurrent ? " lb__book--current" : ""));
    var open = node("button", "lb__book-open");
    open.type = "button";
    open.title = entry.name;
    open.appendChild(node("span", "lb__book-name", title));
    var meta = node("span", "lb__book-meta");
    if (subtitle) meta.appendChild(node("span", "lb__badge", subtitle));
    meta.appendChild(
      node("span", null, t("localChapterCount").replace("{n}", String(num(entry.chapterCount, 0))))
    );
    // 读完了打个勾：一眼能看出这套书还剩哪本没看。
    var finished = isBookFinished(entry);
    if (finished) {
      var done = node("span", "lb__badge lb__badge--done", t("localFinished"));
      done.title = t("localFinishedHint");
      meta.appendChild(done);
    }
    open.appendChild(meta);
    markLocalAction(open, { kind: "book", id: entry.id });
    row.appendChild(open);
    var remove = node("button", "lb__book-del", "✕");
    remove.type = "button";
    remove.title = t("localRemove");
    remove.setAttribute("aria-label", t("localRemove"));
    markLocalAction(remove, { kind: "remove", id: entry.id });
    row.appendChild(remove);
    return row;
  }

  /** 这本书读到结尾了吗（最后一章的进度已记录）。 */
  function isBookFinished(entry) {
    var saved = readLocalProgress(entry.id);
    var total = num(entry.chapterCount, 0);
    return saved >= 0 && total > 0 && saved >= total - 1;
  }

  /** 这一卷读完了吗。 */
  function isVolumeFinished(entry) {
    return isBookFinished(entry);
  }

  /**
   * 侧栏「本地小说」页签：书架（可切换/删除）+ 浏览记录 + 当前书的目录。
   *
   * 三块自上而下：书架 → 最近读过的（书 + 章，可一键回去）→ 当前书的全部章节。
   */
  function renderLocalBookPanel() {
    var info = el.localBookInfo;
    var list = el.localChapterList;
    if (!info || !list) return;
    clear(info);
    clear(list);

    if (!localLibrary.books.length) {
      info.appendChild(node("p", "lb__empty", t("localNoneHint")));
      return;
    }

    // ── 书架：同系列的分卷折成一条，展开后能看到各卷
    info.appendChild(node("div", "lb__section", t("localShelf")));
    localSeriesGroups().forEach(function (group) {
      if (!group.seriesId) {
        // 单本
        var single = group.volumes[0];
        info.appendChild(buildShelfRow(single, single.name, ""));
        return;
      }
      var isCurrentSeries = localLibrary.currentId === group.seriesId;
      var anyVolumeCurrent = group.volumes.some(function (item) {
        return item.id === localLibrary.currentId;
      });
      var row = node(
        "div",
        "lb__book lb__book--series" + (isCurrentSeries || anyVolumeCurrent ? " lb__book--current" : "")
      );
      var open = node("button", "lb__book-open");
      open.type = "button";
      open.title = group.base + "（" + group.volumes.length + " 卷）";
      open.appendChild(node("span", "lb__book-name", group.base));
      var totalChapters = group.volumes.reduce(function (sum, item) {
        return sum + num(item.chapterCount, 0);
      }, 0);
      var meta = node("span", "lb__book-meta");
      meta.appendChild(node("span", "lb__badge", t("localVolumeCount").replace("{n}", String(group.volumes.length))));
      meta.appendChild(
        node("span", null, " · " + t("localChapterCount").replace("{n}", String(totalChapters)))
      );
      open.appendChild(meta);
      markLocalAction(open, { kind: "series", id: group.seriesId });
      row.appendChild(open);
      info.appendChild(row);

      // 各卷一行小字：卷号 + 章数 + 是否读完
      var volumes = node("div", "lb__volumes");
      group.volumes.forEach(function (item) {
        var chip = node("button", "lb__volume");
        chip.type = "button";
        chip.title = item.name;
        var done = isVolumeFinished(item);
        chip.appendChild(
          node("span", "lb__volume-no", "卷" + num(item.__volume, 0) + (done ? " ✓" : ""))
        );
        chip.appendChild(
          node("span", "lb__volume-meta", t("localChapterCount").replace("{n}", String(num(item.chapterCount, 0))))
        );
        if (item.id === localLibrary.currentId) chip.classList.add("lb__volume--current");
        markLocalAction(chip, { kind: "book", id: item.id });
        volumes.appendChild(chip);
      });
      info.appendChild(volumes);
    });

    // ── 浏览记录（按索引显示，正文没加载也能列出来）
    var recentBooks = localLibrary.recent
      .filter(function (entry) {
        return entry && (indexById(entry.id) || seriesGroupById(entry.id));
      })
      // 同一个系列只留最近一次，免得三条记录全是同一部书的不同卷
      .filter(function (entry, position, array) {
        var group = seriesGroupById(entry.id);
        if (!group) return true;
        return (
          array.findIndex(function (other) {
            return seriesGroupById(other.id) === group;
          }) === position
        );
      });
    if (recentBooks.length > 1) {
      info.appendChild(node("div", "lb__section", t("localRecent")));
      recentBooks.slice(0, 5).forEach(function (entry) {
        var group = seriesGroupById(entry.id);
        var single = group ? null : indexById(entry.id);
        var label = group ? group.base : single.name;
        var total = group
          ? group.volumes.reduce(function (sum, item) {
              return sum + num(item.chapterCount, 0);
            }, 0)
          : num(single.chapterCount, 0);
        var row = node("button", "lb__recent");
        row.type = "button";
        row.title = label;
        row.appendChild(node("span", "lb__recent-name", label));
        row.appendChild(
          node(
            "span",
            "lb__recent-chapter",
            t("localChapterOf")
              .replace("{n}", String(num(entry.chapter, 0) + 1))
              .replace("{m}", String(total))
          )
        );
        markLocalAction(row, {
          kind: "recent",
          id: group ? group.seriesId : single.id,
          chapter: num(entry.chapter, 0)
        });
        info.appendChild(row);
      });
    }

    // ── 当前书的目录（需要正文已加载；没加载就先拉回来）
    var book = currentLocalBook();
    if (!book) {
      var currentIndex = indexById(localLibrary.currentId);
      if (!currentIndex) return;
      info.appendChild(node("div", "lb__section", t("localToc")));
      info.appendChild(
        node("p", "lb__empty", t("localTapToLoad").replace("{n}", String(currentIndex.chapterCount || 0)))
      );
      // 静默预取，这样点一下目录就能立刻出章节。
      loadBookText(currentIndex.id).then(function (loaded) {
        if (loaded) renderLocalBookPanel();
      });
      return;
    }
    var facts = node("div", "lb__facts");
    if (book.merged) {
      var loadedVolumes = book.volumes.filter(function (volume) {
        return volume.loaded;
      }).length;
      facts.textContent = [
        t("localVolumeCount").replace("{n}", String(book.volumes.length)),
        t("localChapterCount").replace("{n}", String(book.chapters.length)),
        t("localVolumeLoaded")
          .replace("{done}", String(loadedVolumes))
          .replace("{all}", String(book.volumes.length))
      ].join(" · ");
    } else {
      facts.textContent = [
        t("localChapterCount").replace("{n}", String(book.chapters.length)),
        t("localChars").replace("{n}", formatNumber(book.chars))
      ]
        .concat(book.encoding && book.encoding !== "utf-8" ? [book.encoding] : [])
        .join(" · ");
    }
    info.appendChild(node("div", "lb__section", t("localToc")));
    info.appendChild(facts);
    // 合订本但还没把各卷正文都取回来时，目录是残缺的：说清楚，别让人以为章节丢了。
    if (book.merged && book.partial) {
      var loadAll = node("button", "lb__loadall", t("localLoadAllVolumes"));
      loadAll.type = "button";
      markLocalAction(loadAll, { kind: "loadall", id: book.id, count: book.volumes.length });
      info.appendChild(loadAll);
    }

    var tab = activeTab();
    var current =
      tab && tab.mode === "local" && tab.payload && tab.payload.localBook && tab.payload.localBook.id === book.id
        ? tab.payload.localBook.index
        : readLocalProgress(book.id);
    setupVirtualToc(list, book, current);
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 目录虚拟滚动
   *
   * 一本合订本能有两千多章。全量渲染 = 两千多个 <li>（每个里面还有 <button>
   * 和两个 <span>），打开目录要几百毫秒，滚动也发涩。
   *
   * 做法：只渲染"可视窗口 + 上下各几行余量"，用上下两条占位 <li> 撑出总高度。
   *   · 行高固定（标题 nowrap + 单行），所以能直接用前缀和算偏移；
   *   · 卷首那行原来多了 margin+border+padding，会破坏等高——虚拟模式下改成
   *     等高的变体（`.lb__item--volume-start--flat`），视觉上仍有虚线分隔；
   *   · scrollTop → 二分查找起始下标，滚动时只重建视窗内的几十个节点。
   * ═══════════════════════════════════════════════════════════════════════ */
  var localToc = {
    bookId: "",
    current: 0,
    rowHeight: 0,
    volumeExtra: 0,
    offsets: null,
    count: 0,
    start: -1,
    end: -1,
    frame: 0
  };
  /* 少于这个数就不折腾了：一次渲染几十上百行本来就快，虚拟化反而容易出 bug。 */
  var TOC_VIRTUAL_THRESHOLD = 300;
  var TOC_OVERSCAN = 8;

  /** 量一次行高（含卷首行的额外高度），之后都用它算偏移。 */
  function measureTocRows(list) {
    var probe = node("li", "lb__item");
    var button = node("button", "lb__link");
    button.type = "button";
    button.appendChild(node("span", "lb__no", "0000"));
    button.appendChild(node("span", "lb__title", "测量行"));
    probe.appendChild(button);
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    list.appendChild(probe);
    // 用 getBoundingClientRect() 取**小数**行高：offsetHeight 会取整，
    // 673 行 × 0.95px 的误差累积下来接近 30px，滚到后面就会跳一下。
    var base = probe.getBoundingClientRect().height || probe.offsetHeight || 30;
    probe.classList.add("lb__item--volume-start");
    var extra = Math.max(0, (probe.getBoundingClientRect().height || base) - base);
    list.removeChild(probe);
    return { rowHeight: base, volumeExtra: extra };
  }

  function setupVirtualToc(list, book, current) {
    var count = book.chapters.length;
    localToc.bookId = book.id;
    localToc.current = clamp(num(current, 0), 0, Math.max(0, count - 1));
    localToc.count = count;
    localToc.start = -1;
    localToc.end = -1;

    // 小书直接全量渲染：简单、不会出视窗错位。
    if (count <= TOC_VIRTUAL_THRESHOLD) {
      localToc.offsets = null;
      renderTocRange(list, book, 0, count);
      var activeSmall = list.querySelector(".lb__item--current");
      if (activeSmall && typeof activeSmall.scrollIntoView === "function") {
        activeSmall.scrollIntoView({ block: "center" });
      }
      return;
    }

    var measured = measureTocRows(list);
    localToc.rowHeight = measured.rowHeight;
    localToc.volumeExtra = measured.volumeExtra;

    // 前缀和：offsets[i] = 第 i 行距列表顶部的偏移，offsets[count] = 总高。
    var offsets = new Float64Array(count + 1);
    for (var i = 0; i < count; i += 1) {
      var extra = 0;
      if (book.merged && i > 0 && book.chapters[i].volumeIndex !== book.chapters[i - 1].volumeIndex) {
        extra = localToc.volumeExtra;
      }
      offsets[i + 1] = offsets[i] + localToc.rowHeight + extra;
    }
    localToc.offsets = offsets;

    if (!list.__tocScrollBound) {
      list.__tocScrollBound = true;
      list.addEventListener("scroll", function () {
        // 滚动事件很密，用 rAF 合并；一次滚动最多重建一帧。
        if (localToc.frame) return;
        localToc.frame = requestAnimationFrame(function () {
          localToc.frame = 0;
          refreshVirtualToc();
        });
      });
    }

    // 先按当前滚动位置铺一次，再把当前章滚到中间。
    refreshVirtualToc(true);
    var target = Math.max(0, offsets[localToc.current] - list.clientHeight / 2 + localToc.rowHeight);
    list.scrollTop = target;
    refreshVirtualToc(true);
  }

  /** 用当前 scrollTop 决定该渲染哪一段。force=true 时无视缓存。 */
  function refreshVirtualToc(force) {
    var list = el.localChapterList;
    if (!list || !localToc.offsets || !localToc.count) return;
    var book = currentLocalBook();
    if (!book || book.id !== localToc.bookId) return;

    var height = list.clientHeight || 0;
    if (height <= 0) return; // 面板还没显示，等切过来再铺
    var rowHeight = localToc.rowHeight || 30;
    var visible = Math.ceil(height / rowHeight) + 1;
    var first = findTocIndex(list.scrollTop);
    var start = Math.max(0, first - TOC_OVERSCAN);
    var end = Math.min(localToc.count, first + visible + TOC_OVERSCAN);
    if (!force && start === localToc.start && end === localToc.end) return;
    localToc.start = start;
    localToc.end = end;
    renderTocRange(list, book, start, end);
  }

  /** scrollTop → 下标（二分查找前缀和）。 */
  function findTocIndex(scrollTop) {
    var offsets = localToc.offsets;
    if (!offsets) return 0;
    var low = 0;
    var high = localToc.count - 1;
    while (low < high) {
      var mid = (low + high + 1) >> 1;
      if (offsets[mid] <= scrollTop) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  /** 渲染 [start, end) 这几行，并用上下占位条补齐总高度。 */
  function renderTocRange(list, book, start, end) {
    clear(list);
    var current = localToc.current;
    var offsets = localToc.offsets;
    var stack = document.createDocumentFragment();

    if (offsets && start > 0) {
      var top = node("li", "lb__spacer");
      top.setAttribute("aria-hidden", "true");
      top.style.height = Math.round(offsets[start]) + "px";
      stack.appendChild(top);
    }

    for (var index = start; index < end; index += 1) {
      var chapter = book.chapters[index];
      var item = node("li", "lb__item" + (index === current ? " lb__item--current" : ""));
      var button = node("button", "lb__link");
      button.type = "button";
      button.appendChild(node("span", "lb__no", String(index + 1)));
      var titleNode = node("span", "lb__title", chapter.title);
      // 只有标题、几乎没有正文的行（卷标记）标出来，免得点进去以为文件坏了。
      if (isSparseChapter(book, index)) titleNode.classList.add("lb__title--sparse");
      button.appendChild(titleNode);
      // 合订本在卷与卷的交界处插一条分隔，否则章号看着像跳了。
      if (book.merged && index > 0 && chapter.volumeIndex !== book.chapters[index - 1].volumeIndex) {
        var volumeInfo = book.volumes[chapter.volumeIndex];
        // 虚拟模式下行高必须一致，所以用"等高变体"：分隔线照旧，但不额外撑高。
        item.classList.add(offsets ? "lb__item--volume-start--flat" : "lb__item--volume-start");
        button.insertBefore(
          node("span", "lb__volume-divider", "卷" + num(volumeInfo && volumeInfo.volume, 0)),
          button.firstChild
        );
      }
      markLocalAction(button, { kind: "chapter", index: index });
      item.appendChild(button);
      stack.appendChild(item);
    }

    if (offsets && end < localToc.count) {
      var bottom = node("li", "lb__spacer");
      bottom.setAttribute("aria-hidden", "true");
      bottom.style.height = Math.round(offsets[localToc.count] - offsets[end]) + "px";
      stack.appendChild(bottom);
    }
    list.appendChild(stack);
  }

  /**
   * 侧栏「本地小说」面板：所有点击都走事件委托（见 wiring 里的 wireLocalPanelActions）。
   *
   * 为什么用委托而不是给每个条目挂监听：
   *   * 目录可能有几千条，一次重绘就是几千个监听器；
   *   * 点一下就会重绘，旧节点的监听器随之丢失——一旦重绘时机不对，
   *     点击就会**静默失效**，这正是"点了毫无反应"。
   * 委托只挂在容器上，重绘完全不影响它。
   */
  function readLocalAction(event) {
    var target = event && event.target;
    while (target && target !== document) {
      if (target.getAttribute && target.getAttribute("data-local-action")) {
        var raw = target.getAttribute("data-local-action");
        try {
          return JSON.parse(raw);
        } catch (error) {
          return null;
        }
      }
      target = target.parentNode;
    }
    return null;
  }

  function runLocalAction(action) {
    if (!action || !action.kind) return;
    if (action.kind === "chapter") {
      // 用户明确点了这一章，就照他点的来（哪怕是只有标题的卷标记行）。
      openLocalChapter(num(action.index, 0), { exact: true });
      return;
    }
    if (action.kind === "book") {
      var saved = readLocalProgress(action.id);
      openLocalChapter(saved >= 0 ? saved : 0, { bookId: action.id });
      return;
    }
    if (action.kind === "series") {
      var seriesSaved = readLocalProgress(action.id);
      if (seriesSaved >= 0) {
        openLocalChapter(seriesSaved, { bookId: action.id });
        return;
      }
      // 没读过就从第一卷第一章开始。
      var group = seriesGroupById(action.id);
      if (group && group.volumes.length) {
        var first = group.volumes[0];
        var firstSaved = readLocalProgress(first.id);
        openLocalChapter(firstSaved >= 0 ? firstSaved : 0, { bookId: first.id });
      }
      return;
    }
    if (action.kind === "recent") {
      openLocalChapter(num(action.chapter, 0), { bookId: action.id });
      return;
    }
    if (action.kind === "remove") {
      removeLocalBook(action.id);
      return;
    }
    if (action.kind === "loadall") {
      showStatusNotice(t("localLoadingSeries").replace("{n}", String(num(action.count, 0))));
      ensureSeriesLoaded(action.id).then(function (loadedCount) {
        if (loadedCount < num(action.count, 0)) {
          showStatusNotice(t("localSeriesPartial").replace("{n}", String(num(action.count, 0) - loadedCount)));
        }
        renderLocalBookPanel();
      });
    }
  }

  /** 给一个元素打上"点击时做什么"的标记，由 wireLocalPanelActions 统一处理。 */
  function markLocalAction(element, action) {
    element.setAttribute("data-local-action", JSON.stringify(action));
    return element;
  }

  /**
   * 把委托监听挂到面板的两个容器上（只挂一次）。
   *
   * 容器不会随重绘被替换，所以监听永远有效；面板里几千个条目一个监听器都不用挂。
   */
  function wireLocalPanelActions() {
    function onPanelClick(event) {
      var action = readLocalAction(event);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        runLocalAction(action);
      } catch (error) {
        // 点了没反应是最难查的故障：一律把原因说出来，不要静默。
        if (typeof console !== "undefined" && console.error) {
          console.error("[dbx-webview] 本地小说操作失败", error);
        }
        showStatusNotice(
          t("localActionFailed").replace("{reason}", (error && error.message) || String(error))
        );
      }
    }
    if (el.localBookInfo) el.localBookInfo.addEventListener("click", onPanelClick);
    if (el.localChapterList) el.localChapterList.addEventListener("click", onPanelClick);
  }

  /** 从书架移除一本。 */
  function removeLocalBook(id) {
    // 传系列 id 时把整个系列都移除。
    if (String(id).indexOf("series:") === 0) {
      var group = seriesGroupById(id);
      if (!group) return;
      group.volumes.forEach(function (entry) {
        removeOneBook(entry.id);
      });
      return;
    }
    removeOneBook(id);
  }

  function removeOneBook(id) {
    localLibrary.books = localLibrary.books.filter(function (book) {
      return book.id !== id;
    });
    localLibrary.recent = localLibrary.recent.filter(function (entry) {
      return entry && entry.id !== id;
    });
    if (localLibrary.currentId === id) {
      localLibrary.currentId = localLibrary.books.length ? localLibrary.books[0].id : "";
    }
    delete progress.map[localProgressKey(id)];
    delete bookCache[id];
    // 磁盘上的原文也一起删掉，否则会一直占着空间。
    deleteBookEverywhere(id);
    persistLocalLibrary();
    queuePersist();
    renderLocalBookPanel();
    var tab = activeTab();
    if (tab && tab.mode === "local" && tab.localBookId === id) {
      // 正在读的那本被删了：有别的书就换过去，没有就回空状态。
      if (localLibrary.books.length) {
        openLocalChapter(readLocalProgress(localLibrary.currentId) >= 0 ? readLocalProgress(localLibrary.currentId) : 0);
      } else {
        tab.payload = null;
        tab.localBookId = "";
        tab.mode = "reader";
        tab.title = t("localBook");
        renderTabs();
        renderEmpty(tab);
      }
    }
  }

  /* ── 状态自检 ────────────────────────────────────────────────────────────
   *
   * 装完之后"到底通没通"要能一眼看出来。这几项正好是出错时最需要知道的：
   *   * 宿主存储有没有授权 —— 没授权，书架和阅读位置都不会保存（会静默丢失）；
   *   * 书架索引有多大 —— 逼近 256 KiB/条 的上限就得提醒；
   *   * 原文在不在磁盘上 —— 索引有、文件没了，就是"点开提示正文不在"；
   *   * 字库读没读出来；
   *   * 后端通不通。
   */
  function collectDiagnostics() {
    var rows = [];
    var storageOk = !!(store && store.available);
    rows.push({
      ok: storageOk,
      label: t("diagStorage"),
      value: storageOk
        ? t("diagStorageOk")
        : t("diagStorageMissing"),
      hint: storageOk ? "" : t("diagStorageHint")
    });

    // 索引体积：宿主限制单值 256 KiB，逼近就该提醒。
    var indexPathSize = 0;
    try {
      indexPathSize = JSON.stringify({
        books: localLibrary.books,
        currentId: localLibrary.currentId,
        recent: localLibrary.recent
      }).length;
    } catch (error) {
      indexPathSize = -1;
    }
    var indexLimit = 256 * 1024;
    rows.push({
      ok: indexPathSize >= 0 && indexPathSize < indexLimit * 0.8,
      label: t("diagIndex"),
      value: t("diagIndexValue")
        .replace("{n}", String(localLibrary.books.length))
        .replace("{kb}", (Math.max(0, indexPathSize) / 1024).toFixed(1)),
      hint: indexPathSize >= indexLimit * 0.8 ? t("diagIndexNearLimit") : ""
    });

    // 原文：问后端要一份清单，和索引对账。
    var listed = invoke("webview/listBooks", {}, 15000).then(
      function (result) {
        var books = (result && result.books) || [];
        var bytes = books.reduce(function (sum, item) {
          return sum + num(item.bytes, 0);
        }, 0);
        // 索引里记着 N 本，但磁盘上只有 M 个文件：差额就是"丢了原文"的那些。
        var missing = Math.max(0, localLibrary.books.length - books.length);
        return {
          ok: missing === 0,
          label: t("diagFiles"),
          value: t("diagFilesValue")
            .replace("{n}", String(books.length))
            .replace("{mb}", (bytes / 1024 / 1024).toFixed(1)),
          // 目录用后端实际使用的那一个（dev 与正式宿主不是同一个目录，
          // 以前面板显示的是猜的路径，排查时会被带偏）。
          hint: missing > 0
            ? t("diagFilesMissing").replace("{n}", String(missing)) + " · " + ((result && result.dir) || "")
            : (result && result.dir) || ""
        };
      },
      function () {
        return {
          ok: false,
          label: t("diagFiles"),
          value: t("diagBackendDown"),
          hint: t("diagBackendDownHint")
        };
      }
    );

    // 字库
    rows.push({
      ok: tradToSimp.available,
      label: t("diagTrad"),
      value: tradToSimp.available
        ? t("diagTradValue")
            .replace("{c}", String(Object.keys(trad2Simp.api.chars).length))
            .replace("{p}", String(Object.keys(trad2Simp.api.phrases).length))
        : TRAD2SIMP_FALLBACK_TEXT,
      hint: ""
    });

    // 站点预设
    rows.push({
      ok: state.presets.length > 0,
      label: t("diagPresets"),
      value: state.presets.length ? t("diagPresetsValue").replace("{n}", String(state.presets.length)) : t("diagBackendDown"),
      hint: ""
    });

    return listed.then(function (fileRow) {
      rows.splice(2, 0, fileRow);
      return rows;
    });
  }

  function renderDiagnostics() {
    var list = el.diagList;
    if (!list) return;
    clear(list);
    list.appendChild(node("li", "diag__row diag__row--pending", t("diagChecking")));
    collectDiagnostics().then(function (rows) {
      // 面板可能在异步期间被关掉或重画，这里重新取一次容器。
      var host = el.diagList;
      if (!host) return;
      clear(host);
      rows.forEach(function (row) {
        var item = node("li", "diag__row" + (row.ok ? " diag__row--ok" : " diag__row--bad"));
        item.appendChild(node("span", "diag__mark", row.ok ? "✓" : "!"));
        var body = node("div", "diag__body");
        body.appendChild(node("span", "diag__label", row.label));
        body.appendChild(node("span", "diag__value", row.value));
        if (row.hint) body.appendChild(node("span", "diag__hint", row.hint));
        item.appendChild(body);
        host.appendChild(item);
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 9. Status bar
   * ═══════════════════════════════════════════════════════════════════════ */
  var noticeTimer = null;
  /* 顶部警告条（「已合并 N 个分页」这类）看 3 秒就够，自动收掉。 */
  var WARNING_AUTO_CLOSE_MS = 3000;
  var warningTimer = null;

  function setStatus(info) {
    var data = info || {};
    var mode = data.mode || "empty";
    if (el.statusSpinner) el.statusSpinner.hidden = mode !== "loading";
    if (el.statusState) {
      el.statusState.classList.toggle("st__state--error", mode === "error");
      setText(
        el.statusState,
        mode === "loading"
          ? t("statusLoading")
          : mode === "error"
            ? t("statusError")
            : mode === "loaded"
              ? t("statusLoaded")
              : mode === "live"
                ? t("liveBadge")
                : mode === "empty"
                  ? t("statusEmpty")
                  : t("statusReady")
      );
    }
    if (el.statusHttp) {
      var status = num(data.status, 0);
      el.statusHttp.hidden = !status;
      el.statusHttp.className = "badge" + (status >= 200 && status < 400 ? "" : " badge--error");
      setText(el.statusHttp, status ? "HTTP " + status : "");
    }
    if (el.statusPreset) {
      el.statusPreset.hidden = !data.preset;
      setText(el.statusPreset, data.preset || "");
    }
    if (el.statusSep1) el.statusSep1.hidden = !(num(data.status, 0) || data.preset);
    if (el.statusUrl) {
      setText(el.statusUrl, data.url || "");
      el.statusUrl.title = data.url || "";
    }
    if (el.statusMeta) {
      var parts = [];
      if (typeof data.bytes === "number" && data.bytes > 0) parts.push(formatBytes(data.bytes));
      if (typeof data.elapsedMs === "number" && data.elapsedMs > 0) parts.push(formatElapsed(data.elapsedMs));
      if (data.truncated) parts.push(t("truncated"));
      if (typeof data.chars === "number" && data.chars > 0) parts.push(data.chars + " chars");
      setText(el.statusMeta, parts.join(" · "));
    }
    if (el.statusNotice) {
      el.statusNotice.hidden = !data.notice;
      setText(el.statusNotice, data.notice || "");
    }
  }

  function showStatusNotice(text) {
    if (!el.statusNotice) return;
    setText(el.statusNotice, text);
    el.statusNotice.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    // 三秒足够看清；要留在屏幕上的信息不该走这里（比如"这站要登录"的提示条）。
    noticeTimer = setTimeout(function () {
      noticeTimer = null;
      if (el.statusNotice) el.statusNotice.hidden = true;
    }, 3000);
  }

  function loadingStatus(tab) {
    setStatus({ mode: "loading", url: tab.url, preset: presetNameOf(tab.presetId) || "" });
  }

  function readyStatus(tab) {
    var payload = tab.payload;
    if (!payload) {
      setStatus({ mode: "empty", url: tab.url });
      return;
    }
    setStatus({
      mode: "loaded",
      url: payload.url || tab.url,
      status: payload.status,
      bytes: payload.bytes,
      elapsedMs: payload.elapsedMs,
      truncated: payload.truncated,
      chars: payload.textLength,
      preset: payload.presetName || presetNameOf(payload.presetId)
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 10. Errors
   * ═══════════════════════════════════════════════════════════════════════ */
  function humanError(error) {
    var raw = "";
    if (error && typeof error.message === "string") raw = error.message;
    else if (typeof error === "string") raw = error;
    var text = raw.trim();
    if (text === "") return t("errGeneric");

    // 按 HTTP 状态分类：每种情况的处置方式完全不同，笼统一句"失败"没有帮助。
    if (/\b403\b/.test(text)) return t("err403") + " · " + text;
    if (/\b404\b/.test(text)) return t("err404") + " · " + text;
    if (/\b429\b/.test(text)) return t("err429") + " · " + text;
    if (/\b5\d\d\b/.test(text)) return t("err5xx") + " · " + text;

    var lower = text.toLowerCase();
    if (lower.indexOf("timeout") !== -1 || text.indexOf("超时") !== -1) return t("errTimeout") + " · " + text;
    if (lower.indexOf("dns") !== -1 || lower.indexOf("resolve") !== -1 || text.indexOf("解析") !== -1) {
      return t("errUnknownHost") + " · " + text;
    }
    if (text.indexOf("无法连接") !== -1 || lower.indexOf("connect") !== -1) {
      return t("errConnect") + " · " + text;
    }
    if (lower.indexOf("unsupported") !== -1 || text.indexOf("不支持") !== -1 || lower.indexOf("scheme") !== -1) {
      return t("errEmpty") + " · " + text;
    }
    if (lower.indexOf("preset") !== -1 || text.indexOf("预设") !== -1) return t("errNoPreset") + " · " + text;
    return text;
  }

  function renderError(tab) {
    var host = el.pageHost;
    if (!host) return;
    clear(host);
    if (tab) tab.warnings = [];
    setWarnings(tab, []);
    renderTabs();
    var wrap = node("div", "error");
    wrap.appendChild(node("div", "error__icon", "⚠"));
    wrap.appendChild(node("h2", "error__title", t("errorTitle")));
    wrap.appendChild(node("p", "error__msg", tab.error || t("errGeneric")));
    wrap.appendChild(node("p", "error__hint", t("emptyText")));
    if (tab.url) wrap.appendChild(node("div", "error__url", tab.url));
    var actions = node("div", "error__actions");
    var retry = node("button", "btn btn--primary", t("retry"));
    retry.type = "button";
    retry.addEventListener("click", function () {
      loadTab(tab, { push: false });
    });
    var source = node("button", "btn btn--ghost", t("viewSource"));
    source.type = "button";
    source.addEventListener("click", function () {
      if (!tab.url) return;
      tab.mode = "source";
      syncToolbar();
      loadTab(tab, { push: false });
    });
    actions.appendChild(retry);
    actions.appendChild(source);
    wrap.appendChild(actions);
    host.appendChild(wrap);
    setStatus({ mode: "error", url: tab.url, preset: presetNameOf(tab.presetId) || "" });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 11. Empty / loading states
   * ═══════════════════════════════════════════════════════════════════════ */
  function renderEmpty(tab) {
    var host = el.pageHost;
    if (!host) return;
    clear(host);
    setWarnings(tab, []);
    var wrap = node("div", "empty");
    wrap.appendChild(node("div", "empty__mark", "◎"));
    wrap.appendChild(node("h1", "empty__title", t("emptyTitle")));
    wrap.appendChild(node("p", "empty__text", t("emptyText")));
    wrap.appendChild(node("p", "empty__text empty__text--hint", t("emptyTextDetail")));

    var label = node("p", "empty__label", t("examplesLabel"));
    wrap.appendChild(label);
    var chips = node("div", "examples");
    EXAMPLES.forEach(function (example) {
      var chip = node("button", "example");
      chip.type = "button";
      chip.title = example.url;
      chip.appendChild(node("span", "example__name", example.name[locale] || example.name["zh-CN"]));
      chip.appendChild(node("span", "example__url", example.url));
      chip.addEventListener("click", function () {
        navigate(tab, example.url, { push: true });
      });
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);
    host.appendChild(wrap);

    if (tab && tab.notice) showStatusNotice(tab.notice);
    else setStatus({ mode: "empty", url: tab ? tab.url : "" });
  }

  function renderLoading(tab) {
    var host = el.pageHost;
    if (!host) return;
    clear(host);
    setWarnings(tab, []);
    var wrap = node("div", "loading");
    var bar = node("div", "loading__bar");
    wrap.appendChild(bar);
    wrap.appendChild(node("div", "loading__text", t("loading") + "…"));
    wrap.appendChild(node("div", "loading__url", tab.url || ""));
    host.appendChild(wrap);
    loadingStatus(tab);
  }

  /* Sidecar warnings (`payload.warnings`) as a thin dismissible bar. */
  function setWarnings(tab, warnings) {
    if (tab) tab.warnings = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
    var bar = el.noticeBar;    if (!bar) return;
    // 每次重画都重置计时器，避免上一次的定时器把新内容提前收掉。
    if (warningTimer) {
      clearTimeout(warningTimer);
      warningTimer = null;
    }
    clear(bar);
    var list = tab && Array.isArray(tab.warnings) ? tab.warnings : [];
    if (!list.length) {
      bar.hidden = true;
      return;
    }
    list.slice(0, 3).forEach(function (warning, index) {
      var row = node("div", "notice-bar__row");
      row.appendChild(node("span", "notice-bar__mark", "⚠"));
      row.appendChild(node("span", "notice-bar__text", String(warning)));
      if (index === 0) {
        var close = node("button", "notice-bar__x", "✕");
        close.type = "button";
        close.title = t("dismiss");
        close.setAttribute("aria-label", t("dismiss"));
        close.addEventListener("click", function () {
          setWarnings(tab, []);
        });
        row.appendChild(close);
      }
      bar.appendChild(row);
    });
    if (list.length > 3) {
      var more = node("div", "notice-bar__row");
      more.appendChild(node("span", "notice-bar__mark", "·"));
      more.appendChild(node("span", "notice-bar__text", t("warnMore").replace("{n}", String(list.length - 3))));
      bar.appendChild(more);
    }
    bar.hidden = false;
    // 提示看一眼就够，3 秒后自动收掉，不占着正文位置（✕ 仍可立刻关掉）。
    warningTimer = setTimeout(function () {
      warningTimer = null;
      bar.hidden = true;
    }, WARNING_AUTO_CLOSE_MS);
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 预取下一章 + 阅读位置记忆
   * ═══════════════════════════════════════════════════════════════════════ */

  /* 读完当前页就顺手把「下一章」抓回来，点翻页时秒开。
     只保留最近一条，避免把内存变成无底洞。 */
  var prefetch = { url: "", payload: null, inFlight: "" };

  function prefetchSignature(url, params) {
    return url + "|" + (params.mode || "reader") + "|" + (params.presetId || "") + "|" +
      (params.options && params.options.mergePages === false ? "nom" : "m");
  }

  function takePrefetched(url, params) {
    if (!prefetch.payload) return null;
    if (prefetch.url !== prefetchSignature(url, params)) return null;
    var payload = prefetch.payload;
    prefetch.payload = null;
    prefetch.url = "";
    return payload;
  }

  function prefetchNext(tab) {
    var payload = tab && tab.payload;
    if (!payload || !payload.nextUrl) return;
    // 翻页目标就是站点分页时的下一页时不必预取：合并分页已经把正文读完了。
    if (payload.mergedPages > 0) return;
    var signature = prefetchSignature(payload.nextUrl, {
      mode: tab.mode || "reader",
      presetId: tab.presetId || "",
      options: { mergePages: disguise.mergePages !== false }
    });
    if (prefetch.url === signature || prefetch.inFlight === signature) return;
    prefetch.inFlight = signature;
    invoke(
      "webview/render",
      {
        url: payload.nextUrl,
        mode: tab.mode || "reader",
        presetId: tab.presetId || undefined,
        options: { mergePages: disguise.mergePages !== false }
      },
      RENDER_TIMEOUT_MS
    ).then(
      function (raw) {
        if (prefetch.inFlight !== signature) return;
        prefetch.inFlight = "";
        prefetch.url = signature;
        prefetch.payload = raw;
      },
      function () {
        if (prefetch.inFlight === signature) prefetch.inFlight = "";
      }
    );
  }

  /* 按 URL 记住滚动位置，下次打开同一章直接回到原处。 */
  var progress = { map: {}, limit: 300 };

  function progressKey(url) {
    try {
      var parsed = new URL(url);
      return parsed.origin + parsed.pathname;
    } catch (error) {
      return url || "";
    }
  }

  function saveProgress(url, ratio) {
    var key = progressKey(url);
    if (!key) return;
    progress.map[key] = { ratio: Math.max(0, Math.min(1, ratio)), at: Date.now() };
    var keys = Object.keys(progress.map);
    if (keys.length > progress.limit) {
      keys
        .sort(function (a, b) {
          return (progress.map[a].at || 0) - (progress.map[b].at || 0);
        })
        .slice(0, keys.length - progress.limit)
        .forEach(function (stale) {
          delete progress.map[stale];
        });
    }
    queuePersist();
  }

  function loadProgress(raw) {
    if (!raw || typeof raw !== "object") return;
    Object.keys(raw).forEach(function (key) {
      var entry = raw[key];
      if (!entry || typeof entry !== "object") return;
      // 网络页面按滚动百分比恢复；本地书按章号恢复，两种都收下。
      var ratio = typeof entry.ratio === "number" && isFinite(entry.ratio) ? entry.ratio : null;
      var chapter = typeof entry.chapter === "number" && isFinite(entry.chapter) ? entry.chapter : null;
      if (ratio === null && chapter === null) return;
      progress.map[key] = { ratio: ratio === null ? 0 : ratio, chapter: chapter, at: num(entry.at, 0) };
    });
  }

  /* 恢复位置：只是滚动，不重新抓取。 */
  function restoreProgress(tab) {
    var key = progressKey(tab && tab.url);
    var entry = key ? progress.map[key] : null;
    if (!entry || entry.ratio <= 0.02 || !el.contentView) return false;
    var view = el.contentView;
    var target = Math.round((view.scrollHeight - view.clientHeight) * entry.ratio);
    if (target <= 8) return false;
    view.scrollTop = target;
    return true;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 12. Rendering the fetched payload
   * ═══════════════════════════════════════════════════════════════════════ */
  function normalizePayload(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var chapters = Array.isArray(source.chapters)
      ? source.chapters
          .filter(function (item) {
            return item && typeof item.url === "string";
          })
          .map(function (item) {
            return { title: String(item.title || item.url), url: item.url, current: item.current === true };
          })
      : [];
    var images = Array.isArray(source.images)
      ? source.images
          .filter(function (item) {
            return item && typeof item.src === "string";
          })
          .map(function (item) {
            return { src: item.src, alt: String(item.alt || "") };
          })
      : [];
    return {
      ok: source.ok !== false,
      url: typeof source.url === "string" && source.url ? source.url : "",
      title: typeof source.title === "string" ? source.title : "",
      siteName: typeof source.siteName === "string" ? source.siteName : "",
      status: num(source.status, 0),
      mode: typeof source.mode === "string" ? source.mode : "",
      presetId: typeof source.presetId === "string" ? source.presetId : null,
      presetName: typeof source.presetName === "string" ? source.presetName : null,
      /* Typography contributed by the applied site preset; consumed by
         `setPresetStyle` so novel/社交 presets get their own reading defaults. */
      readerStyle: source.readerStyle && typeof source.readerStyle === "object" ? source.readerStyle : null,
      /* True when the server-side HTML carried no readable text at all. */
      jsRequired: source.jsRequired === true,
      /* True when the site returned a login / captcha / rate-limit wall. */
      blocked: source.blocked === true,
      /* True when the page is essentially a wall of navigation links. */
      linkWall: source.linkWall === true,
      linkRatio: num(source.linkRatio, 0),
      /* 该站章节页要登录才给正文（实测确认的大平台）。 */
      needsLogin: source.needsLogin === true,
      /* 这本书的目录页地址，用来给「目录」按钮。 */
      catalogUrl: typeof source.catalogUrl === "string" ? source.catalogUrl : "",
      /* How many extra pagination pages were merged into `html` (0 = none). */
      mergedPages: num(source.mergedPages, 0),
      fullTextLength: num(source.fullTextLength, 0),
      baseHref: typeof source.baseHref === "string" ? source.baseHref : "",
      contentSelector: typeof source.contentSelector === "string" ? source.contentSelector : null,
      readerOk: source.readerOk !== false,
      html: typeof source.html === "string" ? source.html : "",
      textLength: num(source.textLength, 0),
      truncated: source.truncated === true,
      bytes: num(source.bytes, 0),
      elapsedMs: num(source.elapsedMs, 0),
      fetchedAt: typeof source.fetchedAt === "string" ? source.fetchedAt : "",
      nextUrl: typeof source.nextUrl === "string" && source.nextUrl ? source.nextUrl : null,
      prevUrl: typeof source.prevUrl === "string" && source.prevUrl ? source.prevUrl : null,
      /* Book/TOC pages have no "next chapter" but usually offer "start reading". */
      startUrl: typeof source.startUrl === "string" && source.startUrl ? source.startUrl : null,
      chapters: chapters,
      images: images,
      warnings: Array.isArray(source.warnings) ? source.warnings.filter(function (item) {
        return typeof item === "string" && item !== "";
      }) : []
    };
  }

  function renderPage(tab) {
    var host = el.pageHost;
    if (!host) return;
    if (tab.live) {
      showLiveChrome(tab);
      return;
    }
    var payload = tab.payload;
    // 记下这次渲染实际用的 presetId。本地书不走 finishSuccess，若不在这里记，
    // refreshActiveTab 会误判成"预设变了"而重新去抓一个空地址，把正文换成空状态页。
    tab.lastRenderPreset = tab.presetId || "";
    var sourceMode = tab.mode === "source" || payload.mode === "source";
    var scrollView = el.contentView;
    var addressStale = el.addressInput ? document.activeElement !== el.addressInput : false;

    if (scrollView) tab.scrollTop = scrollView.scrollTop || 0;
    var restore = tab.scrollTop || 0;
    clear(host);
    // 链接页要明确告诉用户"这些链接能点"，否则一屏链接会让人以为界面坏了。
    if (payload.linkWall && !sourceMode) {
      payload.warnings = [t("linkWallText")].concat(payload.warnings || []);
    }
    setWarnings(tab, payload.warnings);

    // 该站章节页要登录才给正文：直接给出「用浏览器打开」这一步，别让用户猜。
    // 这条**不自动消失**——它带着一个可点的下一步，消失了用户就没法操作了。
    tab.prompt = payload.needsLogin && !sourceMode
      ? { text: t("needsLoginNotice"), label: t("needsLoginAction"), run: openInRealBrowser }
      : null;

    var wrapper = node("div", "page-scroll");
    // 顶部提示条只留给"需要用户动手"的提示；其余提示统一走状态栏，3 秒自动收掉。
    if (tab.prompt) wrapper.appendChild(buildNotice(tab));
    if (!sourceMode && payload.chapters.length) wrapper.appendChild(buildChapterBar(tab, payload));

    var doc = node("div", "doc");
    // 本地书里那些"分卷标记行"（只有书名/卷名、没有正文）：
    // 不拦、不报错，但必须说清楚"这里本来就没内容，下一章在哪"，
    // 否则一片空白页看起来就是"点了没反应"。
    if (!sourceMode && payload.localBook && payload.localBook.sparse) {
      doc.appendChild(buildSparseCard(payload));
    }
    // 被登录墙 / 人机校验挡住时才用卡片说明原因。
    //
    // 首页 / 频道页 / 列表页（链接墙）**不再拦下来**：这些页面的价值就在链接本身，
    // 用户需要顺着它们点进章节或目录。所以照常渲染，只是在提示栏里说明一句
    // 「这一页以导航链接为主」，并给链接页一点基础样式，免得看着像界面坏了。
    //
    // **本地书不走这套判断**：那条"正文太短 = 被站点拦了"的启发式只对**抓来的网页**
    // 成立。本地 txt 里"第一卷 《凡尘神域》"这种只有几个字的卷标题是正常结构，
    // 以前会因此弹一张"这个页面被站点拦截了"的卡片（既吓人又不对）。
    var walled =
      !sourceMode && !payload.localBook && (payload.blocked || (!payload.jsRequired && payload.textLength < 60));
    if (walled) {
      doc.appendChild(buildBlockedCard(tab, payload));
    }
    doc.appendChild(buildDocHead(tab, payload));
    var content = node("div", "page-content");
    if (sourceMode) content.classList.add("page-content--source");
    // 链接墙：加上标记类，给它一套"导航列表"的排版，并提示可以点进去。
    if (payload.linkWall && !sourceMode) content.classList.add("page-content--links");
    content.innerHTML = payload.html;
    // 结构性防线：正文里的每个外链都标成 `target=_blank`。
    // 沙箱 iframe 没有 allow-popups，所以**默认点击会被浏览器拦掉**——
    // 即使链接守卫漏了一个，也只会"点了没反应"，绝不会把插件界面导航走。
    // 正常的点击由 wireLinkGuard 的捕获阶段处理（preventDefault + 自己 navigate）。
    Array.prototype.forEach.call(content.querySelectorAll("a[href]"), function (anchor) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noreferrer noopener");
    });
    // 繁体源的小说很多：按开关把正文转成简体（只动文本节点）。
    convertContentToSimplified(content);
    if (!sourceMode) dedupeLeadingTitle(content, payload.title);

    if (!sourceMode) {
      var headings = collectHeadings(content);
      var toc = buildToc(headings);
      if (toc) doc.appendChild(toc);
    }

    doc.appendChild(content);
    wrapper.appendChild(doc);

    if (sourceMode) {
      var sourceNotice = node("div", "notice");
      sourceNotice.appendChild(node("span", null, t("sourceNotice")));
      wrapper.appendChild(sourceNotice);
    } else if (payload.images.length) {
      wrapper.appendChild(buildGallery(payload.images));
    }

    wrapper.appendChild(buildChapterNav(tab, payload));
    host.appendChild(wrapper);

    var token = (renderSeq[tab.id] || 0) + 1;
    renderSeq[tab.id] = token;
    posSeq[tab.id] = token;
    // The preset for this page decides the base typography (novel presets ship
    // 楷体/大字号 etc.); explicit user settings still override it.
    setPresetStyle(payload);
    applyReaderStyle(content);
    attachBrokenImageHandler();
    bindRemoteImages(el.pageHost);
    renderTabs();
    readyStatus(tab);
    if (tab.notice) showStatusNotice(tab.notice);

    requestAnimationFrame(function () {
      if (posSeq[tab.id] !== token) return;
      if (el.contentView) el.contentView.scrollTop = restore;
      // 第一次渲染这个地址时，回到上次读到的地方。
      if (restore <= 0 && restoreProgress(tab)) {
        showStatusNotice(t("resumed"));
      }
    });
    // 本地书的进度按"书 id + 章号"记，比滚动百分比更有意义。
    if (tab && tab.localBookId && tab.payload && tab.payload.localBook) {
      saveLocalProgress(tab.localBookId, tab.payload.localBook.index);
    }
    queuePersist();
    // 读完这一页就顺手把下一章抓回来。
    prefetchNext(tab);
  }

  /* 访问被挡 / 内容为空时的说明卡片。链接页不走这里——那种页面是要点进去用的。 */
  /**
   * 「这一条只是个卷标记，没有正文」说明卡。
   *
   * 本地 txt 里 `第一卷 《凡尘神域》` 这类行会被分章规则当成分章点（这是对的，
   * 它确实是全书结构的一部分），但它本身没有内容。以前点进去就是一片空白，
   * 用户合理地判断成"点击没反应"。这里把原因说清楚，并给一个直接去下一章的按钮。
   */
  function buildSparseCard(payload) {
    var info = payload.localBook;
    var card = node("div", "blocked blocked--sparse");
    card.appendChild(node("div", "blocked__title", t("sparseTitle")));
    card.appendChild(node("p", "blocked__text", t("sparseText")));
    card.appendChild(
      node(
        "p",
        "blocked__facts",
        t("sparseFacts")
          .replace("{n}", String(info.chars))
          .replace("{at}", String(info.index + 1))
          .replace("{total}", String(info.total))
      )
    );

    var actions = node("div", "blocked__actions");
    if (payload.nextUrl) {
      var next = node("button", "btn btn--primary", t("sparseNext"));
      next.type = "button";
      next.addEventListener("click", function () {
        goLocalChapter(1);
      });
      actions.appendChild(next);
    }
    if (payload.prevUrl) {
      var prev = node("button", "btn", t("sparsePrev"));
      prev.type = "button";
      prev.addEventListener("click", function () {
        goLocalChapter(-1);
      });
      actions.appendChild(prev);
    }
    if (actions.childNodes.length) card.appendChild(actions);
    return card;
  }

  function buildBlockedCard(tab, payload) {
    var card = node("div", "blocked");
    // 两种原因分开说，因为处置方式不同：
    //   1. 站点给了登录墙 / 人机校验  -> 换详情页，或先在浏览器里登录
    //   2. 正文由前端脚本渲染 / 确实没有正文 -> 换详情页，或用整页模式
    var kind = payload.blocked || payload.fullTextLength < 200 ? "blocked" : "empty";
    var TITLES = { blocked: "blockedTitle", empty: "emptyPageTitle" };
    var TEXTS = { blocked: "blockedText", empty: "emptyPageText" };
    card.appendChild(node("div", "blocked__title", t(TITLES[kind])));
    card.appendChild(node("p", "blocked__text", t(TEXTS[kind])));

    var facts = [];
    if (payload.url) facts.push(payload.url);
    if (payload.status) facts.push("HTTP " + payload.status);
    facts.push(t("charsCount").replace("{n}", String(payload.textLength)));
    card.appendChild(node("p", "blocked__facts", facts.join(" · ")));

    var actions = node("div", "blocked__actions");
    var fullMode = node("button", "btn", t("tryFullMode"));
    fullMode.type = "button";
    fullMode.addEventListener("click", function () {
      tab.mode = "full";
      refreshActiveTab(true);
      if (tab.url) loadTab(tab, { push: false });
      syncToolbar();
    });
    actions.appendChild(fullMode);

    if (payload.url) {
      var open = node("button", "btn", t("openInNewTab"));
      open.type = "button";
      open.addEventListener("click", function () {
        // 沙箱里 window.open 不可靠，交给宿主剪贴板 + 一个普通链接更稳。
        if (plugin && typeof plugin.copy === "function") plugin.copy(payload.url);
        var link = node("a", "blocked__link", payload.url);
        link.href = payload.url;
        link.target = "_blank";
        link.rel = "noreferrer noopener";
        link.click();
      });
      actions.appendChild(open);
    }
    card.appendChild(actions);

    var link = node("a", "blocked__link", payload.url || tab.url || "");
    link.href = payload.url || tab.url || "#";
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.title = t("openInNewTab");
    card.appendChild(link);
    return card;
  }

  function buildNotice(tab) {
    var bar = node("div", "notice");
    var prompt = tab.prompt || {};
    bar.appendChild(node("span", "notice__text", prompt.text || ""));
    if (typeof prompt.run === "function") {
      var action = node("button", "notice__action", prompt.label || "");
      action.type = "button";
      action.addEventListener("click", function () {
        var run = prompt.run;
        tab.prompt = null;
        if (bar.parentNode) bar.parentNode.removeChild(bar);
        if (typeof run === "function") run();
      });
      bar.appendChild(action);
    }
    var close = node("button", "notice__x", "✕");
    close.type = "button";
    close.setAttribute("aria-label", t("close"));
    close.addEventListener("click", function () {
      tab.prompt = null;
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    });
    bar.appendChild(close);
    return bar;
  }

  function buildChapterBar(tab, payload) {
    var chapters = payload.chapters || [];
    if (!chapters.length) return node("div", "chapter-bar");
    var bar = node("div", "chapter-bar");
    bar.appendChild(node("span", "chapter-bar__label", t("chapter")));
    var select = node("select", "chapter-bar__select");
    select.setAttribute("aria-label", t("catalogue"));
    chapters.forEach(function (chapter, index) {
      var option = node("option", null, shorten(chapter.title, 90));
      option.value = String(index);
      if (chapter.current) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener("change", function () {
      var index = num(select.value, -1);
      // 本地书：章节目录就是全书目录，切换只换 payload，不走网络。
      if (payload.localBook) {
        openLocalChapter(index);
        return;
      }
      var picked = chapters[index];
      if (picked && picked.url) navigate(tab, picked.url, { push: true });
    });
    bar.appendChild(select);
    return bar;
  }

  function buildChapterNav(tab, payload) {
    var nav = node("div", "chapter-nav");
    var prev = node("button", "btn", "‹ " + t("prevChapter"));
    prev.type = "button";
    prev.disabled = !payload.prevUrl;
    prev.addEventListener("click", function () {
      // 本地书：上一章不请求网络，直接换 payload。
      if (payload.localBook) {
        goLocalChapter(-1);
        return;
      }
      if (payload.prevUrl) navigate(tab, payload.prevUrl, { push: true });
    });
    nav.appendChild(prev);

    // 本地书在中间显示"第 n / 共 m 章"，比"下一章"更有信息量。
    if (payload.localBook) {
      var info = payload.localBook;
      var counterText = t("localChapterOf")
        .replace("{n}", String(info.index + 1))
        .replace("{m}", String(info.total));
      // 多卷合订本再标一下当前在第几卷，跨卷时才知道自己读到哪了。
      if (info.merged && info.volumeCount > 1) {
        counterText += " · " + t("localVolumeAt")
          .replace("{n}", String(info.volumeIndex + 1))
          .replace("{m}", String(info.volumeCount));
      }
      var counter = node("span", "chapter-nav__counter", counterText);
      nav.appendChild(counter);
      var nextLocal = node("button", "btn", "› " + t("nextChapter"));
      nextLocal.type = "button";
      nextLocal.disabled = info.index >= info.total - 1;
      nextLocal.addEventListener("click", function () {
        goLocalChapter(1);
      });
      nav.appendChild(nextLocal);
      return nav;
    }

    // 书籍/目录页没有真正的"下一章"：那里的 next 往往是"完整目录"。
    // 只要页面给了"开始阅读"入口，就把它当成主行动。
    if (payload.startUrl) {
      var start = node("button", "btn btn--primary", t("startReading") + " ›");
      start.type = "button";
      start.addEventListener("click", function () {
        navigate(tab, payload.startUrl, { push: true });
      });
      nav.appendChild(start);
      return nav;
    }

    var next = node("button", "btn", "› " + t("nextChapter"));
    next.type = "button";
    next.disabled = !payload.nextUrl;
    next.addEventListener("click", function () {
      if (payload.nextUrl) navigate(tab, payload.nextUrl, { push: true });
    });    nav.appendChild(next);
    return nav;
  }

  function buildDocHead(tab, payload) {
    var head = node("div", "doc__head");
    if (payload.siteName) head.appendChild(node("div", "doc__site", payload.siteName));
    head.appendChild(node("h1", "doc__title", payload.title || payload.siteName || tab.url || t("untitledTab")));

    var meta = node("div", "doc__meta");
    if (payload.url) {
      var link = node("a", null, shorten(payload.url, 92));
      link.href = payload.url;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.title = payload.url;
      meta.appendChild(link);
      meta.appendChild(node("span", "doc__meta-sep", "·"));
    }
    var stamp = formatTime(payload.fetchedAt);
    if (stamp) meta.appendChild(node("span", null, stamp));
    if (payload.presetName) {
      meta.appendChild(node("span", "doc__meta-sep", "·"));
      meta.appendChild(node("span", null, payload.presetName));
    }
    head.appendChild(meta);
    return head;
  }

  function buildGallery(images) {
    var wrap = node("div", "gallery");
    wrap.appendChild(node("h2", "gallery__title", t("gallery") + " · " + images.length));
    var grid = node("div", "gallery__grid");
    images.forEach(function (image) {
      var figure = node("figure", "gallery__item");
      var img = node("img", "gallery__img");
      img.src = image.src;
      img.alt = image.alt || "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      var caption = node("figcaption", "gallery__cap", image.alt || "");
      if (!image.alt) caption.hidden = true;
      figure.appendChild(img);
      figure.appendChild(caption);
      grid.appendChild(figure);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  /* The document head already shows the title the sidecar extracted; when the
     rewritten body repeats it as a leading heading, hide the duplicate. */
  function dedupeLeadingTitle(content, title) {
    var wanted = normalizeTitle(title);
    if (!wanted || wanted.length < 2) return;
    var scan = content.querySelectorAll("h1, h2, h3");
    for (var i = 0; i < scan.length && i < 3; i += 1) {
      if (normalizeTitle(scan[i].textContent) === wanted) {
        scan[i].hidden = true;
        break;
      }
    }
  }

  function normalizeTitle(value) {
    return typeof value === "string"
      ? value.replace(/[\s\u3000]+/g, "").replace(/[|｜\-–—_·:：]+$/g, "").toLowerCase()
      : "";
  }

  function collectHeadings(container) {
    var headings = [];
    var found = container.querySelectorAll("h1, h2, h3");
    for (var i = 0; i < found.length && headings.length < 80; i += 1) {
      if (found[i].hidden) continue;
      var text = (found[i].textContent || "").trim();
      if (text.length < 2 || text.length > 120) continue;
      headings.push({ element: found[i], text: text });
    }
    return headings;
  }

  function buildToc(headings) {
    if (headings.length < 3) return null;
    var details = node("details", "toc");
    var summary = node("summary", null, t("toc") + " · " + headings.length);
    details.appendChild(summary);
    var list = node("ul", "toc__list");
    headings.forEach(function (heading, index) {
      var id = "sec-" + index;
      heading.element.id = id;
      var item = node("li");
      var link = node("a", "toc__link", heading.text);
      link.href = "#" + id;
      link.addEventListener("click", function (event) {
        event.preventDefault();
        var target = document.getElementById(id);
        if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
      });
      item.appendChild(link);
      list.appendChild(item);
    });
    details.appendChild(list);
    return details;
  }

  /* Remote images can never load directly: the plugin sandbox CSP is
     `img-src 'self' data: blob:`. Every remote <img> is therefore kept in a
     data attribute (never handed to the browser, so no CSP violation is even
     attempted) and swapped to a proxied data URI when it nears the viewport. */
  var TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  var imageObserver = null;

  function imageObserverInstance() {
    if (imageObserver || typeof IntersectionObserver !== "function") return imageObserver;
    imageObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          imageObserver.unobserve(entry.target);
          proxyImage(entry.target);
        });
      },
      { rootMargin: "400px 0px" }
    );
    return imageObserver;
  }

  function isRemoteSrc(src) {
    return typeof src === "string" && (src.indexOf("http://") === 0 || src.indexOf("https://") === 0 || src.indexOf("//") === 0);
  }

  function proxyImage(img) {
    if (!img || !img.dataset) return;
    var state = img.dataset.imgState;
    if (state === "loading" || state === "done") return;
    var src = img.dataset.dbxSrc || img.getAttribute("src") || "";
    if (!isRemoteSrc(src)) {
      if (state === "failed") return;
      return;
    }
    img.dataset.imgState = "loading";
    invoke("webview/image", { url: src }, RENDER_TIMEOUT_MS).then(
      function (result) {
        if (!result || !result.dataUri) throw new Error("empty image");
        img.dataset.imgState = "done";
        img.src = result.dataUri;
      },
      function () {
        img.dataset.imgState = "failed";
        markImageBroken(img);
      }
    );
  }

  function markImageBroken(img) {
    if (!img || img.dataset.broken === "1") return;
    img.dataset.broken = "1";
    var alt = img.getAttribute("alt") || "";
    var box = node("span", "img-broken", "🖼 " + t("brokenImage") + (alt ? " · " + shorten(alt, 40) : ""));
    box.title = img.dataset.dbxSrc || img.getAttribute("src") || "";
    if (img.parentNode) img.parentNode.replaceChild(box, img);
  }

  /* Queue every remote <img> from a freshly rendered page payload for proxying. */
  function bindRemoteImages(host) {
    if (!host) return;
    var observer = imageObserverInstance();
    Array.prototype.forEach.call(host.querySelectorAll("img"), function (img) {
      var state = img.dataset.imgState;
      if (state === "done" || state === "loading") return; // already handled
      var stashed = img.dataset.dbxSrc || "";
      var src = stashed || img.getAttribute("src") || "";
      if (isRemoteSrc(src)) {
        // Stash the real URL and keep the browser from ever requesting it.
        img.dataset.dbxSrc = src;
        img.setAttribute("src", TRANSPARENT_PIXEL);
      } else if (!stashed) {
        // A real data: URI (inline image from the page) — leave it alone.
        return;
      }
      if (observer) {
        observer.observe(img);
      } else {
        proxyImage(img);
      }
    });
  }

  /* Safety net for images that appear after binding (gallery, late mutations). */
  function attachBrokenImageHandler() {
    var host = el.pageHost;
    if (!host || host.dataset.imgGuard === "1") return;
    host.dataset.imgGuard = "1";

    host.addEventListener(
      "error",
      function (event) {
        var target = event.target;
        if (!target || target.tagName !== "IMG") return;
        if (target.dataset.imgState === "done" || target.dataset.broken === "1") return;
        // A remote URL slipped through: retry it once through the proxy.
        if (target.dataset.dbxSrc && target.dataset.imgState !== "failed") {
          proxyImage(target);
          return;
        }
        markImageBroken(target);
      },
      true
    );

    if (typeof MutationObserver === "function") {
      var pending = null;
      var mutations = new MutationObserver(function (records) {
        var relevant = records.some(function (record) {
          return Array.prototype.some.call(record.addedNodes || [], function (added) {
            return added && added.nodeType === 1;
          });
        });
        if (!relevant || pending) return;
        pending = setTimeout(function () {
          pending = null;
          bindRemoteImages(host);
        }, 150);
      });
      mutations.observe(host, { childList: true, subtree: true });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 13. Reader style (live, no refetch)
   * ═══════════════════════════════════════════════════════════════════════ */
  function mergeStyle() {
    var out = assign({}, STYLE_DEFAULTS);
    var preset = styleState.preset;
    if (preset && typeof preset === "object") assign(out, preset);
    // `styleState.global` starts as a copy of the defaults; only merge genuinely
    // user-set keys so the preset layer is not flattened away.
    if (styleState.global) {
      Object.keys(styleState.global).forEach(function (key) {
        if (styleState.global[key] !== STYLE_DEFAULTS[key]) out[key] = styleState.global[key];
      });
    }
    if (styleState.perSite) {
      var patch = styleState.site[styleState.host];
      if (patch && typeof patch === "object") assign(out, patch);
    }
    return out;
  }

  /* Preset typography arrives with every render payload; keep it for the host.
     The engine speaks a slightly different vocabulary than the style panel, so
     normalise it here (fontStack -> fontFamily, maxWidth -> contentWidth, ...). */
  var PRESET_FONT_KEYS = {
    kai: "kai",
    song: "serif",
    hei: "sans",
    system: "system",
    serif: "serif",
    sans: "sans"
  };

  function normalizePresetStyle(raw) {
    if (!raw || typeof raw !== "object") return {};
    var out = {};
    var stack = typeof raw.fontFamily === "string" ? raw.fontFamily : "";
    if (stack) {
      var lowered = stack.toLowerCase();
      var key = Object.keys(PRESET_FONT_KEYS).find(function (name) {
        return lowered.indexOf(name) >= 0;
      });
      if (key) out.fontFamily = PRESET_FONT_KEYS[key];
    }
    ["fontSize", "lineHeight", "letterSpacing"].forEach(function (name) {
      var value = raw[name];
      if (typeof value === "number" && isFinite(value)) out[name] = value;
    });
    if (typeof raw.maxWidth === "number" && isFinite(raw.maxWidth)) out.contentWidth = raw.maxWidth;
    if (typeof raw.paragraphSpacing === "number" && isFinite(raw.paragraphSpacing)) {
      out.paraSpacing = raw.paragraphSpacing;
    }
    if (typeof raw.paragraphIndent === "boolean") out.indent = raw.paragraphIndent;
    if (typeof raw.textColor === "string" && raw.textColor) out.textColor = raw.textColor;
    if (typeof raw.bgColor === "string" && raw.bgColor) out.bgColor = raw.bgColor;
    if (typeof raw.dark === "boolean") out.dark = raw.dark;
    return out;
  }

  function setPresetStyle(payload) {
    styleState.preset = normalizePresetStyle(payload && payload.readerStyle);
  }

  function applyReaderStyle(contentNode) {
    var style = mergeStyle();
    styleState.effective = style;
    var root = document.documentElement;
    if (styleState.perSite) root.dataset.readerSite = styleState.host || "";
    else delete root.dataset.readerSite;

    var pageWidth = cssLength(style.pageWidth, "860px", 480, 1200, "px");
    var target = contentNode || (el.pageHost ? el.pageHost.querySelector(".page-content") : null);
    if (target) {
      target.style.setProperty("--reader-font-family", STYLE_FONT_STACKS[style.fontFamily] || STYLE_FONT_STACKS.system);
      target.style.setProperty("--reader-font-size", cssLength(style.fontSize, "17px", 12, 28, "px"));
      target.style.setProperty("--reader-line-height", cssLength(style.lineHeight, "1.75", 1.2, 2.6, ""));
      target.style.setProperty("--reader-letter-spacing", cssLength(style.letterSpacing, "0px", -0.5, 3, "px"));
      target.style.setProperty("--reader-text-width", cssLength(style.contentWidth, "72ch", 30, 110, "ch"));
      target.style.setProperty("--reader-para-gap", cssLength(style.paraSpacing, "0.9em", 0, 2.4, "em"));
      target.style.setProperty("--reader-indent", style.indent ? "2em" : "0px");
    }
    if (el.pageHost) {
      el.pageHost.style.setProperty("--reader-page-width", pageWidth);
      var shell = el.pageHost.querySelector(".page-scroll");
      if (shell) {
        shell.style.setProperty("--reader-page-width", pageWidth);
        shell.style.setProperty(
          "--reader-bg",
          style.dark ? "#15161a" : hexColor(style.bgColor, themeColor("--color-background", "#ffffff"))
        );
      }
    }
    document.body.dataset.readerDark = style.dark ? "1" : "0";

    var customCss = typeof style.customCss === "string" ? style.customCss : "";
    styleState.customCssActive = customCss.trim() !== "";
    if (el.readerCustom) el.readerCustom.textContent = customCss;
    if (target) target.classList.toggle("page-content--styled", styleState.customCssActive);

    rewriteReaderScope(style);
    syncStylePanel(style);
  }

  function rewriteReaderScope(style) {
    if (!el.readerScope) return;
    var pageWidth = cssLength(style.pageWidth, "860px", 480, 1200, "px");
    var dark = style.dark === true;
    var rules = [
      ".page-scroll { --reader-page-width: " + pageWidth + "; background: " + (dark ? "#15161a" : "var(--reader-bg, var(--color-background, #ffffff))") + "; }",
      ".page-content {",
      "  --reader-font-size: " + cssLength(style.fontSize, "17px", 12, 28, "px") + ";",
      "  --reader-line-height: " + cssLength(style.lineHeight, "1.75", 1.2, 2.6, "") + ";",
      "  --reader-color: " + hexColor(dark ? "#e7e8ec" : style.textColor, "var(--color-foreground, #18181b)") + ";",
      "}",
      ".page-bar { background: " + (dark ? "#15161a" : "var(--reader-bg, var(--color-background, #ffffff))") + "; }"
    ];
    if (dark) {
      rules.push(
        ".page-content a { color: #7fb2ff; border-bottom-color: rgba(127, 178, 255, .45); }",
        ".page-content blockquote { color: #b3b5bd; border-left-color: #3a3d45; }",
        ".page-content :not(pre) > code { background: #1d1f25; border-color: #2c2f37; }",
        ".page-content pre { background: #1a1c21; border-color: #2c2f37; }",
        ".page-content th { background: #1d1f25; }",
        ".page-content th, .page-content td { border-color: #2c2f37; }",
        ".doc__title, .doc { color: #e7e8ec; }"
      );
    }
    el.readerScope.textContent = rules.join("\n");
  }

  function themeColor(token, fallback) {
    var root = document.documentElement;
    var value = "";
    try {
      value = getComputedStyle(root).getPropertyValue(token) || "";
    } catch (error) {
      value = "";
    }
    value = value.trim();
    if (!value || value.indexOf("color-mix") !== -1 || value.indexOf("var(") !== -1) return fallback;
    return value;
  }

  function styleForEdit() {
    if (styleState.perSite) return mergeStyle();
    return assign({}, STYLE_DEFAULTS, styleState.global || {});
  }

  var STYLE_CONTROLS = [
    { id: "styleFontFamily", key: "fontFamily", kind: "string" },
    { id: "styleFontSize", key: "fontSize", kind: "number", unit: "px" },
    { id: "styleLineHeight", key: "lineHeight", kind: "number", fixed: 2 },
    { id: "stylePageWidth", key: "pageWidth", kind: "number", unit: "px" },
    { id: "styleContentWidth", key: "contentWidth", kind: "number", unit: "ch" },
    { id: "styleTextColor", key: "textColor", kind: "string" },
    { id: "styleBgColor", key: "bgColor", kind: "string" },
    { id: "styleParaSpacing", key: "paraSpacing", kind: "number", fixed: 1, unit: "em" },
    { id: "styleLetterSpacing", key: "letterSpacing", kind: "number", fixed: 1, unit: "px" },
    { id: "styleIndent", key: "indent", kind: "boolean" },
    { id: "styleDark", key: "dark", kind: "boolean" },
    { id: "styleCustomCss", key: "customCss", kind: "string" }
  ];

  function syncStylePanel(style) {
    if (el.stylePerSite) el.stylePerSite.checked = styleState.perSite === true;
    STYLE_CONTROLS.forEach(function (control) {
      var input = $(control.id);
      if (!input) return;
      if (control.kind === "boolean") {
        var checked = style[control.key] === true;
        if (input.checked !== checked) input.checked = checked;
        return;
      }
      var value = style[control.key];
      if (control.kind === "number") value = num(value, STYLE_DEFAULTS[control.key]);
      else value = typeof value === "string" ? value : "";
      if (isColorControl(control)) {
        /* never fight the native colour picker once the user opened it */
        if (input === document.activeElement) {
          setText($(control.id + "Value"), formatControlValue(control, value));
          return;
        }
        value = hexColor(value, "#000000");
      }
      if (input.value !== String(value)) input.value = String(value);
      if (control.kind === "number") setText($(control.id + "Value"), formatControlValue(control, value));
    });
  }

  function isColorControl(control) {
    return control.key === "textColor" || control.key === "bgColor";
  }

  function formatControlValue(control, value) {
    if (control.key === "contentWidth") return value + "ch";
    if (control.key === "lineHeight") return Number(value).toFixed(2);
    if (control.key === "paraSpacing") return Number(value).toFixed(1) + "em";
    if (control.key === "letterSpacing") return Number(value).toFixed(1) + "px";
    if (control.unit) return value + control.unit;
    return String(value);
  }

  function readControl(control) {
    var input = $(control.id);
    if (!input) return undefined;
    if (control.kind === "boolean") return input.checked === true;
    if (control.kind === "number") return num(input.value, STYLE_DEFAULTS[control.key]);
    return input.value;
  }

  var stylePersist = debounce(function () {
    if (styleState.perSite) storeSet(STORAGE_KEYS.siteStyles, styleState.site);
    else storeSet(STORAGE_KEYS.readerStyle, styleState.global);
  }, 400);

  function onStyleInput(control) {
    var value = readControl(control);
    if (value === undefined) return;
    if (styleState.perSite) {
      var host = styleState.host || hostOf((activeTab() || {}).url || "") || "unknown";
      styleState.site[host] = assign({}, styleState.site[host] || {}, { perSite: true });
      styleState.site[host][control.key] = value;
    } else {
      styleState.global[control.key] = value;
      styleState.global.perSite = false;
    }
    applyReaderStyle(null);
    stylePersist();
  }

  function resetGlobalStyle() {
    styleState.global = assign({}, STYLE_DEFAULTS);
    if (styleState.perSite) {
      var host = styleState.host || hostOf((activeTab() || {}).url || "") || "unknown";
      styleState.site[host] = { perSite: true };
    }
    applyReaderStyle(null);
    storeSet(STORAGE_KEYS.readerStyle, styleState.global);
    if (styleState.perSite) storeSet(STORAGE_KEYS.siteStyles, styleState.site);
  }

  function useThemeColors() {
    var text = hexColor(themeColor("--color-foreground", "#18181b"), "#18181b");
    var bg = hexColor(themeColor("--color-background", "#ffffff"), "#ffffff");
    if (styleState.perSite) {
      var host = styleState.host || hostOf((activeTab() || {}).url || "") || "unknown";
      var patch = styleState.site[host] || { perSite: true };
      patch.perSite = true;
      patch.textColor = text;
      patch.bgColor = bg;
      patch.dark = false;
      styleState.site[host] = patch;
      storeSet(STORAGE_KEYS.siteStyles, styleState.site);
    } else {
      styleState.global.textColor = text;
      styleState.global.bgColor = bg;
      styleState.global.dark = false;
      storeSet(STORAGE_KEYS.readerStyle, styleState.global);
    }
    applyReaderStyle(null);
    showStatusNotice(t("followTheme") + " · " + text + " / " + bg);
  }

  function loadStyleState(rawGlobal, rawSite, rawPerSite) {
    if (rawGlobal && typeof rawGlobal === "object" && !Array.isArray(rawGlobal)) {
      var merged = assign({}, STYLE_DEFAULTS);
      Object.keys(STYLE_DEFAULTS).forEach(function (key) {
        if (rawGlobal[key] !== undefined && typeof rawGlobal[key] === typeof STYLE_DEFAULTS[key]) merged[key] = rawGlobal[key];
        else if (key === "textColor" || key === "bgColor" || key === "customCss") {
          if (typeof rawGlobal[key] === "string") merged[key] = rawGlobal[key];
        }
      });
      styleState.global = merged;
    }
    if (rawSite && typeof rawSite === "object" && !Array.isArray(rawSite)) styleState.site = rawSite;
    /* the per-site switch is stored on its own so it survives a reload */
    styleState.perSite =
      rawPerSite === true ||
      rawPerSite === "true" ||
      (rawPerSite === null && styleState.global.perSite === true);
  }

  function setPerSite(enabled) {
    styleState.perSite = enabled === true;
    var host = hostOf((activeTab() || {}).url || "");
    styleState.host = host;
    storeSet(STORAGE_KEYS.readerStylePerSite, styleState.perSite);
    if (styleState.perSite && host) {
      styleState.site[host] = assign({}, STYLE_DEFAULTS, styleState.global, styleState.site[host] || {}, { perSite: true });
      storeSet(STORAGE_KEYS.siteStyles, styleState.site);
    } else if (!styleState.perSite) {
      styleState.global.perSite = false;
      storeSet(STORAGE_KEYS.readerStyle, styleState.global);
    }
    applyReaderStyle(null);
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 14. Rendering the chrome (toolbar, sidebar, tabs)
   * ═══════════════════════════════════════════════════════════════════════ */
  function applyCopy() {
    document.documentElement.lang = locale;
    syncSettingsPanel();
    setText($("modeLabel"), t("mode"));
    setText($("modeHint"), t("modeHint"));
    setText($("bookmarkText"), t("bookmarkAdd"));
    setText($("newTabText"), t("newTab"));
    setText($("presetHead"), t("presets"));
    setText($("bookmarkHead"), t("bookmarks"));
    setText($("historyHead"), t("history"));
    setText($("styleTitle"), t("settings"));
    // 工具栏按钮改成「设置」（⚙️ + 轻提示"设置"），抽屉里是三个页签。
    setText($("styleText"), t("settings"));
    setText($("tabStyleText"), t("tabStyle"));
    setText($("tabBrowserText"), t("tabBrowser"));
    setText($("tabGeneralText"), t("tabGeneral"));
    setText($("themeResetText"), t("followTheme"));
    setText($("resetAllText"), t("resetAll"));
    setText($("perSiteText"), t("perSite"));
    setText($("fontFamilyLabel"), t("fontFamily"));
    setText($("fontSizeLabel"), t("fontSize"));
    setText($("lineHeightLabel"), t("lineHeight"));
    setText($("pageWidthLabel"), t("pageWidth"));
    setText($("contentWidthLabel"), t("contentWidth"));
    setText($("textColorLabel"), t("textColor"));
    setText($("bgColorLabel"), t("bgColor"));
    setText($("paraSpacingLabel"), t("paraSpacing"));
    setText($("letterSpacingLabel"), t("letterSpacing"));
    setText($("indentText"), t("indent"));
    setText($("darkText"), t("darkRead"));
    setText($("customCssLabel"), t("customCss"));
    setText($("customCssHint"), t("customCssHint"));
    setText($("btnHistoryClear"), t("clear"));
    setText($("btnPresetClear"), t("auto"));
    setText($("btnGo"), t("go"));

    var modeSelect = $("modeSelect");
    if (modeSelect) {
      setText(modeSelect.options[0], t("reader"));
      setText(modeSelect.options[1], t("full"));
      setText(modeSelect.options[2], t("source"));
    }

    var family = $("styleFontFamily");
    if (family) {
      setText(family.options[0], t("fontSystem"));
      setText(family.options[1], t("fontSerif"));
      setText(family.options[2], t("fontSans"));
      setText(family.options[3], t("fontKai"));
    }

    if (el.addressInput) el.addressInput.placeholder = t("addressPlaceholder");
    if (el.addressInput) el.addressInput.setAttribute("aria-label", t("address"));
    var labels = [
      ["btnBack", t("back")],
      ["btnForward", t("forward")],
      ["btnReload", t("reload")],
      ["btnSidebarToggle", t("sidebarToggle")],
      ["btnStyle", t("settings")],
      ["modelabel", ""]
    ];
    labels.forEach(function (pair) {
      var button = $(pair[0]);
      if (!button || !pair[1]) return;
      button.title = pair[1];
      button.setAttribute("aria-label", pair[1]);
    });
    syncDocTitle();
  }

  function syncToolbar() {
    var tab = activeTab();
    var busy = !!(tab && tab.loading);
    var live = !!(tab && tab.live);
    if (el.addressInput) {
      var value = (tab && tab.url) || "";
      // 本地书没有网址：地址栏显示书名，别留一个空框让人以为坏了。
      if (tab && tab.mode === "local" && tab.payload && tab.payload.localBook) {
        value = tab.payload.localBook.name + "  ·  " + (tab.payload.localBook.index + 1) + "/" + tab.payload.localBook.total;
      }
      var editing = document.activeElement === el.addressInput && addressEdited;
      if (!editing) el.addressInput.value = value;
    }
    if (el.addressScheme) {
      var scheme = "◎";
      if (tab && tab.url) scheme = tab.url.indexOf("https://") === 0 ? "🔒" : "○";
      setText(el.addressScheme, scheme);
    }
    if (el.btnGo) el.btnGo.disabled = busy;
    // 本地书模式没有网址可复制 / 刷新。
    var isLocal = !!(tab && tab.mode === "local");
    if (el.btnReload) el.btnReload.disabled = isLocal || !tab || !tab.url;
    if (el.btnCopyUrl) el.btnCopyUrl.disabled = isLocal || !(tab && tab.url);
    if (el.modeSelect) el.modeSelect.value = isLocal ? "reader" : (tab && tab.mode) || "reader";
    // 本地书没有"整页/源码"模式，下拉禁用免得点了没反应；实时页面自己就是渲染结果，也不适用。
    if (el.modeSelect) el.modeSelect.disabled = isLocal || live;
    if (el.btnBack) el.btnBack.disabled = live ? !(tab && tab.liveCanGoBack) : (!tab || tab.historyIndex <= 0);
    if (el.btnForward) el.btnForward.disabled = live ? !(tab && tab.liveCanGoForward) : (!tab || tab.historyIndex >= tab.history.length - 1);
    if (el.btnBookmark) {
      // 本地书也能收藏（收藏的是"这本书的这一章"），所以用合成 key 判断。
      var bookmarkKey = currentBookmarkKey(tab);
      var saved = !!bookmarkKey && isBookmarked(bookmarkKey);
      el.btnBookmark.setAttribute("aria-pressed", saved ? "true" : "false");
      el.btnBookmark.disabled = !bookmarkKey;
      el.btnBookmark.title = saved ? t("bookmarkRemove") : t("bookmarkAdd");
      el.btnBookmark.setAttribute("aria-label", el.btnBookmark.title);
      // 两种状态都用 ⭐：它是"收藏"的标记，用 ☆/★ 在小字号下反而看不出区别。
      // 具体是"收藏"还是"取消收藏"由 tooltip 与文字说明。
      setText(el.bookmarkIcon, "⭐");
      setText(el.bookmarkText, saved ? t("bookmarkRemove") : t("bookmarkAdd"));
      syncDocTitle(tab);
    }
    if (el.btnPresetClear) el.btnPresetClear.setAttribute("aria-pressed", tab && tab.presetId ? "false" : "true");
    // 「目录」按钮：只有拿得到目录地址时才出现。
    if (el.btnCatalog) {
      var catalog = (tab && tab.payload && tab.payload.catalogUrl) || "";
      el.btnCatalog.hidden = live || !catalog;
      el.btnCatalog.disabled = !catalog;
      el.btnCatalog.title = catalog ? t("catalogHint").replace("{url}", catalog) : "";
      setText(el.catalogText, t("catalog"));
    }
    // 样式面板里那行"将要打开的地址"也要跟着当前标签走。
    syncBrowserPanel();
    // 没有地址、或者机器上没有 Chrome / Edge 时，这个入口没有意义。
    if (el.btnOpenBrowser) {
      var canOpen = !!(tab && tab.url) && browserSupport.available;
      el.btnOpenBrowser.disabled = !canOpen;
      el.btnOpenBrowser.title = browserSupport.available
        ? (tab && tab.url
            ? t("browserOpenHintUrl").replace("{url}", tab.url)
            : t("browserOpenHint"))
        : t("browserUnavailable");
      el.btnOpenBrowser.setAttribute("aria-label", el.btnOpenBrowser.title);
      setText(el.openBrowserText, t("browserOpen"));
      el.btnOpenBrowser.hidden = !browserSupport.available;
    }
    if (el.btnLive) {
      el.btnLive.hidden = !tab || !tab.url;
      el.btnLive.disabled = !tab || !tab.url;
      el.btnLive.setAttribute("aria-pressed", live ? "true" : "false");
      el.btnLive.title = live ? t("liveExit") : t("liveHint");
      el.btnLive.setAttribute("aria-label", el.btnLive.title);
      setText(el.liveText, live ? t("liveExit") : t("live"));
    }
    if (live) liveStatus(tab);
  }

  function renderTabs() {
    var list = el.tabList;
    if (!list) return;
    clear(list);
    state.tabs.forEach(function (tab) {
      var item = node("li");
      var row = node("div", "row");
      row.setAttribute("aria-current", tab.id === state.activeTabId ? "true" : "false");
      var button = node("button", "row__body");
      button.type = "button";
      button.appendChild(node("span", "row__title", labelOf(tab)));
      button.appendChild(node("span", "row__sub", tab.url ? shorten(tab.url, 46) : t("untitledTab")));
      button.addEventListener("click", function () {
        activateTab(tab);
      });
      var badge = node("span", "row__badge", t(tab.live ? "liveBadge" : tab.mode === "source" ? "source" : tab.mode === "full" ? "full" : "reader"));
      var close = node("button", "row__x", "✕");
      close.type = "button";
      close.title = t("close");
      close.setAttribute("aria-label", t("close"));
      close.addEventListener("click", function (event) {
        event.stopPropagation();
        closeTab(tab);
      });
      row.appendChild(button);
      row.appendChild(badge);
      row.appendChild(close);
      item.appendChild(row);
      list.appendChild(item);
    });
  }

  function activateTab(tab) {
    if (!tab || tab.id === state.activeTabId) {
      if (tab && !tab.payload && !tab.error && !tab.loading && tab.url) loadTab(tab, { push: false });
      return;
    }
    var current = activeTab();
    if (current && el.contentView) current.scrollTop = el.contentView.scrollTop || 0;
    if (current && current.live && current.id !== tab.id) pauseLive();
    state.activeTabId = tab.id;
    state.lastUrl = tab.url || state.lastUrl;
    queuePersist();
    renderTabs();
    syncToolbar();
    syncDocTitle();
    styleState.host = hostOf(tab.url);
    if (tab.live) {
      showLiveView(tab, { keepFrame: liveState.tabId === tab.id && liveState.ready });
      return;
    }
    hideLiveChrome();
    refreshActiveTab(true);
    if (tab.url && !tab.payload && !tab.error && !tab.loading) loadTab(tab, { push: false });
  }

  function renderSidebar() {
    renderTabs();
    renderPresets();
    renderBookmarks();
    renderHistory();
  }

  function renderPresets() {
    var list = el.presetList;
    if (!list) return;
    // 列表要重画了，菜单里指的 preset/pattern 可能已经不存在，先收起来。
    closeHostMenu();
    clear(list);
    var tab = activeTab();
    var auto = makeRow({
      icon: "◎",
      title: t("autoPreset"),
      sub: tab && presetForUrl(tab.url) ? presetLabel(presetForUrl(tab.url)) : t("auto"),
      active: !tab || !tab.presetId,
      onClick: function () {
        if (tab) {
          tab.presetId = null;
          queuePersist();
          refreshActiveTab(true);
          if (tab.url) loadTab(tab, { push: false });
        }
        renderPresets();
        syncToolbar();
      }
    });
    list.appendChild(auto);
    if (!state.presets.length) {
      list.appendChild(node("li", "sb__empty", t("noPresets")));
      return;
    }
    var groups = {};
    state.presets.forEach(function (preset) {
      var category = preset.category || "·";
      if (!groups[category]) groups[category] = [];
      groups[category].push(preset);
    });
    Object.keys(groups).forEach(function (category) {
      var header = node("li", "plist__group", category === "·" ? t("presets") : category);
      list.appendChild(header);
      groups[category].forEach(function (preset) {
        var item = node("li", "pitem");
        var row = makeRow({
          icon: "◈",
          title: preset.name || preset.id,
          sub: preset.description || "",
          active: !!(tab && tab.presetId === preset.id),
          onClick: function () {
            // 预设本身没有网址，点它只能"套用到当前页面"——前提是当前页面
            // 确实有这个地址，否则就什么也不做（原来这里会静默无反应）。
            if (!tab) return;
            tab.presetId = tab.presetId === preset.id ? null : preset.id;
            queuePersist();
            renderPresets();
            syncToolbar();
            if (tab.url) refreshActiveTab(false);
          }
        });
        item.appendChild(row);

        // 自定义预设：给编辑 / 删除。内置预设只读，不显示这两个按钮。
        if (preset.custom) {
          var tools = node("div", "pitem__tools");
          var edit = node("button", "pitem__tool", t("presetEdit"));
          edit.type = "button";
          edit.title = t("presetEdit");
          edit.addEventListener("click", function (event) {
            event.stopPropagation();
            openPresetForm(preset);
          });
          tools.appendChild(edit);
          var del = node("button", "pitem__tool pitem__tool--danger", t("presetDelete"));
          del.type = "button";
          del.title = t("presetDelete");
          del.addEventListener("click", function (event) {
            event.stopPropagation();
            deleteCustomPreset(preset.id);
          });
          tools.appendChild(del);
          item.appendChild(tools);
        }
        // 真正的"地址"是可点的：匹配域名 → 打开该站点首页。
        // 右键标签弹出菜单：修改 / 删除（删除要二次确认）；内置预设上删掉的
        // 域名以灰色标签保留，右键可以恢复。
        var patterns = (preset.hostPatterns || []).filter(function (pattern) {
          return pattern !== "*" && pattern.indexOf("*") === -1;
        });
        var blockedPatterns = Array.isArray(preset.blockedPatterns) ? preset.blockedPatterns : [];
        if (patterns.length || blockedPatterns.length) {
          var hostRow = node("div", "pitem__hosts");
          patterns.slice(0, 6).forEach(function (pattern) {
            var chip = node("button", "pitem__host", pattern);
            chip.type = "button";
            chip.title = t("openPresetSite").replace("{host}", pattern);
            chip.addEventListener("click", function (event) {
              event.stopPropagation();
              openInTab("https://" + pattern + "/");
            });
            chip.addEventListener("contextmenu", function (event) {
              event.preventDefault();
              event.stopPropagation();
              openHostMenu(preset, pattern, false, event);
            });
            hostRow.appendChild(chip);
          });
          blockedPatterns.forEach(function (pattern) {
            var chip = node("button", "pitem__host pitem__host--off", pattern);
            chip.type = "button";
            // 这里**不能**用 disabled / aria-disabled：前者不派发 contextmenu，
            // 后者会被自动化工具判成"不可点"，右键"恢复"就点不到（实测踩过）。
            // 用 data-off + 样式表达状态，事件照常让它进来。
            chip.setAttribute("data-off", "1");
            chip.title = t("presetHostRemoved");
            chip.addEventListener("click", function (event) {
              event.preventDefault();
              event.stopPropagation();
            });
            chip.addEventListener("contextmenu", function (event) {
              event.preventDefault();
              event.stopPropagation();
              openHostMenu(preset, pattern, true, event);
            });
            hostRow.appendChild(chip);
          });
          item.appendChild(hostRow);
        }
        list.appendChild(item);
      });
    });
  }

  function renderBookmarks() {
    var list = el.bookmarkList;
    if (!list) return;
    clear(list);
    if (!state.bookmarks.length) {
      list.appendChild(node("li", "sb__empty", t("yourBookmarks")));
      return;
    }
    state.bookmarks.forEach(function (bookmark) {
      if (bookmark.local) {
        var info = bookmark.local;
        list.appendChild(
          makeRow({
            icon: "★",
            title: (info.chapterTitle ? info.chapterTitle : info.name) || info.name,
            sub:
              shorten(info.name, 30) +
              " · " +
              t("localChapterOf")
                .replace("{n}", String(num(info.chapter, 0) + 1))
                .replace("{m}", String(num(info.total, 0))),
            onOpen: function () {
              openLocalChapter(num(info.chapter, 0), { bookId: info.bookId });
            },
            onDelete: function () {
              removeBookmark(bookmarkKeyOf(bookmark));
            }
          })
        );
        return;
      }
      list.appendChild(
        makeRow({
          icon: "★",
          title: bookmark.title || hostOf(bookmark.url) || bookmark.url,
          sub: shorten(bookmark.url, 44),
          onOpen: function () {
            openInTab(bookmark.url);
          },
          onDelete: function () {
            removeBookmark(bookmark.url);
          }
        })
      );
    });
  }

  function renderHistory() {
    var list = el.historyList;
    if (!list) return;
    clear(list);
    if (!state.history.length) {
      list.appendChild(node("li", "sb__empty", t("yourHistory")));
      return;
    }
    state.history.forEach(function (entry) {
      list.appendChild(
        makeRow({
          icon: "↺",
          title: entry.title || hostOf(entry.url) || entry.url,
          sub: shorten(entry.url, 44),
          badge: relativeTime(entry.at),
          onOpen: function () {
            openInTab(entry.url);
          }
        })
      );
    });
  }

  function makeRow(options) {
    var item = node("li");
    var row = node("div", "row");
    if (options.active) row.setAttribute("aria-current", "true");
    row.appendChild(node("span", "row__ico", options.icon || "·"));
    var body = node("button", "row__body");
    body.type = "button";
    body.appendChild(node("span", "row__title", options.title || ""));
    if (options.sub) body.appendChild(node("span", "row__sub", options.sub));
    body.addEventListener("click", function () {
      if (options.onClick) options.onClick();
      else if (options.onOpen) options.onOpen();
    });
    row.appendChild(body);
    if (options.badge) row.appendChild(node("span", "row__badge", options.badge));
    if (options.onDelete) {
      var remove = node("button", "row__x", "✕");
      remove.type = "button";
      remove.title = t("clear");
      remove.setAttribute("aria-label", t("clear"));
      remove.addEventListener("click", function (event) {
        event.stopPropagation();
        options.onDelete();
      });
      row.appendChild(remove);
    }
    item.appendChild(row);
    return item;
  }

  function openInTab(url) {
    if (!isHttpUrl(url)) return;
    var existing = null;
    if (state.tabs.length === 1 && !state.tabs[0].url) existing = state.tabs[0];
    var tab = existing || tabsWithUrl(url)[0] || activeTab();
    if (!tab) tab = createTab({ url: url });
    if (tab.id !== state.activeTabId) activateTab(tab);
    navigate(tab, url, { push: tab.url !== url });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 15. Navigation + fetching
   * ═══════════════════════════════════════════════════════════════════════ */
  function commitHistory(tab, url) {
    if (!url) return;
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    if (tab.history[tab.history.length - 1] !== url) tab.history.push(url);
    tab.historyIndex = tab.history.length - 1;
    tab.scrollTop = 0;
  }

  function navigate(tab, url, options) {
    if (!tab || !isHttpUrl(url)) return;
    // 本地书标签不能变成一个网页标签——那会把正在读的书"吃掉"，
    // 用户点回标签时看到的是空白引导页（曾经的真实 bug）。
    // 打开网址时另起一个标签。
    if (tab.mode === "local") {
      var fresh = createTab({});
      activateTab(fresh);
      tab = fresh;
    }
    var opts = options || {};
    checkAutoPreset(tab, url);
    // 小红书这类站点服务端只能拿到壳；直接切到插件内的实时页面。
    if (tab.live || isLiveSite(url)) {
      openLive(tab, url, { push: opts.push !== false });
      return;
    }
    tab.url = url;
    tab.error = null;
    tab.notice = "";
    tab.scrollTop = 0;
    if (opts.push !== false) commitHistory(tab, url);
    state.lastUrl = url;
    styleState.host = hostOf(url);
    queuePersist();
    renderTabs();
    syncToolbar();
    loadTab(tab, { push: false });
  }

  function checkAutoPreset(tab, url) {
    if (tab.presetId) return;
    var preset = presetForUrl(url);
    if (preset) tab.presetId = preset.id;
  }

  function loadTab(tab, options) {
    var opts = options || {};
    var url = tab.url;
    if (!url) {
      tab.loading = false;
      tab.payload = null;
      tab.error = null;
      renderEmpty(tab);
      return Promise.resolve(null);
    }
    if (tab.live) {
      return showLiveView(tab, { keepFrame: false });
    }
    if (opts.push) commitHistory(tab, url);
    tab.loading = true;
    tab.error = null;
    tab.notice = "";
    tab.warnings = [];
    tab.payload = null;
    var token = (renderSeq[tab.id] || 0) + 1;
    renderSeq[tab.id] = token;
    renderLoading(tab);
    syncToolbar();
    renderTabs();

    var params = { url: url, mode: tab.mode || "reader" };
    if (tab.presetId) params.presetId = tab.presetId;
    // 「合并分页」由设置面板控制，默认开启：把同一章被切开的 `_1` / `_2` 抓回来拼上。
    params.options = { mergePages: disguise.mergePages !== false };

    // 命中预取就直接用，翻章几乎瞬时。
    var prefetched = takePrefetched(url, params);
    if (prefetched) {
      tab.loading = false;
      finishSuccess(tab, normalizePayload(prefetched));
      return Promise.resolve(tab.payload);
    }

    return invoke("webview/render", params, RENDER_TIMEOUT_MS).then(
      function (raw) {
        if (renderSeq[tab.id] !== token) return null;
        var payload = normalizePayload(raw);
        if (
          params.mode === "reader" &&
          payload.ok &&
          payload.textLength < READER_MIN_CHARS &&
          payload.html.length > 0
        ) {
          return invoke("webview/render", { url: url, mode: "full", presetId: tab.presetId || undefined }, RENDER_TIMEOUT_MS).then(
            function (retryRaw) {
              if (renderSeq[tab.id] !== token) return null;
              var retryPayload = normalizePayload(retryRaw);
              // 只有在整页模式**确实内容更多**时才切换。纯 JS 站点恰恰相反：
              // 阅读模式还能拿到导航、标题和图片，整页模式几乎是空的。
              if (retryPayload.ok && retryPayload.textLength > payload.textLength) {
                retryPayload.mode = "full";
                tab.mode = "full";
                tab.payload = retryPayload;
                tab.loading = false;
                tab.error = null;
                tab.warnings = retryPayload.warnings.slice();
                tab.notice = t("fallbackNotice");
                tab.title = retryPayload.title || tab.title;
                syncToolbar();
                renderPage(tab);
                syncDocTitle(tab);
                recordHistory(tab.url, retryPayload.title);
                queuePersist();
                return retryPayload;
              }
              finishSuccess(tab, payload);
              return payload;
            },
            function () {
              if (renderSeq[tab.id] !== token) return null;
              finishSuccess(tab, payload);
              return payload;
            }
          );
        }
        finishSuccess(tab, payload);
        return payload;
      },
      function (error) {
        if (renderSeq[tab.id] !== token) return null;
        finishError(tab, error);
        return null;
      }
    );
  }

  function finishSuccess(tab, payload) {
    tab.payload = payload;
    tab.loading = false;
    tab.error = null;
    tab.warnings = payload.warnings.slice();
    tab.title = payload.title || tab.title;
    if (payload.mode && isMode(payload.mode)) tab.mode = payload.mode;
    if (payload.presetId && !tab.presetId) tab.presetId = payload.presetId;
    // 记下这次渲染实际用的 presetId：下次改预设时 refreshActiveTab 靠它判断
    // 需不需要真的重新解析。
    tab.lastRenderPreset = tab.presetId || "";
    if (payload.url && payload.url !== tab.url) {
      tab.url = payload.url;
      commitHistory(tab, payload.url);
    }
    syncToolbar();
    renderPage(tab);
    syncDocTitle(tab);
    recordHistory(tab.url, payload.title);
    queuePersist();
    renderSidebar();
  }

  function finishError(tab, error) {
    tab.loading = false;
    tab.payload = null;
    tab.error = humanError(error);
    renderTabs();
    renderError(tab);
  }

  function goBack() {
    var tab = activeTab();
    if (!tab) return;
    if (tab.live) {
      invoke("webview/liveBack", {}, 5000).catch(function () {});
      return;
    }
    if (tab.historyIndex <= 0) return;
    tab.historyIndex -= 1;
    tab.url = tab.history[tab.historyIndex];
    tab.error = null;
    tab.notice = "";
    tab.scrollTop = 0;
    state.lastUrl = tab.url;
    styleState.host = hostOf(tab.url);
    queuePersist();
    syncToolbar();
    loadTab(tab, { push: false });
  }

  function goForward() {
    var tab = activeTab();
    if (!tab) return;
    if (tab.live) {
      invoke("webview/liveForward", {}, 5000).catch(function () {});
      return;
    }
    if (tab.historyIndex >= tab.history.length - 1) return;
    tab.historyIndex += 1;
    tab.url = tab.history[tab.historyIndex];
    tab.error = null;
    tab.notice = "";
    tab.scrollTop = 0;
    state.lastUrl = tab.url;
    styleState.host = hostOf(tab.url);
    queuePersist();
    syncToolbar();
    loadTab(tab, { push: false });
  }

  function reload() {
    var tab = activeTab();
    if (!tab) return;
    if (tab.live) {
      invoke("webview/liveReload", {}, 5000).catch(function () {});
      return;
    }
    if (!tab.url) {
      refreshActiveTab(true);
      return;
    }
    loadTab(tab, { push: false });
  }

  function submitAddress() {
    var tab = activeTab();
    if (!tab || !el.addressInput) return;
    var raw = el.addressInput.value;
    resolveInput(raw).then(function (url) {
      if (!url) {
        tab.error = t("errEmpty") + " · " + raw;
        renderError(tab);
        return;
      }
      navigate(tab, url, { push: true });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 15b. 插件内实时页面（WebView2 帧流）
   *
   * 沙箱 iframe 被 CSP 禁止嵌入外部站点，所以这里拿到的不是 iframe，而是
   * sidecar 里离屏 WebView2 的 JPEG 帧。鼠标/滚轮/键盘/中文输入再通过
   * webview/liveInput 送回去。登录态在 sidecar 的 WebView2 profile 里。
   * ═══════════════════════════════════════════════════════════════════════ */
  var liveInput = { composing: false, moveTimer: 0, lastPoint: null, pressed: false };

  function liveModifiers(event) {
    return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
  }

  function liveViewport() {
    return {
      width: liveState.width || 1280,
      height: liveState.height || 900
    };
  }

  function setLiveOverlay(show, title, hint, isError) {
    if (!el.liveOverlay) return;
    el.liveOverlay.hidden = !show;
    if (el.liveSpinner) el.liveSpinner.hidden = !!isError;
    if (el.liveTitle) setText(el.liveTitle, title || "");
    if (el.liveHint) {
      setText(el.liveHint, hint || "");
      el.liveHint.classList.toggle("live__hint--error", !!isError);
    }
  }

  function showLiveChrome(tab) {
    if (el.contentView) el.contentView.hidden = true;
    if (el.liveHost) el.liveHost.hidden = false;
    if (el.liveTips) el.liveTips.hidden = !liveState.ready;
    if (el.liveFrame) el.liveFrame.setAttribute("aria-label", (tab && tab.title) || "live page");
  }

  function hideLiveChrome() {
    if (el.liveHost) el.liveHost.hidden = true;
    if (el.contentView) el.contentView.hidden = false;
  }

  function liveStatus(tab) {
    if (!tab) return;
    setStatus({
      mode: "live",
      url: tab.url,
      preset: t("liveBadge")
    });
    if (el.statusState) setText(el.statusState, t("liveBadge"));
  }

  /**
   * 实时页面该用多大的"页面视口"：**就是面板占的 CSS 尺寸**。
   *
   * 这和以前"算采集像素"的思路不同：现在把 WebView2 的视口直接设成面板大小、
   * 设备像素比设成系统 DPR，页面按物理像素栅格化，采集 1:1 对齐屏幕 ——
   * 既不会放大发虚，也不会留黑边（视口比例 == 面板比例）。
   */
  function liveViewportRequest() {
    var surface = el.liveCanvas && !el.liveCanvas.hidden ? el.liveCanvas : el.liveFrame;
    if (!surface) return null;
    var rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    var dpr = window.devicePixelRatio || 1;
    return {
      width: Math.round(clamp(rect.width, 320, 1920)),
      height: Math.round(clamp(rect.height, 240, 1200)),
      dpr: Math.round(clamp(dpr, 1, 2) * 100) / 100
    };
  }

  var liveResizeTimer = 0;
  function liveResizeDebounced() {
    if (liveResizeTimer) clearTimeout(liveResizeTimer);
    liveResizeTimer = setTimeout(function () {
      liveResizeTimer = 0;
      var size = liveViewportRequest();
      if (!size || !liveState.active || liveState.paused) return;
      invoke("webview/liveResize", size, 8000).catch(function () {
        return null;
      });
    }, 500);
  }

  /* ── 地址标签的右键菜单 ────────────────────────────────────────────────
   *
   * 标签本身是"点一下打开该站点"，右键才出菜单：
   *   · 修改：改这一条域名。内置预设改不了本体，所以"修改"= 屏蔽旧域名 +
   *     按原选择器建一条用户规则（域名换了，抓取方式不变）；
   *   · 删除：从匹配里移除。内置预设上只是记进 blockedHosts（灰色保留、可恢复），
   *     自定义预设则直接从规则里删掉。
   * 菜单不依赖 alert/confirm —— 插件 sandbox 里那两个是禁用的。
   */
  var hostMenuState = { preset: null, pattern: "", blocked: false, confirming: false };
  /* 「修改域名」弹窗当前在改哪一条：不要把这些挂到元素映射表上——
     动态挂属性会让静态检查报"引用了未声明的元素"，实际运行时也确实容易漏。 */
  var hostDialogState = { pattern: "", presetId: "", custom: false };

  function openHostMenu(preset, pattern, blocked, event) {
    if (!el.hostMenu) return;
    hostMenuState = { preset: preset, pattern: pattern, blocked: blocked, confirming: false };
    setText(el.hostMenuLabel, pattern);
    el.hostMenuConfirm.hidden = true;
    el.hostMenu.hidden = false;
    // 靠近右/下边缘时往回挪，别让菜单出画面。
    var width = 184;
    var left = clamp(event.clientX - 8, 8, Math.max(8, window.innerWidth - width - 8));
    var top = clamp(event.clientY + 6, 8, Math.max(8, window.innerHeight - 132));
    el.hostMenu.style.left = left + "px";
    el.hostMenu.style.top = top + "px";
    setText(el.hostMenuEditLabel, blocked ? t("presetHostRestore") : t("presetHostEdit"));
    setText(el.hostMenuDeleteLabel, t("presetDelete"));
    el.hostMenuDelete.hidden = blocked;
  }

  function closeHostMenu() {
    if (el.hostMenu) el.hostMenu.hidden = true;
    hostMenuState.confirming = false;
    if (el.hostMenuConfirm) el.hostMenuConfirm.hidden = true;
    if (el.hostMenuActions) el.hostMenuActions.hidden = false;
  }

  /** 第二次点击才算删：先换成"确认删除 xxx？"再等用户点确认。 */
  function confirmHostDelete() {
    if (!hostMenuState.confirming) {
      hostMenuState.confirming = true;
      if (el.hostMenuActions) el.hostMenuActions.hidden = true;
      if (el.hostMenuConfirm) el.hostMenuConfirm.hidden = false;
      setText(
        el.hostMenuConfirmText,
        t("presetHostDeleteConfirm").replace("{host}", hostMenuState.pattern)
      );
      return;
    }
    var preset = hostMenuState.preset;
    var pattern = hostMenuState.pattern;
    closeHostMenu();
    if (!preset) return;
    if (preset.custom) {
      removeCustomHostPattern(preset.id, pattern);
    } else {
      blockBuiltinHostPattern(pattern);
    }
  }

  function removeCustomHostPattern(presetId, pattern) {
    var next = [];
    state.customPresets.forEach(function (rule) {
      if (rule.id !== presetId) {
        next.push(rule);
        return;
      }
      var copy = assign({}, rule);
      copy.hostPatterns = (rule.hostPatterns || []).filter(function (item) {
        return item !== pattern;
      });
      // 域名删光的规则直接移除，留着只会是一条匹配不到任何页面的死规则。
      if (copy.hostPatterns.length) next.push(copy);
    });
    persistSiteData(next, state.blockedHosts);
  }

  function blockBuiltinHostPattern(pattern) {
    var next = (state.blockedHosts || []).filter(function (item) {
      return item !== pattern;
    });
    next.push(pattern);
    persistSiteData(state.customPresets, next);
  }

  function unblockHostPattern(pattern) {
    var next = (state.blockedHosts || []).filter(function (item) {
      return item !== pattern;
    });
    persistSiteData(state.customPresets, next);
  }

  function editHostPattern() {
    var preset = hostMenuState.preset;
    var pattern = hostMenuState.pattern;
    var blocked = hostMenuState.blocked;
    closeHostMenu();
    if (!preset) return;
    if (blocked) {
      unblockHostPattern(pattern);
      return;
    }
    if (el.hostDialogInput) {
      el.hostDialogInput.value = pattern;
      hostDialogState.pattern = pattern;
      hostDialogState.presetId = preset.id;
      hostDialogState.custom = !!preset.custom;
    }
    setText(el.hostDialogTitle, t("presetHostEditTitle"));
    if (el.hostDialog) el.hostDialog.hidden = false;
    if (el.hostDialogInput && el.hostDialogInput.focus) el.hostDialogInput.focus();
  }

  /** 保存"修改域名"。自定义预设就地改名；内置预设则屏蔽旧域名 + 复制规则到新域名。 */
  function saveHostPattern() {
    var value = String((el.hostDialogInput && el.hostDialogInput.value) || "").trim();
    var oldPattern = hostDialogState.pattern || "";
    var presetId = hostDialogState.presetId || "";
    if (!value || value === oldPattern) {
      if (el.hostDialog) el.hostDialog.hidden = true;
      return;
    }
    if (!/^(\*\.)?[A-Za-z0-9._-]+(:[0-9]+)?(\/.*)?$/.test(value)) {
      showStatusNotice(t("presetBadHost").replace("{host}", value));
      return;
    }
    if (el.hostDialog) el.hostDialog.hidden = true;
    if (hostDialogState.custom) {
      var next = state.customPresets.map(function (rule) {
        if (rule.id !== presetId) return rule;
        var copy = assign({}, rule);
        copy.hostPatterns = (rule.hostPatterns || []).map(function (item) {
          return item === oldPattern ? value : item;
        });
        return copy;
      });
      persistSiteData(next, state.blockedHosts);
      return;
    }
    // 内置预设：先取完整规则，再按新域名复制一条用户规则。
    invoke("webview/presetDetail", { id: presetId }, 15000).then(
      function (result) {
        var detail = result && result.preset ? result.preset : null;
        if (!detail) {
          showStatusNotice(t("presetSaveFailed"));
          return;
        }
        var rule = assign({}, detail);
        rule.id = "custom-" + Date.now().toString(36);
        rule.custom = true;
        rule.hostPatterns = [value];
        rule.blockedPatterns = [];
        // 名字加后缀：复制出来的规则和内置那条同名会让列表出现两行"一模一样的名字"。
        rule.name = String(detail.name || detail.id) + t("presetCopySuffix");
        rule.description = t("presetCustomDesc").replace("{hosts}", value);
        var nextCustom = [rule].concat(state.customPresets);
        var nextBlocked = (state.blockedHosts || []).slice();
        if (nextBlocked.indexOf(oldPattern) === -1) nextBlocked.push(oldPattern);
        persistSiteData(nextCustom, nextBlocked);
      },
      function () {
        showStatusNotice(t("presetSaveFailed"));
      }
    );
  }

  /* ── 滚动时降质 ─────────────────────────────────────────────────────── *
   *
   * 人眼在滚动时看不清细节，但停下来的瞬间很挑。所以：滚动期间把 JPEG 质量
   * 降到 60（每帧字节数减半，帧率立刻回升），停手 350ms 后恢复 85。
   */
  var LIVE_QUALITY_IDLE = 85;
  var LIVE_QUALITY_SCROLL = 60;
  var liveQualityState = { current: 0, timer: 0 };

  function requestLiveQuality(quality) {
    if (!liveState.active || liveState.paused) return;
    if (liveQualityState.current === quality) return;
    liveQualityState.current = quality;
    invoke("webview/liveQuality", { quality: quality }, 5000).catch(function () {
      return null;
    });
  }

  /** 滚动/滚轮期间调用；停手后自动恢复清晰度。 */
  function noteLiveScroll() {
    requestLiveQuality(LIVE_QUALITY_SCROLL);
    if (liveQualityState.timer) clearTimeout(liveQualityState.timer);
    liveQualityState.timer = setTimeout(function () {
      liveQualityState.timer = 0;
      requestLiveQuality(LIVE_QUALITY_IDLE);
    }, 350);
  }

  /** 进入/退出实时时把质量复位（否则可能停在 60 上）。 */
  function resetLiveQuality() {
    if (liveQualityState.timer) clearTimeout(liveQualityState.timer);
    liveQualityState.timer = 0;
    liveQualityState.current = 0;
    requestLiveQuality(LIVE_QUALITY_IDLE);
  }

  function resetLiveWorker() {
    liveWorkerState.busy = false;
  }

  function showLiveView(tab, options) {
    if (!tab || !tab.live || !tab.url) {
      hideLiveChrome();
      return Promise.resolve(false);
    }
    var opts = options || {};
    liveState.active = true;
    liveState.tabId = tab.id;
    liveState.paused = false;
    if (!opts.keepFrame) {
      liveState.ready = false;
      liveState.lastSeq = 0;
      liveState.pendingFrame = null;
      liveState.frameBusy = false;
      liveState.framesDrawn = 0;
      resetLiveWorker();
      resetLiveQuality();
      // 回到"还没出画面"的初始状态：两个绘制面都清掉。
      // 注意：canvas 可能已经把控制权交给了 worker，这时**不能**去动它的
      // width/height（会抛 InvalidStateError），只切显示状态。
      if (el.liveCanvas) {
        el.liveCanvas.removeAttribute("data-ready");
        el.liveCanvas.hidden = !liveWorkerState.worker;
      }
      if (el.liveFrame) {
        el.liveFrame.removeAttribute("data-ready");
        el.liveFrame.removeAttribute("src");
        el.liveFrame.hidden = false;
      }
      setLiveOverlay(true, t("liveOpening"), t("liveHint"), false);
    }
    showLiveChrome(tab);
    liveStatus(tab);
    syncToolbar();
    // 视口 = 面板尺寸（CSS 像素），DPR 交给 sidecar 按系统缩放栅格化。
    var viewport = liveViewportRequest();
    var openParams = { url: tab.url };
    if (viewport) {
      openParams.viewportWidth = viewport.width;
      openParams.viewportHeight = viewport.height;
      openParams.deviceScaleFactor = viewport.dpr;
      liveState.width = viewport.width;
      liveState.height = viewport.height;
      liveState.scale = viewport.dpr;
    }
    return invoke("webview/liveOpen", openParams, 45000).then(
      function (result) {
        if (result && result.viewport) {
          liveState.width = num(result.viewport.width, liveState.width);
          liveState.height = num(result.viewport.height, liveState.height);
          liveState.scale = num(result.viewport.scale, liveState.scale || 1);
        }
        liveState.starting = false;
        if (liveState.paused) {
          liveState.paused = false;
          invoke("webview/liveResume", {}, 8000).catch(function () {});
        }
        return true;
      },
      function (error) {
        liveState.starting = false;
        liveState.active = false;
        liveState.tabId = "";
        var message = humanError(error);
        setLiveOverlay(true, t("liveUnavailable"), message, true);
        showStatusNotice(t("liveFallback").replace("{error}", message));
        tab.live = false;
        hideLiveChrome();
        loadTab(tab, { push: false });
        syncToolbar();
        return false;
      }
    );
  }

  function openLive(tab, url, options) {
    if (!tab) return Promise.resolve(false);
    var target = url || tab.url;
    if (!isHttpUrl(target)) return Promise.resolve(false);
    var opts = options || {};
    tab.live = true;
    tab.url = target;
    tab.error = null;
    tab.notice = "";
    tab.loading = false;
    tab.payload = null;
    tab.warnings = [];
    if (opts.push !== false) commitHistory(tab, target);
    state.lastUrl = target;
    styleState.host = hostOf(target);
    state.activeTabId = tab.id;
    renderTabs();
    queuePersist();
    return showLiveView(tab, {});
  }

  function exitLive(tab) {
    var target = tab || activeTab();
    if (!target) return;
    target.live = false;
    liveState.active = false;
    liveState.tabId = "";
    liveState.ready = false;
    liveState.paused = false;
    hideLiveChrome();
    invoke("webview/livePause", {}, 5000).catch(function () {});
    queuePersist();
    syncToolbar();
    renderTabs();
    if (target.url) loadTab(target, { push: false });
    else renderEmpty(target);
  }

  function pauseLive() {
    if (!liveState.active || liveState.paused) return;
    liveState.paused = true;
    invoke("webview/livePause", {}, 5000).catch(function () {});
  }

  function resumeLive() {
    if (!liveState.active || !liveState.paused) return;
    var tab = activeTab();
    if (!tab || !tab.live || tab.id !== liveState.tabId) return;
    liveState.paused = false;
    invoke("webview/liveResume", {}, 5000).catch(function () {});
  }

  /**
   * 把一帧画到界面上。
   *
   * 现在的链路（按优先级）：
   *   1. **Worker + OffscreenCanvas**：解码与绘制都在 worker 里，主线程只在
   *      收帧时把 ArrayBuffer 转移过去，滚动时不会被解码拖住。
   *   2. **主线程 createImageBitmap**：worker 不可用时（CSP 限制等）退回。
   *   3. **img 降级**：更老的运行时。
   *
   * 帧数据来自二进制通道（`webview/liveFrame`），已经是原始 JPEG 字节，
   * 不再有 base64 解码这一步。
   */
  function applyLiveFrame() {
    if (!liveState.pendingFrame || liveState.frameBusy) return;
    var frame = liveState.pendingFrame;
    liveState.pendingFrame = null;

    var done = function () {
      liveState.frameBusy = false;
      if (liveState.pendingFrame) applyLiveFrame();
    };

    markLiveReady();

    var stats = window.__dbxLiveStats || (window.__dbxLiveStats = { received: 0, drawn: 0, bytes: 0 });
    var started = typeof performance !== "undefined" && performance.now ? performance.now() : 0;
    var canvas = el.liveCanvas;

    // 1) Worker 路径。**只有一个待画槽位**：`liveState.pendingFrame`。
    //    之前 worker 那边又留了一个 pending，worker 画完只去取自己那个槽，
    //    主线程排队的最新帧就没人处理 —— 表现是"只画第一帧然后卡住"。
    if (startLiveWorker(canvas)) {
      if (!liveWorkerState.ready) {
        // worker 还没 init 完：把帧放回去，等 ready 回调再取。
        liveState.pendingFrame = frame;
        return;
      }
      liveState.frameBusy = true;
      liveWorkerState.busy = true;
      try {
        liveWorkerState.worker.postMessage({ type: "frame", buffer: frame.bytes.buffer }, [
          frame.bytes.buffer
        ]);
      } catch (error) {
        liveState.frameBusy = false;
        liveWorkerState.busy = false;
      }
      return;
    }

    liveState.frameBusy = true;

    // 2) 主线程 createImageBitmap
    if (canvas && typeof window.createImageBitmap === "function" && typeof window.Blob === "function") {
      var blob = new Blob([frame.bytes], { type: "image/jpeg" });
      window.createImageBitmap(blob).then(
        function (bitmap) {
          if (started) {
            stats.decodeMs = (stats.decodeMs || 0) + (performance.now() - started);
            stats.decodeCount = (stats.decodeCount || 0) + 1;
          }
          if (!liveState.active || liveState.paused) {
            if (bitmap && bitmap.close) bitmap.close();
            done();
            return;
          }
          drawLiveBitmap(canvas, bitmap, done);
        },
        function () {
          done();
        }
      );
      return;
    }

    // 3) img 降级
    if (!el.liveFrame) {
      liveState.frameBusy = false;
      return;
    }
    el.liveFrame.hidden = false;
    if (canvas) canvas.hidden = true;
    var url = URL.createObjectURL(new Blob([frame.bytes], { type: "image/jpeg" }));
    var revoke = function () {
      URL.revokeObjectURL(url);
      done();
    };
    el.liveFrame.onload = revoke;
    el.liveFrame.onerror = revoke;
    el.liveFrame.src = url;
  }

  /* ── Worker 解码 ─────────────────────────────────────────────────────── */

  var liveWorkerState = { worker: null, ready: false, failed: false, busy: false, canvas: null };

  var LIVE_WORKER_CODE = [
    "var canvas = null;",
    "var ctx = null;",
    "self.onmessage = function (e) {",
    "  var m = e.data || {};",
    "  if (m.type === 'init') {",
    "    canvas = m.canvas; ctx = canvas.getContext('2d');",
    "    canvas.width = m.width; canvas.height = m.height;",
    "    self.postMessage({ type: 'ready' });",
    "    return;",
    "  }",
    "  if (m.type === 'frame') {",
    "    var bitmapPromise = self.createImageBitmap(new Blob([m.buffer], { type: 'image/jpeg' }));",
    "    bitmapPromise.then(function (bitmap) {",
    "      try {",
    "        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {",
    "          canvas.width = bitmap.width; canvas.height = bitmap.height;",
    "        }",
    "        ctx.imageSmoothingEnabled = true;",
    "        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';",
    "        ctx.drawImage(bitmap, 0, 0);",
    "      } catch (err) {}",
    "      if (bitmap.close) bitmap.close();",
    "      self.postMessage({ type: 'drawn' });",
    "    }, function () {",
    "      self.postMessage({ type: 'failed' });",
    "    });",
    "  }",
    "};"
  ].join("\n");

  /** 懒启动 worker；失败（CSP 不允许 blob worker 等）就永久降级。 */
  function startLiveWorker(canvas) {
    if (!canvas || liveWorkerState.failed) return false;
    if (liveWorkerState.worker) return true;
    if (
      typeof window.Worker !== "function" ||
      typeof window.Blob !== "function" ||
      typeof window.URL === "undefined" ||
      !canvas.transferControlToOffscreen
    ) {
      liveWorkerState.failed = true;
      return false;
    }
    try {
      var url = URL.createObjectURL(new Blob([LIVE_WORKER_CODE], { type: "text/javascript" }));
      var worker = new window.Worker(url);
      var offscreen = canvas.transferControlToOffscreen();
      liveWorkerState.worker = worker;
      liveWorkerState.canvas = canvas;
      worker.onmessage = function (event) {
        var message = event && event.data ? event.data : {};
        var stats = window.__dbxLiveStats;
        if (message.type === "ready") {
          liveWorkerState.ready = true;
          // init 期间排着的那一帧现在可以画了。
          if (liveState.pendingFrame) applyLiveFrame();
          return;
        }
        if (message.type === "drawn" || message.type === "failed") {
          liveWorkerState.busy = false;
          liveState.frameBusy = false;
          if (stats) {
            stats.worker = stats.worker || { ready: 0, drawn: 0, failed: 0 };
            if (message.type === "drawn") {
              stats.drawn += 1;
              stats.worker.drawn += 1;
            } else {
              stats.worker.failed += 1;
            }
          }
          // 关键：画完之后要回到**主线程的待画槽**继续取帧，
          // 否则排队的最新帧永远没人处理，画面停在第一帧。
          if (liveState.pendingFrame) applyLiveFrame();
        }
      };
      worker.onerror = function (event) {
        liveWorkerState.failed = true;
        var stats = window.__dbxLiveStats;
        if (stats) {
          stats.worker = stats.worker || { ready: 0, drawn: 0, failed: 0 };
          stats.worker.lastError = (event && event.message ? event.message : "worker error").slice(0, 200);
        }
        liveState.frameBusy = false;
        if (liveState.pendingFrame) applyLiveFrame();
      };
      // 画布一旦转交给 worker，主线程就不能再画了：直接从 <img> 切过去。
      canvas.hidden = false;
      if (el.liveFrame) el.liveFrame.hidden = true;
      worker.postMessage(
        {
          type: "init",
          canvas: offscreen,
          width: canvas.width || 640,
          height: canvas.height || 360
        },
        [offscreen]
      );
      return true;
    } catch (error) {
      liveWorkerState.failed = true;
      liveWorkerState.worker = null;
      return false;
    }
  }

  /** 在下一帧绘制，避免同一 tick 里画两次互相覆盖。 */
  function drawLiveBitmap(canvas, bitmap, done) {
    var paint = function () {
      try {
        // 第一次成功绘制时从 <img> 切到 <canvas>。
        if (canvas.hidden) {
          canvas.hidden = false;
          if (el.liveFrame) el.liveFrame.hidden = true;
        }
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        var ctx = canvas.getContext("2d");
        if (ctx) {
          // 缩放绘制时用高质量插值，避免文字发虚。
          ctx.imageSmoothingEnabled = true;
          if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
          ctx.drawImage(bitmap, 0, 0);
        }
        liveState.framesDrawn = (liveState.framesDrawn || 0) + 1;
        var stats = window.__dbxLiveStats;
        if (stats) stats.drawn += 1;
      } catch (error) {
        /* 画失败也继续，下一帧会重试 */
      }
      if (bitmap.close) bitmap.close();
      done();
    };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(paint);
    else paint();
  }

  /** 在下一帧绘制，避免同一 tick 里画两次互相覆盖。 */
  function drawLiveBitmap(canvas, bitmap, done) {
    var paint = function () {
      try {
        // 第一次成功绘制时从 <img> 切到 <canvas>。
        if (canvas.hidden) {
          canvas.hidden = false;
          if (el.liveFrame) el.liveFrame.hidden = true;
        }
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        var ctx = canvas.getContext("2d");
        if (ctx) {
          // 缩放绘制时用高质量插值，避免文字发虚。
          ctx.imageSmoothingEnabled = true;
          if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
          ctx.drawImage(bitmap, 0, 0);
        }
        liveState.framesDrawn = (liveState.framesDrawn || 0) + 1;
        var stats = window.__dbxLiveStats;
        if (stats) stats.drawn += 1;
      } catch (error) {
        /* 画失败也继续，下一帧会重试 */
      }
      if (bitmap.close) bitmap.close();
      done();
    };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(paint);
    else paint();
  }

  /** 第一帧到达时收起"正在启动"遮罩。 */
  function markLiveReady() {
    if (liveState.ready) return;
    liveState.ready = true;
    // 两个绘制面都标记 ready：canvas 优先，但降级时 <img> 也要能显示。
    if (el.liveCanvas) el.liveCanvas.setAttribute("data-ready", "1");
    if (el.liveFrame) el.liveFrame.setAttribute("data-ready", "1");
    setLiveOverlay(false);
    if (el.liveTips) {
      el.liveTips.hidden = false;
      if (liveState.hideTipsTimer) clearTimeout(liveState.hideTipsTimer);
      liveState.hideTipsTimer = setTimeout(function () {
        if (el.liveTips) el.liveTips.hidden = true;
      }, 9000);
    }
  }

  /** 当前真正在显示画面的元素（canvas 优先，其次 img）。 */
  function liveSurface() {
    if (el.liveCanvas && !el.liveCanvas.hidden) return el.liveCanvas;
    return el.liveFrame || null;
  }

  /* 二进制帧头：magic "LF1"(3) + seq(4) + width(2) + height(2)，后面是 JPEG。 */
  var LIVE_FRAME_HEADER = 11;

  /**
   * 收帧入口。两条来源都要走这里：
   *   · 二进制通道（`onBinary`，`stdio-framed`）：`data` 是 Uint8Array/ArrayBuffer；
   *   · 旧宿主的事件通道（base64 JSON）：为了兼容，仍然能解。
   */
  function ingestLiveFrame(bytes, seq, width, height) {
    if (!liveState.active || liveState.paused) return;
    if (!bytes || !bytes.length) return;
    if (seq && seq <= liveState.lastSeq) return;
    liveState.lastSeq = seq || liveState.lastSeq + 1;
    // 帧里的 width/height 是**采集像素**（设备像素），不能拿来当点击坐标的视口：
    // 视口是 CSS 像素，以 `liveState` 事件里的 viewport 为准。
    if (width) liveState.captureWidth = width;
    if (height) liveState.captureHeight = height;
    liveState.pendingFrame = { bytes: bytes };
    var stats = window.__dbxLiveStats || (window.__dbxLiveStats = { received: 0, drawn: 0, bytes: 0 });
    stats.received += 1;
    stats.bytes += bytes.length;
    applyLiveFrame();
  }

  /** 二进制事件：`{ channel, data }`，data 是原始字节。 */
  function onLiveBinary(payload) {
    if (!payload || payload.channel !== "webview/liveFrame") return;
    var raw = payload.data;
    var view;
    if (raw instanceof Uint8Array) view = raw;
    else if (raw instanceof ArrayBuffer) view = new Uint8Array(raw);
    else if (raw && raw.buffer instanceof ArrayBuffer) view = new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength || 0);
    else return;
    if (view.length <= LIVE_FRAME_HEADER) return;
    if (view[0] !== 0x4c || view[1] !== 0x46 || view[2] !== 0x31) return; // "LF1"
    var header = new DataView(view.buffer, view.byteOffset, LIVE_FRAME_HEADER);
    var seq = header.getUint32(3);
    var width = header.getUint16(7);
    var height = header.getUint16(9);
    // slice 出独立 ArrayBuffer：稍后要 transfer 给 worker，不能带着头部的偏移。
    var jpeg = view.slice(LIVE_FRAME_HEADER);
    ingestLiveFrame(jpeg, seq, width, height);
  }

  /** 旧宿主的事件通道（base64）。保留兼容：新宿主不会再走这里。 */
  function onLiveFrame(payload) {
    if (!payload || typeof payload.data !== "string" || !payload.data) return;
    var binary;
    try {
      binary = window.atob(payload.data);
    } catch (error) {
      return;
    }
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    ingestLiveFrame(bytes, num(payload.seq, 0), num(payload.width, 0), num(payload.height, 0));
  }

  function onLiveState(payload) {
    if (!payload) return;
    liveState.state = payload;
    // 视口是 CSS 像素，点击坐标要按它换算（采集像素是它的 DPR 倍）。
    if (payload.viewport) {
      liveState.width = num(payload.viewport.width, liveState.width);
      liveState.height = num(payload.viewport.height, liveState.height);
      liveState.scale = num(payload.viewport.scale, liveState.scale || 1);
    }
    var tab = byId(state.tabs, liveState.tabId) || activeTab();
    if (!tab) return;
    if (isHttpUrl(payload.url)) {
      var changed = tab.url !== payload.url;
      tab.url = payload.url;
      state.lastUrl = payload.url;
      if (changed && payload.title) recordHistory(payload.url, payload.title);
    }
    if (typeof payload.title === "string" && payload.title) tab.title = payload.title;
    tab.liveCanGoBack = payload.canGoBack === true;
    tab.liveCanGoForward = payload.canGoForward === true;
    if (el.addressInput && document.activeElement !== el.addressInput) el.addressInput.value = tab.url || "";
    if (el.addressScheme) setText(el.addressScheme, (tab.url || "").indexOf("https://") === 0 ? "🔒" : "○");
    liveStatus(tab);
    syncToolbar();
    renderTabs();
    syncDocTitle(tab);
    queuePersist();
  }

  function onLiveError(payload) {
    var message = payload && payload.message ? payload.message : t("liveError");
    setLiveOverlay(true, t("liveError"), message, true);
    showStatusNotice(message);
  }

  function livePoint(event) {
    // 用**当前实际显示画面的元素**取矩形：canvas 与 img 是同一个盒子，
    // 但对象可能已经切换，取错了会让点击整体偏移。
    var frame = liveSurface();
    if (!frame) return null;
    var rect = frame.getBoundingClientRect();
    var view = liveViewport();
    if (!rect.width || !rect.height) return null;
    var scale = Math.min(rect.width / view.width, rect.height / view.height);
    if (!scale) return null;
    var left = rect.left + (rect.width - view.width * scale) / 2;
    var top = rect.top + (rect.height - view.height * scale) / 2;
    var x = (event.clientX - left) / scale;
    var y = (event.clientY - top) / scale;
    return {
      x: clamp(x, 0, view.width),
      y: clamp(y, 0, view.height)
    };
  }

  function postLiveInput(event, timeoutMs) {
    return invoke("webview/liveInput", { event: event }, timeoutMs || 6000).catch(function () {
      return null;
    });
  }

  function sendLiveMouse(type, point, event) {
    if (!point) return;
    var payload = {
      kind: "mouse",
      type: type,
      x: Math.round(point.x),
      y: Math.round(point.y),
      button: type === "moved" ? "none" : "left",
      clickCount: clamp(num(event && event.detail, 1), 1, 3),
      modifiers: event ? liveModifiers(event) : 0
    };
    postLiveInput(payload);
  }

  function focusLiveInput(event) {
    if (!el.liveIme || !el.liveHost) return;
    var hostRect = el.liveHost.getBoundingClientRect();
    el.liveIme.style.left = Math.max(0, Math.min(hostRect.width - 2, event.clientX - hostRect.left)) + "px";
    el.liveIme.style.top = Math.max(0, Math.min(hostRect.height - 2, event.clientY - hostRect.top)) + "px";
    el.liveIme.style.bottom = "auto";
    try {
      el.liveIme.focus({ preventScroll: true });
    } catch (error) {
      el.liveIme.focus();
    }
  }

  function sendLiveText(text) {
    if (!text) return;
    postLiveInput({ kind: "text", text: text });
  }

  function sendLiveKey(event) {
    var key = event.key;
    var payload = {
      kind: "key",
      key: key,
      code: event.code || key,
      windowsVirtualKeyCode: event.keyCode || 0,
      modifiers: liveModifiers(event)
    };
    if (key === "Enter") payload.text = "\r";
    postLiveInput(assign({ type: "keyDown" }, payload));
    postLiveInput(assign({ type: "keyUp" }, payload));
  }

  function wireLiveView() {
    if (el.btnLive) {
      el.btnLive.addEventListener("click", function () {
        var tab = activeTab();
        if (!tab) return;
        if (!tab.url) {
          showStatusNotice(t("urlEmpty"));
          return;
        }
        if (tab.live) exitLive(tab);
        else openLive(tab, tab.url, { push: false });
      });
    }
    if (el.btnLiveExit) {
      el.btnLiveExit.addEventListener("click", function () {
        exitLive(activeTab());
      });
    }
    // 指针事件挂在**容器**上，而不是那张 <img>：
    // 画面可能在 <canvas> 与 <img> 之间切换，挂容器就不必跟着换监听。
    if (el.liveHost) {
      el.liveHost.addEventListener("mousedown", function (event) {
        if (event.button !== 0) return;
        // 遮罩层（正在启动/出错）显示时不要转发点击。
        if (el.liveOverlay && !el.liveOverlay.hidden) return;
        event.preventDefault();
        focusLiveInput(event);
        liveInput.pressed = true;
        sendLiveMouse("pressed", livePoint(event), event);
        if (el.liveTips) el.liveTips.hidden = true;
      });
      el.liveHost.addEventListener("mousemove", function (event) {
        if (liveInput.moveTimer) return;
        var point = livePoint(event);
        liveInput.moveTimer = requestAnimationFrame(function () {
          liveInput.moveTimer = 0;
          if (!liveState.ready) return;
          sendLiveMouse("moved", point, event);
        });
      });
      el.liveHost.addEventListener("wheel", function (event) {
        var point = livePoint(event);
        if (!point) return;
        event.preventDefault();
        // 滚动期间降质换帧率，停手 350ms 自动恢复。
        noteLiveScroll();
        postLiveInput({
          kind: "mouse",
          type: "wheel",
          x: Math.round(point.x),
          y: Math.round(point.y),
          deltaX: Math.round(event.deltaX),
          deltaY: Math.round(event.deltaY),
          modifiers: liveModifiers(event)
        });
      }, { passive: false });
      el.liveHost.addEventListener("contextmenu", function (event) {
        event.preventDefault();
      });
    }
    // 松开鼠标统一挂在 window 上（捕获阶段），而不是只挂在那张 <img> 上。
    //
    // 只挂 img 时，光标在按下之后移出画面、或被别的元素挡住（比如那个
    // 用来接输入法的透明输入框），mouseup 就收不到 —— 实时页面只收到
    // mousePressed、永远收不到 mouseReleased，于是**页面上什么都点不动**。
    // 这是"当前页面无法点击"的直接原因。
    window.addEventListener(
      "mouseup",
      function (event) {
        if (event.button !== 0 || !liveInput.pressed) return;
        liveInput.pressed = false;
        sendLiveMouse("released", livePoint(event), event);
      },
      true
    );
    if (el.liveIme) {
      el.liveIme.addEventListener("keydown", function (event) {
        if (event.isComposing || event.keyCode === 229) return;
        var key = event.key;
        var mod = event.ctrlKey || event.metaKey;
        if (mod && (key === "l" || key === "L")) {
          event.preventDefault();
          event.stopPropagation();
          if (el.addressInput) {
            el.addressInput.focus();
            el.addressInput.select();
          }
          return;
        }
        if (mod && (key === "r" || key === "R")) {
          event.preventDefault();
          event.stopPropagation();
          reload();
          return;
        }
        if (key === "Escape") return; // 交给全局热键切回伪装界面
        var special = [
          "Enter",
          "Backspace",
          "Tab",
          "Delete",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
          "PageUp",
          "PageDown"
        ];
        if (mod && /^[acvxzy]$/i.test(key)) {
          // 粘贴走 paste 事件（中文/多行更可靠），其余快捷键转给页面。
          if (key.toLowerCase() === "v") return;
          event.preventDefault();
          event.stopPropagation();
          sendLiveKey(event);
          return;
        }
        if (special.indexOf(key) !== -1) {
          event.preventDefault();
          event.stopPropagation();
          sendLiveKey(event);
        }
        // 普通字符不在这里转发：交给 input / compositionend 走 insertText。
      });
      el.liveIme.addEventListener("input", function () {
        if (liveInput.composing) return;
        var text = el.liveIme.value;
        if (!text) return;
        el.liveIme.value = "";
        sendLiveText(text);
      });
      el.liveIme.addEventListener("compositionstart", function () {
        liveInput.composing = true;
      });
      el.liveIme.addEventListener("compositionend", function (event) {
        liveInput.composing = false;
        var text = event.data || el.liveIme.value;
        el.liveIme.value = "";
        if (text) sendLiveText(text);
      });
      el.liveIme.addEventListener("paste", function (event) {
        var clipboard = event.clipboardData || window.clipboardData;
        var text = clipboard ? clipboard.getData("text") : "";
        event.preventDefault();
        if (text) sendLiveText(text);
      });
    }
  }

  function wireLiveEvents() {
    // 二进制通道：新宿主走这里（manifest 声明了 host.binary + stdio-framed）。
    if (plugin && typeof plugin.onBinary === "function") {
      try {
        plugin.onBinary(function (payload) {
          onLiveBinary(payload);
        });
      } catch (error) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[dbx-webview] binary subscription failed", error);
        }
      }
    }
    if (!plugin || typeof plugin.onEvent !== "function") return;
    try {
      plugin.onEvent(function (event) {
        var method = event && event.method ? event.method : "";
        var payload = event && event.params ? event.params : {};
        if (method === "webview/liveFrame") onLiveFrame(payload);
        else if (method === "webview/liveState") onLiveState(payload);
        else if (method === "webview/liveError") onLiveError(payload);
      });
    } catch (error) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[dbx-webview] live event subscription failed", error);
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 16. Chrome state (sidebar / drawer / panels)
   * ═══════════════════════════════════════════════════════════════════════ */
  /* 用户**主动**收起过侧栏吗？
     主动收起是明确意图，宽度变化不该把它翻回来；反之，因为"当时太窄"而被自动收起的，
     一旦变宽就应该自己回来。两者必须区分，否则会互相打架。 */
  var sidebarPinnedHidden = false;

  function setSidebar(visible) {
    var root = el.root;
    if (!root) return;
    var wide = window.innerWidth > 960;
    var value = visible ? (wide ? "shown" : "shown-mobile") : "hidden";
    root.dataset.sidebar = value;
    if (el.btnSidebarToggle) el.btnSidebarToggle.setAttribute("aria-pressed", visible ? "true" : "false");
    if (el.scrim) el.scrim.hidden = !(!wide && (visible || root.dataset.drawer === "open"));
  }

  /** 用户点工具栏那个按钮时走这里，记录他的明确意图。 */
  function toggleSidebar() {
    var next = !isSidebarVisible();
    sidebarPinnedHidden = !next;
    setSidebar(next);
  }

  function isSidebarVisible() {
    return el.root && el.root.dataset.sidebar !== "hidden";
  }

  function setDrawer(open) {
    var root = el.root;
    if (!root || !el.stylePanel) return;
    root.dataset.drawer = open ? "open" : "closed";
    el.stylePanel.hidden = !open;
    if (el.btnStyle) el.btnStyle.setAttribute("aria-expanded", open ? "true" : "false");
    if (el.scrim) el.scrim.hidden = !(!(window.innerWidth > 960) && (open || isSidebarVisible()));
  }

  /** 切换设置抽屉里的页签：样式 / 浏览器窗口 / 设置。 */
  function setDrawerTab(name) {
    var panes = { style: el.paneStyle, browser: el.paneBrowser, general: el.paneGeneral };
    if (!panes[name]) name = "style";
    state.drawerTab = name;
    Object.keys(panes).forEach(function (key) {
      var pane = panes[key];
      if (pane) pane.hidden = key !== name;
    });
    var tabs = el.drawerTabs ? el.drawerTabs.querySelectorAll("[data-drawer-tab]") : [];
    Array.prototype.forEach.call(tabs, function (button) {
      var selected = button.getAttribute("data-drawer-tab") === name;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.classList.toggle("dr__tab--active", selected);
    });
    // 「恢复默认」只对样式页签有意义。
    if (el.stylePanel) {
      var reset = el.stylePanel.querySelector(".dr__foot");
      if (reset) reset.hidden = name !== "style";
    }
    if (name === "browser") syncBrowserPanel();
    if (name === "style") syncCssValidation();
    // 切到「设置」页签时跑一次自检：这几项都是"现在的状态"，不该是打开时的快照。
    if (name === "general") renderDiagnostics();
  }

  function isDrawerOpen() {
    return el.root && el.root.dataset.drawer === "open";
  }

  function setPanel(name) {
    state.sidePanel = name;
    var tabs = el.sideTabs ? el.sideTabs.querySelectorAll(".sb__tab") : [];
    for (var i = 0; i < tabs.length; i += 1) {
      var selected = tabs[i].dataset.panel === name;
      tabs[i].setAttribute("aria-selected", selected ? "true" : "false");
    }
    var panels = document.querySelectorAll("[data-panel-view]");
    for (var j = 0; j < panels.length; j += 1) {
      panels[j].hidden = panels[j].dataset.panelView !== name;
    }
    // 切到「本地小说」时重画一次：书架/浏览记录/目录都可能在这期间变了。
    if (name === "local") renderLocalBookPanel();
    renderSidebar();
  }

  function confirmInline(button, message, onConfirm) {
    if (button.dataset.confirming === "1") {
      button.dataset.confirming = "";
      setText(button, t("clear"));
      onConfirm();
      return;
    }
    button.dataset.confirming = "1";
    setText(button, message);
    setTimeout(function () {
      if (button.dataset.confirming === "1") {
        button.dataset.confirming = "";
        setText(button, t("clear"));
      }
    }, 4000);
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 17. Wiring
   * ═══════════════════════════════════════════════════════════════════════ */
  function cacheElements() {
    el = {
      root: $("wbRoot"),
      bootBanner: $("bootBanner"),
      bootBannerText: $("bootBannerText"),
      sidebar: $("sidebar"),
      content: $("content"),
      contentView: $("contentView"),
      pageHost: $("pageHost"),
      scrim: $("scrim"),
      btnBack: $("btnBack"),
      btnForward: $("btnForward"),
      btnReload: $("btnReload"),
      btnSidebarToggle: $("btnSidebarToggle"),
      btnGo: $("btnGo"),
      btnCopyUrl: $("btnCopyUrl"),
      btnBookmark: $("btnBookmark"),
      bookmarkIcon: $("bookmarkIcon"),
      bookmarkText: $("bookmarkText"),
      btnOpenBrowser: $("btnOpenBrowser"),
      openBrowserText: $("openBrowserText"),
      btnLive: $("btnLive"),
      liveText: $("liveText"),
      liveHost: $("liveHost"),
      liveFrame: $("liveFrame"),
      liveCanvas: $("liveCanvas"),
      liveOverlay: $("liveOverlay"),
      liveSpinner: $("liveSpinner"),
      liveTitle: $("liveTitle"),
      liveHint: $("liveHint"),
      liveHud: $("liveHud"),
      liveBadge: $("liveBadge"),
      btnLiveExit: $("btnLiveExit"),
      liveTips: $("liveTips"),
      liveIme: $("liveIme"),
      localBookFile: $("localBookFile"),
      localImportText: $("localImportText"),
      btnLocalImport: $("btnLocalImport"),
      localBookInfo: $("localBookInfo"),
      localChapterList: $("localChapterList"),
      localHead: $("localHead"),
      tabLocalBook: $("tabLocalBook"),
      diagList: $("diagList"),
      diagLegend: $("diagLegend"),
      diagRefreshText: $("diagRefreshText"),
      btnDiagRefresh: $("btnDiagRefresh"),
      btnCatalog: $("btnCatalog"),
      catalogText: $("catalogText"),
      browserHistoryList: $("browserHistoryList"),
      btnBrowserOpen: $("btnBrowserOpen"),
      browserOpenText: $("browserOpenText"),
      btnBrowserFetch: $("btnBrowserFetch"),
      browserFetchText: $("browserFetchText"),
      browserFetchHint: $("browserFetchHint"),
      browserHint: $("browserHint"),
      browserCurrent: $("browserCurrent"),
      /* 自定义 CSS 的输入框与两个反馈位。
         它们以前**没被收进这张表**，于是 `syncCssValidation()` 里的 `el.styleCustomCss`
         永远是 null —— 语法校验和"是否生效"其实一直是死代码。
         tools/check-el-refs.mjs 会静态查出这类漏接线。 */
      styleCustomCss: $("styleCustomCss"),
      customCssIssues: $("customCssIssues"),
      customCssHint: $("customCssHint"),
      customCssStatus: $("customCssStatus"),
      browserProfile: $("browserProfile"),
      btnStyle: $("btnStyle"),
      btnStyleClose: $("btnStyleClose"),
      addressForm: $("addressForm"),
      addressInput: $("addressInput"),
      addressScheme: $("addressScheme"),
      modeSelect: $("modeSelect"),
      stylePanel: $("stylePanel"),
      sideTabs: $("sideTabs"),
      tabList: $("tabList"),
      presetList: $("presetList"),
      bookmarkList: $("bookmarkList"),
      historyList: $("historyList"),
      btnNewTab: $("btnNewTab"),
      btnPresetClear: $("btnPresetClear"),
      btnPresetNew: $("btnPresetNew"),
      hostMenu: $("hostMenu"),
      hostMenuLabel: $("hostMenuLabel"),
      hostMenuActions: $("hostMenuActions"),
      hostMenuEdit: $("hostMenuEdit"),
      hostMenuEditLabel: $("hostMenuEditLabel"),
      hostMenuDelete: $("hostMenuDelete"),
      hostMenuDeleteLabel: $("hostMenuDeleteLabel"),
      hostMenuConfirm: $("hostMenuConfirm"),
      hostMenuConfirmText: $("hostMenuConfirmText"),
      hostMenuConfirmYes: $("hostMenuConfirmYes"),
      hostMenuConfirmNo: $("hostMenuConfirmNo"),
      hostDialog: $("hostDialog"),
      hostDialogTitle: $("hostDialogTitle"),
      hostDialogInput: $("hostDialogInput"),
      hostDialogSave: $("hostDialogSave"),
      hostDialogCancel: $("hostDialogCancel"),
      presetForm: $("presetForm"),
      presetFormTitle: $("presetFormTitle"),
      pfName: $("pfName"),
      pfCategory: $("pfCategory"),
      pfHosts: $("pfHosts"),
      pfContent: $("pfContent"),
      pfRemove: $("pfRemove"),
      pfSearch: $("pfSearch"),
      pfMode: $("pfMode"),
      pfHint: $("pfHint"),
      pfSave: $("pfSave"),
      pfCancel: $("pfCancel"),
      btnHistoryClear: $("btnHistoryClear"),
      btnSidebarHide: $("btnSidebarHide"),
      stylePerSite: $("stylePerSite"),
      btnStyleTheme: $("btnStyleTheme"),
      btnStyleReset: $("btnStyleReset"),
      readerScope: $("readerScope"),
      readerCustom: $("readerCustom"),
      statusSpinner: $("statusSpinner"),
      statusState: $("statusState"),
      statusHttp: $("statusHttp"),
      statusPreset: $("statusPreset"),
      statusSep1: $("statusSep1"),
      statusUrl: $("statusUrl"),
      statusMeta: $("statusMeta"),
      statusNotice: $("statusNotice"),
      noticeBar: $("noticeBar"),
      /* 伪装层与设置面板 */
      coverLayer: $("coverLayer"),
      coverSettings: $("coverSettings"),
      coverRun: $("coverRun"),
      coverRunText: $("coverRunText"),
      coverConn: $("coverConn"),
      coverConnLabel: $("coverConnLabel"),
      coverDb: $("coverDb"),
      coverDbLabel: $("coverDbLabel"),
      coverStatus: $("coverStatus"),
      coverCode: $("coverCode"),
      coverGridHost: $("coverGridHost"),
      coverResultTitle: $("coverResultTitle"),
      coverSearch: $("coverSearch"),
      coverSearchLabel: $("coverSearchLabel"),
      coverCopy: $("coverCopy"),
      coverCopyText: $("coverCopyText"),
      coverExport: $("coverExport"),
      coverExportText: $("coverExportText"),
      coverResultMeta: $("coverResultMeta"),
      coverElapsed: $("coverElapsed"),
      coverFootLeft: $("coverFootLeft"),
      coverFootRight: $("coverFootRight"),
      settingsPanel: $("settingsPanel"),
      btnSettingsClose: $("btnSettingsClose"),
      /* 伪装层设置面板（只有外观 + 切换热键；其余开关在设置抽屉的「设置」页签） */
      coverThemeSegment: $("coverThemeSegment"),
      coverThemeLegend: $("coverThemeLegend"),
      coverHotkeyInput: $("coverHotkeyInput"),
      coverHotkeyLegend: $("coverHotkeyLegend"),
      coverHotkeyReset: $("coverHotkeyReset"),
      coverHotkeyHint: $("coverHotkeyHint"),
      /* 设置抽屉「设置」页签里的同一组控件 */
      themeSegment: $("themeSegment"),
      themeLegend: $("themeLegend"),
      hotkeyInput: $("hotkeyInput"),
      hotkeyLegend: $("hotkeyLegend"),
      btnHotkeyReset: $("btnHotkeyReset"),
      hotkeyHint: $("hotkeyHint"),
      coverOnStart: $("coverOnStart"),
      coverOnStartText: $("coverOnStartText"),
      coverHideOnFocus: $("coverHideOnFocus"),
      coverHideOnFocusText: $("coverHideOnFocusText"),
      coverHideOnBlur: $("coverHideOnBlur"),
      coverHideOnBlurText: $("coverHideOnBlurText"),
      readerLegend: $("readerLegend"),
      optMergePages: $("optMergePages"),
      optMergePagesText: $("optMergePagesText"),
      optTradToSimp: $("optTradToSimp"),
      optTradToSimpText: $("optTradToSimpText"),
      optVersion: $("optVersion"),
      /* 设置抽屉的三个页签 */
      drawerTabs: $("drawerTabs"),
      paneStyle: $("paneStyle"),
      paneBrowser: $("paneBrowser"),
      paneGeneral: $("paneGeneral"),
      tabStyleText: $("tabStyleText"),
      tabBrowserText: $("tabBrowserText"),
      tabGeneralText: $("tabGeneralText"),
      coverThemeSegment: $("coverThemeSegment"),
      coverHotkeyReset: $("coverHotkeyReset"),
      coverHotkeyInput: $("coverHotkeyInput")
    };
  }

  function wireToolbar() {
    // 沙箱 iframe 没有 allow-forms：既不能用 <form> 提交，也不能依赖 submit 事件，
    // 回车与「打开」按钮都由脚本直接处理。
    if (el.btnGo) {
      el.btnGo.addEventListener("click", function (event) {
        event.preventDefault();
        addressEdited = false;
        submitAddress();
      });
    }
    if (el.addressInput) {
      el.addressInput.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.keyCode !== 13) return;
        event.preventDefault();
        addressEdited = false;
        submitAddress();
      });
      el.addressInput.addEventListener("input", function () {
        addressEdited = true;
      });
      el.addressInput.addEventListener("blur", function () {
        addressEdited = false;
      });
    }
    if (el.btnBack) el.btnBack.addEventListener("click", goBack);
    if (el.btnForward) el.btnForward.addEventListener("click", goForward);
    if (el.btnReload) el.btnReload.addEventListener("click", reload);
    if (el.btnBookmark) el.btnBookmark.addEventListener("click", toggleBookmark);
    if (el.btnOpenBrowser) el.btnOpenBrowser.addEventListener("click", openInRealBrowser);
    if (el.btnCatalog) el.btnCatalog.addEventListener("click", goToCatalog);
    // 本地小说入口只在侧栏的「本地小说」页签里（工具栏不再占位）。
    if (el.btnLocalImport) el.btnLocalImport.addEventListener("click", pickLocalBook);
    // 面板里所有点击统一走委托（容器级，重绘不影响）。
    wireLocalPanelActions();
    if (el.btnDiagRefresh) {
      el.btnDiagRefresh.addEventListener("click", function () {
        renderDiagnostics();
      });
    }
    if (el.localBookFile) el.localBookFile.addEventListener("change", onLocalBookPicked);
    if (el.btnCopyUrl) el.btnCopyUrl.addEventListener("click", putUrlInAddressBar);
    if (el.btnBrowserOpen) el.btnBrowserOpen.addEventListener("click", openInRealBrowser);
    if (el.btnBrowserFetch) el.btnBrowserFetch.addEventListener("click", fetchBrowserUrl);
    setDrawerTab(state.drawerTab || "style");

    if (el.btnStyle) {
      el.btnStyle.addEventListener("click", function () {
        setDrawer(!isDrawerOpen());
      });
    }
    // 设置抽屉的页签
    if (el.drawerTabs) {
      el.drawerTabs.addEventListener("click", function (event) {
        var target = event.target;
        while (target && target !== el.drawerTabs && !target.getAttribute("data-drawer-tab")) {
          target = target.parentNode;
        }
        if (!target || target === el.drawerTabs) return;
        setDrawerTab(target.getAttribute("data-drawer-tab"));
      });
    }
    if (el.btnStyleClose) {
      el.btnStyleClose.addEventListener("click", function () {
        setDrawer(false);
      });
    }
    if (el.btnSidebarToggle) {
      el.btnSidebarToggle.addEventListener("click", toggleSidebar);
    }
    if (el.btnSidebarHide) {
      el.btnSidebarHide.addEventListener("click", function () {
        // 侧栏里那个「⟨」也是主动收起，同样记成明确意图。
        sidebarPinnedHidden = true;
        setSidebar(false);
      });
    }
    if (el.scrim) {
      el.scrim.addEventListener("click", function () {
        setDrawer(false);
        if (window.innerWidth <= 960) setSidebar(false);
      });
    }
    if (el.modeSelect) {
      el.modeSelect.addEventListener("change", function () {
        var tab = activeTab();
        if (!tab) return;
        var next = el.modeSelect.value;
        tab.mode = isMode(next) ? next : "reader";
        queuePersist();
        renderTabs();
        if (tab.url) loadTab(tab, { push: false });
        else refreshActiveTab(true);
      });
    }
  }

  function wireSidebar() {
    if (el.sideTabs) {
      el.sideTabs.addEventListener("click", function (event) {
        var button = event.target && event.target.closest ? event.target.closest(".sb__tab") : null;
        if (button && button.dataset.panel) setPanel(button.dataset.panel);
      });
    }
    if (el.btnNewTab) {
      el.btnNewTab.addEventListener("click", function () {
        var tab = createTab(null);
        queuePersist();
        renderTabs();
        syncToolbar();
        refreshActiveTab(true);
        if (el.addressInput) el.addressInput.focus();
        return tab;
      });
    }
    if (el.btnPresetNew) {
      el.btnPresetNew.addEventListener("click", function () {
        openPresetForm(null);
      });
    }
    if (el.pfSave) el.pfSave.addEventListener("click", savePresetForm);
    if (el.pfCancel) el.pfCancel.addEventListener("click", closePresetForm);
    if (el.presetForm) {
      // 表单里回车 = 保存；Esc = 取消。别让回车落到宿主的快捷键上。
      el.presetForm.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && event.target && event.target.tagName === "INPUT") {
          event.preventDefault();
          savePresetForm();
        } else if (event.key === "Escape") {
          event.preventDefault();
          closePresetForm();
        }
      });
    }
    if (el.hostMenuEdit) el.hostMenuEdit.addEventListener("click", editHostPattern);
    if (el.hostMenuDelete) el.hostMenuDelete.addEventListener("click", confirmHostDelete);
    if (el.hostMenuConfirmYes) el.hostMenuConfirmYes.addEventListener("click", confirmHostDelete);
    if (el.hostMenuConfirmNo) el.hostMenuConfirmNo.addEventListener("click", closeHostMenu);
    if (el.hostDialogSave) el.hostDialogSave.addEventListener("click", saveHostPattern);
    if (el.hostDialogCancel) {
      el.hostDialogCancel.addEventListener("click", function () {
        if (el.hostDialog) el.hostDialog.hidden = true;
      });
    }
    if (el.hostDialogInput) {
      el.hostDialogInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          saveHostPattern();
        } else if (event.key === "Escape") {
          event.preventDefault();
          if (el.hostDialog) el.hostDialog.hidden = true;
        }
      });
    }
    // 点空白 / 按 Esc / 滚动列表都要收起菜单，否则它会浮在那里。
    document.addEventListener("click", function (event) {
      if (el.hostMenu && !el.hostMenu.hidden) {
        if (!el.hostMenu.contains(event.target)) closeHostMenu();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && el.hostMenu && !el.hostMenu.hidden) closeHostMenu();
    });
    if (el.presetList) {
      el.presetList.addEventListener("scroll", closeHostMenu);
    }
    // 失焦（切到别的应用 / 触发伪装层）、页面隐藏、面板被切换，都要收起菜单。
    // 菜单是 position:fixed 的独立浮层，不属于被隐藏的容器，不会自己跟着消失。
    window.addEventListener("blur", closeHostMenu);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) closeHostMenu();
    });
    if (el.btnPresetClear) {
      el.btnPresetClear.addEventListener("click", function () {
        var tab = activeTab();
        if (!tab) return;
        tab.presetId = null;
        queuePersist();
        renderPresets();
        syncToolbar();
        refreshActiveTab(true);
        if (tab.url) loadTab(tab, { push: false });
      });
    }
    if (el.btnHistoryClear) {
      el.btnHistoryClear.addEventListener("click", function () {
        confirmInline(el.btnHistoryClear, t("clearHistoryConfirm"), clearHistory);
      });
    }
    wireLinkGuard();
  }

  /**
   * 链接守卫：**页面上任何一个链接被点，都不允许 iframe 自己导航走**。
   *
   * 这是一个真实踩过、且后果最严重的 bug：
   *   旧实现只判断 `event.target.tagName === "A"`。而真实站点的链接大量是
   *   `<a><span>下一章</span></a>` / `<a><img></a>`，点在里面的元素上时
   *   target 是 SPAN，判断直接 return —— 浏览器按默认行为**把插件的 iframe
   *   导航到了那个站点**。结果就是：插件界面（工具栏、热键）整个消失，
   *   只剩一个裸的网页，而且没有任何办法退回（我们的 JS 已经不在了）。
   *
   * 所以这里做三层：
   *   1. 用 `closest("a[href]")` 向上找锚点，不再依赖点中的是哪个子元素；
   *   2. 挂在 document 的**捕获阶段**，页面里任何链接都跑不掉；
   *   3. 只要点在链接上就 `preventDefault()` —— 哪怕是 mailto:、下载、
   *      或本来不打算处理的协议。宁可"点了没反应"，也不能让界面被销毁。
   *      中键（auxclick）同样处理，否则中键会触发一次默认导航。
   */
  function wireLinkGuard() {
    function anchorOf(event) {
      var target = event.target;
      if (!target || !target.closest) return null;
      // 图片/文字都可能被包在 <a> 里，所以必须向上找。
      var anchor = target.closest("a[href]");
      if (!anchor) return null;
      // 只处理正文与画廊里的链接；工具栏/侧栏自己的按钮不动。
      if (!anchor.closest(".page-content, .gallery, .doc")) return null;
      return anchor;
    }

    function onClick(event) {
      var anchor = anchorOf(event);
      if (!anchor) return;
      // 无论如何先掐掉默认行为：默认行为就是"导航走"。
      event.preventDefault();
      var href = anchor.getAttribute("href") || "";
      if (href === "" || href.charAt(0) === "#" || /^javascript:/i.test(href)) return;
      if (!isHttpUrl(href)) return;
      var tab = activeTab();
      if (tab) navigate(tab, href, { push: true });
    }

    document.addEventListener("click", onClick, true);
    // 中键/侧键：浏览器会用默认行为新开或导航，sandbox 挡不住自身导航。
    document.addEventListener(
      "auxclick",
      function (event) {
        if (anchorOf(event)) event.preventDefault();
      },
      true
    );
    // 兜底：如果还有漏网之鱼导致本页被导航，至少留一条日志便于排查。
    window.addEventListener("beforeunload", function () {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[dbx-webview] 页面正在离开插件（链接守卫漏了一个）");
      }
    });
  }

  function wireStylePanel() {
    if (el.stylePerSite) {
      el.stylePerSite.addEventListener("change", function () {
        setPerSite(el.stylePerSite.checked);
      });
    }
    STYLE_CONTROLS.forEach(function (control) {
      var input = $(control.id);
      if (!input) return;
      input.addEventListener("input", function () {
        // 自定义 CSS 边写边校验：写错了立刻看到，不用等打开浏览器窗口。
        if (control.key === "customCss") syncCssValidation();
        onStyleInput(control);
      });
    });
    if (el.btnStyleTheme) el.btnStyleTheme.addEventListener("click", useThemeColors);
    if (el.btnStyleReset) el.btnStyleReset.addEventListener("click", resetGlobalStyle);
  }

  function wireKeyboard() {
    document.addEventListener("keydown", function (event) {
      // 录制热键时不要触发任何快捷键。
      if (disguise.recording) return;

      // 伪装界面 / 阅读界面切换：默认 Escape，可在设置里改。
      // 放在最前面，且不受输入框限制——这个键就是用来“随时切走”的。
      if (hotkeyMatches(event, disguise.hotkey)) {
        event.preventDefault();
        event.stopPropagation();
        toggleCover();
        return;
      }

      // 伪装层显示期间，其它阅读相关快捷键一律不响应。
      if (disguise.active) return;

      var key = event.key;
      var mod = event.ctrlKey || event.metaKey;
      if (mod && (key === "l" || key === "L")) {
        event.preventDefault();
        if (el.addressInput) {
          el.addressInput.focus();
          el.addressInput.select();
        }
        return;
      }
      if (mod && (key === "r" || key === "R")) {
        event.preventDefault();
        reload();
        return;
      }
      if (event.altKey && key === "ArrowLeft") {
        event.preventDefault();
        goBack();
        return;
      }
      if (event.altKey && key === "ArrowRight") {
        event.preventDefault();
        goForward();
        return;
      }
      if (key === "Escape") {
        if (disguise.settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        if (isDrawerOpen()) {
          setDrawer(false);
          return;
        }
        if (window.innerWidth <= 960 && isSidebarVisible()) setSidebar(false);
      }
    });
  }

  function wireWindow() {
    // 滚动时记住阅读位置（防抖，避免每一帧都写存储）。
    if (el.contentView) {
      el.contentView.addEventListener(
        "scroll",
        debounce(function () {
          var tab = activeTab();
          if (!tab || !tab.payload || disguise.active) return;
          var view = el.contentView;
          var range = view.scrollHeight - view.clientHeight;
          if (range <= 40) return;
          saveProgress(tab.url, view.scrollTop / range);
        }, 600)
      );
    }
    window.addEventListener("resize", debounce(function () {
      var wide = window.innerWidth > 960;
      // 跟随宽度变化，**两个方向都要管**。
      // 以前这里只调 `setSidebar(isSidebarVisible())`，等于什么都不做：如果 start()
      // 恰好在窄宽度下跑过（面板刚打开、iframe 还没铺开），侧栏就被永久收起了 ——
      // 侧栏里的「本地小说」页签还在原坐标上，但被内容区盖住，点它毫无反应。
      if (wide && el.root && el.root.dataset.sidebar === "hidden" && !sidebarPinnedHidden) {
        setSidebar(true);
      } else if (!wide && isSidebarVisible()) {
        setSidebar(false);
      } else {
        setSidebar(isSidebarVisible());
      }
      setDrawer(isDrawerOpen());
      // 面板尺寸变了，采集尺寸也要跟着变：解码成本和像素数成正比，
      // 面板缩小时继续按旧尺寸采集就是纯浪费（反之会糊）。
      if (liveState.active && !liveState.paused) liveResizeDebounced();
      // 目录可视窗口的行数随面板高度变化，重算一次。
      refreshVirtualToc(true);
    }, 150));
    window.addEventListener("dbx-plugin-env", function () {
      var previous = locale;
      if (plugin) {
        locale = localeOf(plugin.locale);
        strings = COPY[locale];
      }
      if (locale !== previous) {
        applyCopy();
        renderTabs();
        renderSidebar();
        syncToolbar();
        syncStylePanel(styleForEdit());
        refreshActiveTab(true);
        if (disguise.active) renderCover();
      } else {
        applyReaderStyle(null);
      }
    });
    if (plugin && typeof plugin.onContext === "function") {
      try {
        plugin.onContext(function (context) {
          if (!context || typeof context !== "object") return;
          var url = extractContextUrl(context);
          if (url) openInTab(url);
        });
      } catch (error) {
        /* context subscription is optional */
      }
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) pauseLive();
      else resumeLive();
    });
  }

  function extractContextUrl(context) {
    var candidates = [context.url, context.URL, context.address];
    if (context.params && typeof context.params === "object") {
      candidates.push(context.params.url, context.params.URL);
    }
    if (context.workbench && typeof context.workbench === "object") {
      candidates.push(context.workbench.url);
    }
    for (var i = 0; i < candidates.length; i += 1) {
      if (typeof candidates[i] === "string" && isHttpUrl(candidates[i])) return candidates[i];
    }
    return "";
  }

  function applyTheme() {
    var theme = plugin && plugin.theme;
    var appearance = theme && typeof theme.appearance === "string" ? theme.appearance : "";
    if (appearance !== "light" && appearance !== "dark") {
      appearance = document.documentElement.dataset.dbxTheme === "dark" ? "dark" : "light";
    }
    // 用户在设置里强制日间 / 夜间时，覆盖宿主外观；「跟随 DBX」才用宿主的值。
    if (disguise.themeChoice === "light" || disguise.themeChoice === "dark") {
      appearance = disguise.themeChoice;
    }
    document.documentElement.dataset.dbxTheme = appearance;
    document.documentElement.dataset.themeChoice = disguise.themeChoice;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 21. 伪装层：热键、SQL 与结果网格
   * ═══════════════════════════════════════════════════════════════════════ */

  /* ── 热键 ─────────────────────────────────────────────────────────────── */

  /* 把 KeyboardEvent 归一成 "escape" / "alt+q" / "ctrl+shift+h" 这样的串。 */
  function hotkeyFromEvent(event) {
    var key = String(event.key || "").toLowerCase();
    if (!key || key === "control" || key === "shift" || key === "alt" || key === "meta") return "";
    var parts = [];
    if (event.ctrlKey) parts.push("ctrl");
    if (event.altKey) parts.push("alt");
    if (event.shiftKey) parts.push("shift");
    if (event.metaKey) parts.push("meta");
    parts.push(key === " " ? "space" : key);
    return parts.join("+");
  }

  function hotkeyMatches(event, spec) {
    if (!spec) return false;
    return hotkeyFromEvent(event) === spec;
  }

  /* 界面上显示得好看一点：Escape / Alt+Q / Ctrl+Shift+H */
  function hotkeyLabel(spec) {
    if (!spec) return "";
    return spec
      .split("+")
      .map(function (part) {
        if (part === "escape") return "Escape";
        if (part === "space") return "Space";
        if (part.length === 1) return part.toUpperCase();
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join("+");
  }

  /* ── 伪装界面：显示 / 隐藏 ────────────────────────────────────────────── */

  function setCover(active) {
    disguise.active = active !== false;
    if (el.coverLayer) el.coverLayer.hidden = !disguise.active;
    // 伪装层是浮在最上面的独立图层，右键菜单那种 fixed 浮层不受它约束：
    // 不主动收起来，就会出现"已经切到伪装界面了，菜单还飘在上面"（用户实测反馈）。
    closeHostMenu();
    if (el.hostDialog) el.hostDialog.hidden = true;
    // 伪装层出现时停止向 UI 推帧，切回来再继续；否则在后台白烧 CPU 和带宽。
    if (disguise.active) pauseLive();
    else resumeLive();
    // 两个方向的切换都要收起设置面板：它悬浮在右上角，留着会挡住阅读界面的工具栏。
    setSettingsOpen(false);
    // 伪装层出现时不要让它把焦点留在被遮住的输入框上。
    if (disguise.active && document.activeElement && document.activeElement.blur) {
      var tag = document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") document.activeElement.blur();
    }
    if (disguise.active) renderCover();
    // 键盘事件必须先落到 iframe 上，切换后主动拿回焦点。
    focusWorkbench();
  }

  function setSettingsOpen(open) {
    disguise.settingsOpen = open === true;
    if (el.settingsPanel) el.settingsPanel.hidden = !disguise.settingsOpen;
    if (el.coverSettings) el.coverSettings.setAttribute("aria-expanded", disguise.settingsOpen ? "true" : "false");
    if (disguise.settingsOpen) syncSettingsPanel();
  }

  /* iframe 只有在获得焦点时才收得到键盘事件；切换界面后主动抢一次焦点。 */
  function focusWorkbench() {
    try {
      window.focus();
      if (document.body && typeof document.body.focus === "function") {
        if (!document.body.hasAttribute("tabindex")) document.body.setAttribute("tabindex", "-1");
        document.body.focus({ preventScroll: true });
      }
    } catch (error) {
      /* 焦点拿不到不影响功能，只是热键要等用户点一下 */
    }
  }

  function setThemeChoice(choice) {
    disguise.themeChoice = choice === "light" || choice === "dark" ? choice : "follow";
    applyTheme();
    applyReaderStyle(null);
    syncSettingsPanel();
    persistDisguise();
  }

  /* ── SQL 与结果网格：从当前页面的真实结构推导出可信的"查询" ───────────── */

  /* 同一个域名永远给出同一套数据，避免每次刷新数字都在跳。 */
  function seedFrom(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash || 1;
  }

  function seededRandom(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function sqlString(value) {
    return "'" + String(value == null ? "" : value).replace(/'/g, "''") + "'";
  }

  /* 从当前标签页推导出"这套库表是干什么的"。 */
  function coverModel(tab) {
    var payload = (tab && tab.payload) || {};
    var raw = payload.url || payload.requestedUrl || (tab && tab.url) || "";
    var host = "";
    try {
      host = raw ? new URL(raw).hostname.replace(/^www\./, "") : "";
    } catch (error) {
      host = "";
    }
    var slug = host.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "app";
    var presetId = String(payload.presetId || "");
    var category = "";
    for (var i = 0; i < state.presets.length; i += 1) {
      if (state.presets[i] && state.presets[i].id === presetId) category = state.presets[i].category || "";
    }

    var table = "page_snapshots";
    var titleCol = "title";
    var columns = [
      { key: "id", label: "id", type: "bigint", numeric: true },
      { key: "title", label: "title", type: "text" },
      { key: "status", label: "status", type: "text" },
      { key: "views", label: "views", type: "integer", numeric: true },
      { key: "ratio", label: "ratio", type: "numeric(5,2)", numeric: true }
    ];

    if (payload.chapters && payload.chapters.length) {
      table = slug + "_chapters";
      titleCol = "chapter";
      columns = [
        { key: "id", label: "id", type: "bigint", numeric: true },
        { key: "chapter", label: "chapter", type: "text" },
        { key: "words", label: "words", type: "integer", numeric: true },
        { key: "views", label: "views", type: "integer", numeric: true },
        { key: "ratio", label: "ratio", type: "numeric(5,2)", numeric: true }
      ];
    } else if (category.indexOf("小说") >= 0) {
      table = slug + "_chapters";
      titleCol = "chapter";
      columns = [
        { key: "id", label: "id", type: "bigint", numeric: true },
        { key: "chapter", label: "chapter", type: "text" },
        { key: "words", label: "words", type: "integer", numeric: true },
        { key: "views", label: "views", type: "integer", numeric: true },
        { key: "ratio", label: "ratio", type: "numeric(5,2)", numeric: true }
      ];
    } else if (category.indexOf("资讯") >= 0 || category.indexOf("博客") >= 0 || category.indexOf("文档") >= 0 || category.indexOf("百科") >= 0) {
      table = slug + "_cms_articles";
      columns = [
        { key: "id", label: "id", type: "bigint", numeric: true },
        { key: "title", label: "title", type: "text" },
        { key: "status", label: "status", type: "text" },
        { key: "reads", label: "reads", type: "integer", numeric: true },
        { key: "ratio", label: "ratio", type: "numeric(5,2)", numeric: true }
      ];
    } else if (category.indexOf("社交") >= 0 || category.indexOf("社区") >= 0 || category.indexOf("视频") >= 0 || category.indexOf("问答") >= 0) {
      table = slug + "_contents";
      columns = [
        { key: "id", label: "id", type: "bigint", numeric: true },
        { key: "title", label: "title", type: "text" },
        { key: "status", label: "status", type: "text" },
        { key: "views", label: "views", type: "integer", numeric: true },
        { key: "ratio", label: "ratio", type: "numeric(5,2)", numeric: true }
      ];
    }

    return { host: host, slug: slug, table: table, titleCol: titleCol, columns: columns, payload: payload };
  }

  /* 生成一段看起来很正常的排查 SQL。
     刻意全部使用英文与数字：结果网格里出现中文会和"数据库客户端"的观感冲突，
     也容易被一眼看出是假数据。 */
  function coverSql(model) {
    var table = model.table;
    var lines = [];
    lines.push("-- " + (model.host || "local") + " content store · weekly check");
    lines.push("-- watch: status mix, view magnitude, completion outliers");
    lines.push("-- note: read-only role, DDL disabled");
    lines.push("select");
    lines.push("    id,");
    lines.push("    " + model.titleCol + ",");
    lines.push("    status,");
    lines.push("    views,");
    lines.push("    round(done_views::numeric / nullif(views, 0), 4) as ratio");
    lines.push("from " + table);
    lines.push("where status in ('draft', 'review', 'published', 'archived')");
    lines.push("  and created_at >= now() - interval '90 days'");
    lines.push("order by views desc");
    lines.push("limit 50;");
    return lines.join("\n");
  }

  /* 结果行：全部英文 + 数字，且同一域名每次给出同一批数据。 */
  function coverRows(model) {
    var random = seededRandom(seedFrom(model.host || model.table));
    var statuses = ["published", "published", "published", "review", "draft", "archived"];
    var titles = [];

    // 条数跟着真实内容量走：页面越大、章节越多，"数据集"看起来也越大。
    // 点「运行」重跑一次时数字会随之变化，这比永远固定的行数可信得多。
    var volume = num(model.payload.textLength, 0) + num(model.payload.chapters && model.payload.chapters.length, 0) * 40;
    var span = Math.max(14, Math.min(38, 12 + Math.round(volume / 260)));
    var paused = model.paused === true;
    var target = paused ? span + 1 + Math.abs(model.bump || 0) : span;
    target = Math.max(8, Math.min(60, target));

    // 英文标识符：小说站用 chapter_，其它用 record_ / item_。
    var noun = model.titleCol === "chapter" ? "chapter" : model.host ? "item" : "record";
    var width = target >= 100 ? 4 : 3;
    while (titles.length < target) {
      var index = titles.length + 1;
      var serial = ("000" + index).slice(-width);
      var mix = Math.floor(random() * 900 + 100);
      titles.push(noun + "_" + serial + "_" + mix);
    }

    var startId = 1048576 + Math.floor(random() * 90000) + (paused ? (model.bump || 0) * 13 : 0);
    return titles.slice(0, target).map(function (title, index) {
      var views = Math.floor(random() * 98000) + 320;
      var ratio = 0.18 + random() * 0.72;
      // 分区归属：前 1/3 归"近 90 天"，中间 1/3 归"归档"，其余算通用行。
      // 顶部下拉切分区时行数会变，但**不会变成 0**。
      var third = Math.max(1, Math.ceil(target / 3));
      var segment = index < third ? 0 : index < third * 2 ? 1 : 2;
      return {
        id: startId + index * (model.titleCol === "chapter" ? 1 : 7),
        title: title,
        words: Math.floor(random() * 5200) + 900,
        views: views,
        reads: views,
        status: statuses[Math.floor(random() * statuses.length)],
        ratio: ratio,
        segment: segment
      };
    });
  }

  function highlightSql(sql) {
    var escaped = String(sql)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    // 注释 -> 关键字 -> 字符串 -> 数字
    escaped = escaped.replace(/(--[^\n]*)/g, '<span class="c">$1</span>');
    escaped = escaped.replace(
      /\b(select|from|where|and|or|in|order|by|limit|group|having|round|nullif|as|interval|now|desc|asc|join|left|on|count|sum|avg|case|when|then|else|end|not|is|null|numeric|integer|text|bigint)\b/gi,
      '<span class="k">$1</span>'
    );
    escaped = escaped.replace(/('[^']*')/g, '<span class="s">$1</span>');
    escaped = escaped.replace(/\b(\d+)\b/g, '<span class="n">$1</span>');
    return escaped;
  }

  function formatNumber(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* 把当前页面渲染成一个 SQL 工作台：连接名、SQL、结果网格。 */
  function renderCover(runState) {
    if (!el.coverLayer) return;
    var tab = activeTab();
    var model = coverModel(tab);
    if (runState) {
      model.paused = runState.paused === true;
      model.bump = num(runState.bump, 0);
    }
    var columns = model.columns;
    var rows = coverRows(model);
    var visible = columns.filter(function (column) {
      if (column.key === "words") return model.titleCol === "chapter";
      if (column.key === "reads") return model.titleCol === "title" && model.table.indexOf("cms") >= 0;
      return true;
    });

    if (el.coverCode) el.coverCode.innerHTML = highlightSql(coverSql(model));
    if (el.coverResultMeta) setText(el.coverResultMeta, t("coverRows").replace("{n}", String(rows.length)));
    if (el.coverStatus) setText(el.coverStatus, t("coverReady"));
    if (el.coverFootLeft) setText(el.coverFootLeft, t("coverFootLeft"));
    if (el.coverFootRight) {
      setText(el.coverFootRight, (disguise.host || model.host || "localhost") + " · postgres 16.3");
    }
    if (el.coverElapsed) setText(el.coverElapsed, (18 + (model.host.length % 40)) + " ms");

    var connections = el.coverConn;
    if (connections && !connections.options.length) {
      [
        "prod-readonly · 10.12.4.31:5432",
        "staging · 10.12.9.7:5432",
        "warehouse · 10.20.1.8:5432"
      ].forEach(function (label, index) {
        var option = node("option", null, label);
        option.value = label;
        if (index === 0) option.selected = true;
        connections.appendChild(option);
      });
    }
    var databases = el.coverDb;
    if (databases) {
      // 下拉在"同一张表的分区"之间切换，而不是切到别的库——切到别的库结果会永远是
      // 0 行，那比不能点更可疑。三个选项行数各不相同，但**默认那个一定非空**。
      var wanted = [model.table, model.table + "_recent", model.table + "_archive"];
      var current = Array.prototype.map.call(databases.options, function (option) {
        return option.text;
      }).join("|");
      if (current !== wanted.join("|")) {
        clear(databases);
        wanted.forEach(function (label, index) {
          var option = node("option", null, label);
          option.value = String(index);
          if (index === 0) option.selected = true;
          databases.appendChild(option);
        });
      } else {
        // 表格换了一批（切页面/切标签）时把选择复位到"全部"，免得停在空分区上。
        databases.value = "0";
      }
    }

    if (!el.coverGridHost) return;
    clear(el.coverGridHost);
    var table = node("table", "cv__grid");
    var thead = node("thead");
    var headRow = node("tr");
    headRow.appendChild(node("th", null, "#"));
    visible.forEach(function (column) {
      var cell = node("th");
      cell.appendChild(node("span", null, column.label));
      cell.appendChild(document.createTextNode(" "));
      cell.appendChild(node("span", "cv__type", column.type));
      headRow.appendChild(cell);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = node("tbody");
    rows.forEach(function (row, index) {
      var tr = node("tr");
      // 分区：0 全部 / 1 近 90 天 / 2 归档。默认显示 0，所以一进来就有数据。
      tr.setAttribute("data-segment", String(row.segment === undefined ? 0 : row.segment));
      tr.appendChild(node("td", null, String(index + 1)));
      visible.forEach(function (column) {
        var value = row[column.key];
        var cell = node("td", column.numeric ? "cv__num" : null);
        if (column.key === "id") cell.textContent = String(value);
        else if (column.key === "views" || column.key === "reads") cell.textContent = formatNumber(value);
        else if (column.key === "ratio") cell.textContent = Number(value).toFixed(2);
        else if (column.key === "words") cell.textContent = formatNumber(value);
        else cell.textContent = String(value);
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    el.coverGridHost.appendChild(table);

    // 结果区的小工具要能真的用：筛选、复制、导出。
    // 这些是"伪装可信度"的关键——点了没反应的界面反而更可疑。
    applyCoverFilter();
  }

  /**
   * 过滤当前结果行。两个入口共用这一条链路：
   *   * 顶部「检索」框 —— 按关键字匹配任意列；
   *   * 顶部「数据库」下拉 —— 按行的 `data-source`（分库）过滤。
   * 合并条件，任一不满足就隐藏；状态栏与行数都跟着更新。
   */
  function applyCoverFilter() {
    var host = el.coverGridHost;
    if (!host) return;
    var keyword = el.coverSearch ? String(el.coverSearch.value || "").trim().toLowerCase() : "";
    var segment = el.coverDb ? String(el.coverDb.value || "0") : "0";
    var rows = host.querySelectorAll("tbody tr");
    var shown = 0;
    Array.prototype.forEach.call(rows, function (row) {
      var hitKeyword = !keyword || row.textContent.toLowerCase().indexOf(keyword) >= 0;
      // data-segment: 0 = 全部行（每行都带 0），1/2 = 只显示对应分区。
      // 这样"选了某个分区"永远有数据，不会出现 0 行。
      var rowSegment = row.getAttribute("data-segment") || "0";
      var hitSegment = segment === "0" || rowSegment === segment || rowSegment === "0";
      var hit = hitKeyword && hitSegment;
      row.hidden = !hit;
      if (hit) shown += 1;
    });
    if (el.coverResultMeta) {
      setText(el.coverResultMeta, t("coverRows").replace("{n}", String(shown)));
    }
    if (el.coverStatus) {
      setText(el.coverStatus, keyword || segment !== "0" ? t("coverFiltered") : t("coverReady"));
    }
  }

  /** 把当前结果复制成 TSV（Excel 直接能粘）。 */
  function copyCoverResult() {
    var host = el.coverGridHost;
    if (!host) return;
    var lines = [];
    Array.prototype.forEach.call(host.querySelectorAll("tr"), function (row) {
      if (row.hidden) return;
      var cells = Array.prototype.map.call(row.children, function (cell) {
        return cell.textContent.trim().replace(/\s+/g, " ");
      });
      lines.push(cells.join("\t"));
    });
    if (!lines.length) return;
    var payload = lines.join("\n");
    try {
      if (plugin && typeof plugin.copy === "function") plugin.copy(payload);
    } catch (error) {
      void error;
    }
    if (el.coverStatus) setText(el.coverStatus, t("coverCopied"));
  }

  /**
   * 把可见行按 CSV 格式复制到剪贴板。
   *
   * 沙箱 iframe 里**没有下载通道**（没有 allow-downloads，也不能开新窗口写文件），
   * 所以这里只做"复制成 CSV"，不假装能导出文件。
   */
  function exportCoverResult() {
    var host = el.coverGridHost;
    if (!host) return;
    var lines = [];
    Array.prototype.forEach.call(host.querySelectorAll("tr"), function (row) {
      if (row.hidden) return;
      var cells = Array.prototype.map.call(row.children, function (cell) {
        var text = cell.textContent.trim().replace(/\s+/g, " ");
        return '"' + text.replace(/"/g, '""') + '"';
      });
      lines.push(cells.join(","));
    });
    if (lines.length < 2) return;
    var payload = lines.join("\n");
    try {
      if (plugin && typeof plugin.copy === "function") plugin.copy(payload);
    } catch (error) {
      void error;
    }
    if (el.coverStatus) {
      setText(el.coverStatus, t("coverExported").replace("{n}", String(lines.length - 1)));
    }
  }

  /* ── 设置面板 ─────────────────────────────────────────────────────────── */

  function syncSettingsPanel() {
    setText($("settingsTitle"), t("settings"));
    // 「外观 + 切换热键」两组在**两个地方**各有一份：伪装层的设置面板，以及设置抽屉的
    // 「设置」页签。两份都要同步，所以下面统一按 [cover, drawer] 处理。
    ["", "cover"].forEach(function (prefix) {
      var scope = prefix ? "cover" : "";
      setText($(scope ? "coverThemeLegend" : "themeLegend"), t("themeLegend"));
      setText($(scope ? "coverHotkeyLegend" : "hotkeyLegend"), t("hotkeyLegend"));
      setText($(scope ? "coverHotkeyHint" : "hotkeyHint"), t("hotkeyHint"));
      setText($(scope ? "coverHotkeyReset" : "btnHotkeyReset"), t("hotkeyReset"));
      ["light", "dark", "follow"].forEach(function (choice) {
        var id = scope
          ? "coverTheme" + choice.charAt(0).toUpperCase() + choice.slice(1)
          : "theme" + choice.charAt(0).toUpperCase() + choice.slice(1);
        setText($(id), t(choice === "light" ? "themeLight" : choice === "dark" ? "themeDark" : "themeFollow"));
      });
      var segment = $(scope ? "coverThemeSegment" : "themeSegment");
      if (segment) {
        Array.prototype.forEach.call(segment.querySelectorAll("[data-theme-choice]"), function (button) {
          var current = button.getAttribute("data-theme-choice");
          button.setAttribute("aria-pressed", current === disguise.themeChoice ? "true" : "false");
        });
      }
      var input = $(scope ? "coverHotkeyInput" : "hotkeyInput");
      if (input && !disguise.recording) input.value = hotkeyLabel(disguise.hotkey);
    });
    setText($("coverOnStartText"), t("coverOnStart"));
    setText($("coverHideOnFocusText"), t("coverHideOnFocus"));
    setText($("coverHideOnBlurText"), t("coverHideOnBlur"));
    setText($("coverRunText"), t("coverRun"));
    setText($("coverConnLabel"), t("coverConn"));
    setText($("coverDbLabel"), t("coverDb"));
    setText($("localHead"), t("localHead"));
    setText($("localImportText"), t("localImport"));
    setText($("tabLocalBook"), t("localBook"));
    setText($("coverResultTitle"), t("coverResult"));
    setText($("coverSearchLabel"), t("coverSearchLabel"));
    setText($("coverCopyText"), t("coverCopy"));

    var onStart = $("coverOnStart");
    if (onStart) onStart.checked = disguise.onStart === true;
    var hideOnFocus = $("coverHideOnFocus");
    if (hideOnFocus) hideOnFocus.checked = disguise.hideOnFocus === true;
    var hideOnBlur = $("coverHideOnBlur");
    if (hideOnBlur) hideOnBlur.checked = disguise.hideOnBlur === true;
    var mergePages = $("optMergePages");
    if (mergePages) mergePages.checked = disguise.mergePages !== false;
    var trad = $("optTradToSimp");
    if (trad) {
      trad.checked = tradToSimp.available && tradToSimp.enabled === true;
      // 字库没读出来时不要让用户点一个不会生效的开关，并说明原因。
      trad.disabled = !tradToSimp.available;
      if (!tradToSimp.available) trad.checked = false;
      trad.title = tradToSimp.available ? "" : TRAD2SIMP_FALLBACK_TEXT;
    }
    setText($("readerLegend"), t("readerLegend"));
    setText($("optMergePagesText"), t("optMergePages"));
    setText($("optTradToSimpText"), t("optTradToSimp"));
    setText(
      $("optVersion"),
      "com.dbx.webview " + (disguise.version || "?") + (tradToSimp.available ? "" : " · 未加载繁简表")
    );
  }

  function persistDisguise() {
    storeSet(STORAGE_KEYS.disguise, {
      onStart: disguise.onStart === true,
      hideOnFocus: disguise.hideOnFocus === true,
      hideOnBlur: disguise.hideOnBlur === true,
      mergePages: disguise.mergePages !== false,
      tradToSimp: tradToSimp.enabled === true,
      hotkey: disguise.hotkey,
      themeChoice: disguise.themeChoice
    });
  }

  function loadDisguise(raw) {
    if (!raw || typeof raw !== "object") return;
    if (typeof raw.hotkey === "string" && raw.hotkey) disguise.hotkey = raw.hotkey;
    if (raw.themeChoice === "light" || raw.themeChoice === "dark" || raw.themeChoice === "follow") {
      disguise.themeChoice = raw.themeChoice;
    }
    if (typeof raw.onStart === "boolean") disguise.onStart = raw.onStart;
    if (typeof raw.hideOnFocus === "boolean") disguise.hideOnFocus = raw.hideOnFocus;
    if (typeof raw.hideOnBlur === "boolean") disguise.hideOnBlur = raw.hideOnBlur;
    if (typeof raw.mergePages === "boolean") disguise.mergePages = raw.mergePages;
    if (typeof raw.tradToSimp === "boolean") {
      // 用户显式关过就尊重他的选择；否则保持默认开启（内置字库是完整的）。
      tradToSimp.enabled = raw.tradToSimp;
    }
  }

  function wireCover() {
    if (el.coverSettings) {
      el.coverSettings.addEventListener("click", function (event) {
        event.stopPropagation();
        setSettingsOpen(!disguise.settingsOpen);
      });
    }
    if (el.btnSettingsClose) {
      el.btnSettingsClose.addEventListener("click", function () {
        setSettingsOpen(false);
      });
    }
    if (el.coverRun) {
      el.coverRun.addEventListener("click", function () {
        // 看起来像真的在跑查询：状态变化 + 行数/耗时轻微波动。
        // 数字变了才可信，永远一样反而假。
        if (el.coverStatus) setText(el.coverStatus, t("coverRunning"));
        el.coverRun.disabled = true;
        window.setTimeout(function () {
          coverRunBump += 1;
          renderCover({ paused: true, bump: coverRunBump });
          if (el.coverStatus) setText(el.coverStatus, t("coverDone"));
          el.coverRun.disabled = false;
        }, 220 + Math.floor(Math.random() * 260));
      });
    }
    // Ctrl/Cmd+Enter 跑查询：数据库客户端里这是肌肉记忆，缺了会显得假。
    if (el.coverLayer) {
      el.coverLayer.addEventListener("keydown", function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && el.coverRun) {
          event.preventDefault();
          el.coverRun.click();
        }
      });
    }
    // 结果区的小工具：复制、导出。
    if (el.coverSearch) {
      el.coverSearch.addEventListener("input", applyCoverFilter);
      el.coverSearch.placeholder = t("coverSearchPlaceholder");
    }
    if (el.coverCopy) el.coverCopy.addEventListener("click", copyCoverResult);
    if (el.coverExport) el.coverExport.addEventListener("click", exportCoverResult);
    // 连接 / 数据库下拉：切换时过滤结果并给状态反馈，别让它们像摆设。
    if (el.coverConn) {
      el.coverConn.addEventListener("change", function () {
        if (el.coverStatus) setText(el.coverStatus, t("coverSwitched"));
        if (el.coverFootRight) {
          setText(el.coverFootRight, String(el.coverConn.value || "").split(" · ")[0] + " · postgres 16.3");
        }
      });
    }
    if (el.coverDb) {
      el.coverDb.addEventListener("change", function () {
        applyCoverFilter();
      });
    }
    // 外观 + 切换热键在两个地方各有一份（伪装层的设置面板、设置抽屉的「设置」页签），
    // 所以按同一套逻辑把两份都接上。
    [
      { segment: el.coverThemeSegment, reset: el.coverHotkeyReset, input: el.coverHotkeyInput },
      { segment: el.themeSegment, reset: el.btnHotkeyReset, input: el.hotkeyInput }
    ].forEach(function (group) {
      if (group.segment) {
        group.segment.addEventListener("click", function (event) {
          var target = event.target;
          while (target && target !== group.segment && !target.getAttribute("data-theme-choice")) {
            target = target.parentNode;
          }
          if (!target || target === group.segment) return;
          setThemeChoice(target.getAttribute("data-theme-choice"));
        });
      }
      if (group.reset) {
        group.reset.addEventListener("click", function () {
          disguise.hotkey = DEFAULT_HOTKEY;
          persistDisguise();
          syncSettingsPanel();
        });
      }
      var input = group.input;
      if (!input) return;
      input.addEventListener("click", function () {
        disguise.recording = true;
        input.dataset.recording = "1";
        input.value = t("hotkeyRecording");
        input.focus();
      });
      input.addEventListener("blur", function () {
        disguise.recording = false;
        input.dataset.recording = "0";
        syncSettingsPanel();
      });
      input.addEventListener("keydown", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Tab") {
          input.blur();
          return;
        }
        var spec = hotkeyFromEvent(event);
        if (!spec) return; // 单独的修饰键继续等
        disguise.hotkey = spec;
        disguise.recording = false;
        input.dataset.recording = "0";
        persistDisguise();
        syncSettingsPanel();
        input.blur();
      });
    });
    if (el.coverOnStart) {
      el.coverOnStart.addEventListener("change", function () {
        disguise.onStart = el.coverOnStart.checked === true;
        persistDisguise();
      });
    }
    if (el.coverHideOnFocus) {
      el.coverHideOnFocus.addEventListener("change", function () {
        disguise.hideOnFocus = el.coverHideOnFocus.checked === true;
        persistDisguise();
      });
    }
    if (el.coverHideOnBlur) {
      el.coverHideOnBlur.addEventListener("change", function () {
        disguise.hideOnBlur = el.coverHideOnBlur.checked === true;
        persistDisguise();
      });
    }
    if (el.optMergePages) {
      el.optMergePages.addEventListener("change", function () {
        disguise.mergePages = el.optMergePages.checked === true;
        persistDisguise();
      });
    }
    if (el.optTradToSimp) {
      el.optTradToSimp.addEventListener("change", function () {
        tradToSimp.enabled = el.optTradToSimp.checked === true;
        persistDisguise();
        // 切换后立刻按当前设置重绘，不必重新抓取。
        if (state.activeTabId) {
          var tab = activeTab();
          if (tab && tab.payload) renderPage(tab);
        }
      });
    }
    // 原来这里有一个「进入阅读界面」按钮，现已去掉：
    // 伪装层留「外观 + 切换热键」两项就够，进阅读界面用热键（默认 Esc）或工具栏。
    // 切换到阅读界面的能力仍在（setCover(false)），只是不再占用伪装层的版面。
  }

  /* 热键只在工作台拥有焦点时才收得到键盘事件。浏览器在 iframe 内部点击时会把焦点
     交给 iframe，所以不需要手动抢。只有两种情况要主动拿回焦点：
       1) 刚从“显示伪装界面”的快捷键里恢复（用户可能正停在别处）；
       2) 宿主把焦点交还给 iframe（窗口重新激活）。
     注意：**不要**在每次点击时无条件抢焦点——那会把用户刚点开的抽屉 / 面板 / 输入框
     的焦点抢走，反而破坏了交互。 */
  function wireCoverFocus() {
    window.addEventListener("focus", function () {
      // 只在伪装层可见时关心焦点：那是唯一需要键盘输入（热键）的场景。
      // 阅读界面正在显示时绝不动焦点，免得把用户正在输入的地址栏 / 搜索框打断。
      if (disguise.active) {
        focusWorkbench();
        return;
      }
      maybeAutoHide();
    });

    // 可选：一离开工作台就把伪装界面盖回来。这样「离开」本身就是安全状态，
    // 不必依赖按键——而按键恰恰需要焦点，是个死结。
    window.addEventListener("blur", function () {
      if (disguise.hideOnBlur !== true) return;
      if (disguise.active) return;
      setCover(true);
    });
  }

  /* 可选行为：窗口重新获得焦点时自动显示伪装界面。
     默认关闭——否则用户正读到一半，切个窗口回来就被盖住了。 */
  function maybeAutoHide() {
    if (disguise.hideOnFocus !== true) return;
    if (disguise.active) return;
    setCover(true);
  }

  function toggleCover() {
    setCover(!disguise.active);
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 18. Boot
   * ═══════════════════════════════════════════════════════════════════════ */
  function readPersisted() {
    return Promise.all([
      storeGet(STORAGE_KEYS.tabs, null),
      storeGet(STORAGE_KEYS.activeTab, null),
      storeGet(STORAGE_KEYS.lastUrl, ""),
      storeGet(STORAGE_KEYS.history, []),
      storeGet(STORAGE_KEYS.bookmarks, []),
      storeGet(STORAGE_KEYS.readerStyle, null),
      storeGet(STORAGE_KEYS.siteStyles, null),
      storeGet(STORAGE_KEYS.readerStylePerSite, null),
      storeGet(STORAGE_KEYS.disguise, null),
      storeGet(STORAGE_KEYS.progress, null),
      storeGet(STORAGE_KEYS.localLibrary, null),
      storeGet(STORAGE_KEYS.localBook, null)
    ]).then(function (results) {
      var tabs = results[0];
      var activeId = results[1];
      var lastUrl = results[2];
      var history = results[3];
      var bookmarks = results[4];
      loadStyleState(results[5], results[6], results[7]);
      loadDisguise(results[8]);
      loadProgress(results[9]);
      // 书架：storage 里只有索引，正文在 sidecar 磁盘上。
      // 旧格式（带整本 text）会在这里迁移：正文交给 sidecar，索引留在 storage。
      var loaded = loadLocalLibrary(results[10], results[11]);
      localLibrary = loaded.library;
      if (loaded.pending.length) {
        migrateLegacyBooks(loaded.pending);
      }
      // 书架索引读回来之后必须**立刻渲染一次**侧栏面板。
      // 曾经漏了这一步：索引其实好好地存在 storage 里，但界面从未画出来，
      // 用户看到的就是"重开 DBX 书架空了"——直到重新导入一次才顺带画出来。
      renderLocalBookPanel();

      if (Array.isArray(tabs)) {
        tabs.slice(0, 24).forEach(function (seed) {
          if (!seed || typeof seed !== "object") return;
          // 本地书标签没有 http 地址，单独恢复（不抢活动标签）。
          if (seed.mode === "local" && seed.localBookId && indexById(seed.localBookId)) {
            var localTab = makeTab(null);
            localTab.mode = "local";
            localTab.localBookId = seed.localBookId;
            localTab.title = seed.title || (indexById(seed.localBookId) || {}).name || t("localBook");
            state.tabs.push(localTab);
            return;
          }
          if (isHttpUrl(seed.url)) state.tabs.push(makeTab(seed));
        });
      }
      if (!state.tabs.length) state.tabs.push(makeTab(null));
      var active = byId(state.tabs, activeId) || state.tabs[state.tabs.length - 1];
      state.activeTabId = active.id;

      if (Array.isArray(history)) {
        state.history = history
          .filter(function (item) {
            return item && typeof item.url === "string" && isHttpUrl(item.url);
          })
          .slice(0, HISTORY_LIMIT);
      }
      state.bookmarks = normalizeBookmarks(bookmarks);
      state.lastUrl = typeof lastUrl === "string" && isHttpUrl(lastUrl) ? lastUrl : "";
      styleState.host = hostOf(active.url) || hostOf(state.lastUrl) || "";
      return active;
    });
  }

  function loadPresets() {
    return softInvoke("webview/presets", {}, 15000).then(function (result) {
      var ok = false;
      if (result && !result.__error && Array.isArray(result.presets)) {
        state.presets = result.presets
          .filter(function (preset) {
            return preset && typeof preset.id === "string";
          })
          .map(function (preset) {
            return {
              id: preset.id,
              name: typeof preset.name === "string" ? preset.name : preset.id,
              category: typeof preset.category === "string" ? preset.category : "",
              hostPatterns: Array.isArray(preset.hostPatterns) ? preset.hostPatterns.filter(function (item) {
                return typeof item === "string";
              }) : [],
              description: typeof preset.description === "string" ? preset.description : "",
              /* 自定义预设可以编辑/删除；内置的只读。 */
              custom: preset.custom === true,
              /* 用户在这条预设上删掉的域名（灰色显示，可右键恢复）。 */
              blockedPatterns: Array.isArray(preset.blockedPatterns) ? preset.blockedPatterns.filter(function (item) {
                return typeof item === "string";
              }) : [],
              mode: typeof preset.mode === "string" ? preset.mode : "",
              searchUrl: typeof preset.searchUrl === "string" ? preset.searchUrl : ""
            };
          });
        ok = true;
      } else {
        state.presets = [];
      }
      // 再把完整规则取回来（摘要里没有选择器，编辑时需要全文）。
      return softInvoke("webview/settings", {}, 15000).then(function (settings) {
        state.customPresets =
          settings && !settings.__error && Array.isArray(settings.customRules)
            ? settings.customRules.filter(function (item) {
                return item && typeof item === "object";
              })
            : [];
        state.blockedHosts =
          settings && !settings.__error && Array.isArray(settings.blockedHosts)
            ? settings.blockedHosts.filter(function (item) {
                return typeof item === "string";
              })
            : [];
        return ok;
      });
    });
  }

  /**
   * 保存站点数据（自定义规则 + 被删掉的内置域名）。
   *
   * 两个字段必须一起发：只发 customRules 会把 blockedHosts 覆盖成空，
   * 用户之前删掉的域名就会"自己回来了"。
   */
  function persistSiteData(nextCustom, nextBlocked) {
    return invoke(
      "webview/saveSettings",
      { customRules: nextCustom || [], blockedHosts: nextBlocked || [] },
      20000
    ).then(
      function (result) {
        if (!result || result.ok !== true) {
          showStatusNotice(t("presetSaveFailed"));
          return false;
        }
        state.customPresets = nextCustom || [];
        state.blockedHosts = nextBlocked || [];
        return loadPresets().then(function () {
          renderPresets();
          var tab = activeTab();
          if (tab && tab.url) refreshActiveTab(false);
          showStatusNotice(t("presetSaved"));
          return true;
        });
      },
      function (error) {
        showStatusNotice(t("presetSaveFailed") + " · " + humanError(error));
        return false;
      }
    );
  }

  /** 把表单里的逗号/换行分隔文本拆成数组。 */
  function splitList(text) {
    return String(text || "")
      .split(/[,，\n]/)
      .map(function (item) {
        return item.trim();
      })
      .filter(function (item) {
        return item !== "";
      });
  }

  function openPresetForm(preset) {
    if (!el.presetForm) return;
    state.presetEditId = preset && preset.id ? preset.id : "";
    setText(el.presetFormTitle, state.presetEditId ? t("presetEditTitle") : t("presetNewTitle"));
    var full = null;
    if (state.presetEditId) {
      state.customPresets.forEach(function (item) {
        if (item.id === state.presetEditId) full = item;
      });
    }
    el.pfName.value = full ? full.name || "" : "";
    el.pfCategory.value = full ? full.category || "" : (preset && preset.category) || "自定义";
    el.pfHosts.value = full ? (full.hostPatterns || []).join(", ") : (preset && (preset.hostPatterns || []).join(", ")) || "";
    el.pfContent.value = full ? (full.contentSelectors || []).join(", ") : "";
    el.pfRemove.value = full ? (full.removeSelectors || []).join(", ") : "";
    el.pfSearch.value = full ? full.searchUrl || "" : "";
    el.pfMode.value = full && full.mode === "full" ? "full" : "reader";
    setText(el.pfHint, t("presetFormHint"));
    el.presetForm.hidden = false;
    if (el.pfName.focus) el.pfName.focus();
  }

  function closePresetForm() {
    if (el.presetForm) el.presetForm.hidden = true;
    state.presetEditId = "";
  }

  /** 校验并保存表单。名称与域名是必填——没有域名的规则永远匹配不到。 */
  function savePresetForm() {
    var name = String(el.pfName.value || "").trim();
    var hosts = splitList(el.pfHosts.value);
    if (!name) {
      showStatusNotice(t("presetNeedName"));
      if (el.pfName.focus) el.pfName.focus();
      return;
    }
    if (!hosts.length) {
      showStatusNotice(t("presetNeedHost"));
      if (el.pfHosts.focus) el.pfHosts.focus();
      return;
    }
    // 域名只做形状校验：允许 example.com / *.example.com / 带路径前缀。
    var bad = hosts.filter(function (host) {
      return !/^(\*\.)?[A-Za-z0-9._-]+(:[0-9]+)?(\/.*)?$/.test(host);
    });
    if (bad.length) {
      showStatusNotice(t("presetBadHost").replace("{host}", bad[0]));
      return;
    }

    var rule = {
      id: state.presetEditId || "custom-" + Date.now().toString(36),
      name: name,
      category: String(el.pfCategory.value || "").trim() || t("presetCustomCategory"),
      description: t("presetCustomDesc").replace("{hosts}", hosts.slice(0, 3).join(", ")),
      hostPatterns: hosts,
      contentSelectors: splitList(el.pfContent.value),
      removeSelectors: splitList(el.pfRemove.value),
      searchUrl: String(el.pfSearch.value || "").trim() || null,
      mode: el.pfMode.value === "full" ? "full" : "reader",
      custom: true
    };

    var next = state.customPresets.filter(function (item) {
      return item.id !== rule.id;
    });
    next.unshift(rule);
    persistSiteData(next, state.blockedHosts).then(function (ok) {
      if (ok) closePresetForm();
    });
  }

  function deleteCustomPreset(id) {
    var next = state.customPresets.filter(function (item) {
      return item.id !== id;
    });
    if (next.length === state.customPresets.length) return;
    persistSiteData(next, state.blockedHosts).then(function (ok) {
      if (ok && state.presetEditId === id) closePresetForm();
    });
  }

  function probeBackend() {
    return softInvoke("webview/check", {}, 10000).then(function (result) {
      if (result && !result.__error && result.ok === true) {
        if (typeof result.version === "string") disguise.version = result.version;
        return true;
      }
      return false;
    });
  }

  function showBanner(text) {
    if (!el.bootBanner || !el.bootBannerText) return;
    setText(el.bootBannerText, text);
    el.bootBanner.hidden = !text;
  }

  function contextUrl() {
    var context = plugin && plugin.context;
    if (!context) return "";
    if (typeof context === "string") {
      var text = context.trim();
      if (text.charAt(0) === "{") {
        try {
          return extractContextUrl(JSON.parse(text));
        } catch (error) {
          return "";
        }
      }
      return isHttpUrl(text) ? text : "";
    }
    if (typeof context === "object") return extractContextUrl(context);
    return "";
  }

  function start() {
    cacheElements();
    applyTheme();
    applyCopy();
    // 宽了就显示、窄了就收起；但如果用户**主动**收起过，就尊重他的选择。
    setSidebar(!sidebarPinnedHidden && window.innerWidth > 960);
    setDrawer(false);
    setPanel("tabs");
    wireToolbar();
    wireSidebar();
    wireStylePanel();
    wireKeyboard();
    wireWindow();
    wireCover();
    wireCoverFocus();
    wireLiveView();
    wireLiveEvents();
    applyReaderStyle(null);
    // 默认先显示伪装界面；用户可以在设置里关掉。
    setCover(disguise.onStart !== false);
    syncSettingsPanel();
    // 设置抽屉默认停在「样式」页签。
    setDrawerTab(state.drawerTab || "style");

    if (state.bootError) showBanner(state.bootError);
    else if (!store || !store.available) showBanner(t("storageOff"));

    var startupUrl = contextUrl() || state.lastUrl || "";
    var tab = activeTab();
    // 本地书标签：直接回到上次读到的那一章，别落到空状态页。
    if (tab && tab.mode === "local" && tab.localBookId && localBookById(tab.localBookId)) {
      var resume = readLocalProgress(tab.localBookId);
      openLocalChapter(resume >= 0 ? resume : 0, { bookId: tab.localBookId, keepScroll: resume >= 0 });
    } else if (startupUrl && isHttpUrl(startupUrl) && tab) {
      navigate(tab, startupUrl, { push: false });
    } else {
      refreshActiveTab(true);
    }

    return Promise.all([loadPresets(), probeBackend(), probeBrowser()]).then(function (results) {
      var backendOk = results[1];
      renderPresets();
      syncToolbar();
      if (!backendOk) showBanner(t("backendMissing"));
      else if (state.bootError) showBanner(state.bootError);
      else if (!store || !store.available) showBanner(t("storageOff"));
      else showBanner("");
      var current = activeTab();
      if (current && current.payload) renderPage(current);
      else if (current && current.error) renderError(current);
      return true;
    });
  }

  setupPlugin()
    .then(function () {
      setupStore();
      return readPersisted();
    })
    .then(function () {
      return start();
    })
    .catch(function (error) {
      if (el.bootBanner) showBanner(humanError(error));
      else if (el.pageHost) {
        clear(el.pageHost);
        el.pageHost.appendChild(node("div", "error", humanError(error)));
      }
    });
})();
