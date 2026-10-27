//! `history.rs` 的单元测试。
//!
//! 这里**手工拼装**一个最小 SQLite 文件当夹具，而不是读外部文件：
//! 测试要能在任何机器上跑，同时精确覆盖两个最容易写错的点 ——
//! 第 1 页前 100 字节的文件头，以及序列化类型的长度计算。
#![cfg(test)]

use crate::history::*;

/// 按 SQLite 文件格式拼一个最小库：一个 sqlite_master 页 + 一个 urls 数据页。
fn build_fixture(rows: &[(i64, &str, &str, i64, i64)]) -> Vec<u8> {
    const PAGE_SIZE: usize = 512;

    fn varint(mut value: u64) -> Vec<u8> {
        let mut groups = [0u8; 9];
        let mut count = 0;
        while value > 0 {
            groups[count] = (value & 0x7F) as u8;
            value >>= 7;
            count += 1;
        }
        let mut bytes = Vec::with_capacity(count);
        for index in (0..count).rev() {
            let mut byte = groups[index];
            if index != 0 {
                byte |= 0x80;
            }
            bytes.push(byte);
        }
        if bytes.is_empty() {
            bytes.push(0);
        }
        bytes
    }

    /// 拼一条记录：头部长度 varint + 各列序列类型 + 各列数据。
    fn record(columns: &[(u64, Vec<u8>)]) -> Vec<u8> {
        let mut header: Vec<u8> = Vec::new();
        for (serial, _) in columns {
            header.extend_from_slice(&varint(*serial));
        }
        let mut header_length = header.len() + 1;
        if header_length > 0x7F {
            header_length += 1;
        }
        let mut payload = varint(header_length as u64);
        payload.extend_from_slice(&header);
        for (_, data) in columns {
            payload.extend_from_slice(data);
        }
        payload
    }

    fn text_serial(text: &str) -> (u64, Vec<u8>) {
        let bytes = text.as_bytes().to_vec();
        (13 + 2 * bytes.len() as u64, bytes)
    }

    let mut cells: Vec<Vec<u8>> = Vec::new();
    for (id, url, title, visit_count, last_visit_time) in rows {
        let payload = record(&[
            (1, vec![*id as u8]),
            text_serial(url),
            text_serial(title),
            (1, vec![*visit_count as u8]),
            (1, vec![0]), // typed_count
            (6, last_visit_time.to_be_bytes().to_vec()),
            (1, vec![0]), // hidden
        ]);
        let mut cell = varint(payload.len() as u64);
        cell.extend_from_slice(&varint(*id as u64));
        cell.extend_from_slice(&payload);
        cells.push(cell);
    }

    // 数据页（第 2 页）：单元格从页尾往前放
    let mut data_page = vec![0u8; PAGE_SIZE];
    let mut offset = PAGE_SIZE;
    let mut pointers: Vec<u16> = Vec::new();
    for cell in &cells {
        offset -= cell.len();
        data_page[offset..offset + cell.len()].copy_from_slice(cell);
        pointers.push(offset as u16);
    }
    data_page[0] = 0x0D; // 叶子表页
    data_page[3] = (pointers.len() >> 8) as u8;
    data_page[4] = pointers.len() as u8;
    for (index, pointer) in pointers.iter().enumerate() {
        data_page[8 + index * 2] = (pointer >> 8) as u8;
        data_page[8 + index * 2 + 1] = *pointer as u8;
    }

    // sqlite_master 页（第 1 页）：前 100 字节是文件头，b-tree 头从 100 开始
    let schema = "CREATE TABLE urls(id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0, typed_count INTEGER DEFAULT 0, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0)";
    let master_payload = record(&[
        (23, b"table".to_vec()), // 5 字节文本：13 + 2*5 = 23
        text_serial("urls"),
        text_serial("urls"),
        (1, vec![2]), // rootpage
        text_serial(schema),
    ]);
    let mut master_cell = varint(master_payload.len() as u64);
    master_cell.extend_from_slice(&varint(1));
    master_cell.extend_from_slice(&master_payload);

    let mut page_one = vec![0u8; PAGE_SIZE];
    page_one[..16].copy_from_slice(b"SQLite format 3\0");
    page_one[16] = (PAGE_SIZE >> 8) as u8;
    page_one[17] = PAGE_SIZE as u8;
    page_one[18] = 1;
    page_one[19] = 1;
    page_one[20] = 0;
    page_one[21] = 64;
    page_one[22] = 32;
    page_one[23] = 32;
    page_one[24..28].copy_from_slice(&1u32.to_be_bytes());
    page_one[28..32].copy_from_slice(&2u32.to_be_bytes());
    page_one[56..60].copy_from_slice(&1u32.to_be_bytes()); // UTF-8
    page_one[100] = 0x0D;
    page_one[104] = 1;
    let master_offset = PAGE_SIZE - master_cell.len();
    page_one[master_offset..].copy_from_slice(&master_cell);
    page_one[108] = (master_offset >> 8) as u8;
    page_one[109] = master_offset as u8;

    let mut file = Vec::with_capacity(PAGE_SIZE * 2);
    file.extend_from_slice(&page_one);
    file.extend_from_slice(&data_page);
    file
}

fn write_fixture(name: &str, bytes: &[u8]) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(name);
    std::fs::write(&path, bytes).expect("写测试库");
    path
}

#[test]
fn reads_url_rows_from_a_sqlite_file() {
    let path = write_fixture(
        "dbx-history-fixture.db",
        &build_fixture(&[
            (1, "https://a.test/one", "第一篇", 3, 300),
            (2, "https://b.test/two", "第二篇", 1, 500),
        ]),
    );
    let entries = recent(&path, 10).expect("解析应该成功");
    assert_eq!(entries.len(), 2, "{entries:?}");
    // 按访问时间倒序
    assert_eq!(entries[0].url, "https://b.test/two");
    assert_eq!(entries[0].title, "第二篇");
    assert_eq!(entries[0].last_visit_time, 500);
    assert_eq!(entries[1].url, "https://a.test/one");
    assert_eq!(entries[1].visit_count, 3);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn honours_the_limit() {
    let path = write_fixture(
        "dbx-history-limit.db",
        &build_fixture(&[
            (1, "https://a.test/", "a", 1, 100),
            (2, "https://b.test/", "b", 1, 200),
            (3, "https://c.test/", "c", 1, 300),
        ]),
    );
    let entries = recent(&path, 2).expect("解析应该成功");
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].url, "https://c.test/");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn rejects_files_that_are_not_sqlite() {
    let path = write_fixture("dbx-history-junk.db", &vec![0u8; 4096]);
    let error = recent(&path, 5).expect_err("应当报错");
    assert!(error.contains("SQLite"), "{error}");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn parses_column_names_from_create_table() {
    let columns = parse_create_table_columns(
        "CREATE TABLE urls(id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0, last_visit_time INTEGER NOT NULL)",
    );
    assert_eq!(
        columns,
        vec!["id", "url", "title", "visit_count", "last_visit_time"]
    );
    // 表级约束不能被当成列名
    let with_constraint =
        parse_create_table_columns("CREATE TABLE t(a INTEGER, b TEXT, PRIMARY KEY(a), UNIQUE(b))");
    assert_eq!(with_constraint, vec!["a", "b"]);
}

#[test]
fn varints_round_trip() {
    for value in [0u64, 1, 127, 128, 300, 16383, 16384, 1 << 40] {
        let mut bytes = Vec::new();
        bytes.push(0u8); // 占位，等下直接测 read_varint
        let mut encoded = Vec::new();
        let mut remaining = value;
        let mut groups = [0u8; 9];
        let mut count = 0;
        while remaining > 0 {
            groups[count] = (remaining & 0x7F) as u8;
            remaining >>= 7;
            count += 1;
        }
        for index in (0..count).rev() {
            let mut byte = groups[index];
            if index != 0 {
                byte |= 0x80;
            }
            encoded.push(byte);
        }
        if encoded.is_empty() {
            encoded.push(0);
        }
        let mut offset = 0usize;
        let decoded = read_varint(&encoded, &mut offset).expect("解码");
        assert_eq!(decoded, value, "value={value}");
        let _ = bytes.pop();
    }
}
