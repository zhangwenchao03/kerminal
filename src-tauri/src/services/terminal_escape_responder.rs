//! PTY 输出侧的最小终端查询响应器。
//!
//! @author kongweiguang

const ESC: char = '\u{1b}';
const BEL: u8 = 0x07;
const CSI_INTRO: u8 = b'[';
const OSC_INTRO: u8 = b']';
const ST_FINAL: u8 = b'\\';
const MAX_PENDING_ESCAPE_BYTES: usize = 256;

/// Primary DA response: VT100 with advanced video option.
pub const PRIMARY_DA_RESPONSE: &str = "\u{1b}[?1;2c";
/// Secondary DA response: minimal xterm-compatible terminal id/version tuple.
pub const SECONDARY_DA_RESPONSE: &str = "\u{1b}[>0;0;0c";
/// Cursor position response used before the renderer can answer CPR itself.
pub const STARTUP_CPR_RESPONSE: &str = "\u{1b}[1;1R";

/// 单次 PTY 输出观察后的过滤结果和需要回写给 PTY child 的响应。
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct TerminalEscapeObservation {
    pub data: String,
    pub responses: Vec<&'static str>,
}

/// 仅处理启动期 terminal query 的小状态机。
#[derive(Debug, Default)]
pub struct TerminalEscapeResponder {
    pending_escape: String,
    seen_visible_output: bool,
}

impl TerminalEscapeResponder {
    pub fn new() -> Self {
        Self::default()
    }

    /// 观察 PTY 输出，过滤由后端代答的 DA/DSR query，并返回应写回 PTY 的响应。
    pub fn observe(&mut self, data: &str) -> TerminalEscapeObservation {
        let mut input = String::new();
        if !self.pending_escape.is_empty() {
            input.push_str(&self.pending_escape);
            self.pending_escape.clear();
        }
        input.push_str(data);

        let mut output = String::with_capacity(input.len());
        let mut responses = Vec::new();
        let mut index = 0;

        while index < input.len() {
            let Some(escape_offset) = input[index..].find(ESC) else {
                self.push_visible(&mut output, &input[index..]);
                break;
            };
            let escape_start = index + escape_offset;
            if escape_start > index {
                self.push_visible(&mut output, &input[index..escape_start]);
            }

            let bytes = input.as_bytes();
            if escape_start + 1 >= input.len() {
                self.hold_or_flush_pending(&mut output, &input[escape_start..]);
                break;
            }

            match bytes[escape_start + 1] {
                CSI_INTRO => match csi_end(&input, escape_start) {
                    Some(sequence_end) => {
                        let sequence = &input[escape_start..sequence_end];
                        match classify_csi(sequence) {
                            CsiQuery::PrimaryDa => {
                                responses.push(PRIMARY_DA_RESPONSE);
                            }
                            CsiQuery::SecondaryDa => {
                                responses.push(SECONDARY_DA_RESPONSE);
                            }
                            CsiQuery::StartupCpr if !self.seen_visible_output => {
                                responses.push(STARTUP_CPR_RESPONSE);
                            }
                            CsiQuery::StartupCpr | CsiQuery::Other => {
                                output.push_str(sequence);
                            }
                        }
                        index = sequence_end;
                    }
                    None => {
                        self.hold_or_flush_pending(&mut output, &input[escape_start..]);
                        break;
                    }
                },
                OSC_INTRO => match osc_end(&input, escape_start) {
                    Some(sequence_end) => {
                        output.push_str(&input[escape_start..sequence_end]);
                        index = sequence_end;
                    }
                    None => {
                        self.hold_or_flush_pending(&mut output, &input[escape_start..]);
                        break;
                    }
                },
                _ => {
                    let sequence_end = (escape_start + 2).min(input.len());
                    output.push_str(&input[escape_start..sequence_end]);
                    index = sequence_end;
                }
            }
        }

        TerminalEscapeObservation {
            data: output,
            responses,
        }
    }

    pub fn pending_len(&self) -> usize {
        self.pending_escape.len()
    }

    fn push_visible(&mut self, output: &mut String, value: &str) {
        if value.chars().any(|ch| !ch.is_control()) {
            self.seen_visible_output = true;
        }
        output.push_str(value);
    }

    fn hold_or_flush_pending(&mut self, output: &mut String, value: &str) {
        if value.len() > MAX_PENDING_ESCAPE_BYTES {
            output.push_str(value);
            self.pending_escape.clear();
            return;
        }
        self.pending_escape.push_str(value);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CsiQuery {
    PrimaryDa,
    SecondaryDa,
    StartupCpr,
    Other,
}

fn classify_csi(sequence: &str) -> CsiQuery {
    let bytes = sequence.as_bytes();
    if bytes.len() < 3 || bytes[0] != ESC as u8 || bytes[1] != CSI_INTRO {
        return CsiQuery::Other;
    }

    let final_byte = *bytes.last().unwrap_or(&0);
    let params = &sequence[2..sequence.len() - 1];
    match final_byte {
        b'c' if params.is_empty() || params == "0" => CsiQuery::PrimaryDa,
        b'c' if params == ">" || params == ">0" => CsiQuery::SecondaryDa,
        b'n' if params == "6" => CsiQuery::StartupCpr,
        _ => CsiQuery::Other,
    }
}

fn csi_end(input: &str, escape_start: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    let mut index = escape_start + 2;
    while index < bytes.len() {
        if (0x40..=0x7e).contains(&bytes[index]) {
            return Some(index + 1);
        }
        index += 1;
    }
    None
}

fn osc_end(input: &str, escape_start: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    let mut index = escape_start + 2;
    while index < bytes.len() {
        if bytes[index] == BEL {
            return Some(index + 1);
        }
        if bytes[index] == ESC as u8 && index + 1 < bytes.len() && bytes[index + 1] == ST_FINAL {
            return Some(index + 2);
        }
        index += 1;
    }
    None
}
