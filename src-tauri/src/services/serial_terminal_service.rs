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
    services::terminal_manager::TerminalManager,
    storage::SqliteStore,
};

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
        storage: &SqliteStore,
        terminals: &TerminalManager,
        request: SerialTerminalCreateRequest,
        output: F,
    ) -> AppResult<TerminalSessionSummary>
    where
        F: Fn(TerminalOutputEvent) -> bool + Send + 'static,
    {
        let terminal_request = self.resolve_terminal_request(storage, request)?;
        terminals.create_session(terminal_request, output)
    }

    /// 将 Serial 主机配置解析为本地串口客户端命令。
    pub fn resolve_terminal_request(
        &self,
        storage: &SqliteStore,
        request: SerialTerminalCreateRequest,
    ) -> AppResult<TerminalCreateRequest> {
        validate_terminal_size(request.rows, request.cols)?;
        let host = storage
            .remote_host_by_id(&request.host_id)?
            .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {}", request.host_id)))?;
        let client = resolve_serial_client()?;

        build_serial_terminal_request(&host, client, request.rows, request.cols)
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
    #[cfg(any(windows, test))]
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

    #[cfg(any(windows, test))]
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
}

impl SerialParity {
    #[cfg(any(windows, test))]
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
    #[cfg(any(windows, test))]
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
            #[cfg(any(windows, test))]
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
        secret_input_response: None,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::remote_host::{RemoteHostAuthType, SshOptions};

    fn remote_host(host: &str, tags: Vec<String>) -> RemoteHost {
        RemoteHost {
            id: "host-1".to_owned(),
            group_id: Some("group-1".to_owned()),
            name: "serial console".to_owned(),
            host: host.to_owned(),
            port: 1,
            username: String::new(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            tags,
            production: false,
            ssh_options: SshOptions::default(),
            sort_order: 10,
            created_at: "now".to_owned(),
            updated_at: "now".to_owned(),
        }
    }

    #[test]
    fn build_serial_terminal_request_uses_parameterized_plink_args_from_tags() {
        let request = build_serial_terminal_request(
            &remote_host(
                "COM1",
                vec![
                    " serial ".to_owned(),
                    "serial-port:COM9".to_owned(),
                    "serial-baud:115200".to_owned(),
                    "serial-data-bits:7".to_owned(),
                    "serial-stop-bits:2".to_owned(),
                    "serial-parity:even".to_owned(),
                    "serial-flow:rtscts".to_owned(),
                ],
            ),
            SerialClient::Plink("plink".to_owned()),
            24,
            80,
        )
        .expect("build request");

        assert_eq!(request.shell.as_deref(), Some("plink"));
        assert_eq!(
            request.args,
            vec!["-serial", "COM9", "-sercfg", "115200,7,e,2,R"]
        );
        assert_eq!(request.cwd, None);
        assert_eq!(request.rows, 24);
        assert_eq!(request.cols, 80);
        assert!(request.env.is_empty());
        assert!(request.cleanup_paths.is_empty());
        assert!(request.secret_input_response.is_none());
    }

    #[test]
    fn build_serial_terminal_request_uses_default_config() {
        let request = build_serial_terminal_request(
            &remote_host("COM3", vec!["serial".to_owned()]),
            SerialClient::Plink("plink".to_owned()),
            30,
            100,
        )
        .expect("build request");

        assert_eq!(request.shell.as_deref(), Some("plink"));
        assert_eq!(
            request.args,
            vec!["-serial", "COM3", "-sercfg", "9600,8,n,1,N"]
        );
        assert_eq!(request.rows, 30);
        assert_eq!(request.cols, 100);
    }

    #[test]
    fn build_serial_terminal_request_rejects_invalid_baud() {
        let error = build_serial_terminal_request(
            &remote_host(
                "COM3",
                vec!["serial".to_owned(), "serial-baud:42".to_owned()],
            ),
            SerialClient::Plink("plink".to_owned()),
            24,
            80,
        )
        .expect_err("reject invalid baud");

        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn build_serial_terminal_request_rejects_non_serial_tag() {
        let error = build_serial_terminal_request(
            &remote_host("COM3", vec!["ssh".to_owned()]),
            SerialClient::Plink("plink".to_owned()),
            24,
            80,
        )
        .expect_err("reject non serial host");

        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn build_serial_terminal_request_rejects_zero_size() {
        let error = build_serial_terminal_request(
            &remote_host("COM3", vec!["serial".to_owned()]),
            SerialClient::Plink("plink".to_owned()),
            0,
            80,
        )
        .expect_err("reject zero rows");

        assert!(matches!(error, AppError::InvalidInput(_)));
    }
}
