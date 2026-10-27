//! HTML 清理 / 重写引擎。
//!
//! 输入任意站点的 HTML，输出一个可以安全 `innerHTML` 进 DBX 插件工作台的片段：
//! 没有脚本、没有事件处理器、所有地址变成绝对地址、正文之外的内容按站点规则裁掉。
//!
//! 实现分两遍：
//! 1. `scraper`（只读 DOM）负责选正文容器、抽元信息、抽章节导航。
//! 2. `lol_html` 流式重写负责真正的清理与 URL / CSS 改写。

use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::Rc;
use std::str::FromStr;

use lol_html::{rewrite_str, ElementContentHandlers, RewriteStrSettings, Selector as HtmlSelector};
use scraper::{Html, Selector};
use url::Url;

use crate::site::SiteRule;

/// 渲染模式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RenderMode {
    #[default]
    Reader,
    Full,
    Source,
}

impl RenderMode {
    pub fn parse(value: Option<&str>) -> Self {
        match value.unwrap_or("reader").to_ascii_lowercase().as_str() {
            "full" | "page" => RenderMode::Full,
            "source" | "raw" => RenderMode::Source,
            _ => RenderMode::Reader,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            RenderMode::Reader => "reader",
            RenderMode::Full => "full",
            RenderMode::Source => "source",
        }
    }
}

/// 页面元信息。
#[derive(Debug, Clone, Default)]
pub struct PageMeta {
    pub title: String,
    pub site_name: String,
    pub description: String,
    pub canonical: String,
}

/// 一个可跳转链接（章节导航 / 章节目录）。
#[derive(Debug, Clone)]
pub struct PageLink {
    pub text: String,
    pub url: String,
}

/// 清理结果。
#[derive(Debug, Clone, Default)]
pub struct CleanedPage {
    pub meta: PageMeta,
    pub html: String,
    pub text_length: usize,
    /// 整页文字量（清理前），用于区分「没抽到」和「本来就没有」。
    pub full_text_length: usize,
    /// 正文里链接文字占的比例。首页/导航页会很高。
    pub link_ratio: f64,
    /// 这一页基本只有链接，没有可读正文。
    pub link_wall: bool,
    pub images: Vec<(String, String)>,
    pub chapters: Vec<PageLink>,
    pub prev: Option<PageLink>,
    pub next: Option<PageLink>,
    /// 书籍/目录页的"开始阅读"入口。
    pub start_reading: Option<PageLink>,
    pub warnings: Vec<String>,
    /// 阅读模式实际命中的正文选择器。
    pub content_selector: Option<String>,
    /// 原文里的基础地址，UI 会用它做 `<base href>`。
    pub base_href: String,
    /// 是否成功抽取到正文（正文过短时 UI 可以提示回退整页模式）。
    pub reader_ok: bool,
}

pub struct CleanOptions<'a> {
    pub base: &'a Url,
    pub rule: Option<&'a SiteRule>,
    pub mode: RenderMode,
    /// 是否把站外样式表下载后内联（保留原站排版，代价是额外请求）。
    pub inline_stylesheets: bool,
    /// 图库最多列多少张图。
    pub max_gallery_images: usize,
    /// 允许的 HTML 体积上限（字节），超出则截断。
    pub max_html_bytes: usize,
}

/// 由站点规则推导出的请求头部定制。
pub fn request_profile(rule: Option<&SiteRule>) -> crate::net::RequestProfile {
    let mut profile = crate::net::RequestProfile::browser();
    if let Some(rule) = rule {
        profile.user_agent = rule.user_agent.clone();
        profile.referer = rule.referer.clone();
        if let Some(flag) = rule.image_referer_origin {
            profile.image_referer_origin = flag;
        }
    }
    profile
}

/// 会整棵删掉的标签。
const DROPPED_TAGS: &[&str] = &[
    "script", "noscript", "template", "iframe", "frame", "frameset", "object", "embed",
    "applet", "canvas", "form", "input", "textarea", "select", "option", "optgroup",
    "button", "base", "meta", "link", "title", "dialog", "slot", "portal", "svg",
    "math", "map", "area", "audio", "video", "source", "track", "picture", "datalist",
    "output", "progress", "meter", "marquee",
];

/// 只保留这些标签。
const ALLOWED_TAGS: &[&str] = &[
    "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br",
    "caption", "center", "cite", "code", "col", "colgroup", "data", "dd", "del", "details",
    "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font", "footer", "h1", "h2",
    "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "i", "img", "ins", "kbd", "label",
    "li", "main", "mark", "nav", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s", "samp",
    "section", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td",
    "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "wbr",
];

/// 属性白名单。
const ALLOWED_ATTRS: &[&str] = &[
    "href", "src", "srcset", "alt", "title", "width", "height", "colspan", "rowspan",
    "scope", "lang", "dir", "datetime", "cite", "start", "reversed", "open", "class",
    "id", "style", "align", "valign", "bgcolor", "color", "face", "size", "border",
    "cellpadding", "cellspacing", "role", "aria-label", "aria-level", "aria-hidden",
    "loading", "decoding", "data-dbx-preset",
];

/// 内联 `style` 里允许保留的排版属性。
const ALLOWED_STYLE_PROPS: &[&str] = &[
    "color", "background-color", "font-weight", "font-style", "font-size", "font-family",
    "text-align", "text-decoration", "line-height", "letter-spacing", "margin",
    "margin-top", "margin-bottom", "margin-left", "margin-right", "padding",
    "padding-top", "padding-bottom", "padding-left", "padding-right", "border",
    "border-radius", "border-color", "border-width", "border-style", "vertical-align",
    "white-space", "word-break", "opacity", "text-indent", "list-style",
    "list-style-type", "display", "text-transform", "font-variant", "clear", "float",
];

/// 清理配置（不依赖站点规则的部分）。
pub struct Engine {
    pub inline_stylesheets: bool,
    pub max_gallery_images: usize,
    pub max_html_bytes: usize,
}

impl Default for Engine {
    fn default() -> Self {
        Self {
            inline_stylesheets: false,
            max_gallery_images: 24,
            max_html_bytes: 6 * 1024 * 1024,
        }
    }
}

/// 主入口：清理一份已经解码成 UTF-8 的 HTML。
pub fn clean(html: &str, options: &CleanOptions<'_>, engine: &Engine) -> CleanedPage {
    let page = clean_document(html, options, engine);

    // 很多中文小说站把正文塞在 `document.writeln(qsbs.bb('<base64>'))` 之类的
    // 加密脚本里，脚本被清掉后正文会整段消失。正文过短时尝试解包再清一遍。
    if options.mode == RenderMode::Reader && page.text_length < 200 {
        for (decoded, label) in [
            (decode_packed_content(html), "已解码站点内嵌的正文数据"),
            (decode_embedded_json(html), "已从页面内嵌 JSON 中还原正文"),
        ] {
            let Some(decoded) = decoded else { continue };
            let mut retried = clean_document(&decoded, options, engine);
            if retried.text_length > page.text_length {
                // 解出来的片段没有 head，标题要沿用原文档的。
                if retried.meta.title.is_empty()
                    || retried.meta.title == options.base.host_str().unwrap_or_default()
                {
                    retried.meta.title = page.meta.title.clone();
                }
                if retried.meta.site_name.is_empty() {
                    retried.meta.site_name = page.meta.site_name.clone();
                }
                if !page.meta.description.is_empty() {
                    retried.meta.description = page.meta.description.clone();
                }
                // 解出来的片段只有正文，导航必须从原文档带过来。
                if retried.prev.is_none() {
                    retried.prev = page.prev.clone();
                }
                if retried.next.is_none() {
                    retried.next = page.next.clone();
                }
                if retried.start_reading.is_none() {
                    retried.start_reading = page.start_reading.clone();
                }
                if retried.chapters.is_empty() {
                    retried.chapters = page.chapters.clone();
                }
                if retried.images.is_empty() {
                    retried.images = page.images.clone();
                }
                retried.warnings.insert(0, label.to_string());
                return retried;
            }
        }
    }
    page
}

fn clean_document(html: &str, options: &CleanOptions<'_>, engine: &Engine) -> CleanedPage {
    let mut document = Html::parse_document(html);
    let mut warnings: Vec<String> = Vec::new();
    // 保留原始的整页 HTML：文档级删除之后，`<base>` 标签可能已经被摘掉，
    // 而 UI 仍然需要一个基准地址。
    let original_html = html.to_string();

    // 先在**整份文档**上做删除。必须在抽取正文容器之前：阅读模式取到的是某个
    // 容器的 HTML 片段，如果容器内部还挂着导航、广告、站点提示，那些东西会一起
    // 被带走（真实站点里 `<article>` 常把翻页导航包在里面）。
    let mut document_selectors: Vec<String> = Vec::new();
    if let Some(rule) = options.rule {
        document_selectors.extend(rule.remove_selectors.iter().cloned());
    }
    document_selectors.extend(crate::site::universal_remove_selectors());

    // 收集阶段借用 `document` 的不可变视图；先算出要删的节点 id，再统一 detach，
    // 这样两类借用不会重叠。（`document.tree` 只接受 ego_tree 的 NodeId，类型由
    // `element.id()` 推断，不需要手写。）
    let mut doomed = Vec::new();
    for selector in &document_selectors {
        let Ok(parsed) = Selector::parse(selector) else {
            continue;
        };
        for element in document.select(&parsed) {
            doomed.push(element.id());
        }
    }
    // 站点塞在正文里的"请勿开启阅读模式 / 求票 / 防盗声明"等噪音段落。
    // 用 ElementRef 遍历（ego_tree 的 NodeRef 没有 text()），只对候选文本容器
    // 求一次文本，比整树遍历更省。
    let Ok(everything) = Selector::parse("p, div, span, em, strong, font, b, i, small") else {
        return clean_after_document_removal(document, &original_html, options, engine, warnings);
    };
    for element in document.select(&everything) {
        let text = element.text().collect::<String>();
        let text = text.trim();
        if text.is_empty() || text.chars().count() > 120 {
            continue;
        }
        let lowered = text.to_ascii_lowercase();
        let matched = NOISE_TEXT_PATTERNS.iter().any(|pattern| {
            text.contains(pattern) || lowered.contains(&pattern.to_ascii_lowercase())
        });
        if matched {
            doomed.push(element.id());
        }
    }

    let removed = doomed.len();
    for id in doomed {
        if let Some(mut handle) = document.tree.get_mut(id) {
            handle.detach();
        }
    }
    if removed > 0 {
        warnings.push(format!("已移除 {removed} 处站点装饰与提示文字"));
    }

    clean_after_document_removal(document, &original_html, options, engine, warnings)
}

/// 文档级删除完成后的主流程。
fn clean_after_document_removal(
    document: Html,
    original_html: &str,
    options: &CleanOptions<'_>,
    engine: &Engine,
    mut warnings: Vec<String>,
) -> CleanedPage {
    // 站点规则可以覆盖 UA / Referer；后续所有子请求（样式表）沿用同一套头部。
    let profile = request_profile(options.rule);
    let mut meta = extract_meta(&document, options.base);

    if let Some(rule) = options.rule {
        if let Some(selector) = rule.title_selector.as_deref() {
            if let Some(value) = first_text(&document, selector) {
                meta.title = value;
            }
        }
        if !rule.name.is_empty() && rule.id != "general" {
            meta.site_name = rule.name.clone();
        }
    }
    // `document.title` 经常是「站点名_栏目_首页」这类噪音，或者干脆为空
    // （依赖 JavaScript 渲染的站点）。标题太短时用常见标题结构兜底。
    if meta.title.chars().count() < 4 || meta.title == options.base.host_str().unwrap_or_default() {
        const TITLE_FALLBACKS: &[&str] = &[
            ".layout-tit",
            ".word_read h3",
            "#chaptercontent h1",
            ".bookname h1",
            ".book-info h1",
            "#info h1",
            ".video-title",
            "[class*=video-title]",
            "[class*=note-title]",
            "[class*=article-title]",
            "[class*=post-title]",
            "#detail-title",
            "article h1",
            "main h1",
            "h1",
            "h2",
            "h3",
        ];
        for selector in TITLE_FALLBACKS {
            if let Some(value) = first_text(&document, selector) {
                if value.chars().count() >= 2 {
                    meta.title = value;
                    break;
                }
            }
        }
    }
    if meta.title.is_empty() {
        meta.title = options.base.host_str().unwrap_or_default().to_string();
    }
    // 记录整页文字量：正文过短时用它判断「是不是站点根本不给正文」。
    let full_text_length: usize = document
        .root_element()
        .text()
        .map(|text| text.trim().chars().count())
        .sum();
    // ---- 导航（必须在裁剪之前收集）----
    let guessed = guess_navigation(&document, options.base);
    let prev = selector_link(&document, options.rule.and_then(|rule| rule.prev_selector.as_deref()), options.base)
        .or(guessed.0);
    let next = selector_link(&document, options.rule.and_then(|rule| rule.next_selector.as_deref()), options.base)
        .or(guessed.1);
    // 目录页没有"下一章"，但通常有"开始阅读"；把它单独标出来。
    let start_reading = detect_start_reading(&document, options.base);
    let chapters = options
        .rule
        .and_then(|rule| rule.chapter_list_selector.as_deref())
        .map(|selector| collect_chapters(&document, selector, options.base, 600))
        .filter(|list| !list.is_empty())
        .unwrap_or_else(|| {
            // 新闻页底部的"相关阅读"也是一组同形链接，所以非小说站点要求更高的
            // 条数门槛，避免给文章页凭空加一个章节下拉框。
            let is_novel = options
                .rule
                .map(|rule| rule.category.contains("小说"))
                .unwrap_or(false);
            detect_chapter_list(&document, options.base, 600, if is_novel { 5 } else { 15 })
        });
    let images = collect_images(&document, options.base, engine.max_gallery_images);

    // ---- 选正文容器 ----
    let mut content_selector: Option<String> = None;
    let mut fragment = original_html.to_string();
    if options.mode == RenderMode::Reader {
        let mut found = None;
        if let Some(rule) = options.rule {
            for selector in &rule.content_selectors {
                if let Some((node_html, resolved)) = subtree_html(&document, selector) {
                    content_selector = Some(resolved);
                    found = Some(node_html);
                    break;
                }
            }
        }
        if found.is_none() {
            if let Some((node_html, selector)) = score_content_root(&document) {
                content_selector = Some(selector);
                found = Some(node_html);
            }
        }
        match found {
            Some(node_html) => fragment = node_html,
            None => warnings.push("未找到明显的正文容器，已输出整页内容".to_string()),
        }
    }

    // ---- 流式清理 / 重写 ----
    let state = Rc::new(RewriteState {
        base: options.base.clone(),
        removed_links: Cell::new(0),
        warnings: RefCell::new(Vec::new()),
    });

    let mut removal_selectors: Vec<String> = Vec::new();
    if let Some(rule) = options.rule {
        removal_selectors.extend(rule.remove_selectors.iter().cloned());
    }
    removal_selectors.extend(crate::site::universal_remove_selectors());
    for tag in DROPPED_TAGS {
        removal_selectors.push(tag.to_string());
    }
    // 未知标签（自定义元素）解包，但保留其子节点。
    let allowed_selector = ALLOWED_TAGS.join(",");
    removal_selectors.push(format!(
        ":not({allowed_selector}):not(html):not(head):not(body)"
    ));

    let rewritten = rewrite(&fragment, &removal_selectors, state.clone());

    let mut final_html = rewritten;
    let base_href = base_href_from(&fragment, options.base);
    if options.inline_stylesheets {
        final_html = inline_stylesheets(&final_html, options.base, &profile, &mut warnings);
    }
    if !state.warnings.borrow().is_empty() {
        warnings.extend(state.warnings.borrow().iter().cloned());
    }

    // `lol_html` 会在片段外包一层 html/body，剥掉它。
    let final_html = strip_wrappers(&final_html);

    let truncated = final_html.len() > engine.max_html_bytes;
    let final_html = if truncated {
        warnings.push("页面过大，输出已截断".to_string());
        truncate_html(&final_html, engine.max_html_bytes)
    } else {
        final_html
    };

    let text_length = visible_text_length(&final_html);
    // 链接占比：整页模式拿到"首页/导航页"时会产出几屏都是链接的页面，
    // 看起来像界面坏了。这种情况要如实说明，而不是把用户扔进链接墙。
    let link_ratio = link_text_ratio(&final_html);
    let link_wall = text_length >= 200 && link_ratio >= 0.6;
    if options.mode == RenderMode::Reader && text_length < 200 {
        if full_text_length >= 200 {
            // 站点确实给了正文，只是抽取器选错了容器——给出更准确的提示。
            warnings.push("阅读模式未能定位正文容器，可切换「整页模式」查看".to_string());
        } else {
            warnings.push(
                "该页面正文由 JavaScript 渲染，服务端 HTML 里没有可读内容".to_string(),
            );
        }
    }
    let removed_links = state.removed_links.get();
    if removed_links > 0 {
        warnings.push(format!("已禁用 {removed_links} 个非 HTTP(S) 链接"));
    }
    if link_wall {
        warnings.push(format!(
            "该页面几乎全是链接（{:.0}% 是导航文字），没有可读正文",
            link_ratio * 100.0
        ));
    }

    CleanedPage {
        meta,
        html: final_html,
        text_length,
        full_text_length,
        link_ratio,
        link_wall,
        images,
        chapters,
        prev,
        next,
        start_reading,
        warnings,
        content_selector,
        base_href,
        reader_ok: text_length >= 200 && !link_wall,
    }
}

/// 清理过程中共享的可变状态。
struct RewriteState {
    base: Url,
    removed_links: Cell<usize>,
    warnings: RefCell<Vec<String>>,
}

fn rewrite(fragment: &str, removal_selectors: &[String], state: Rc<RewriteState>) -> String {
    let mut handlers: Vec<(std::borrow::Cow<'static, HtmlSelector>, ElementContentHandlers<'static>)> =
        Vec::new();

    // 先注册删除器，再注册 `*` 上的属性清洗器。lol_html 会按声明顺序对同一元素
    // 调用处理器；被删除的元素不会再进入后续处理器。
    for selector in removal_selectors {
        let Ok(selector) = HtmlSelector::from_str(selector) else {
            state
                .warnings
                .borrow_mut()
                .push(format!("选择器语法无效，已忽略：{selector}"));
            continue;
        };
        handlers.push((
            std::borrow::Cow::Owned(selector),
            ElementContentHandlers {
                element: Some(Box::new(|element: &mut lol_html::html_content::Element<'_, '_>| {
                    element.remove();
                    Ok(())
                })),
                ..ElementContentHandlers::default()
            },
        ));
    }

    let element_state = state.clone();
    let Ok(everything) = HtmlSelector::from_str("*") else {
        return fragment.to_string();
    };
    handlers.push((
        std::borrow::Cow::Owned(everything),
        ElementContentHandlers {
            element: Some(Box::new(move |element: &mut lol_html::html_content::Element<'_, '_>| {
                rewrite_element(element, &element_state);
                Ok(())
            })),
            ..ElementContentHandlers::default()
        },
    ));

    match rewrite_str(
        fragment,
        RewriteStrSettings {
            element_content_handlers: handlers,
            ..RewriteStrSettings::default()
        },
    ) {
        Ok(output) => output,
        Err(error) => {
            state
                .warnings
                .borrow_mut()
                .push(format!("HTML 重写失败：{error}"));
            fragment.to_string()
        }
    }
}

fn rewrite_element(element: &mut lol_html::html_content::Element<'_, '_>, state: &Rc<RewriteState>) {
    let tag = element.tag_name().to_ascii_lowercase();

    // 属性快照：`attributes()` 返回借用，改写前必须先复制出来。
    let snapshot: Vec<(String, String)> = element
        .attributes()
        .iter()
        .map(|attribute| (attribute.name(), attribute.value()))
        .collect();
    let names: Vec<String> = snapshot.iter().map(|(name, _)| name.clone()).collect();

    let mut keep: Vec<(String, String)> = Vec::new();
    let mut drop_href = false;

    for (name, value) in &snapshot {
        let lower = name.to_ascii_lowercase();
        if let Some(safe) = sanitize_attribute(&lower, value, &state.base, &mut drop_href) {
            keep.push(safe);
        }
    }

    // 图片懒加载：`data-src` 已经搬到 src；没有 src 的 img 直接丢掉。
    if tag == "img" && !keep.iter().any(|(name, _)| name == "src") {
        element.remove();
        return;
    }
    if tag == "a" && drop_href {
        element.remove_attribute("href");
    }

    for name in &names {
        element.remove_attribute(name);
    }
    for (name, value) in keep {
        let _ = element.set_attribute(&name, &value);
    }
}

/// 单个属性的清洗规则：返回 `Some` 表示保留（可能已改写值）。
fn sanitize_attribute(
    lower: &str,
    value: &str,
    base: &Url,
    drop_href: &mut bool,
) -> Option<(String, String)> {
    if lower.starts_with("on") || lower == "srcdoc" || lower == "formaction" || lower == "target" {
        return None;
    }
    match lower {
        "style" => sanitize_inline_style(value).map(|safe| ("style".to_string(), safe)),
        "href" => match resolve_url(base, value) {
            Some(url) => Some(("href".to_string(), url)),
            None => {
                *drop_href = true;
                None
            }
        },
        "src" => resolve_url(base, value).map(|url| ("src".to_string(), url)),
        "srcset" => rewrite_srcset(base, value).map(|srcset| ("srcset".to_string(), srcset)),
        "poster" | "data-src" | "data-original" | "data-lazy-src" | "data-echo" => {
            resolve_url(base, value).map(|url| ("src".to_string(), url))
        }
        "id" => Some(("id".to_string(), value.to_string())),
        "class" => {
            if value.len() <= 4096 {
                Some(("class".to_string(), value.to_string()))
            } else {
                None
            }
        }
        _ => {
            if ALLOWED_ATTRS.contains(&lower) {
                Some((lower.to_string(), value.to_string()))
            } else if lower.starts_with("data-") && !lower.starts_with("data-dbx") && value.len() <= 512 {
                Some((lower.to_string(), value.to_string()))
            } else {
                None
            }
        }
    }
}

/// 解析 URL 并拒绝危险协议。
fn resolve_url(base: &Url, raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lowered = trimmed.to_ascii_lowercase();
    if lowered.starts_with("javascript:")
        || lowered.starts_with("vbscript:")
        || lowered.starts_with("file:")
        || lowered.starts_with("blob:")
        || lowered.starts_with("filesystem:")
        || lowered.starts_with("about:")
    {
        return None;
    }
    if lowered.starts_with("data:") {
        return if lowered.starts_with("data:image/") && trimmed.len() <= 512 * 1024 {
            Some(trimmed.to_string())
        } else {
            None
        };
    }
    if trimmed.starts_with('#') {
        return Some(trimmed.to_string());
    }
    match base.join(trimmed) {
        Ok(url) if matches!(url.scheme(), "http" | "https") => Some(url.to_string()),
        _ => None,
    }
}

fn rewrite_srcset(base: &Url, value: &str) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for candidate in value.split(',') {
        let candidate = candidate.trim();
        if candidate.is_empty() {
            continue;
        }
        let mut pieces = candidate.split_whitespace();
        let Some(url) = pieces.next() else { continue };
        let descriptor: Vec<&str> = pieces.collect();
        if let Some(resolved) = resolve_url(base, url) {
            if descriptor.is_empty() {
                parts.push(resolved);
            } else {
                parts.push(format!("{} {}", resolved, descriptor.join(" ")));
            }
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(", "))
    }
}

/// 内联样式只保留排版相关属性，避免原站用绝对定位把内容顶出屏幕。
pub fn sanitize_inline_style(value: &str) -> Option<String> {
    let mut kept: Vec<String> = Vec::new();
    for declaration in value.split(';') {
        let Some((property, raw_value)) = declaration.split_once(':') else {
            continue;
        };
        let property = property.trim().to_ascii_lowercase();
        let raw_value = raw_value.trim();
        if raw_value.is_empty() || raw_value.len() > 200 {
            continue;
        }
        let lowered = raw_value.to_ascii_lowercase();
        if lowered.contains("javascript:")
            || lowered.contains("expression(")
            || lowered.contains("url(")
            || lowered.contains("position:fixed")
        {
            continue;
        }
        if ALLOWED_STYLE_PROPS.contains(&property.as_str()) {
            kept.push(format!("{property}:{raw_value}"));
        }
    }
    if kept.is_empty() {
        None
    } else {
        Some(kept.join(";"))
    }
}

/// 把 CSS 里的相对 `url()` 变成绝对地址，并丢掉 `@import`。
pub fn rewrite_css_urls(css: &str, base: &Url) -> String {
    let mut output = String::with_capacity(css.len());
    let bytes = css.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        let rest = &css[index..];
        if rest.len() >= 7 && rest[..7].eq_ignore_ascii_case("@import") {
            match rest.find(';') {
                Some(end) => {
                    index += end + 1;
                    continue;
                }
                None => break,
            }
        }
        if rest.len() >= 3 && rest[..3].eq_ignore_ascii_case("url") {
            let after = &rest[3..];
            let trimmed = after.trim_start();
            if let Some(stripped) = trimmed.strip_prefix('(') {
                if let Some(close) = stripped.find(')') {
                    let inner = stripped[..close].trim().trim_matches(['"', '\'']).trim();
                    let replacement = match resolve_url(base, inner) {
                        Some(url) => format!("url(\"{url}\")"),
                        None => "none".to_string(),
                    };
                    output.push_str(&replacement);
                    index += 3 + (after.len() - trimmed.len()) + 1 + close + 1;
                    continue;
                }
            }
        }
        let Some(ch) = rest.chars().next() else { break };
        output.push(ch);
        index += ch.len_utf8();
    }
    output
}

/// 内联站外样式表：让「整页模式」尽量保留原站排版。
fn inline_stylesheets(
    html: &str,
    base: &Url,
    profile: &crate::net::RequestProfile,
    warnings: &mut Vec<String>,
) -> String {
    let document = Html::parse_fragment(html);
    let Ok(selector) = Selector::parse("link[rel=stylesheet][href]") else {
        return html.to_string();
    };
    let mut styles: Vec<String> = Vec::new();
    for element in document.select(&selector) {
        let Some(href) = element.value().attr("href") else { continue };
        let Some(url) = resolve_url(base, href) else { continue };
        if styles.len() >= 4 {
            break;
        }
        match crate::net::fetch_text(&url, 1_500_000, std::time::Duration::from_secs(12), profile) {
            Ok(resource) => {
                let css = rewrite_css_urls(&resource.body, &resource.final_url);
                styles.push(format!("<style data-dbx-sheet=\"{}\">{}</style>", escape_attr(&url), css));
            }
            Err(error) => warnings.push(format!("样式表加载失败：{error}")),
        }
    }
    if styles.is_empty() {
        return html.to_string();
    }
    let mut combined = styles.join("");
    combined.push_str(html);
    combined
}

fn escape_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// 剥掉 `lol_html` 补上的 html/head/body 外壳。
fn strip_wrappers(html: &str) -> String {
    let trimmed = html.trim();
    let lowered = trimmed.to_ascii_lowercase();
    let mut output = trimmed.to_string();

    let starts_with_html = lowered.starts_with("<html");
    let starts_with_head = lowered.starts_with("<head");
    let starts_with_body = lowered.starts_with("<body");

    if starts_with_html {
        if let Some(index) = output.find('>') {
            output = output[index + 1..].to_string();
        }
    }
    if output.trim_start().to_ascii_lowercase().starts_with("<head") {
        if let Some(end) = output.to_ascii_lowercase().find("</head>") {
            output = output[end + 7..].to_string();
        }
    }
    if output.trim_start().to_ascii_lowercase().starts_with("<body") {
        if let Some(index) = output.find('>') {
            output = output[index + 1..].to_string();
        }
    }
    let lowered_end = output.to_ascii_lowercase();
    if let Some(index) = lowered_end.rfind("</body>") {
        output.truncate(index);
    }
    let lowered_end = output.to_ascii_lowercase();
    if let Some(index) = lowered_end.rfind("</html>") {
        output.truncate(index);
    }
    let _ = starts_with_head;
    let _ = starts_with_body;
    output
}

/// 按标签边界安全截断，避免产生半截标签。
fn truncate_html(html: &str, max_bytes: usize) -> String {
    if html.len() <= max_bytes {
        return html.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !html.is_char_boundary(end) {
        end -= 1;
    }
    let slice = &html[..end];
    match slice.rfind('>') {
        Some(index) => slice[..=index].to_string(),
        None => String::new(),
    }
}

/// 正文里「链接文字」占全部文字的比例。首页/导航页接近 1，文章页接近 0。
fn link_text_ratio(html: &str) -> f64 {
    let document = Html::parse_fragment(html);
    let Ok(anchor) = Selector::parse("a") else {
        return 0.0;
    };
    let total = visible_text_length(html);
    if total == 0 {
        return 0.0;
    }
    let linked: usize = document
        .select(&anchor)
        .map(|element| element.text().map(|text| text.trim().chars().count()).sum::<usize>())
        .sum();
    (linked as f64 / total as f64).min(1.0)
}

fn visible_text_length(html: &str) -> usize {    let document = Html::parse_fragment(html);
    let selector = Selector::parse("body").ok();
    let root = match selector.and_then(|selector| document.select(&selector).next()) {
        Some(element) => element,
        None => document.root_element(),
    };
    root.text().map(|text| text.trim().chars().count()).sum()
}

/// 从原文档（清理前）里读 `<base href>`，UI 会把它作为渲染容器的基准地址。
/// 清理器不输出 `<base>` 标签本身，因为宿主会往沙箱文档注入自己的 `<base>`。
fn base_href_from(html: &str, fallback: &Url) -> String {
    let lowered = html.to_ascii_lowercase();
    let Some(index) = lowered.find("<base") else {
        return fallback.to_string();
    };
    let tail = &html[index..];
    let Some(end) = tail.find('>') else {
        return fallback.to_string();
    };
    let tag = &tail[..end];
    let lowered_tag = tag.to_ascii_lowercase();
    let Some(href_index) = lowered_tag.find("href=") else {
        return fallback.to_string();
    };
    let after = &tag[href_index + 5..];
    let Some(quote) = after.chars().next() else {
        return fallback.to_string();
    };
    let rest = &after[1..];
    match rest.find(quote) {
        Some(close) => {
            let candidate = &rest[..close];
            match fallback.join(candidate) {
                Ok(url) if matches!(url.scheme(), "http" | "https") => url.to_string(),
                _ => fallback.to_string(),
            }
        }
        None => fallback.to_string(),
    }
}

// ------------------------------------------------------------ scraper 侧的工具

fn extract_meta(document: &Html, base: &Url) -> PageMeta {
    let mut meta = PageMeta::default();
    meta.title = first_text(document, "title").unwrap_or_default();
    if let Some(canonical) = first_attr(document, "link[rel=canonical]", "href") {
        if let Ok(url) = base.join(&canonical) {
            meta.canonical = url.to_string();
        }
    }
    for (property, target) in [
        ("og:title", "title"),
        ("og:site_name", "site"),
        ("og:description", "description"),
        ("description", "description"),
    ] {
        let selector = format!("meta[property=\"{property}\"], meta[name=\"{property}\"]");
        if let Some(content) = first_attr(document, &selector, "content") {
            let content = collapse_whitespace(&content);
            if content.is_empty() {
                continue;
            }
            match target {
                "title" if meta.title.is_empty() => meta.title = content,
                "site" if meta.site_name.is_empty() => meta.site_name = content,
                "description" if meta.description.is_empty() => meta.description = content,
                _ => {}
            }
        }
    }
    meta.title = collapse_whitespace(&meta.title);
    meta.site_name = collapse_whitespace(&meta.site_name);
    meta.description = collapse_whitespace(&meta.description);
    meta
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn first_text(document: &Html, selector: &str) -> Option<String> {
    let selector = Selector::parse(selector).ok()?;
    document
        .select(&selector)
        .next()
        .map(|element| collapse_whitespace(&element.text().collect::<String>()))
        .filter(|value| !value.is_empty())
}

fn first_attr(document: &Html, selector: &str, attribute: &str) -> Option<String> {
    let selector = Selector::parse(selector).ok()?;
    document
        .select(&selector)
        .next()
        .and_then(|element| element.value().attr(attribute))
        .map(|value| value.to_string())
}

/// 取某个选择器命中节点的 HTML 与其实际命中的选择器。
fn subtree_html(document: &Html, selector: &str) -> Option<(String, String)> {
    let parsed = Selector::parse(selector).ok()?;
    let element = document.select(&parsed).next()?;
    let html = element.html();
    if html.trim().is_empty() {
        return None;
    }
    // 命中结果过小基本是误命中（例如命中了空占位节点）。
    let text: usize = element.text().map(|text| text.trim().chars().count()).sum();
    if text < 80 && !selector.contains("content") {
        return None;
    }
    Some((html, selector.to_string()))
}

fn selector_link(document: &Html, selector: Option<&str>, base: &Url) -> Option<PageLink> {
    let selector = Selector::parse(selector?).ok()?;
    for element in document.select(&selector) {
        let Some(href) = element.value().attr("href") else { continue };
        let Some(url) = resolve_url(base, href) else { continue };
        return Some(PageLink {
            text: collapse_whitespace(&element.text().collect::<String>()),
            url,
        });
    }
    None
}

fn collect_chapters(document: &Html, selector: &str, base: &Url, limit: usize) -> Vec<PageLink> {
    let Ok(parsed) = Selector::parse(selector) else {
        return Vec::new();
    };
    let Ok(anchor) = Selector::parse("a[href]") else {
        return Vec::new();
    };
    let mut chapters = Vec::new();
    for element in document.select(&parsed) {
        for link in element.select(&anchor) {
            let Some(href) = link.value().attr("href") else { continue };
            let Some(url) = resolve_url(base, href) else { continue };
            let text = collapse_whitespace(&link.text().collect::<String>());
            if text.is_empty() || text.chars().count() > 60 {
                continue;
            }
            chapters.push(PageLink { text, url });
            if chapters.len() >= limit {
                return chapters;
            }
        }
    }
    chapters
}

fn collect_images(document: &Html, base: &Url, limit: usize) -> Vec<(String, String)> {
    let Ok(selector) = Selector::parse("img") else {
        return Vec::new();
    };
    let mut images = Vec::new();
    let mut seen = HashSet::new();
    for element in document.select(&selector) {
        let candidate = element
            .value()
            .attr("src")
            .or_else(|| element.value().attr("data-src"))
            .or_else(|| element.value().attr("data-original"));
        let Some(candidate) = candidate else { continue };
        let Some(url) = resolve_url(base, candidate) else { continue };
        if url.starts_with("data:") || !seen.insert(url.clone()) {
            continue;
        }
        let alt = element.value().attr("alt").unwrap_or_default().to_string();
        images.push((url, collapse_whitespace(&alt)));
        if images.len() >= limit {
            break;
        }
    }
    images
}

/// 识别"开始阅读 / 继续阅读 / 开始阅读"这类入口。
fn detect_start_reading(document: &Html, base: &Url) -> Option<PageLink> {
    const STARTS: &[&str] = &["开始阅读", "继续阅读", "开始看", "立即阅读", "从头阅读", "阅读正文", "start reading"];
    let selector = Selector::parse("a[href]").ok()?;
    for element in document.select(&selector) {
        let text = collapse_whitespace(&element.text().collect::<String>());
        if text.is_empty() || text.chars().count() > 10 {
            continue;
        }
        let lowered = text.to_ascii_lowercase();
        if !STARTS.iter().any(|needle| lowered.contains(needle)) {
            continue;
        }
        let Some(href) = element.value().attr("href") else { continue };
        let Some(url) = resolve_url(base, href) else { continue };
        return Some(PageLink { text, url });
    }
    None
}

/// 站点在正文里塞的"请勿使用阅读模式"之类提示句子——它们对读者毫无价值，
/// 而且几乎每个小说站都有一句。按文字内容匹配（CSS 选择器做不到这件事）。
const NOISE_TEXT_PATTERNS: &[&str] = &[
    "请勿开启浏览器阅读模式",
    "请关闭浏览器阅读模式",
    "开启浏览器阅读模式",
    "浏览器阅读模式",
    "请退出阅读模式",
    "本站已启用防盗",
    "请记住本站",
    "最快更新",
    "无弹窗",
    "手机用户请",
    "推荐票",
    "求收藏",
    "求订阅",
    "加入书签",
    "天才一秒记住",
    "内容严重缺失",
];

/// 按内容（而不是按类名）识别"章节目录"。
///
/// 大量小说站的 class 名是随机的（`class="empdrp9"`），按选择器写规则根本
/// 无法维护；但目录结构本身是稳定的：一个容器里放着一批 URL 形状相同、标题
/// 互不相同的链接。这里就按这个特征去找。
fn detect_chapter_list(
    document: &Html,
    base: &Url,
    limit: usize,
    min_links: usize,
) -> Vec<PageLink> {
    let Ok(anchor) = Selector::parse("a[href]") else {
        return Vec::new();
    };
    let mut best: Option<(Vec<PageLink>, usize)> = None;

    for candidate in document.select(&Selector::parse("body").unwrap()) {
        for container in candidate.descendants().filter_map(scraper::ElementRef::wrap) {
            let name = container.value().name();
            if !matches!(name, "ul" | "ol" | "dl" | "div" | "section" | "table" | "tbody") {
                continue;
            }
            let mut links: Vec<PageLink> = Vec::new();
            for element in container.select(&anchor) {
                let Some(href) = element.value().attr("href") else { continue };
                let Some(url) = resolve_url(base, href) else { continue };
                if url.starts_with('#') {
                    continue;
                }
                let text = collapse_whitespace(&element.text().collect::<String>());
                if text.is_empty() || text.chars().count() > 60 {
                    continue;
                }
                links.push(PageLink { text, url });
            }
            if links.len() < min_links {
                continue;
            }
            // 目录里的链接必须"形状相同"：同一层级、同一个父路径。
            let mut shapes: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
            for link in &links {
                if let Some(shape) = url_shape(&link.url) {
                    *shapes.entry(shape).or_insert(0) += 1;
                }
            }
            let Some((_, dominant)) = shapes.iter().max_by_key(|(_, count)| **count) else {
                continue;
            };
            let dominant = *dominant;
            // 至少要有一半链接同形，且不能是"一堆同样的地址"。
            if dominant * 2 < links.len() {
                continue;
            }
            // 目录里常混着一条"完整目录 / 章节目录"的入口，它不是章节。
            links.retain(|link| !is_catalogue_entry(&link.text, &link.url));
            if links.len() < min_links {
                continue;
            }
            let mut titles: std::collections::HashSet<&str> = std::collections::HashSet::new();
            for link in &links {
                titles.insert(link.text.as_str());
            }
            if titles.len() * 2 < links.len() {
                continue;
            }
            let score = dominant * 3 + titles.len();
            if best.as_ref().map(|(_, current)| score > *current).unwrap_or(true) {
                links.truncate(limit);
                best = Some((links, score));
            }
        }
    }

    best.map(|(links, _)| links).unwrap_or_default()
}

/// 判断一条链接是不是"目录入口"而不是章节。书名/目录链接的地址形状常常和章节
/// 链接一模一样（`/shulou8/onpnq/mulu_1.html`），只能靠文字和路径里的线索区分。
fn is_catalogue_entry(text: &str, url: &str) -> bool {
    const MARKERS: &[&str] = &["目录", "書目", "章节列表", "全部章节", "章節", "catalog", "contents"];
    if MARKERS.iter().any(|marker| text.contains(marker)) {
        return true;
    }
    let lowered = url.to_ascii_lowercase();
    ["mulu", "index", "catalog", "list", "/dir"].iter().any(|marker| lowered.contains(marker))
}

/// 把 URL 归一成"形状"：把最后一段里的数字与长随机串替换成占位符。
/// `/shulou8/onpnq/jktlblnx.html` → `/shulou8/onpnq/*.html`
/// `/book/10806/2708313.html` → `/book/10806/*.html`
fn url_shape(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let segments: Vec<&str> = parsed.path().split('/').collect();
    let (last, parents) = segments.split_last()?;
    let mut normalized = String::from("/");
    for parent in parents.iter().skip(1) {
        normalized.push_str(parent);
        normalized.push('/');
    }
    let (stem, extension) = match last.rsplit_once('.') {
        Some((_, extension)) => ("*", Some(extension)),
        None => ("*", None),
    };
    normalized.push_str(&stem);
    if let Some(extension) = extension {
        normalized.push('.');
        normalized.push_str(extension);
    }
    Some(normalized)
}

/// 用链接文字猜章节翻页。
fn guess_navigation(document: &Html, base: &Url) -> (Option<PageLink>, Option<PageLink>) {
    const NEXT: &[&str] = &["下一章", "下一页", "下章", "下页", "后一章", "下一节", "next", "»", "→"];
    const PREV: &[&str] = &["上一章", "上一页", "上章", "上页", "前一章", "上一节", "prev", "previous", "«", "←"];

    let Ok(selector) = Selector::parse("a[href]") else {
        return (None, None);
    };
    let mut prev: Option<PageLink> = None;
    let mut next: Option<PageLink> = None;
    for element in document.select(&selector) {
        let text = collapse_whitespace(&element.text().collect::<String>());
        if text.is_empty() || text.chars().count() > 12 {
            continue;
        }
        let lowered = text.to_ascii_lowercase();
        let Some(href) = element.value().attr("href") else { continue };
        let Some(url) = resolve_url(base, href) else { continue };
        if next.is_none() && NEXT.iter().any(|needle| lowered.contains(needle)) {
            next = Some(PageLink { text: text.clone(), url: url.clone() });
        }
        if prev.is_none() && PREV.iter().any(|needle| lowered.contains(needle)) {
            prev = Some(PageLink { text: text.clone(), url: url.clone() });
        }
        if next.is_some() && prev.is_some() {
            break;
        }
    }
    (prev, next)
}

/// 通用正文打分：没有站点规则或规则未命中时的兜底。
fn score_content_root(document: &Html) -> Option<(String, String)> {
    const CANDIDATES: &[&str] = &[
        "article",
        "main",
        "[role=main]",
        "#content",
        ".content",
        "#main",
        ".main",
        ".post",
        ".article",
        ".entry-content",
        ".markdown-body",
        ".article-content",
        "#chaptercontent",
        "section",
        "div",
        "td",
    ];
    let Ok(paragraph_selector) = Selector::parse("p") else {
        return None;
    };
    let Ok(link_selector) = Selector::parse("a") else {
        return None;
    };
    let mut best: Option<(String, String, f64)> = None;
    for selector in CANDIDATES {
        let Ok(parsed) = Selector::parse(selector) else { continue };
        for element in document.select(&parsed) {
            let text: usize = element.text().map(|text| text.trim().chars().count()).sum();
            if text < 200 {
                continue;
            }
            let links: usize = element
                .select(&link_selector)
                .map(|link| link.text().map(|text| text.trim().chars().count()).sum::<usize>())
                .sum();
            let paragraphs = element.select(&paragraph_selector).count();
            let link_ratio = links as f64 / text as f64;
            let density = 1.0 - link_ratio.min(1.0);
            let structural_bonus = match *selector {
                "article" | "main" | "[role=main]" => 1.25,
                "div" | "section" | "td" => 0.8,
                _ => 1.0,
            };
            let score =
                (text as f64 * density * density + paragraphs as f64 * 35.0) * structural_bonus;
            if best.as_ref().map(|(_, _, current)| score > *current).unwrap_or(true) {
                let html = element.html();
                if !html.trim().is_empty() {
                    best = Some((html, selector.to_string(), score));
                }
            }
        }
    }
    best.map(|(html, selector, _)| (html, selector))
}

/// 从内嵌脚本里还原被编码的正文。
///
/// 中文小说站的常见做法是把每个段落 base64 化后塞进脚本：
/// `document.writeln(qsbs.bb('PHA+5LiA5aOw...'))` 或 `eval(unescape('...'))`。
/// 浏览器靠脚本渲染出来，而清理器必须删掉脚本，正文就会整段消失。
/// 这里用启发式把这类字面量解出来，拼成真正的 HTML 再走一遍清理流程。
pub fn decode_packed_content(html: &str) -> Option<String> {
    let mut pieces: Vec<String> = Vec::new();
    let mut decoded_bytes = 0usize;
    let mut index = 0usize;

    while index < html.len() {
        let rest = &html[index..];
        let Some(quote_offset) = rest.find(['\'', '"']) else {
            break;
        };
        let quote = rest.as_bytes()[quote_offset] as char;
        let literal_start = index + quote_offset + 1;
        let Some(close_offset) = html[literal_start..].find(quote) else {
            break;
        };
        let literal = &html[literal_start..literal_start + close_offset];
        index = literal_start + close_offset + 1;

        if literal.len() < 32 || literal.len() > 4 * 1024 * 1024 {
            continue;
        }
        // 只看真正的 base64 字符集，避免把普通文案当成密文。
        if !literal
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=' | b'\n' | b'\r'))
        {
            continue;
        }
        let Some(bytes) = base64_decode(literal) else {
            continue;
        };
        let Ok(text) = String::from_utf8(bytes) else {
            continue;
        };
        // 解码结果必须是 HTML 片段（至少含一个标签）才认。
        if !text.contains('<') || !text.contains('>') {
            continue;
        }
        decoded_bytes += text.len();
        pieces.push(text);
        if pieces.len() >= 4000 || decoded_bytes > 4 * 1024 * 1024 {
            break;
        }
    }

    if pieces.is_empty() {
        return None;
    }
    Some(format!("<div class=\"dbx-unpacked\">{}</div>", pieces.join("")))
}

/// 标准 base64 解码（含 `-_` URL-safe 变体），失败返回 `None`。
fn base64_decode(input: &str) -> Option<Vec<u8>> {
    let mut output = Vec::with_capacity(input.len() / 4 * 3);
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for byte in input.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' | b'\n' | b'\r' | b' ' => continue,
            _ => return None,
        } as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buffer >> bits) as u8);
        }
    }
    Some(output)
}

/// 从内嵌的 JSON 状态里还原正文。
///
/// 现代站点（Next.js / Nuxt / 各类 SSR 框架）常把整页数据塞进
/// `<script id="__NEXT_DATA__">`、`window.__NUXT__=`、`__INITIAL_STATE__` 之类的
/// 脚本里。脚本会被清理器删掉，正文也就一起没了——这里在删之前把它们捞出来，
/// 递归找出「成段的自然语言」再拼成 HTML。
pub fn decode_embedded_json(html: &str) -> Option<String> {
    const MARKERS: &[&str] = &[
        "__NEXT_DATA__",
        "__NUXT__",
        "__INITIAL_STATE__",
        "__APOLLO_STATE__",
        "SSR_HYDRATED_DATA",
        "RENDER_DATA",
        "window.__data",
        "__PRELOADED_STATE__",
        "self.__next_f",
    ];

    let mut texts: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for marker in MARKERS {
        for blob in json_blobs_after(html, marker) {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&blob) else {
                continue;
            };
            collect_json_text(&value, &mut texts, &mut seen, 0);
            if texts.len() >= 2000 {
                break;
            }
        }
        if texts.len() >= 2000 {
            break;
        }
    }

    if texts.is_empty() {
        return None;
    }
    let mut output = String::from("<div class=\"dbx-embedded\">");
    for text in texts.iter().take(600) {
        output.push_str("<p>");
        output.push_str(&escape_text(text));
        output.push_str("</p>");
    }
    output.push_str("</div>");
    Some(output)
}

/// 找出 `marker` 之后第一个配平的 JSON 值（`{`…`}` 或 `[`…`]`）。
/// 用括号计数配平，并且区分字符串内外，避免被文本里的括号骗到。
fn json_blobs_after(html: &str, marker: &str) -> Vec<String> {
    let mut blobs = Vec::new();
    let mut from = 0usize;
    while let Some(offset) = html[from..].find(marker) {
        let start_at = from + offset + marker.len();
        from = start_at;
        let Some(open_offset) = html[start_at..].find(['{', '[']) else {
            continue;
        };
        let start = start_at + open_offset;
        // 标记和数据之间不能隔太远，否则多半是误命中。
        if open_offset > 64 {
            continue;
        }
        if let Some(blob) = balanced_json(&html[start..]) {
            blobs.push(blob);
        }
        if blobs.len() >= 6 {
            break;
        }
    }
    blobs
}

/// 从 `{` 或 `[` 开始取出配平的 JSON 文本。
fn balanced_json(text: &str) -> Option<String> {
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (index, ch) in text.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' | '[' => depth += 1,
            '}' | ']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(text[..index + ch.len_utf8()].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

/// 递归收集 JSON 里的长文本。
fn collect_json_text(
    value: &serde_json::Value,
    out: &mut Vec<String>,
    seen: &mut HashSet<String>,
    depth: usize,
) {
    if depth > 24 || out.len() >= 2000 {
        return;
    }
    match value {
        serde_json::Value::String(text) => {
            let trimmed = text.trim();
            if !looks_like_prose(trimmed) {
                return;
            }
            let owned = trimmed.to_string();
            if seen.insert(owned.clone()) {
                out.push(owned);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_json_text(item, out, seen, depth + 1);
            }
        }
        serde_json::Value::Object(map) => {
            for (key, item) in map {
                // 只认正文类字段，避免把 url / id / class 名当成正文。
                if matches!(
                    key.as_str(),
                    "content"
                        | "text"
                        | "body"
                        | "html"
                        | "desc"
                        | "description"
                        | "summary"
                        | "title"
                        | "abstract"
                        | "paragraphs"
                        | "chapters"
                        | "items"
                        | "data"
                        | "list"
                        | "props"
                        | "pageProps"
                        | "article"
                        | "post"
                        | "note"
                ) || matches!(
                    key.as_str(),
                    "noteContent" | "noteTitle" | "articleContent" | "videoDesc" | "shareTitle"
                ) {
                    collect_json_text(item, out, seen, depth + 1);
                }
            }
        }
        _ => {}
    }
}

/// 判断一段字符串像不像"给人读的正文"。
fn looks_like_prose(text: &str) -> bool {
    if text.chars().count() < 24 {
        return false;
    }
    let lowered = text.to_ascii_lowercase();
    if lowered.starts_with("http://") || lowered.starts_with("https://") || lowered.starts_with("data:") {
        return false;
    }
    // 含标签的片段交给清理器再处理，这里会连标签一起留下；纯文本直接保留。
    let cjk = text.chars().filter(|ch| ('\u{4e00}'..='\u{9fff}').contains(ch)).count();
    let ascii_letters = text.chars().filter(|ch| ch.is_ascii_alphabetic()).count();
    let spaces = text.chars().filter(|ch| ch.is_whitespace()).count();
    // 中文正文：汉字占比要够高；英文正文：要有空格分词。
    if cjk >= 12 {
        return cjk * 3 >= text.chars().count().min(120);
    }
    ascii_letters >= 40 && spaces * 6 >= text.chars().count().min(400)
}

fn escape_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(html: &str, mode: RenderMode) -> CleanedPage {
        let base = Url::parse("https://example.com/a/b").unwrap();
        let options = CleanOptions {
            base: &base,
            rule: None,
            mode,
            inline_stylesheets: false,
            max_gallery_images: 10,
            max_html_bytes: 1024 * 1024,
        };
        clean(html, &options, &Engine::default())
    }

    #[test]
    fn removes_scripts_handlers_and_wrappers() {
        let html = r#"<html><head><title>T</title></head><body>
            <script>alert(1)</script>
            <div onclick="evil()" style="position:fixed;color:red">正文内容</div>
        </body></html>"#;
        let page = run(html, RenderMode::Full);
        assert!(!page.html.contains("<script"), "script 未清理: {}", page.html);
        assert!(!page.html.contains("onclick"), "事件处理器未清理: {}", page.html);
        assert!(!page.html.contains("position:fixed"), "危险样式未清理: {}", page.html);
        assert!(!page.html.contains("<html"), "外壳未剥离: {}", page.html);
        assert!(page.html.contains("正文内容"));
        assert_eq!(page.meta.title, "T");
    }

    #[test]
    fn rewrites_relative_urls_to_absolute() {
        let html = r#"<div><a href="/x/y">L</a><img src="img/p.png" alt="p"><a href="javascript:void(0)">bad</a></div>"#;
        let page = run(html, RenderMode::Full);
        assert!(page.html.contains("https://example.com/x/y"), "{}", page.html);
        assert!(page.html.contains("https://example.com/a/img/p.png"), "{}", page.html);
        assert!(!page.html.contains("javascript:"), "{}", page.html);
    }

    #[test]
    fn reader_mode_prefers_article_container() {
        let filler = "无关导航 ".repeat(60);
        let body = "这是一段足够长的正文内容，用来触发打分算法。".repeat(20);
        let html = format!(
            r#"<html><body><nav>{filler}</nav><article><h1>标题</h1><p>{body}</p></article></body></html>"#
        );
        let page = run(&html, RenderMode::Reader);
        assert!(page.content_selector.is_some());
        assert!(page.text_length > 200, "正文长度 {}", page.text_length);
        assert!(!page.html.contains("无关导航"));
    }

    #[test]
    fn guesses_chapter_navigation() {
        let html = r#"<div><a href="/c/1.html">上一章</a><a href="/c/3.html">下一章</a></div>"#;
        let page = run(html, RenderMode::Full);
        assert_eq!(page.prev.unwrap().url, "https://example.com/c/1.html");
        assert_eq!(page.next.unwrap().url, "https://example.com/c/3.html");
    }

    #[test]
    fn css_urls_are_absolutized() {
        let base = Url::parse("https://example.com/css/a.css").unwrap();
        let css = "@import url(other.css); body{background:url('../img/b.png')} .x{background-image:url(\"/i/c.png\")}";
        let rewritten = rewrite_css_urls(css, &base);
        assert!(!rewritten.contains("@import"));
        assert!(rewritten.contains("https://example.com/img/b.png"), "{rewritten}");
        assert!(rewritten.contains("https://example.com/i/c.png"), "{rewritten}");
    }

    #[test]
    fn strips_lol_html_wrappers_from_fragment() {
        let page = run("<p>只有一段</p>", RenderMode::Full);
        assert!(!page.html.contains("<body"), "{}", page.html);
        assert!(page.html.contains("只有一段"));
    }

    #[test]
    fn decodes_base64_packed_script_content() {
        // `document.writeln(qsbs.bb('<base64>'))` 是中文小说站的常见混淆方式。
        let paragraph = "<p>第一段正文内容，长度足够。</p>";
        let encoded = base64_encode(paragraph.as_bytes());
        let html = format!(
            r#"<html><body><div class="word_read"><h3>第一章</h3>
            <script>document.writeln(qsbs.bb('{encoded}'));</script>
            </div></body></html>"#
        );
        let decoded = decode_packed_content(&html).expect("应该能解出内嵌正文");
        assert!(decoded.contains("第一段正文内容"), "{decoded}");
    }

    #[test]
    fn packed_decoder_ignores_plain_markup() {
        let html = r#"<div class="content"><p>没有混淆的正文</p></div>"#;
        assert!(decode_packed_content(html).is_none());
    }

    #[test]
    fn detects_chapter_list_without_stable_class_names() {
        // 类名是随机的（真实站点就是这样），只能靠"一组同形链接"识别目录。
        let items: String = (1..=40)
            .map(|index| format!("<li><a href=\"/shulou8/onpnq/abc{index}x.html\">第{index}章：正文标题</a></li>"))
            .collect();
        let html = format!(
            r#"<html><body><main><h1>某本书</h1><p>简介文字。</p>
            <section class="dvvhk12"><h2>目录</h2><ul class="empdrp9">{items}</ul></section>
            </main></body></html>"#
        );
        let page = run(&html, RenderMode::Reader);
        assert_eq!(page.chapters.len(), 40, "应该识别出 40 条章节");
        assert_eq!(page.chapters[0].url, "https://example.com/shulou8/onpnq/abc1x.html");
    }

    #[test]
    fn does_not_mistake_a_nav_bar_for_a_chapter_list() {
        // 导航栏只有几条链接，且数量不够，不能被当成目录。
        let html = r#"<html><body><nav>
            <a href="/a">首页</a><a href="/b">分类</a><a href="/c">排行</a><a href="/d">书架</a>
            </nav><article><p>一段足够长的正文内容，用来让阅读模式有东西可抽。</p></article></body></html>"#;
        let page = run(html, RenderMode::Reader);
        assert!(page.chapters.is_empty(), "不应该把导航栏当目录: {:?}", page.chapters);
    }

    #[test]
    fn detects_start_reading_entry() {
        let html = r#"<div><a href="/book/1/first.html">开始阅读</a></div>
            <ul><li><a href="/book/1/c1.html">第1章 起点</a></li><li><a href="/book/1/c2.html">第2章 前行</a></li>
            <li><a href="/book/1/c3.html">第3章 转折</a></li><li><a href="/book/1/c4.html">第4章 落幕</a></li>
            <li><a href="/book/1/c5.html">第5章 尾声</a></li></ul>"#;
        let page = run(html, RenderMode::Reader);
        assert_eq!(
            page.start_reading.map(|link| link.url),
            Some("https://example.com/book/1/first.html".to_string())
        );
    }

    #[test]
    fn extracts_text_from_next_data_script() {
        let html = r#"<html><head><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"article":{"title":"测试标题","content":"这是一段足够长的正文内容，用来验证内嵌 JSON 抽取通道是否生效，中文汉字数量要够。"}}},"page":"/post"}</script></head><body><div id="root"></div></body></html>"#;
        let decoded = decode_embedded_json(html).expect("应该能从 __NEXT_DATA__ 里抽出正文");
        assert!(decoded.contains("足够长的正文内容"), "{decoded}");
        assert!(!decoded.contains("pageProps"));
    }

    #[test]
    fn embedded_json_ignores_short_and_url_values() {
        let html = r#"<script id="__NEXT_DATA__">{"props":{"url":"https://example.com/a","title":"短"}}</script>"#;
        assert!(decode_embedded_json(html).is_none());
    }

    #[test]
    fn balanced_json_handles_braces_inside_strings() {
        let text = r#"{"content":"a } b { c \" d"}"#;
        let blob = balanced_json(text).expect("配平");
        assert_eq!(blob, text);
    }

    #[test]
    fn drops_catalogue_entries_from_the_chapter_list() {
        // 真实站点会把「完整目录」混进章节列表，而且地址形状和章节完全一样。
        let items: String = (1..=20)
            .map(|index| format!("<li><a href=\"/s/onpnq/c{index}x.html\">第{index}章 标题</a></li>"))
            .collect();
        let html = format!(
            r#"<html><body><main><h2>目录<a href="/s/onpnq/mulu_1.html">完整目录 »</a></h2>
            <ul>{items}</ul></main></body></html>"#
        );
        let page = run(&html, RenderMode::Reader);
        assert_eq!(page.chapters.len(), 20, "目录入口不该出现在章节列表里");
        assert!(
            page.chapters.iter().all(|chapter| !chapter.text.contains("完整目录")),
            "{:?}",
            page.chapters.first()
        );
    }

    #[test]
    fn base64_round_trips() {        let raw = "中文 base64 测试 test";
        let encoded = base64_encode(raw.as_bytes());
        let decoded = base64_decode(&encoded).expect("decode");
        assert_eq!(String::from_utf8(decoded).unwrap(), raw);
    }

    fn base64_encode(input: &[u8]) -> String {
        const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut output = String::new();
        for chunk in input.chunks(3) {
            let b = [
                chunk[0],
                chunk.get(1).copied().unwrap_or(0),
                chunk.get(2).copied().unwrap_or(0),
            ];
            let triple = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
            output.push(TABLE[((triple >> 18) & 0x3f) as usize] as char);
            output.push(TABLE[((triple >> 12) & 0x3f) as usize] as char);
            if chunk.len() > 1 {
                output.push(TABLE[((triple >> 6) & 0x3f) as usize] as char);
            } else {
                output.push('=');
            }
            if chunk.len() > 2 {
                output.push(TABLE[(triple & 0x3f) as usize] as char);
            } else {
                output.push('=');
            }
        }
        output
    }
}
