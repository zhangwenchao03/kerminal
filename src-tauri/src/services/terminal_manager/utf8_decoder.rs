//! 终端字节流的增量 UTF-8 解码器。
//!
//! @author kongweiguang

const REPLACEMENT_CHARACTER: char = '\u{fffd}';

/// 跨读取分片保留不完整字符，并保持 `String::from_utf8_lossy` 的非法序列语义。
#[derive(Debug, Default)]
pub(crate) struct IncrementalUtf8Decoder {
    pending: Vec<u8>,
}

impl IncrementalUtf8Decoder {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// 解码一个有序字节分片；末尾不完整字符会保留到下一次调用。
    pub(crate) fn decode(&mut self, chunk: &[u8]) -> String {
        if chunk.is_empty() {
            return String::new();
        }

        let mut input = Vec::with_capacity(self.pending.len().saturating_add(chunk.len()));
        input.append(&mut self.pending);
        input.extend_from_slice(chunk);

        let mut output = String::with_capacity(input.len());
        let mut remaining = input.as_slice();
        while !remaining.is_empty() {
            match std::str::from_utf8(remaining) {
                Ok(valid) => {
                    output.push_str(valid);
                    break;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();
                    if valid_up_to > 0 {
                        // `valid_up_to` 来自标准库校验器，因此该前缀必然是合法 UTF-8。
                        output.push_str(
                            std::str::from_utf8(&remaining[..valid_up_to])
                                .expect("validated UTF-8 prefix"),
                        );
                    }
                    match error.error_len() {
                        Some(invalid_len) => {
                            output.push(REPLACEMENT_CHARACTER);
                            remaining = &remaining[valid_up_to + invalid_len..];
                        }
                        None => {
                            self.pending.extend_from_slice(&remaining[valid_up_to..]);
                            break;
                        }
                    }
                }
            }
        }
        output
    }

    /// 在 EOF 或最终读取错误时输出尚未闭合字符的替换符；重复调用不会重复输出。
    pub(crate) fn finish(&mut self) -> String {
        if self.pending.is_empty() {
            return String::new();
        }
        self.pending.clear();
        REPLACEMENT_CHARACTER.to_string()
    }

    pub(crate) fn pending_len(&self) -> usize {
        self.pending.len()
    }
}
