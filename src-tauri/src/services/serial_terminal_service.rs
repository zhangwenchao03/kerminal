//! Serial 串口终端会话服务。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::RemoteHost,
        terminal::{
            SerialTerminalCreateRequest, TerminalCreateRequest, TerminalOutputEvent,
            TerminalSessionSummary,
        },
    },
    services::{remote_host_service::RemoteHostService, terminal_manager::TerminalManager},
};
use std::time::Duration;

const DEFAULT_BAUD: u32 = 9_600;
const DEFAULT_DATA_BITS: u8 = 8;
const DEFAULT_STOP_BITS: u8 = 1;
const MIN_BAUD: u32 = 300;
const MAX_BAUD: u32 = 4_000_000;

/// Serial 串口终端业务入口。
#[derive(Debug, Default)]
pub struct SerialTerminalService;

impl SerialTerminalService {
    /// 创建 Serial 串口终端服务。
    pub fn new() -> Self {
        Self
    }

    /// 创建 Serial 串口终端会话。
    pub fn create_session<F>(
        &self,
        remote_hosts: &RemoteHostService,
        terminals: &TerminalManager,
        request: SerialTerminalCreateRequest,
        output: F,
    ) -> AppResult<TerminalSessionSummary>
    where
        F: Fn(TerminalOutputEvent) -> bool + Send + 'static,
    {
        let terminal_request = self.resolve_terminal_request(remote_hosts, request)?;
        terminals.create_session(terminal_request, output)
    }

    /// 将 Serial 主机配置解析为本地串口客户端命令。
    pub fn resolve_terminal_request(
        &self,
        remote_hosts: &RemoteHostService,
        request: SerialTerminalCreateRequest,
    ) -> AppResult<TerminalCreateRequest> {
        validate_terminal_size(request.rows, request.cols)?;
        let host = remote_hosts.require_host(&request.host_id)?;
        let client = resolve_serial_client()?;

        build_serial_terminal_request(&host, client, request.rows, request.cols)
    }

    /// 测试 Serial 主机配置能否打开串口，并确认实际终端客户端可用。
    pub fn test_connection(&self, host: &RemoteHost) -> AppResult<()> {
        let config = SerialConfig::from_host(host)?;
        config.open_for_probe(Duration::from_millis(1_500))?;
        let _client = resolve_serial_client()?;
        Ok(())
    }
}

#[doc(hidden)]
pub mod rules {
    use super::*;

    pub fn build_plink_serial_terminal_request(
        host: &RemoteHost,
        plink_executable: String,
        rows: u16,
        cols: u16,
    ) -> AppResult<TerminalCreateRequest> {
        build_serial_terminal_request(host, SerialClient::Plink(plink_executable), rows, cols)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SerialConfig {
    port_name: String,
    baud: u32,
    data_bits: u8,
    stop_bits: u8,
    parity: SerialParity,
    flow: SerialFlow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SerialParity {
    None,
    Odd,
    Even,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SerialFlow {
    None,
    XonXoff,
    RtsCts,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SerialClient {
    Plink(String),
    #[cfg(unix)]
    Picocom(String),
    #[cfg(unix)]
    Screen(String),
}

impl SerialConfig {
    fn from_host(host: &RemoteHost) -> AppResult<Self> {
        ensure_serial_host(host)?;
        let port_name = serial_tag_value(&host.tags, "serial-port")
            .map(str::to_owned)
            .unwrap_or_else(|| host.host.trim().to_owned());
        if port_name.is_empty() {
            return Err(AppError::InvalidInput(
                "串口名称不能为空，请设置 serial-port 标签或主机地址".to_owned(),
            ));
        }

        let baud = parse_baud(serial_tag_value(&host.tags, "serial-baud"))?;
        let data_bits = parse_data_bits(serial_tag_value(&host.tags, "serial-data-bits"))?;
        let stop_bits = parse_stop_bits(serial_tag_value(&host.tags, "serial-stop-bits"))?;
        let parity = parse_parity(serial_tag_value(&host.tags, "serial-parity"))?;
        let flow = parse_flow(serial_tag_value(&host.tags, "serial-flow"))?;

        Ok(Self {
            port_name,
            baud,
            data_bits,
            stop_bits,
            parity,
            flow,
        })
    }

    fn plink_sercfg(&self) -> String {
        format!(
            "{},{},{},{},{}",
            self.baud,
            self.data_bits,
            self.parity.plink_value(),
            self.stop_bits,
            self.flow.plink_value()
        )
    }

    fn open_for_probe(&self, timeout: Duration) -> AppResult<()> {
        serialport::new(&self.port_name, self.baud)
            .data_bits(self.serialport_data_bits()?)
            .flow_control(self.flow.serialport_value())
            .parity(self.parity.serialport_value())
            .stop_bits(self.serialport_stop_bits()?)
            .timeout(timeout)
            .open()
            .map(|_| ())
            .map_err(|error| {
                AppError::Terminal(format!("无法打开串口 {}: {error}", self.port_name))
            })
    }

    fn serialport_data_bits(&self) -> AppResult<serialport::DataBits> {
        match self.data_bits {
            5 => Ok(serialport::DataBits::Five),
            6 => Ok(serialport::DataBits::Six),
            7 => Ok(serialport::DataBits::Seven),
            8 => Ok(serialport::DataBits::Eight),
            _ => Err(AppError::InvalidInput(
                "serial-data-bits 只能是 5、6、7 或 8".to_owned(),
            )),
        }
    }

    fn serialport_stop_bits(&self) -> AppResult<serialport::StopBits> {
        match self.stop_bits {
            1 => Ok(serialport::StopBits::One),
            2 => Ok(serialport::StopBits::Two),
            _ => Err(AppError::InvalidInput(
                "serial-stop-bits 只能是 1 或 2".to_owned(),
            )),
        }
    }
}

impl SerialParity {
    fn serialport_value(self) -> serialport::Parity {
        match self {
            Self::None => serialport::Parity::None,
            Self::Odd => serialport::Parity::Odd,
            Self::Even => serialport::Parity::Even,
        }
    }

    fn plink_value(self) -> &'static str {
        match self {
            Self::None => "n",
            Self::Odd => "o",
            Self::Even => "e",
        }
    }

    #[cfg(unix)]
    fn picocom_value(self) -> &'static str {
        match self {
            Self::None => "n",
            Self::Odd => "o",
            Self::Even => "e",
        }
    }
}

impl SerialFlow {
    fn serialport_value(self) -> serialport::FlowControl {
        match self {
            Self::None => serialport::FlowControl::None,
            Self::XonXoff => serialport::FlowControl::Software,
            Self::RtsCts => serialport::FlowControl::Hardware,
        }
    }

    fn plink_value(self) -> &'static str {
        match self {
            Self::None => "N",
            Self::XonXoff => "X",
            Self::RtsCts => "R",
        }
    }

    #[cfg(unix)]
    fn picocom_value(self) -> &'static str {
        match self {
            Self::None => "n",
            Self::XonXoff => "s",
            Self::RtsCts => "h",
        }
    }
}

impl SerialClient {
    fn command(self, config: &SerialConfig) -> (String, Vec<String>) {
        match self {
            Self::Plink(executable) => (
                executable,
                vec![
                    "-serial".to_owned(),
                    config.port_name.clone(),
                    "-sercfg".to_owned(),
                    config.plink_sercfg(),
                ],
            ),
            #[cfg(unix)]
            Self::Picocom(executable) => (
                executable,
                vec![
                    "-b".to_owned(),
                    config.baud.to_string(),
                    "--databits".to_owned(),
                    config.data_bits.to_string(),
                    "--parity".to_owned(),
                    config.parity.picocom_value().to_owned(),
                    "--stopbits".to_owned(),
                    config.stop_bits.to_string(),
                    "--flow".to_owned(),
                    config.flow.picocom_value().to_owned(),
                    config.port_name.clone(),
                ],
            ),
            #[cfg(unix)]
            Self::Screen(executable) => (
                executable,
                vec![config.port_name.clone(), config.baud.to_string()],
            ),
        }
    }
}

fn build_serial_terminal_request(
    host: &RemoteHost,
    client: SerialClient,
    rows: u16,
    cols: u16,
) -> AppResult<TerminalCreateRequest> {
    validate_terminal_size(rows, cols)?;
    let config = SerialConfig::from_host(host)?;
    let (shell, args) = client.command(&config);

    Ok(TerminalCreateRequest {
        shell: Some(shell),
        args,
        cwd: None,
        cols,
        rows,
        env: Default::default(),
        cleanup_paths: Vec::new(),
    })
}

fn validate_terminal_size(rows: u16, cols: u16) -> AppResult<()> {
    if rows == 0 || cols == 0 {
        return Err(AppError::InvalidInput(
            "终端行数和列数必须大于 0".to_owned(),
        ));
    }
    Ok(())
}

fn ensure_serial_host(host: &RemoteHost) -> AppResult<()> {
    if !has_serial_tag(&host.tags) {
        return Err(AppError::InvalidInput(
            "Serial 终端只支持带 serial 标签的远程主机".to_owned(),
        ));
    }
    Ok(())
}

fn has_serial_tag(tags: &[String]) -> bool {
    tags.iter()
        .any(|tag| tag.trim().eq_ignore_ascii_case("serial"))
}

fn serial_tag_value<'a>(tags: &'a [String], key: &str) -> Option<&'a str> {
    tags.iter().find_map(|tag| {
        let (tag_key, value) = tag.trim().split_once(':')?;
        if tag_key.trim().eq_ignore_ascii_case(key) {
            Some(value.trim())
        } else {
            None
        }
    })
}

fn parse_baud(value: Option<&str>) -> AppResult<u32> {
    let Some(value) = value else {
        return Ok(DEFAULT_BAUD);
    };
    let baud = value.parse::<u32>().map_err(|_| {
        AppError::InvalidInput("serial-baud 必须是 300 到 4000000 之间的数字".to_owned())
    })?;
    if !(MIN_BAUD..=MAX_BAUD).contains(&baud) {
        return Err(AppError::InvalidInput(
            "serial-baud 必须在 300 到 4000000 之间".to_owned(),
        ));
    }
    Ok(baud)
}

fn parse_data_bits(value: Option<&str>) -> AppResult<u8> {
    parse_allowed_u8(
        value,
        DEFAULT_DATA_BITS,
        &[5, 6, 7, 8],
        "serial-data-bits 只能是 5、6、7 或 8",
    )
}

fn parse_stop_bits(value: Option<&str>) -> AppResult<u8> {
    parse_allowed_u8(
        value,
        DEFAULT_STOP_BITS,
        &[1, 2],
        "serial-stop-bits 只能是 1 或 2",
    )
}

fn parse_allowed_u8(
    value: Option<&str>,
    default_value: u8,
    allowed: &[u8],
    error_message: &str,
) -> AppResult<u8> {
    let Some(value) = value else {
        return Ok(default_value);
    };
    let parsed = value
        .parse::<u8>()
        .map_err(|_| AppError::InvalidInput(error_message.to_owned()))?;
    if !allowed.contains(&parsed) {
        return Err(AppError::InvalidInput(error_message.to_owned()));
    }
    Ok(parsed)
}

fn parse_parity(value: Option<&str>) -> AppResult<SerialParity> {
    let Some(value) = value else {
        return Ok(SerialParity::None);
    };
    match value.to_ascii_lowercase().as_str() {
        "none" | "n" => Ok(SerialParity::None),
        "odd" | "o" => Ok(SerialParity::Odd),
        "even" | "e" => Ok(SerialParity::Even),
        _ => Err(AppError::InvalidInput(
            "serial-parity 只能是 none、odd 或 even".to_owned(),
        )),
    }
}

fn parse_flow(value: Option<&str>) -> AppResult<SerialFlow> {
    let Some(value) = value else {
        return Ok(SerialFlow::None);
    };
    match value.to_ascii_lowercase().as_str() {
        "none" | "n" => Ok(SerialFlow::None),
        "xonxoff" | "x" => Ok(SerialFlow::XonXoff),
        "rtscts" | "r" => Ok(SerialFlow::RtsCts),
        _ => Err(AppError::InvalidInput(
            "serial-flow 只能是 none、xonxoff 或 rtscts".to_owned(),
        )),
    }
}

#[cfg(windows)]
fn resolve_serial_client() -> AppResult<SerialClient> {
    which::which("plink")
        .or_else(|_| which::which("plink.exe"))
        .map(|path| SerialClient::Plink(path.to_string_lossy().into_owned()))
        .map_err(|_| {
            AppError::Terminal(
                "未找到 Serial 串口客户端，请安装 PuTTY/plink 并确认 plink 已加入 PATH".to_owned(),
            )
        })
}

#[cfg(unix)]
fn resolve_serial_client() -> AppResult<SerialClient> {
    if let Ok(path) = which::which("picocom") {
        return Ok(SerialClient::Picocom(path.to_string_lossy().into_owned()));
    }
    if let Ok(path) = which::which("screen") {
        return Ok(SerialClient::Screen(path.to_string_lossy().into_owned()));
    }

    Err(AppError::Terminal(
        "未找到 Serial 串口客户端，请安装 picocom 或 screen 并确认已加入 PATH".to_owned(),
    ))
}

#[cfg(not(any(windows, unix)))]
fn resolve_serial_client() -> AppResult<SerialClient> {
    Err(AppError::Terminal(
        "当前平台暂不支持自动选择 Serial 串口客户端".to_owned(),
    ))
}
