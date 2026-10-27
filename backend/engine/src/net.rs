//! HTTP 抓取层。
//!
//! Sidecar 不受浏览器 CSP 与 CORS 限制，所以这里可以直接抓取任意站点。
//! 只负责「拿到字节 → 猜编码 → 变成 String」，其余交给 cleaner。

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use encoding_rs::{Encoding, GB18030};
use serde_json::{json, Value};
use url::Url;

/// 抓到的一段内容。
pub struct Fetched {
    pub final_url: Url,
    pub status: u16,
    pub content_type: String,
    pub body: String,
    pub bytes: usize,
    pub elapsed_ms: u64,
}

/// 抓取失败。
#[derive(Debug)]
pub struct FetchError {
    pub message: String,
    pub status: Option<u16>,
}

impl FetchError {
    fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), status: None }
    }
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

/// 常见浏览器 UA：不少站点对非浏览器 UA 直接 403。
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// 单次请求的头部定制。站点规则可以覆盖，用来应付校验 `Referer` / UA 的站点。
#[derive(Debug, Clone, Default)]
pub struct RequestProfile {
    pub user_agent: Option<String>,
    pub referer: Option<String>,
    /// 抓图片时把 Referer 换成该图片自己的 origin（部分站点的防盗链要求）。
    pub image_referer_origin: bool,
}

impl RequestProfile {
    /// 默认行为：浏览器 UA，Referer 用目标站点自身 origin，图片按 origin 走。
    pub fn browser() -> Self {
        Self {
            user_agent: None,
            referer: None,
            image_referer_origin: true,
        }
    }
}

static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();

fn client() -> &'static reqwest::blocking::Client {
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::limited(10))
            .user_agent(USER_AGENT)
            .cookie_store(true)
            .build()
            .expect("failed to build HTTP client")
    })
}

/// 抓取一个 URL 并解码成 UTF-8 字符串。
pub fn fetch(url: &str, timeout: Duration) -> Result<Fetched, FetchError> {
    fetch_with(url, timeout, &RequestProfile::browser())
}

/// 带自定义头部抓取（站点规则可以指定 UA / Referer）。
pub fn fetch_with(
    url: &str,
    timeout: Duration,
    profile: &RequestProfile,
) -> Result<Fetched, FetchError> {
    let parsed = normalize_url(url)?;
    fetch_parsed(&parsed, timeout, profile)
}

/// 规范化用户输入的 URL：补协议、拒绝不支持的 scheme。
pub fn normalize_url(input: &str) -> Result<Url, FetchError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(FetchError::new("地址为空"));
    }
    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let parsed = Url::parse(&candidate).map_err(|error| FetchError::new(format!("地址无效：{error}")))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(FetchError::new(format!("不支持的协议：{other}"))),
    }
}

fn fetch_parsed(url: &Url, timeout: Duration, profile: &RequestProfile) -> Result<Fetched, FetchError> {
    let started = Instant::now();
    let mut request = client()
        .get(url.as_str())
        .timeout(timeout)
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        )
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("Cache-Control", "no-cache")
        .header("Upgrade-Insecure-Requests", "1");
    if let Some(agent) = profile.user_agent.as_deref().filter(|value| !value.is_empty()) {
        request = request.header("User-Agent", agent);
    }
    // 站点规则没指定时，Referer 用目标站点自身 origin——有些站点的防盗链要求。
    let referer = profile
        .referer
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("{}/", url.origin().ascii_serialization()));
    request = request.header("Referer", referer);

    let response = request.send().map_err(|error| {
            if error.is_timeout() {
                FetchError::new("请求超时")
            } else if error.is_connect() {
                FetchError::new(format!("无法连接：{error}"))
            } else {
                FetchError::new(format!("请求失败：{error}"))
            }
        })?;

    let status = response.status();
    let final_url = response.url().clone();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("text/html")
        .to_string();

    if status.as_u16() >= 400 {
        return Err(FetchError {
            message: format!("HTTP {}", status.as_u16()),
            status: Some(status.as_u16()),
        });
    }

    let raw = response
        .bytes()
        .map_err(|error| FetchError::new(format!("读取响应失败：{error}")))?;
    let bytes = raw.len();
    let body = decode(&raw, &content_type);
    Ok(Fetched {
        final_url,
        status: status.as_u16(),
        content_type,
        body,
        bytes,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

/// 探测编码：优先 Content-Type，其次 `<meta charset>`，然后按 UTF-8 解码；
/// UTF-8 解码失败时退回 GB18030（中文小说站常见）。
pub fn decode(raw: &[u8], content_type: &str) -> String {
    let declared = charset_from_content_type(content_type).or_else(|| charset_from_meta(raw));

    if let Some(declared) = declared {
        if let Some(encoding) = Encoding::for_label(declared.as_bytes()) {
            let (text, _, _) = encoding.decode(raw);
            return text.into_owned();
        }
    }

    // 没有声明编码时先赌 UTF-8；失败再用 GB18030。注意不能反着来——GB18030
    // 几乎能解码任何字节序列，先试它会把正常 UTF-8 页面变成乱码。
    match std::str::from_utf8(raw) {
        Ok(text) => text.to_string(),
        Err(_) => {
            let (text, _, _) = GB18030.decode(raw);
            text.into_owned()
        }
    }
}

fn charset_from_content_type(content_type: &str) -> Option<String> {
    let lowered = content_type.to_ascii_lowercase();
    let index = lowered.find("charset=")?;
    let value = &content_type[index + 8..];
    let value = value.split([';', ' ']).next().unwrap_or_default();
    let value = value.trim_matches(['"', '\'', ' ']);
    if value.is_empty() {
        None
    } else {
        Some(value.to_ascii_lowercase())
    }
}

fn charset_from_meta(raw: &[u8]) -> Option<String> {
    let head = &raw[..raw.len().min(4096)];
    let text = String::from_utf8_lossy(head).to_ascii_lowercase();
    let index = text.find("charset")?;
    let tail = &text[index + 7..];
    let tail = tail.trim_start_matches(['=', '"', '\'', ' ']);
    let value: String = tail
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/// 只抓文本类资源的小工具（样式表内联用）。
pub struct TextResource {
    pub body: String,
    pub final_url: Url,
}

pub fn fetch_text(
    url: &str,
    max_bytes: usize,
    timeout: Duration,
    profile: &RequestProfile,
) -> Result<TextResource, FetchError> {
    let parsed = Url::parse(url).map_err(|error| FetchError::new(error.to_string()))?;
    let fetched = fetch_parsed(&parsed, timeout, profile)?;
    let body = if fetched.body.len() > max_bytes {
        fetched.body[..max_bytes].to_string()
    } else {
        fetched.body
    };
    Ok(TextResource { body, final_url: fetched.final_url })
}

/// 给 UI 用的站点健康检查结果。
pub fn probe(url: &str) -> Value {
    match fetch(url, Duration::from_secs(10)) {
        Ok(fetched) => json!({
            "ok": true,
            "status": fetched.status,
            "url": fetched.final_url.to_string(),
            "contentType": fetched.content_type,
            "bytes": fetched.bytes,
            "elapsedMs": fetched.elapsed_ms,
        }),
        Err(error) => json!({ "ok": false, "error": error.message }),
    }
}

/// 抓取一张图片（沙箱 CSP 只允许 `img-src 'self' data: blob:`，所以远端图片
/// 必须由 Sidecar 取回来再交给 UI）。
pub fn fetch_image(url: &str, max_bytes: usize) -> Result<(String, String, usize), FetchError> {
    fetch_image_with(url, max_bytes, &RequestProfile::browser())
}

/// 带头部定制的图片抓取。`image_referer_origin` 为假时沿用调用方给的 Referer。
pub fn fetch_image_with(
    url: &str,
    max_bytes: usize,
    profile: &RequestProfile,
) -> Result<(String, String, usize), FetchError> {
    let parsed = Url::parse(url).map_err(|error| FetchError::new(format!("图片地址无效：{error}")))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(FetchError::new(format!("不支持的协议：{other}"))),
    }

    // 很多站点的图片有防盗链：直接请求会被 403，带上来源页才行。
    let referer = profile
        .referer
        .clone()
        .filter(|value| !value.is_empty() && !profile.image_referer_origin)
        .unwrap_or_else(|| format!("{}/", parsed.origin().ascii_serialization()));

    let mut request = client()
        .get(parsed.as_str())
        .timeout(Duration::from_secs(20))
        .header("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
        .header("Referer", referer);
    if let Some(agent) = profile.user_agent.as_deref().filter(|value| !value.is_empty()) {
        request = request.header("User-Agent", agent);
    }

    let response = request.send().map_err(|error| {
        if error.is_timeout() {
            FetchError::new("图片下载超时")
        } else {
            FetchError::new(format!("图片下载失败：{error}"))
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        return Err(FetchError {
            message: format!("HTTP {}", status.as_u16()),
            status: Some(status.as_u16()),
        });
    }
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/jpeg")
        .split(';')
        .next()
        .unwrap_or("image/jpeg")
        .trim()
        .to_ascii_lowercase();
    if !content_type.starts_with("image/") {
        return Err(FetchError::new(format!("不是图片：{content_type}")));
    }

    let raw = response
        .bytes()
        .map_err(|error| FetchError::new(format!("读取图片失败：{error}")))?;
    if raw.len() > max_bytes {
        return Err(FetchError::new(format!(
            "图片过大（{} 字节，上限 {max_bytes}）",
            raw.len()
        )));
    }
    Ok((content_type, base64_encode(&raw), raw.len()))
}

/// 标准 base64 编码。
pub fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let first = chunk[0] as u32;
        let second = chunk.get(1).copied().unwrap_or(0) as u32;
        let third = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (first << 16) | (second << 8) | third;
        output.push(TABLE[((triple >> 18) & 0x3f) as usize] as char);
        output.push(TABLE[((triple >> 12) & 0x3f) as usize] as char);
        output.push(if chunk.len() > 1 {
            TABLE[((triple >> 6) & 0x3f) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            TABLE[(triple & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_bare_hosts() {
        assert_eq!(normalize_url("example.com").unwrap().as_str(), "https://example.com/");
        assert!(normalize_url("file:///etc/passwd").is_err());
        assert_eq!(normalize_url("http://a.b/c").unwrap().as_str(), "http://a.b/c");
    }

    #[test]
    fn decodes_gbk_when_utf8_fails() {
        let (raw, _, _) = GB18030.encode("中文测试");
        // 未声明编码的 GBK 页面：字节不是合法 UTF-8，回退到 GB18030。
        assert_eq!(decode(&raw, "text/html"), "中文测试");
    }

    #[test]
    fn keeps_valid_utf8_untouched() {
        let raw = "中文测试".as_bytes();
        assert_eq!(decode(raw, "text/html"), "中文测试");
    }

    #[test]
    fn reads_charset_from_content_type_and_meta() {
        let (raw, _, _) = GB18030.encode("章节");
        assert_eq!(decode(&raw, "text/html; charset=gbk"), "章节");
        let html = b"<html><head><meta charset=\"gb2312\"></head><body>\xd6\xd0\xce\xc4</body></html>";
        assert_eq!(decode(html, "text/html"), "<html><head><meta charset=\"gb2312\"></head><body>中文</body></html>");
    }
}
