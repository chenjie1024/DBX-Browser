//! 本地小说的磁盘存储。
//!
//! 为什么不放在 UI 的 `host.storage` 里：宿主对它有硬限制——**单值 256 KiB、
//! 插件总量 1 MiB**（见 Host API 文档），而一本 txt 动辄几 MB。之前把整本原文塞进
//! storage，`set` 直接失败、被 `.catch` 静默吞掉，于是"重新打开 DBX 书架就没了"。
//!
//! 所以这里只保存**索引**（书名、章节标题、字数）在 storage 里，原文交给 sidecar
//! 写到 `DBX_PLUGIN_DATA_DIR/local-books/`，空间只受磁盘限制。
//!
//! 安全：书 id 由 UI 生成，但落盘前仍然只接受 `[A-Za-z0-9._:-]`，并再次确认最终路径
//! 落在书籍目录内，避免任何形式的路径穿越。

use std::path::{Path, PathBuf};

/// 书籍目录：`<插件数据目录>/local-books`。
pub fn books_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("local-books")
}

/// 校验书 id。只做**逻辑**校验：不允许空、超长、`..`。
///
/// 注意：id 里可能有 `:`（UI 用 `local:文件名:字数` 生成），而 Windows 文件名不允许冒号，
/// 所以磁盘文件名**不用 id 本身**，而是用它的哈希（见 `file_stem`）。
pub fn sanitize_id(id: &str) -> Option<String> {
    let trimmed = id.trim();
    if trimmed.is_empty() || trimmed.len() > 400 {
        return None;
    }
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return None;
    }
    Some(trimmed.to_string())
}

/// id -> 文件名主干。用稳定的 FNV-1a 哈希，避免任何非法字符与路径穿越，
/// 同时保证同一个 id 每次都映射到同一个文件。
fn file_stem(id: &str) -> Option<String> {
    let safe = sanitize_id(id)?;
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in safe.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    // 再带上长度，进一步降低碰撞导致"两本书互相覆盖"的可能。
    Some(format!("{hash:016x}-{:x}", safe.len()))
}

fn book_paths(data_dir: &Path, id: &str) -> Option<(PathBuf, PathBuf)> {
    let stem = file_stem(id)?;
    let directory = books_dir(data_dir);
    let text = directory.join(format!("{stem}.txt"));
    let meta = directory.join(format!("{stem}.json"));
    // 兜底：确认落点确实在书籍目录内。
    if text.parent() != Some(directory.as_path()) || meta.parent() != Some(directory.as_path()) {
        return None;
    }
    Some((text, meta))
}

/// 写入一本书的原文与元数据。返回写入的字节数。
pub fn save(data_dir: &Path, id: &str, text: &str, meta: &str) -> Result<usize, String> {
    let (text_path, meta_path) = book_paths(data_dir, id).ok_or("书名 id 不合法")?;
    let directory = books_dir(data_dir);
    std::fs::create_dir_all(&directory).map_err(|error| format!("创建书籍目录失败：{error}"))?;
    std::fs::write(&text_path, text.as_bytes()).map_err(|error| format!("写入原文失败：{error}"))?;
    std::fs::write(&meta_path, meta.as_bytes()).map_err(|error| format!("写入元数据失败：{error}"))?;
    Ok(text.len())
}

/// 开始一次分块上传：建目录、清掉旧文件、写下元数据，返回当前字节数（0）。
///
/// 为什么要分块：UI ↔ 宿主的 JSON 桥单次参数上限是 **2 MiB**，一本 4.5 MB 的小说
/// 转成 JSON 字符串会超过它（换行与中文都要转义），整本一次发过去会被宿主直接拒掉
/// （实测 HTTP 400）。所以按字节切片、多次追加。
pub fn begin_upload(data_dir: &Path, id: &str, meta: &str) -> Result<u64, String> {
    let (text_path, meta_path) = book_paths(data_dir, id).ok_or("书名 id 不合法")?;
    let directory = books_dir(data_dir);
    std::fs::create_dir_all(&directory).map_err(|error| format!("创建书籍目录失败：{error}"))?;
    std::fs::write(&text_path, b"").map_err(|error| format!("创建原文失败：{error}"))?;
    std::fs::write(&meta_path, meta.as_bytes()).map_err(|error| format!("写入元数据失败：{error}"))?;
    Ok(0)
}

/// 追加一块。`offset` 必须是当前文件长度，否则说明顺序错乱，直接拒绝。
pub fn append_chunk(data_dir: &Path, id: &str, offset: u64, chunk: &str) -> Result<u64, String> {
    use std::io::Write;
    let (text_path, _) = book_paths(data_dir, id).ok_or("书名 id 不合法")?;
    let current = std::fs::metadata(&text_path).map(|meta| meta.len()).unwrap_or(0);
    if current != offset {
        return Err(format!("分块顺序不对：期望偏移 {current}，收到 {offset}"));
    }
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&text_path)
        .map_err(|error| format!("打开原文失败：{error}"))?;
    file.write_all(chunk.as_bytes())
        .map_err(|error| format!("追加失败：{error}"))?;
    Ok(current + chunk.len() as u64)
}

/// 收尾：校验总字节数与预期一致。
pub fn finish_upload(data_dir: &Path, id: &str, expected_bytes: u64) -> Result<u64, String> {
    let (text_path, _) = book_paths(data_dir, id).ok_or("书名 id 不合法")?;
    let actual = std::fs::metadata(&text_path)
        .map(|meta| meta.len())
        .map_err(|error| format!("找不到原文：{error}"))?;
    if expected_bytes > 0 && actual != expected_bytes {
        return Err(format!("原文不完整：期望 {expected_bytes} 字节，实际 {actual}"));
    }
    Ok(actual)
}

/// 直接把磁盘上的一个文件导入成书（不经过 UI 传输）。
///
/// 给"文件本来就在这台机器上"的场景用：sidecar 是原生进程，可以直接读路径。
pub fn import_from_path(data_dir: &Path, id: &str, source: &Path, meta: &str) -> Result<u64, String> {
    let (text_path, meta_path) = book_paths(data_dir, id).ok_or("书名 id 不合法")?;
    let directory = books_dir(data_dir);
    std::fs::create_dir_all(&directory).map_err(|error| format!("创建书籍目录失败：{error}"))?;
    let bytes = std::fs::read(source).map_err(|error| format!("读取源文件失败：{error}"))?;
    std::fs::write(&text_path, &bytes).map_err(|error| format!("写入原文失败：{error}"))?;
    std::fs::write(&meta_path, meta.as_bytes()).map_err(|error| format!("写入元数据失败：{error}"))?;
    Ok(bytes.len() as u64)
}

/// 读回原文。文件不存在返回 `Ok(None)`，由 UI 决定怎么提示。
pub fn read_text(data_dir: &Path, id: &str) -> Result<Option<String>, String> {
    let (text_path, _) = book_paths(data_dir, id).ok_or("书名 id 不合法")?;
    if !text_path.is_file() {
        return Ok(None);
    }
    match std::fs::read_to_string(&text_path) {
        Ok(text) => Ok(Some(text)),
        Err(error) => Err(format!("读取原文失败：{error}")),
    }
}

pub fn read_meta(data_dir: &Path, id: &str) -> Result<Option<String>, String> {
    let (_, meta_path) = book_paths(data_dir, id).ok_or("书名 id 不合法")?;
    if !meta_path.is_file() {
        return Ok(None);
    }
    std::fs::read_to_string(&meta_path)
        .map(Some)
        .map_err(|error| format!("读取元数据失败：{error}"))
}

pub fn delete(data_dir: &Path, id: &str) -> Result<(), String> {
    let (text_path, meta_path) = book_paths(data_dir, id).ok_or("书名 id 不合法")?;
    let mut removed = false;
    for path in [text_path, meta_path] {
        if path.is_file() {
            std::fs::remove_file(&path).map_err(|error| format!("删除失败：{error}"))?;
            removed = true;
        }
    }
    if !removed {
        return Err("这本书不在磁盘上".to_string());
    }
    Ok(())
}

/// 列出磁盘上现有的书（磁盘文件名主干 + 原文大小），用来和 storage 里的索引对账。
pub fn list(data_dir: &Path) -> Vec<(String, u64)> {
    let directory = books_dir(data_dir);
    let Ok(entries) = std::fs::read_dir(&directory) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("txt") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        found.push((stem.to_string(), size));
    }
    found.sort();
    found
}

/// 原文当前在磁盘上的字节数（不存在算 0）。给"字节数对不上"的排查用。
pub fn size(data_dir: &Path, id: &str) -> u64 {
    match book_paths(data_dir, id) {
        Some((text, _)) => std::fs::metadata(text).map(|meta| meta.len()).unwrap_or(0),
        None => 0,
    }
}

/// 原文的 FNV-1a 64 位哈希（十六进制）。UI 用同算法比对，确认写下来的内容一致。
pub fn digest(data_dir: &Path, id: &str) -> String {
    let Some((text, _)) = book_paths(data_dir, id) else {
        return String::new();
    };
    let Ok(bytes) = std::fs::read(&text) else {
        return String::new();
    };
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// 磁盘上是否存在这本书。UI 拿索引对账时用。
pub fn exists(data_dir: &Path, id: &str) -> bool {
    match book_paths(data_dir, id) {
        Some((text, _)) => text.is_file(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_ids_that_could_escape_the_directory() {
        assert!(sanitize_id("local:book.txt:123").is_some());
        assert!(sanitize_id("").is_none());
        assert!(sanitize_id("../evil").is_none());
        assert!(sanitize_id("a/b").is_none());
        assert!(sanitize_id("a\\b").is_none());
        assert!(sanitize_id(&"x".repeat(401)).is_none());
    }

    #[test]
    fn filenames_avoid_illegal_characters() {
        // id 里带冒号（UI 就是这么生成的），但文件名不能有冒号
        let stem = file_stem("local:《书名》.txt:1563175").expect("stem");
        assert!(!stem.contains(':'), "{stem}");
        assert!(!stem.contains('《'), "{stem}");
        // 同一个 id 必须每次都映射到同一个文件
        assert_eq!(stem, file_stem("local:《书名》.txt:1563175").unwrap());
        // 不同 id 不能撞在一起
        assert_ne!(stem, file_stem("local:《书名》.txt:1563176").unwrap());
    }

    #[test]
    fn chunked_upload_reassembles_the_text() {
        let base = std::env::temp_dir().join("dbx-books-chunked");
        let _ = std::fs::remove_dir_all(&base);
        let id = "local:chunked.txt:9";
        let whole = "第一章 你好\n正文内容\n第二章 再见\n更多正文";
        let bytes = whole.as_bytes();

        begin_upload(&base, id, "{\"chapters\":2}").expect("begin");
        // 按字节切块，但每块都必须落在字符边界上（UTF-8 中文一个字 3 字节）。
        let mut offset = 0u64;
        let mut chunk = String::new();
        for ch in whole.chars() {
            chunk.push(ch);
            if chunk.len() >= 7 {
                offset = append_chunk(&base, id, offset, &chunk).expect("append");
                chunk.clear();
            }
        }
        if !chunk.is_empty() {
            offset = append_chunk(&base, id, offset, &chunk).expect("append");
        }
        assert_eq!(offset as usize, bytes.len());
        assert_eq!(finish_upload(&base, id, offset).unwrap(), bytes.len() as u64);
        assert_eq!(read_text(&base, id).unwrap().as_deref(), Some(whole));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn append_rejects_out_of_order_chunks() {
        let base = std::env::temp_dir().join("dbx-books-order");
        let _ = std::fs::remove_dir_all(&base);
        let id = "local:order.txt:1";
        begin_upload(&base, id, "{}").expect("begin");
        append_chunk(&base, id, 0, "abc").expect("first");
        // 偏移错了必须报错，否则拼出来的正文会缺一段
        assert!(append_chunk(&base, id, 0, "xyz").is_err());
        assert!(append_chunk(&base, id, 99, "xyz").is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn finish_detects_a_truncated_upload() {
        let base = std::env::temp_dir().join("dbx-books-truncated");
        let _ = std::fs::remove_dir_all(&base);
        let id = "local:cut.txt:1";
        begin_upload(&base, id, "{}").expect("begin");
        append_chunk(&base, id, 0, "只有一半").expect("append");
        assert!(finish_upload(&base, id, 999).is_err(), "长度不符应当报错");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn imports_a_file_directly_from_disk() {
        let base = std::env::temp_dir().join("dbx-books-from-path");
        let _ = std::fs::remove_dir_all(&base);
        let source = std::env::temp_dir().join("dbx-books-source.txt");
        std::fs::write(&source, "第一章 直接读盘\n正文").expect("write source");
        let id = "local:frompath.txt:1";
        let written = import_from_path(&base, id, &source, "{}").expect("import");
        assert!(written > 0);
        assert_eq!(read_text(&base, id).unwrap().as_deref(), Some("第一章 直接读盘\n正文"));
        let _ = std::fs::remove_file(&source);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn round_trips_text_and_metadata() {
        let base = std::env::temp_dir().join("dbx-local-books-test");
        let _ = std::fs::remove_dir_all(&base);
        let id = "local:novel.txt:1234";
        save(&base, id, "第一章 你好\n正文", "{\"chapters\":1}").expect("save");
        assert_eq!(read_text(&base, id).unwrap().as_deref(), Some("第一章 你好\n正文"));
        assert_eq!(read_meta(&base, id).unwrap().as_deref(), Some("{\"chapters\":1}"));
        let listed = list(&base);
        assert_eq!(listed.len(), 1, "{listed:?}");
        delete(&base, id).expect("delete");
        assert!(read_text(&base, id).unwrap().is_none());
        assert!(delete(&base, id).is_err(), "重复删除应当报错");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn missing_book_reads_as_none_not_error() {
        let base = std::env::temp_dir().join("dbx-local-books-missing");
        let _ = std::fs::remove_dir_all(&base);
        assert!(read_text(&base, "local:nope.txt:1").unwrap().is_none());
        let _ = std::fs::remove_dir_all(&base);
    }
}
