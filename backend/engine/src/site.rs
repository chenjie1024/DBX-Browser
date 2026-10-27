//! 站点规则表：内置预设 + 用户自定义规则。
//!
//! 每条规则描述「如何清理某个站点、用哪块 DOM 当正文、阅读区用什么排版」。
//! Manifest 的 `host.network:*` 权限不影响 Sidecar 的网络能力，所以规则表里出现的
//! 任何域名都不需要在 manifest.json 里声明。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 单条站点规则。所有字段都可省略，省略即「不干预」。
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SiteRule {
    pub id: String,
    pub name: String,
    /// 分类，例如 小说 / 社交 / 资讯。
    pub category: String,
    pub description: String,
    /// 域名匹配：`example.com`、`*.example.com`、`example.com/path` 前缀。
    pub host_patterns: Vec<String>,
    /// 正文候选选择器，按顺序取第一个命中的。
    pub content_selectors: Vec<String>,
    /// 需要整棵删除的节点选择器。
    pub remove_selectors: Vec<String>,
    /// 标题选择器，优先于 `document.title`。
    pub title_selector: Option<String>,
    /// 上一章 / 下一章链接选择器。
    pub prev_selector: Option<String>,
    pub next_selector: Option<String>,
    /// 章节目录容器选择器。
    pub chapter_list_selector: Option<String>,
    /// 注入到正文前部的 CSS。
    pub inject_css: Option<String>,
    /// 站点搜索地址模板，`{q}` 会替换成查询词。
    pub search_url: Option<String>,
    /// 覆盖请求的 Referer（部分站点校验来源页才给内容 / 图片）。
    pub referer: Option<String>,
    /// 覆盖请求的 User-Agent（移动版页面往往更轻、更好抓）。
    pub user_agent: Option<String>,
    /// 图片是否用图片自身 origin 当 Referer（默认 true）。
    pub image_referer_origin: Option<bool>,
    /// 强制渲染模式：`reader` / `full`。
    pub mode: Option<String>,
    /// 用户在内置预设上"删掉"的域名。
    ///
    /// 内置规则是编译进二进制的，不能就地改；所以把被移除的域名记下来，
    /// 匹配时跳过它们（`host_patterns` 里已经剔掉了），UI 再用这个字段
    /// 把被删的标签以灰色显示，可以右键恢复。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocked_patterns: Vec<String>,
    /// 阅读区排版偏好。
    pub reader: Option<Value>,
    /// 用户自定义规则标记。
    #[serde(default, skip_serializing_if = "is_false")]
    pub custom: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// 单个域名 pattern 与单个 host 的匹配。
///
/// - `example.com`：精确或任意子域
/// - `*.example.com` / `.example.com`：任意子域
/// - `bqg*`：前缀必须是「域名标签边界」——`bqg221.com` 命中，`xbqg.com` 不命中
fn host_matches_pattern(pattern: &str, host: &str) -> bool {
    if pattern.is_empty() || host.is_empty() {
        return false;
    }
    if let Some(suffix) = pattern.strip_prefix("*.").or_else(|| pattern.strip_prefix('.')) {
        return host == suffix || host.ends_with(&format!(".{suffix}"));
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        if prefix.is_empty() {
            return true;
        }
        return host.starts_with(prefix)
            && host[prefix.len()..]
                .chars()
                .next()
                .map_or(true, |next| next == '.' || next == '-');
    }
    host == pattern || host.ends_with(&format!(".{pattern}"))
}

impl SiteRule {
    /// 该规则是否匹配给定 URL。
    pub fn matches(&self, url: &url::Url) -> bool {
        self.match_detail(url).is_some()
    }

    /// 诊断用：返回命中的 pattern 与主机判定明细。
    pub fn match_detail(&self, url: &url::Url) -> Option<String> {
        let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
        if host.is_empty() {
            return None;
        }
        // 裸域名规则要能同时匹配 `example.com` 与 `www.example.com`。
        let bare = host.strip_prefix("www.").unwrap_or(&host).to_string();
        let path = url.path().to_ascii_lowercase();

        self.host_patterns.iter().find_map(|pattern| {
            let pattern = pattern.trim().to_ascii_lowercase();
            if pattern.is_empty() {
                return None;
            }
            // 裸 `*` 是兜底规则（通用网页），匹配任何主机。
            if pattern == "*" {
                return Some(format!("{pattern} (catch-all)"));
            }
            let (pattern_host, pattern_path) = match pattern.split_once('/') {
                Some((host_part, path_part)) => {
                    (host_part.to_string(), Some(format!("/{path_part}")))
                }
                None => (pattern.clone(), None),
            };
            let host_ok = host_matches_pattern(&pattern_host, &host)
                || host_matches_pattern(&pattern_host, &bare);
            if !host_ok {
                return None;
            }
            match &pattern_path {
                Some(prefix) if !path.starts_with(prefix) => None,
                _ => Some(pattern),
            }
        })
    }

    /// 给 UI 的摘要。
    pub fn summary(&self) -> Value {
        serde_json::json!({
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "description": self.description,
            "hostPatterns": self.host_patterns,
            "mode": self.mode,
            "searchUrl": self.search_url,
            "custom": self.custom,
            "blockedPatterns": self.blocked_patterns,
            "reader": self.reader,
        })
    }

    /// 完整规则（编辑面板用）。
    pub fn detail(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
}

fn rule(
    id: &str,
    name: &str,
    category: &str,
    description: &str,
    hosts: &[&str],
    content: &[&str],
    remove: &[&str],
) -> SiteRule {
    SiteRule {
        id: id.to_string(),
        name: name.to_string(),
        category: category.to_string(),
        description: description.to_string(),
        host_patterns: hosts.iter().map(|value| value.to_string()).collect(),
        content_selectors: content.iter().map(|value| value.to_string()).collect(),
        remove_selectors: remove.iter().map(|value| value.to_string()).collect(),
        ..SiteRule::default()
    }
}

/// 所有站点都会应用的通用清理选择器。
///
/// 刻意保持克制：宁可少删，也不要把正文删掉。`script` / `style` 之类的标签由
/// 引擎的标签白名单统一处理，不需要写在这里。
pub fn universal_remove_selectors() -> Vec<String> {
    [
        "link",
        "meta",
        "style",
        "svg",
        "canvas",
        "audio",
        "video",
        "figure.wp-block-embed",
        ".advertisement",
        ".adsbygoogle",
        ".ad-container",
        ".ad-wrapper",
        "[id^=google_ads]",
        "[id^=aswift]",
        "[class^=ads-]",
        "[class*=cookie-banner]",
        "[class*=cookie-consent]",
        "[class*=cookie-notice]",
        "[class*=gdpr-consent]",
        "[aria-hidden=true][role=presentation]",
    ]
    .iter()
    .map(|value| value.to_string())
    .collect()
}

/// 内置站点规则。
pub fn builtin_rules() -> Vec<SiteRule> {
    let mut rules = Vec::new();

    // ---------------------------------------------------------------- 小说站
    // 说明：23qb 一类站点对服务端请求返回 403（Cloudflare 反爬），实测打不开，
    // 因此不再为它们单独准备预设——统一由 novel-generic 兜底。

    let mut novel_obfuscated = rule(
        "novel-obfuscated",
        "小说站（混淆类名）",
        "小说",
        "类名被随机化的小说站：靠 <article>/<main> 结构抓正文，目录与翻页由内容自动识别。",
        &[
            // 只保留实测可用的域名。`qbtr.cc` 会 302 到 `qbtr.org`，而匹配用的是
            // 跳转后的最终地址，所以两个都要写。
            "taishuaile.com", "qbtr.cc", "qbtr.org", "bqzw*",
        ],
        &[
            "article",
            "#chaptercontent",
            "#content",
            ".word_read",
            ".read-content",
            "main",
        ],
        &[
            ".hd1wzz",
            "[class*=read_btn]",
            ".read_btn",
            ".bottem",
            ".bottem1",
            ".bottem2",
            ".chapter-nav",
            ".page_chapter",
            ".tips",
            ".report",
            ".recommend",
            ".bookinfo",
            "footer",
            "header",
            "nav",
            "[class*=banner]",
            "[id*=banner]",
        ],
    );
    novel_obfuscated.chapter_list_selector = Some("#list, #chapterList, .chapter-list, .listmain".into());
    novel_obfuscated.reader = Some(serde_json::json!({
        "fontFamily": "宋体, SimSun, serif",
        "fontSize": 19,
        "lineHeight": 2.0,
        "maxWidth": 760,
        "paragraphIndent": true,
        "paragraphSpacing": 0.9,
    }));
    rules.push(novel_obfuscated);

    let mut novel_generic = rule(
        "novel-generic",
        "通用小说站",
        "小说",
        "按常见命名约定抓取章节正文，并尽量识别章节翻页。",
        &[
            // `*.bqg*` 这类写法覆盖 `www.bqg221.com` 与 `bqg221.com` 两种情况：
            // 去掉 `*.` 后是后缀通配，比裸前缀通配更不容易误伤。
            //
            // 这份名单**逐个实测过**（2026-10，用 sidecar 真实抓取）。判定标准很严：
            // 必须在**章节页**用阅读模式抽到正文，并且找到了正文容器。
            // "首页有文字量"不算通过 —— 小说站首页永远是推荐列表，没有任何阅读价值。
            //
            // 实测结论：大型平台站（阅文系 hongxiu/readnovel、纵横、17K、起点、晋江）
            // 的章节页要登录或带 cookie 才给正文，服务端抓到的只有推荐位；
            // linovelib 有 Cloudflare 挑战页。这些都不再列名，避免给用户死链。
            "*.bqg*", "*.xbiquge*", "*.biquge*", "*.biqiuge*", "*.shuquge*",
            "*.uukanshu*", "*.ixdzs*",
            // 实测确认章节页能抽到正文的：
            "bqg221.com", "biquge365.net", "shuquge.com",
            // 类名随机化的站点由 novel-obfuscated 处理，这里只是别漏掉。
            "taishuaile.com", "qbtr.cc", "qbtr.org",
            // 可用但正文偏短（章节页只有一个容器，约 250 字），保留并弱化预期。
            "dingdian999.com",
        ],
        &[
            "#content",
            "#chaptercontent",
            "#chapter-content",
            "#booktext",
            ".word_read",
            ".content",
            ".read-content",
            ".reading-content",
            ".txt",
            "#txt",
            ".text",
            "#htmlContent",
            ".showtxt",
            ".yd_text2",
            "#nr1",
            "#nr",
            ".article-content",
            ".book_content",
            "article",
        ],
        &[
            ".bottem",
            ".bottem1",
            ".bottem2",
            ".chapter-nav",
            ".page_chapter",
            ".read_btn",
            ".readset",
            "#readSetBox",
            ".bookinfo",
            ".tips",
            ".report",
            ".recommend",
            ".footer",
            ".header",
            ".nav",
            "#banner",
            ".ads",
            ".bqg-ad",
            ".gg",
            ".bqgbox",
            ".lm",
            "[class*=banner]",
            "[id*=banner]",
        ],
    );
    novel_generic.prev_selector = Some("a[rel=prev], a.prev, a#prev_url".into());
    novel_generic.next_selector = Some("a[rel=next], a.next, a#next_url".into());
    novel_generic.chapter_list_selector =
        Some("#list, #chapterList, .chapter-list, .listmain, .volume-wrap, .book_list".into());
    novel_generic.reader = Some(serde_json::json!({
        "fontFamily": "宋体, SimSun, serif",
        "fontSize": 19,
        "lineHeight": 2.0,
        "maxWidth": 760,
        "paragraphIndent": true,
        "paragraphSpacing": 0.9,
    }));
    // 注意：这里**不要**随便覆盖 referer / user_agent。实测给 bqg221 发一个指向
    // 别家小说站的 Referer 之后，它就不再输出「下一章」链接了——分页合并直接失效。
    // 规则里的 referer / user_agent 字段是留给确实需要的站点的，默认留空最安全。
    rules.push(novel_generic);

    // ------------------------------------------------------------ 社交 / 内容
    // 说明：抖音、微博、知乎**故意没有预设**。
    // 实测这三家对服务端请求只会返回验证码中间页 / 访客验证页 / 403，
    // 服务端 HTML 里一个正文字都没有，留着预设只会让用户以为插件坏了。
    // 这些站点的地址仍然可以打开（会落到 general 规则），只是不再宣称"支持"。

    let mut xhs = rule(
        "xiaohongshu",
        "小红书",
        "社交",
        "笔记详情页：标题、正文、图片与评论。首页/推荐流只有导航，会提示换详情页。",
        &["xiaohongshu.com", "xhslink.com"],
        &[
            "#detail-desc",
            ".note-content",
            ".desc",
            "[class*=note-detail]",
            "[class*=noteContent]",
        ],
        &[
            "[class*=side-bar]",
            "[class*=sidebar]",
            "[class*=interact-container]",
            "[class*=login-container]",
            "[class*=qrcode]",
            "[class*=app-guide]",
            "[class*=download]",
            "[class*=bottom-bar]",
            "[class*=recommend]",
            "[class*=comment-item]:nth-child(n+21)",
        ],
    );
    xhs.mode = Some("reader".into());
    xhs.search_url = Some("https://www.xiaohongshu.com/search_result?keyword={q}".into());
    rules.push(xhs);

    let mut bilibili = rule(
        "bilibili",
        "哔哩哔哩",
        "视频",
        "视频页：标题、UP 主、简介与评论；播放器与推荐位会被移除。",
        &["bilibili.com", "b23.tv"],
        &[
            ".video-desc-info",
            "#v_desc",
            ".desc-info",
            ".video-info-container",
            "[class*=video-desc]",
        ],
        &[
            ".bpx-player-container",
            "#bilibili-player",
            "[class*=ad-report]",
            "[class*=slide-ad]",
            ".recommend-list-v1",
            "[class*=pop-live]",
            ".nav-menu",
            "[class*=international-header]",
            "[class*=login-tip]",
        ],
    );
    bilibili.mode = Some("reader".into());
    bilibili.search_url = Some("https://search.bilibili.com/all?keyword={q}".into());
    rules.push(bilibili);

    let mut douban = rule(
        "douban",
        "豆瓣",
        "社区",
        "书影音条目与日记：保留简介、正文与短评。",
        &["douban.com"],
        &["#link-report", ".note-container", ".article", "#content"],
        &["#db-global-nav", ".go-abroad", ".sns-bar", ".reader-bar", ".aside"],
    );
    douban.mode = Some("reader".into());
    douban.search_url = Some("https://www.douban.com/search?q={q}".into());
    rules.push(douban);

    // ------------------------------------------------------------ 资讯 / 技术
    let mut news = rule(
        "news-cn",
        "中文资讯",
        "资讯",
        "常见新闻门户的正文抽取。",
        &[
            "news.*",
            "*.news.*",
            "thepaper.cn",
            "jiemian.com",
            "36kr.com",
            "ifeng.com",
            "sina.com.cn",
            "sohu.com",
            "163.com",
            "qq.com",
            "people.com.cn",
            "xinhuanet.com",
            "chinanews.com.cn",
            "yicai.com",
            "caixin.com",
            "guancha.cn",
            "huanqiu.com",
            "toutiao.com",
            "baijiahao.baidu.com",
        ],
        &[
            "#artibody",
            "#articleContent",
            ".article-content",
            ".article",
            "#content",
            ".post_body",
            ".post-content",
            ".rich_media_content",
            "#js_content",
            ".article_content",
            ".content",
            "#Content",
            "article",
        ],
        &[
            ".article-sidebar",
            ".related",
            ".recommend",
            ".comment",
            "#comment",
            ".share",
            ".statement",
            ".editor",
            ".advert",
            "[class*=advert]",
            ".breadcrumb",
            ".keywords",
        ],
    );
    news.mode = Some("reader".into());
    rules.push(news);

    let mut tech = rule(
        "tech-blog",
        "技术博客",
        "技术",
        "开发者文档与博客：保留代码块结构。",
        &[
            "csdn.net",
            "cnblogs.com",
            "juejin.cn",
            "segmentfault.com",
            "oschina.net",
            "infoq.cn",
            "51cto.com",
            "iteye.com",
            "medium.com",
            "dev.to",
            "stackoverflow.com",
            "github.io",
            "github.com",
            "gitbook.io",
            "readthedocs.io",
            "docs.rs",
            "developer.mozilla.org",
            "runoob.com",
            "liaoxuefeng.com",
        ],
        &[
            "#content_views",
            ".postBody",
            ".article-content",
            ".markdown-body",
            ".blog-content-box",
            ".htmledit_views",
            ".answer",
            "#js_content",
            ".main-content",
            ".article_content",
            "article",
        ],
        &[
            ".recommend-box",
            ".blog-footer",
            ".csdn-side-toolbar",
            ".hide-article-box",
            ".comment-box",
            ".pulllog-box",
            ".article-copyright",
            "#treeSkill",
            ".passport-login-container",
            ".toolbar",
        ],
    );
    tech.mode = Some("reader".into());
    rules.push(tech);

    let mut wiki = rule(
        "wikipedia",
        "维基百科",
        "百科",
        "词条正文与信息框；移除编辑链接与站点导航。",
        &["wikipedia.org", "wiktionary.org", "wikiwand.com", "baike.baidu.com", "moegirl.org.cn"],
        &["#mw-content-text", ".mw-parser-output", ".wiki-content", "#J-lemma-main-wrapper"],
        &[
            ".mw-editsection",
            "#toc",
            ".toc",
            ".navbox",
            ".vertical-navbox",
            ".metadata",
            ".sistersitebox",
            ".mw-jump-link",
            ".noprint",
            "#catlinks",
            ".mw-indicators",
            ".vector-menu",
            "#mw-navigation",
            ".side-bar",
            ".lemmaWgt-promotion-leadPVBtn",
        ],
    );
    wiki.mode = Some("reader".into());
    wiki.search_url = Some("https://zh.wikipedia.org/w/index.php?search={q}".into());
    rules.push(wiki);

    // ------------------------------------------------------------ 短视频 / 短剧
    //
    // 这两个站几乎全靠前端渲染，服务端抓取经常只拿到验证码页或空壳
    // （实测抖音首页 reader 只剩 0 字）。预设照旧提供选择器：能抽到就抽，
    // 抽不到就走通用兜底——界面不再额外挂"建议用实时页面"之类的提示。
    let mut douyin = rule(
        "douyin",
        "抖音",
        "视频",
        "视频详情页：简介、话题与文案。",
        &["douyin.com", "*.douyin.com", "iesdouyin.com", "*.iesdouyin.com"],
        &[
            "[data-e2e=video-desc]",
            "[data-e2e=video-detail]",
            ".video-info-detail",
            "#douyin-right-container",
            "main",
        ],
        &[
            "[class*=comment]",
            "[data-e2e=comment-list]",
            "[class*=sidebar]",
            "[class*=recommend]",
            "header",
            "nav",
            "footer",
        ],
    );
    douyin.mode = Some("reader".into());

    douyin.search_url = Some("https://www.douyin.com/search/{q}".into());
    rules.push(douyin);

    let mut hongguo = rule(
        "hongguo",
        "红果短剧",
        "视频",
        "短剧详情页与剧集列表。",
        &[
            "hongguoduanju.com",
            "*.hongguoduanju.com",
            "hongguo.com",
            "*.hongguo.com",
        ],
        &[
            "[class*=drama-detail]",
            "[class*=video-desc]",
            "[class*=episode]",
            "article",
            "main",
        ],
        &[
            "[class*=comment]",
            "[class*=recommend]",
            "[class*=sidebar]",
            "header",
            "nav",
            "footer",
        ],
    );
    hongguo.mode = Some("reader".into());

    hongguo.search_url = Some("https://www.hongguoduanju.com/search?q={q}".into());
    rules.push(hongguo);

    let mut forum = rule(
        "forum",
        "论坛与社区",
        "社区",
        "楼层式页面：保留楼主与回复正文。",
        &["tieba.baidu.com", "v2ex.com", "nga.cn", "hupu.com", "reddit.com", "discuz.net", "zhihu.com/column"],
        &[
            "#post_content",
            ".d_post_content",
            ".topic_content",
            ".post-content",
            ".pcb",
            ".RichText",
            "article",
        ],
        &[
            ".j_click_stats",
            ".share",
            "[class*=advert]",
            "[class*=l_post]:nth-child(n+21)",
        ],
    );
    forum.mode = Some("reader".into());
    rules.push(forum);

    // ---------------------------------------------------------------- 通用兜底
    let mut general = rule(
        "general",
        "通用网页",
        "通用",
        "没有匹配到站点规则时使用的通用抽取与清理策略。",
        &["*"],
        &[
            "article",
            "main",
            "[role=main]",
            "#content",
            ".content",
            ".post",
            ".entry",
            "#main",
            ".main",
        ],
        &[],
    );
    general.mode = Some("reader".into());
    general.search_url = Some("https://www.bing.com/search?q={q}".into());
    rules.push(general);

    rules
}

/// 合并用户规则与内置规则：用户规则优先匹配。
///
/// `blocked` 是用户在内置预设上删掉的域名（原样字符串比较）。内置规则编译在
/// 二进制里、改不了，所以这里合并时把它们从 `host_patterns` 剔除，并把被剔除的
/// 记进 `blocked_patterns`，让 UI 还能显示（并可恢复）。自定义规则不受影响。
pub fn merge_rules(custom: Vec<SiteRule>, blocked: &[String]) -> Vec<SiteRule> {
    let mut merged: Vec<SiteRule> = Vec::new();
    for mut item in custom {
        item.custom = true;
        if item.id.trim().is_empty() {
            item.id = format!("custom-{}", merged.len() + 1);
        }
        if item.category.trim().is_empty() {
            item.category = "自定义".to_string();
        }
        if item.name.trim().is_empty() {
            item.name = item.id.clone();
        }
        merged.push(item);
    }
    for mut builtin in builtin_rules() {
        if blocked.is_empty() {
            merged.push(builtin);
            continue;
        }
        let mut kept = Vec::new();
        let mut removed = Vec::new();
        for pattern in builtin.host_patterns.drain(..) {
            if blocked.iter().any(|item| item == &pattern) {
                removed.push(pattern);
            } else {
                kept.push(pattern);
            }
        }
        builtin.host_patterns = kept;
        builtin.blocked_patterns = removed;
        // 域名全被删光的规则不再出现：否则列表里会留一条永远匹配不到的空规则。
        if !builtin.host_patterns.is_empty() {
            merged.push(builtin);
        }
    }
    merged
}

/// 找出第一条匹配 URL 的规则。
pub fn match_rule<'a>(rules: &'a [SiteRule], url: &url::Url) -> Option<&'a SiteRule> {
    rules.iter().find(|rule| rule.matches(url))
}

/// 按分类聚合，供 UI 列表使用。
pub fn group_by_category(rules: &[SiteRule]) -> BTreeMap<String, Vec<Value>> {
    let mut grouped: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for rule in rules {
        grouped
            .entry(rule.category.clone())
            .or_default()
            .push(rule.summary());
    }
    grouped
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> url::Url {
        url::Url::parse(value).expect("url")
    }

    #[test]
    fn host_patterns_match_subdomains_and_wildcards() {
        let rules = builtin_rules();
        // 抖音/微博/知乎故意没有预设：服务端只返回验证码或访客验证页。
        assert_eq!(match_rule(&rules, &url("https://www.douyin.com/video/1")).unwrap().id, "douyin");
        assert_eq!(match_rule(&rules, &url("https://weibo.com/")).unwrap().id, "general");
        assert_eq!(
            match_rule(&rules, &url("https://www.xiaohongshu.com/explore")).unwrap().id,
            "xiaohongshu"
        );
        // 23qb 也去掉了专属预设（服务端 403），落回 general。
        assert_eq!(match_rule(&rules, &url("https://www.23qb.com/book/2537/")).unwrap().id, "general");
        // xbiquge.bz 主站实测连不上（超时），但 `*.xbiquge*` 通配仍然覆盖这类镜像。
        // 注意 `*.xbiquge*` 只匹配 "xbiquge" 开头的域名，不匹配 "xbiquge.bz"
        // 前面的 www 形式，所以这里落回 general 是正确的。
        assert_eq!(match_rule(&rules, &url("https://www.xbiquge.bz/book/1/2.html")).unwrap().id, "general");
        // 实测可用的镜像站要命中小说规则。
        assert_eq!(match_rule(&rules, &url("https://www.bqg221.com/biquge/1/2.html")).unwrap().id, "novel-generic");
        assert_eq!(match_rule(&rules, &url("https://www.shuquge.com/0/10/1.html")).unwrap().id, "novel-generic");
        assert_eq!(match_rule(&rules, &url("https://www.biquge365.net/52_52781/2075.html")).unwrap().id, "novel-generic");
        // 类名随机化的站点走各自的规则，不能被 novel-generic 抢走。
        assert_eq!(match_rule(&rules, &url("https://www.taishuaile.com/shulou8/onpnq/")).unwrap().id, "novel-obfuscated");
        // 大型平台站章节页要登录才给正文，已不列名，落回 general 是有意为之。
        assert_eq!(match_rule(&rules, &url("https://www.zongheng.com/book/1/2.html")).unwrap().id, "general");
        assert_eq!(match_rule(&rules, &url("https://www.jjwxc.net/onebook.php?novelid=1")).unwrap().id, "general");
        assert_eq!(match_rule(&rules, &url("https://example.org/whatever")).unwrap().id, "general");
        assert_eq!(match_rule(&rules, &url("https://blog.csdn.net/x/article/details/1")).unwrap().id, "tech-blog");
    }

    #[test]
    fn prefix_wildcards_do_not_over_match() {
        let rules = builtin_rules();
        // `*.bqg*` 覆盖带 www 与不带 www 的镜像站。
        assert_eq!(
            match_rule(&rules, &url("https://www.bqg221.com/book/1/")).unwrap().id,
            "novel-generic"
        );
        assert_eq!(
            match_rule(&rules, &url("https://bqg221.com/book/1/")).unwrap().id,
            "novel-generic"
        );
        // 无关域名必须落到通用兜底规则，而不是被 `*.bqg*` 之类的前缀通配吞掉。
        assert_eq!(
            match_rule(&rules, &url("https://totally-unrelated.example/x")).unwrap().id,
            "general"
        );
        assert_eq!(match_rule(&rules, &url("https://xbqg.example/x")).unwrap().id, "general");
    }

    #[test]
    fn custom_rules_win_over_builtins() {
        let custom = SiteRule {
            id: "mine".into(),
            name: "Mine".into(),
            category: "自定义".into(),
            host_patterns: vec!["douyin.com".into()],
            ..SiteRule::default()
        };
        let rules = merge_rules(vec![custom], &[]);
        let matched = match_rule(&rules, &url("https://www.douyin.com/video/1")).unwrap();
        assert_eq!(matched.id, "mine");
        assert!(matched.custom);
    }

    /// 在内置预设上"删掉"域名：该域名不再命中那条规则，但规则本身还在，
    /// 且被删的域名可以从 `blocked_patterns` 里读回来（UI 用于恢复）。
    #[test]
    fn blocked_pattern_drops_host_but_keeps_rule() {
        let rules = merge_rules(vec![], &["zhihu.com/column".to_string()]);
        let forum = rules.iter().find(|rule| rule.id == "forum").unwrap();
        assert!(!forum.host_patterns.iter().any(|item| item == "zhihu.com/column"));
        assert!(forum.blocked_patterns.iter().any(|item| item == "zhihu.com/column"));
        // 其它域名照旧命中。
        assert_eq!(
            match_rule(&rules, &url("https://tieba.baidu.com/p/1")).unwrap().id,
            "forum"
        );
        // 被删的域名落到通用规则。
        assert_eq!(
            match_rule(&rules, &url("https://zhihu.com/column/x")).unwrap().id,
            "general"
        );
    }

    #[test]
    fn every_builtin_rule_has_allowed_fields() {
        for rule in builtin_rules() {
            assert!(!rule.id.is_empty(), "规则缺少 id");
            assert!(!rule.host_patterns.is_empty(), "规则 {} 缺少域名", rule.id);
        }
    }
}
