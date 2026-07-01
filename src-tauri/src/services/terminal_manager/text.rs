//! 终端文本处理小工具。
//!
//! @author kongweiguang

/// 返回不落在 UTF-8 字符中间的下一个字节边界。
pub(super) fn next_char_boundary(data: &str, mut index: usize) -> usize {
    while index < data.len() && !data.is_char_boundary(index) {
        index += 1;
    }
    index
}
