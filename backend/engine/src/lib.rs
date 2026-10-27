//! DBX 网页阅读插件的抓取 + 清理引擎。
//!
//! - [`net`]：HTTP 抓取与编码探测（Sidecar 不受浏览器 CSP / CORS 限制）。
//! - [`cleaner`]：把任意站点的 HTML 变成可以安全塞进沙箱工作台的片段。
//! - [`site`]：站点规则表（内置预设 + 用户自定义）。

pub mod cleaner;
pub mod history;
pub mod net;
pub mod site;
