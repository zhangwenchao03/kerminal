//! 文件预览内容分类策略。
//!
//! @author kongweiguang

/// 内容被判定为二进制的稳定原因。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilePreviewBinaryReason {
    /// 命中了已知二进制或不可编辑文档格式的文件头。
    KnownSignature,
    /// 内容包含 NUL；当前文本编辑契约不支持 UTF-16 等含 NUL 编码。
    NullByte,
    /// 不允许的 ASCII 控制字节数量和占比都超过保守阈值。
    DisallowedControlBytes,
}

/// 文件预览内容分类结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilePreviewContentKind {
    /// 可继续按 UTF-8 lossy 文本契约解码。
    Text,
    /// 不应把原始内容传给文本编辑器。
    Binary(FilePreviewBinaryReason),
}

impl FilePreviewContentKind {
    /// 判断分类结果是否必须走不可预览的安全响应。
    #[must_use]
    pub const fn is_binary(self) -> bool {
        matches!(self, Self::Binary(_))
    }
}

/// 对受限读取到的文件字节做纯内容分类。
///
/// 判定只使用稳定的格式特征、NUL 和保守控制字节比例。无效 UTF-8
/// 本身不是二进制证据，`0x80..=0xff` 也不计入控制比例，从而兼容需要
/// lossy 展示的 GBK、Windows-1252 等遗留文本。
#[must_use]
pub fn classify_file_preview_bytes(bytes: &[u8]) -> FilePreviewContentKind {
    if has_known_binary_signature(bytes) {
        return FilePreviewContentKind::Binary(FilePreviewBinaryReason::KnownSignature);
    }
    if bytes.contains(&0) {
        return FilePreviewContentKind::Binary(FilePreviewBinaryReason::NullByte);
    }
    if has_excessive_disallowed_controls(bytes) {
        return FilePreviewContentKind::Binary(FilePreviewBinaryReason::DisallowedControlBytes);
    }
    FilePreviewContentKind::Text
}

/// 返回内容是否不应进入文本编辑器。
#[must_use]
pub fn is_binary_file_preview_content(bytes: &[u8]) -> bool {
    classify_file_preview_bytes(bytes).is_binary()
}

/// 返回文件预览响应的稳定编码标记。
///
/// 二进制响应不携带正文，必须显式标记为 `binary`，避免调用方把空正文
/// 误解为经过 UTF-8 lossy 解码的空文本。
#[must_use]
pub const fn file_preview_response_encoding(binary: bool) -> &'static str {
    if binary {
        "binary"
    } else {
        "utf-8-lossy"
    }
}

const KNOWN_BINARY_PREFIXES: &[&[u8]] = &[
    b"%PDF-",
    b"\x7fELF",
    b"\x89PNG\r\n\x1a\n",
    b"\xff\xd8\xff",
    b"GIF87a",
    b"GIF89a",
    b"II*\x00",
    b"MM\x00*",
    b"\x00\x00\x01\x00",
    b"\x00\x00\x02\x00",
    b"PK\x03\x04",
    b"PK\x05\x06",
    b"PK\x07\x08",
    b"\x1f\x8b\x08",
    b"\xfd7zXZ\x00",
    b"\x28\xb5\x2f\xfd",
    b"\x04\x22\x4d\x18",
    b"7z\xbc\xaf\x27\x1c",
    b"Rar!\x1a\x07\x00",
    b"Rar!\x1a\x07\x01\x00",
    b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
    b"SQLite format 3\x00",
    b"\x00asm",
    b"\xca\xfe\xba\xbe",
    b"\xfe\xed\xfa\xce",
    b"\xce\xfa\xed\xfe",
    b"\xfe\xed\xfa\xcf",
    b"\xcf\xfa\xed\xfe",
    b"\xca\xfe\xba\xbf",
    b"\xbf\xba\xfe\xca",
    b"\x1a\x45\xdf\xa3",
    b"8BPS",
];

fn has_known_binary_signature(bytes: &[u8]) -> bool {
    KNOWN_BINARY_PREFIXES
        .iter()
        .any(|signature| bytes.starts_with(signature))
        || has_bzip2_signature(bytes)
        || has_riff_signature(bytes)
        || has_aiff_signature(bytes)
        || has_iso_base_media_signature(bytes)
        || has_id3_signature(bytes)
        || has_pe_signature(bytes)
}

fn has_bzip2_signature(bytes: &[u8]) -> bool {
    bytes.starts_with(b"BZh")
        && bytes
            .get(3)
            .is_some_and(|level| (b'1'..=b'9').contains(level))
}

fn has_riff_signature(bytes: &[u8]) -> bool {
    if bytes.len() < 12 || !(bytes.starts_with(b"RIFF") || bytes.starts_with(b"RIFX")) {
        return false;
    }
    let kind = &bytes[8..12];
    kind == b"WAVE" || kind == b"AVI " || kind == b"WEBP"
}

fn has_aiff_signature(bytes: &[u8]) -> bool {
    if bytes.len() < 12 || !bytes.starts_with(b"FORM") {
        return false;
    }
    let kind = &bytes[8..12];
    kind == b"AIFF" || kind == b"AIFC"
}

fn has_iso_base_media_signature(bytes: &[u8]) -> bool {
    if bytes.len() < 12 || &bytes[4..8] != b"ftyp" {
        return false;
    }
    let box_size = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    box_size == 1 || (8..=1024 * 1024).contains(&box_size)
}

fn has_id3_signature(bytes: &[u8]) -> bool {
    bytes.len() >= 10
        && bytes.starts_with(b"ID3")
        && bytes[3] <= 4
        && bytes[6..10].iter().all(|byte| byte & 0x80 == 0)
}

fn has_pe_signature(bytes: &[u8]) -> bool {
    if bytes.len() < 64 || !bytes.starts_with(b"MZ") {
        return false;
    }
    let pe_offset = u32::from_le_bytes([bytes[60], bytes[61], bytes[62], bytes[63]]) as usize;
    let Some(pe_end) = pe_offset.checked_add(4) else {
        return false;
    };
    pe_end <= bytes.len() && &bytes[pe_offset..pe_end] == b"PE\x00\x00"
}

fn has_excessive_disallowed_controls(bytes: &[u8]) -> bool {
    const MIN_DISALLOWED_CONTROLS: usize = 4;

    let disallowed = bytes
        .iter()
        .filter(|byte| is_disallowed_ascii_control(**byte))
        .count();

    // 同时要求至少四个且超过 10%，避免单个 ESC/退格等日志字符误伤文本。
    disallowed >= MIN_DISALLOWED_CONTROLS && disallowed > bytes.len() / 10
}

fn is_disallowed_ascii_control(byte: u8) -> bool {
    byte == 0x7f || (byte < 0x20 && !byte.is_ascii_whitespace())
}
