//! Agent terminal OSC signal detector.
//!
//! @author kongweiguang

pub use crate::models::terminal::{TerminalAgentKind, TerminalAgentSignal, TerminalAgentStatus};

const OSC_PREFIX: &str = "\u{1b}]";
const OSC_ST_TERMINATOR: &str = "\u{1b}\\";
const DEFAULT_MAX_OSC_SEQUENCE_BYTES: usize = 8 * 1024;
const KERMINAL_AGENT_NOTIFY_PREFIX: &str = "777;notify;Kerminal;";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalAgentSignalObservation {
    pub data: String,
    pub signals: Vec<TerminalAgentSignal>,
}

#[derive(Debug, Clone)]
pub struct TerminalAgentSignalDetector {
    armed_agent: Option<TerminalAgentKind>,
    osc_buffer: String,
    max_osc_sequence_bytes: usize,
}

impl Default for TerminalAgentSignalDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalAgentSignalDetector {
    pub fn new() -> Self {
        Self::with_max_osc_sequence_bytes(DEFAULT_MAX_OSC_SEQUENCE_BYTES)
    }

    pub fn with_max_osc_sequence_bytes(max_osc_sequence_bytes: usize) -> Self {
        Self {
            armed_agent: None,
            osc_buffer: String::new(),
            max_osc_sequence_bytes: max_osc_sequence_bytes.max(OSC_PREFIX.len() + 1),
        }
    }

    pub fn armed_agent(&self) -> Option<TerminalAgentKind> {
        self.armed_agent
    }

    pub fn observe(&mut self, data: &str) -> Vec<TerminalAgentSignal> {
        self.observe_inner(data, false).signals
    }

    pub fn observe_and_filter(&mut self, data: &str) -> TerminalAgentSignalObservation {
        self.observe_inner(data, true)
    }

    fn observe_inner(
        &mut self,
        data: &str,
        filter_kerminal_marker: bool,
    ) -> TerminalAgentSignalObservation {
        if data.is_empty() && self.osc_buffer.is_empty() {
            return TerminalAgentSignalObservation {
                data: String::new(),
                signals: Vec::new(),
            };
        }

        let mut source = String::new();
        if !self.osc_buffer.is_empty() {
            source.push_str(&self.osc_buffer);
            self.osc_buffer.clear();
        }
        source.push_str(data);

        let mut signals = Vec::new();
        let mut filtered_data = String::with_capacity(data.len());
        let mut cursor = 0;

        while cursor < source.len() {
            let Some(relative_start) = source[cursor..].find(OSC_PREFIX) else {
                if let Some(partial_start) = partial_osc_prefix_start(&source, cursor) {
                    if filter_kerminal_marker {
                        filtered_data.push_str(&source[cursor..partial_start]);
                    }
                    self.osc_buffer.push_str(&source[partial_start..]);
                } else if filter_kerminal_marker {
                    filtered_data.push_str(&source[cursor..]);
                }
                break;
            };
            let start = cursor + relative_start;
            let payload_start = start + OSC_PREFIX.len();
            if filter_kerminal_marker {
                filtered_data.push_str(&source[cursor..start]);
            }

            let Some(terminator) = find_osc_terminator(&source, payload_start) else {
                if source.len().saturating_sub(start) <= self.max_osc_sequence_bytes {
                    self.osc_buffer.push_str(&source[start..]);
                } else if filter_kerminal_marker {
                    filtered_data.push_str(&source[start..]);
                }
                break;
            };

            let sequence_len = terminator.index + terminator.len - start;
            let payload = &source[payload_start..terminator.index];
            if sequence_len <= self.max_osc_sequence_bytes {
                self.observe_osc_payload(payload, &mut signals);
            }
            if filter_kerminal_marker && !is_kerminal_agent_marker(payload) {
                filtered_data.push_str(&source[start..terminator.index + terminator.len]);
            }
            cursor = terminator.index + terminator.len;
        }

        TerminalAgentSignalObservation {
            data: filtered_data,
            signals,
        }
    }

    pub fn finish_pty(&mut self) -> Option<TerminalAgentSignal> {
        let agent = self.armed_agent.take()?;
        self.osc_buffer.clear();
        Some(TerminalAgentSignal {
            agent,
            status: TerminalAgentStatus::Exited,
        })
    }

    fn observe_osc_payload(&mut self, payload: &str, signals: &mut Vec<TerminalAgentSignal>) {
        if let Some(signal) = self.parse_kerminal_agent_signal(payload) {
            self.armed_agent = Some(signal.agent);
            signals.push(signal);
            return;
        }

        if let Some(agent) = parse_osc133_command_agent(payload) {
            self.armed_agent = Some(agent);
            signals.push(TerminalAgentSignal {
                agent,
                status: TerminalAgentStatus::Working,
            });
            return;
        }

        if is_osc9_attention(payload) {
            if let Some(agent) = self.armed_agent {
                signals.push(TerminalAgentSignal {
                    agent,
                    status: TerminalAgentStatus::Attention,
                });
            }
        }
    }

    fn parse_kerminal_agent_signal(&self, payload: &str) -> Option<TerminalAgentSignal> {
        let rest = payload.strip_prefix(KERMINAL_AGENT_NOTIFY_PREFIX)?;
        let mut parts = rest.split(';');
        let agent = TerminalAgentKind::from_id(parts.next()?)?;
        let status = TerminalAgentStatus::from_marker_event(parts.next()?)?;
        Some(TerminalAgentSignal { agent, status })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OscTerminator {
    index: usize,
    len: usize,
}

fn find_osc_terminator(source: &str, payload_start: usize) -> Option<OscTerminator> {
    let tail = &source[payload_start..];
    let bel = tail.find('\u{7}').map(|index| OscTerminator {
        index: payload_start + index,
        len: '\u{7}'.len_utf8(),
    });
    let st = tail.find(OSC_ST_TERMINATOR).map(|index| OscTerminator {
        index: payload_start + index,
        len: OSC_ST_TERMINATOR.len(),
    });

    match (bel, st) {
        (Some(left), Some(right)) => Some(if left.index <= right.index {
            left
        } else {
            right
        }),
        (Some(terminator), None) | (None, Some(terminator)) => Some(terminator),
        (None, None) => None,
    }
}

fn partial_osc_prefix_start(source: &str, cursor: usize) -> Option<usize> {
    let tail = &source[cursor..];
    (1..OSC_PREFIX.len())
        .rev()
        .find(|length| tail.ends_with(&OSC_PREFIX[..*length]))
        .map(|length| source.len() - length)
}

fn parse_osc133_command_agent(payload: &str) -> Option<TerminalAgentKind> {
    let rest = payload.strip_prefix("133;")?;
    let mut parts = rest.splitn(2, ';');
    let marker = parts.next()?.trim();
    if !marker.eq_ignore_ascii_case("C") {
        return None;
    }
    detect_agent_command(parts.next().unwrap_or_default())
}

fn is_osc9_attention(payload: &str) -> bool {
    payload == "9" || payload.starts_with("9;")
}

fn is_kerminal_agent_marker(payload: &str) -> bool {
    payload.starts_with(KERMINAL_AGENT_NOTIFY_PREFIX)
}

fn detect_agent_command(command: &str) -> Option<TerminalAgentKind> {
    let mut cursor = 0;
    let mut allow_env_assignments = true;

    while let Some(token) = next_shell_token(command, &mut cursor) {
        let normalized = normalize_command_token(&token);
        if normalized.is_empty() {
            continue;
        }

        if allow_env_assignments && looks_like_env_assignment(&normalized) {
            continue;
        }

        allow_env_assignments = false;
        if matches!(normalized.as_str(), "command" | "exec" | "sudo") {
            continue;
        }
        if normalized == "env" {
            allow_env_assignments = true;
            continue;
        }

        return TerminalAgentKind::from_id(&normalized);
    }

    None
}

fn next_shell_token(command: &str, cursor: &mut usize) -> Option<String> {
    let bytes = command.as_bytes();
    while *cursor < bytes.len() && bytes[*cursor].is_ascii_whitespace() {
        *cursor += 1;
    }
    if *cursor >= bytes.len() {
        return None;
    }

    let quote = match bytes[*cursor] {
        b'\'' => Some('\''),
        b'"' => Some('"'),
        _ => None,
    };
    if let Some(quote) = quote {
        *cursor += quote.len_utf8();
        let start = *cursor;
        while *cursor < command.len() {
            let Some(character) = command[*cursor..].chars().next() else {
                break;
            };
            if character == quote {
                let token = command[start..*cursor].to_owned();
                *cursor += character.len_utf8();
                return Some(token);
            }
            *cursor += character.len_utf8();
        }
        return Some(command[start..].to_owned());
    }

    let start = *cursor;
    while *cursor < command.len() {
        let Some(character) = command[*cursor..].chars().next() else {
            break;
        };
        if character.is_whitespace() {
            break;
        }
        *cursor += character.len_utf8();
    }
    Some(command[start..*cursor].to_owned())
}

fn normalize_command_token(token: &str) -> String {
    let token = token.trim_matches(|character| {
        matches!(
            character,
            '"' | '\'' | '`' | ';' | ',' | '(' | ')' | '[' | ']'
        )
    });
    let token = token.replace('\\', "/");
    let executable = token.rsplit('/').next().unwrap_or(token.as_str());
    let mut normalized = executable.to_ascii_lowercase();
    for suffix in [".exe", ".cmd", ".bat", ".ps1"] {
        if normalized.ends_with(suffix) {
            normalized.truncate(normalized.len() - suffix.len());
            break;
        }
    }
    normalized
}

fn looks_like_env_assignment(token: &str) -> bool {
    let Some((name, value)) = token.split_once('=') else {
        return false;
    };
    !name.is_empty()
        && !value.is_empty()
        && name
            .chars()
            .all(|character| character == '_' || character.is_ascii_alphanumeric())
}
