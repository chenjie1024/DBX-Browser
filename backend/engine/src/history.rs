//! 只读读取 Chrome / Edge 的 `History` 数据库，用来回答一个问题：
//! **阅读窗口里现在打开的是哪个地址。**
//!
//! 为什么不直接用 CDP：本插件的目标环境里，Chromium 的调试端口和命名管道都可能被安全策略
//! 拦掉（见 README「已知限制」）。但阅读窗口用的是**我们自己的 profile**，它的
//! `History` 就是一个标准 SQLite 文件，直接读文件既不依赖调试通道，也不需要网络。
//!
//! 这里自己实现了一个**最小只读 SQLite b-tree 解析器**，而不是引入 `rusqlite`：
//!   * 只需要"按 rowid 顺序读出 urls 表的 url 与 last_visit_time 两列"这一个查询；
//!   * 不引入 C 依赖（rusqlite 要捆绑或链接 SQLite），交叉编译与打包都更省心；
//!   * 读文件是只读操作，绝不写入 —— 浏览器可能正开着这个库。
//!
//! 覆盖范围：table b-tree（叶子页 / 内部页）、溢页、varint、记录序列化类型 0..9 与 12。
//! 不覆盖：索引、WITHOUT ROWID、加密库、WAL 中尚未合并的事务。用不到，缺了也不影响
//! ——最坏情况是列表少几条最近记录。

use std::path::Path;

/// 一条历史记录。
#[derive(Debug, Clone)]
pub struct HistoryEntry {
    pub url: String,
    pub title: String,
    /// Chrome 的 time 格式：1601-01-01 起的微秒数。0 表示未知。
    pub last_visit_time: i64,
    pub visit_count: i64,
}

/// 读取 `History` 里最近访问的若干条记录，按访问时间倒序。
///
/// `limit` 为 0 表示不限制。任何解析问题都返回 `Err`，由调用方决定怎么提示。
pub fn recent(path: &Path, limit: usize) -> Result<Vec<HistoryEntry>, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("读取历史库失败：{error}"))?;
    if bytes.len() < 100 {
        return Err("历史库文件太小，可能还没写入过记录".to_string());
    }
    if &bytes[0..16] != b"SQLite format 3\0" {
        return Err("不是 SQLite 文件".to_string());
    }

    let header = Header::parse(&bytes)?;
    // 找到 urls 表的根页。找不到就退回第 2 页（sqlite_master 的第一页）。
    let root = table_root_page(&bytes, &header, "urls").unwrap_or(2);

    let columns = table_columns(&bytes, &header, "urls");
    let url_index = columns.iter().position(|name| name == "url").unwrap_or(1);
    let title_index = columns.iter().position(|name| name == "title");
    let visit_index = columns.iter().position(|name| name == "visit_count");
    let time_index = columns.iter().position(|name| name == "last_visit_time");

    let mut rows: Vec<Vec<Value>> = Vec::new();
    let mut cursor = RowCursor::new(&bytes, &header);
    cursor.walk(root, &mut rows, 0)?;

    let mut entries: Vec<HistoryEntry> = Vec::new();
    for row in rows {
        let Some(url) = row.get(url_index).and_then(Value::as_text) else {
            continue;
        };
        if url.is_empty() {
            continue;
        }
        entries.push(HistoryEntry {
            url,
            title: title_index
                .and_then(|index| row.get(index))
                .and_then(Value::as_text)
                .unwrap_or_default(),
            visit_count: visit_index
                .and_then(|index| row.get(index))
                .and_then(Value::as_int)
                .unwrap_or(0),
            last_visit_time: time_index
                .and_then(|index| row.get(index))
                .and_then(Value::as_int)
                .unwrap_or(0),
        });
    }

    entries.sort_by(|left, right| right.last_visit_time.cmp(&left.last_visit_time));
    if limit > 0 && entries.len() > limit {
        entries.truncate(limit);
    }
    Ok(entries)
}

// ─────────────────────────────────────────────────────────────── 文件头

struct Header {
    page_size: usize,
    /// 1 = UTF-8, 2 = UTF-16le, 3 = UTF-16be
    encoding: u32,
    usable_size: usize,
}

impl Header {
    fn parse(bytes: &[u8]) -> Result<Self, String> {
        let raw_page_size = u16::from_be_bytes([bytes[16], bytes[17]]);
        // SQLite 用 1 表示 65536，因为 16 位放不下。
        let page_size = if raw_page_size == 1 { 65536 } else { raw_page_size as usize };
        if page_size < 512 || !page_size.is_power_of_two() {
            return Err(format!("页大小异常：{page_size}"));
        }
        let reserved = bytes[20] as usize;
        let encoding = u32::from_be_bytes([bytes[56], bytes[57], bytes[58], bytes[59]]);
        Ok(Self {
            page_size,
            encoding,
            usable_size: page_size - reserved,
        })
    }

    /// 页号从 1 开始。
    fn page<'a>(&self, bytes: &'a [u8], page_number: usize) -> Option<&'a [u8]> {
        if page_number == 0 {
            return None;
        }
        let start = (page_number - 1) * self.page_size;
        let end = start + self.page_size;
        bytes.get(start..end)
    }

    /// b-tree 页头在这一页里的起始偏移。
    ///
    /// 第 1 页的前 100 字节被 SQLite 文件头占用，所以它作为 b-tree 页时，
    /// 页头从偏移 100 开始 —— 单元格指针也是相对这一页开头算的，但内容区不能
    /// 落到前 100 字节里。漏掉这一点就会把文件头当成页类型（实测读到 0x53，
    /// 也就是 'S'，正是 "SQLite format 3" 的首字母）。
    fn btree_offset(&self, page_number: usize) -> usize {
        if page_number == 1 {
            100
        } else {
            0
        }
    }
}

// ─────────────────────────────────────────────────────────────── 值

#[derive(Debug, Clone)]
enum Value {
    Null,
    Int(i64),
    Text(String),
    /// blob / real 用不到，但记录解码时必须能**算对它们的长度**，否则
    /// 后面的列会全部错位，所以保留这两个变体。
    Blob(#[allow(dead_code)] Vec<u8>),
    Real(#[allow(dead_code)] f64),
}

impl Value {
    fn as_text(&self) -> Option<String> {
        match self {
            Value::Text(text) => Some(text.clone()),
            _ => None,
        }
    }

    fn as_int(&self) -> Option<i64> {
        match self {
            Value::Int(value) => Some(*value),
            _ => None,
        }
    }
}

// ─────────────────────────────────────────────────────────────── varint

/// SQLite 的变长整数：最多 9 字节，大端，除第 9 字节外每字节高位置 1 表示继续。
fn read_varint(bytes: &[u8], offset: &mut usize) -> Option<u64> {
    let mut value: u64 = 0;
    for index in 0..9 {
        let byte = *bytes.get(*offset)?;
        *offset += 1;
        if index == 8 {
            value = (value << 8) | byte as u64;
            return Some(value);
        }
        value = (value << 7) | (byte & 0x7F) as u64;
        if byte & 0x80 == 0 {
            return Some(value);
        }
    }
    None
}

// ─────────────────────────────────────────────────────────────── 页遍历

struct RowCursor<'a> {
    bytes: &'a [u8],
    header: &'a Header,
}

impl<'a> RowCursor<'a> {
    fn new(bytes: &'a [u8], header: &'a Header) -> Self {
        Self { bytes, header }
    }

    /// 深度优先遍历 table b-tree，把所有叶子单元格解析成行。
    fn walk(&mut self, page_number: usize, rows: &mut Vec<Vec<Value>>, depth: usize) -> Result<(), String> {
        if depth > 32 {
            return Err("b-tree 层数异常".to_string());
        }
        let Some(page) = self.header.page(self.bytes, page_number) else {
            return Err(format!("页 {page_number} 越界"));
        };
        // 第 1 页的 b-tree 头从字节 100 开始（前面是文件头）。
        let base = self.header.btree_offset(page_number);
        let kind = *page.get(base).unwrap_or(&0);
        match kind {
            0x05 => {
                // 内部页：表头 12 字节，然后是单元格指针数组
                let count = u16::from_be_bytes([page[base + 3], page[base + 4]]) as usize;
                let pointer_base = base + 12;
                for index in 0..count {
                    let at = pointer_base + index * 2;
                    if at + 1 >= page.len() {
                        break;
                    }
                    let cell = u16::from_be_bytes([page[at], page[at + 1]]) as usize;
                    // 内部页单元格：4 字节左子页号 + varint rowid
                    if cell + 4 > page.len() {
                        continue;
                    }
                    let child = u32::from_be_bytes([page[cell], page[cell + 1], page[cell + 2], page[cell + 3]]) as usize;
                    self.walk(child, rows, depth + 1)?;
                }
                // 最右子页
                let right = u32::from_be_bytes([
                    page[base + 8],
                    page[base + 9],
                    page[base + 10],
                    page[base + 11],
                ]) as usize;
                self.walk(right, rows, depth + 1)?;
                Ok(())
            }
            0x0D => {
                // 叶子页
                let count = u16::from_be_bytes([page[base + 3], page[base + 4]]) as usize;
                for index in 0..count {
                    let at = base + 8 + index * 2;
                    if at + 1 >= page.len() {
                        break;
                    }
                    let cell = u16::from_be_bytes([page[at], page[at + 1]]) as usize;
                    if let Some(row) = self.parse_leaf_cell(page, cell, page_number) {
                        rows.push(row);
                    }
                }
                Ok(())
            }
            other => Err(format!("页 {page_number} 不是 table b-tree（类型 {other:#04x}）")),
        }
    }

    /// 叶子单元格：varint 载荷长度 + varint rowid + 记录载荷（可能带溢页链）。
    fn parse_leaf_cell(&self, page: &[u8], cell: usize, page_number: usize) -> Option<Vec<Value>> {
        if cell >= page.len() {
            return None;
        }
        let mut offset = cell;
        let payload_length = read_varint(page, &mut offset)? as usize;
        let _rowid = read_varint(page, &mut offset)?;

        // 页内能放多少载荷：U = 可用空间，X = U - 35
        let usable = self.header.usable_size;
        let max_local = usable - 35;
        let local = if payload_length <= max_local {
            payload_length
        } else {
            let min_local = ((usable - 12) * 32 / 255) - 23;
            let mut size = min_local + (payload_length - min_local) % (usable - 4);
            if size > max_local {
                size = min_local;
            }
            size
        };
        if offset + local > page.len() {
            return None;
        }
        let mut payload = page[offset..offset + local].to_vec();

        // 溢页链：4 字节下一页页号，直到凑够 payload_length
        if local < payload_length {
            let chain_at = offset + local;
            if chain_at + 4 > page.len() {
                return None;
            }
            let mut next = u32::from_be_bytes([
                page[chain_at],
                page[chain_at + 1],
                page[chain_at + 2],
                page[chain_at + 3],
            ]) as usize;
            let mut remaining = payload_length - local;
            let mut guard = 0;
            while next != 0 && remaining > 0 && guard < 4096 {
                guard += 1;
                let overflow = self.header.page(self.bytes, next)?;
                // 溢页开头 4 字节指向下一页
                let take = remaining.min(usable - 4).min(overflow.len().saturating_sub(4));
                payload.extend_from_slice(&overflow[4..4 + take]);
                remaining -= take;
                next = u32::from_be_bytes([overflow[0], overflow[1], overflow[2], overflow[3]]) as usize;
            }
        }
        let _ = page_number;

        decode_record(&payload, self.header.encoding)
    }
}

// ─────────────────────────────────────────────────────────────── 记录解码

fn decode_record(payload: &[u8], encoding: u32) -> Option<Vec<Value>> {
    let mut offset = 0usize;
    let header_length = read_varint(payload, &mut offset)? as usize;
    if header_length == 0 || header_length > payload.len() {
        return None;
    }
    // 先读序列类型表，再按表取数据
    let mut types: Vec<u64> = Vec::new();
    while offset < header_length {
        types.push(read_varint(payload, &mut offset)?);
    }
    let mut data_offset = header_length;
    let mut values = Vec::with_capacity(types.len());
    for serial in types {
        let (value, size) = decode_value(payload, data_offset, serial, encoding)?;
        data_offset += size;
        values.push(value);
    }
    Some(values)
}

fn serial_size(serial: u64) -> usize {
    match serial {
        0 => 0,
        1 | 2 | 3 | 4 => serial as usize, // 1,2,3,4 字节整数
        5 => 6,
        6 | 7 => 8,
        8 | 9 => 0,
        10 | 11 => 0,
        n if n >= 12 => {
            if n % 2 == 0 {
                ((n - 12) / 2) as usize // blob
            } else {
                ((n - 13) / 2) as usize // 文本
            }
        }
        _ => 0,
    }
}

fn decode_value(payload: &[u8], offset: usize, serial: u64, encoding: u32) -> Option<(Value, usize)> {
    let size = serial_size(serial);
    let slice = payload.get(offset..offset + size)?;
    let value = match serial {
        0 => Value::Null,
        1 => Value::Int(slice[0] as i8 as i64),
        2 => Value::Int(i16::from_be_bytes([slice[0], slice[1]]) as i64),
        3 => {
            let raw = i32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]);
            // 3 字节整数的高位补在第三个字节里
            Value::Int(((raw << 8) >> 8) as i64)
        }
        4 => Value::Int(i32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]) as i64),
        5 => {
            let mut buffer = [0u8; 8];
            buffer[2..].copy_from_slice(slice);
            Value::Int(i64::from_be_bytes(buffer))
        }
        6 => {
            let mut buffer = [0u8; 8];
            buffer.copy_from_slice(slice);
            Value::Int(i64::from_be_bytes(buffer))
        }
        7 => {
            let mut buffer = [0u8; 8];
            buffer.copy_from_slice(slice);
            Value::Real(f64::from_bits(u64::from_be_bytes(buffer)))
        }
        8 => Value::Int(0),
        9 => Value::Int(1),
        10 | 11 => Value::Null,
        n if n >= 12 && n % 2 == 0 => Value::Blob(slice.to_vec()),
        _ => Value::Text(decode_text(slice, encoding)),
    };
    Some((value, size))
}

fn decode_text(slice: &[u8], encoding: u32) -> String {
    match encoding {
        2 => {
            // UTF-16 little endian
            let units: Vec<u16> = slice
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect();
            String::from_utf16_lossy(&units)
        }
        3 => {
            let units: Vec<u16> = slice
                .chunks_exact(2)
                .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                .collect();
            String::from_utf16_lossy(&units)
        }
        _ => String::from_utf8_lossy(slice).to_string(),
    }
}

// ─────────────────────────────────────────────── sqlite_master 查询

/// 在 sqlite_master 里找某张表的根页号。找不到返回 None。
fn table_root_page(bytes: &[u8], header: &Header, table: &str) -> Option<usize> {
    let mut rows: Vec<Vec<Value>> = Vec::new();
    let mut cursor = RowCursor::new(bytes, header);
    cursor.walk(1, &mut rows, 0).ok()?;
    for row in &rows {
        // sqlite_master: type, name, tbl_name, rootpage, sql
        let kind = row.first().and_then(Value::as_text).unwrap_or_default();
        let name = row.get(1).and_then(Value::as_text).unwrap_or_default();
        if kind == "table" && name == table {
            if let Some(page) = row.get(3).and_then(Value::as_int) {
                return Some(page as usize);
            }
        }
    }
    None
}

/// 从 `sqlite_master.sql` 里解析列名，用来定位 url / last_visit_time 是第几列。
fn table_columns(bytes: &[u8], header: &Header, table: &str) -> Vec<String> {
    let mut rows: Vec<Vec<Value>> = Vec::new();
    let mut cursor = RowCursor::new(bytes, header);
    if cursor.walk(1, &mut rows, 0).is_err() {
        return Vec::new();
    }
    for row in &rows {
        let kind = row.first().and_then(Value::as_text).unwrap_or_default();
        let name = row.get(1).and_then(Value::as_text).unwrap_or_default();
        if kind != "table" || name != table {
            continue;
        }
        let Some(sql) = row.get(4).and_then(Value::as_text) else {
            continue;
        };
        return parse_create_table_columns(&sql);
    }
    Vec::new()
}

/// 从 `CREATE TABLE x (...)` 里取出列名。够用即可。
///
/// 两种"引用"要一起处理：双引号/单引号/反引号，以及 SQLite 特有的方括号
/// （`[url]`）。方括号**不是**嵌套，把它当括号算会把列切错。
fn parse_create_table_columns(sql: &str) -> Vec<String> {
    let Some(open) = sql.find('(') else {
        return Vec::new();
    };
    let bytes = sql.as_bytes();
    let mut depth = 0i32;
    let mut close = None;
    let mut quote: Option<u8> = None;
    for (index, byte) in bytes.iter().enumerate().skip(open) {
        match (quote, *byte) {
            (Some(active), current) if current == active => quote = None,
            (Some(_), _) => {}
            (None, b'"') | (None, b'\'') | (None, b'`') | (None, b'[') => quote = Some(*byte),
            (None, b'(') => depth += 1,
            (None, b')') => {
                depth -= 1;
                if depth == 0 {
                    close = Some(index);
                    break;
                }
            }
            _ => {}
        }
    }
    let Some(close) = close else {
        return Vec::new();
    };
    let body = &sql[open + 1..close];

    // 按顶层逗号切成一段段列定义。
    let mut parts: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;
    let mut quote: Option<char> = None;
    for ch in body.chars() {
        match (quote, ch) {
            (Some(active), value) if value == active => {
                quote = None;
                current.push(ch);
            }
            (Some(_), value) => current.push(value),
            (None, '"') | (None, '\'') | (None, '`') | (None, '[') => {
                quote = Some(ch);
                current.push(ch);
            }
            (None, '(') => {
                depth += 1;
                current.push(ch);
            }
            (None, ')') => {
                depth -= 1;
                current.push(ch);
            }
            (None, ',') if depth == 0 => {
                parts.push(std::mem::take(&mut current));
            }
            (None, _) => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current);
    }

    // 表级约束不是列名。
    const RESERVED: &[&str] = &["primary", "unique", "check", "foreign", "constraint"];
    parts
        .into_iter()
        .filter_map(|part| {
            let trimmed = part.trim();
            let name: String = trimmed
                .trim_start_matches(['"', '\'', '`', '['])
                .chars()
                .take_while(|ch| !matches!(ch, '"' | '\'' | '`' | ']' | ' ' | '\t' | '('))
                .collect();
            if name.is_empty() || RESERVED.contains(&name.to_ascii_lowercase().as_str()) {
                None
            } else {
                Some(name)
            }
        })
        .collect()
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;
