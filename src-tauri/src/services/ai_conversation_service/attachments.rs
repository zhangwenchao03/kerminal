//! AI 会话附件文件处理。
//!
//! @author kongweiguang

use std::{
    env,
    ffi::OsString,
    fs,
    io::Cursor,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use image::{ImageFormat, ImageReader};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::ai_conversation::{AiAttachment, AiAttachmentAssetInfo},
    paths::{KerminalPaths, AI_ATTACHMENTS_DIR_NAME},
    security::redaction::redact_terminal_text,
    storage::{ai_conversations::AiAttachmentWrite, SqliteStore},
};

use super::{
    allowed_source_kinds, allowed_vision_usages, normalize_optional_enum, normalize_optional_text,
    normalize_required_owned_text, unix_time_millis,
};

const MAX_IMAGE_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;
const MAX_IMAGE_ATTACHMENT_PIXELS: u64 = 80_000_000;
const MAX_OCR_TEXT_CHARS: usize = 20_000;
const MAX_OCR_ERROR_CHARS: usize = 500;
const OCR_TIMEOUT_SECONDS: u64 = 15;
const TESSERACT_PATH_ENV: &str = "KERMINAL_TESSERACT_PATH";

#[derive(Debug, Clone)]
struct ManagedImageImport {
    conversation_id: String,
    original_name: String,
    bytes: Vec<u8>,
    source_kind: Option<String>,
    vision_usage: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DetectedImage {
    format: ImageFormat,
    mime_type: &'static str,
    extension: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AttachmentFileState {
    path: Option<PathBuf>,
    exists: bool,
    missing_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AttachmentOcrMetadata {
    ocr_text: Option<String>,
    vision_usage: String,
    redaction_summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum LocalOcrError {
    Unavailable,
    TimedOut,
    Failed(String),
}

pub(super) fn import_image_attachment(
    storage: &SqliteStore,
    paths: &KerminalPaths,
    conversation_id: String,
    source_path: String,
    source_kind: Option<String>,
    vision_usage: Option<String>,
) -> AppResult<AiAttachment> {
    let source_path = normalize_required_owned_text("图片路径", source_path, 2_000)?;
    let source_path = PathBuf::from(source_path);
    let source_path = source_path
        .canonicalize()
        .map_err(|error| AppError::InvalidInput(format!("图片文件不存在或无法访问: {error}")))?;
    let metadata = fs::metadata(&source_path)?;
    if !metadata.is_file() {
        return Err(AppError::InvalidInput(format!(
            "图片路径不是文件: {}",
            source_path.display()
        )));
    }
    if metadata.len() == 0 {
        return Err(AppError::InvalidInput("图片文件不能为空".to_owned()));
    }
    if metadata.len() > MAX_IMAGE_ATTACHMENT_BYTES {
        return Err(AppError::InvalidInput(format!(
            "图片文件不能超过 {} MB",
            MAX_IMAGE_ATTACHMENT_BYTES / 1024 / 1024
        )));
    }

    let original_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| "image".to_owned());
    let bytes = fs::read(&source_path)?;
    persist_managed_image_attachment(
        storage,
        paths,
        ManagedImageImport {
            conversation_id,
            original_name,
            bytes,
            source_kind,
            vision_usage,
        },
    )
}

pub(super) fn import_image_attachment_bytes(
    storage: &SqliteStore,
    paths: &KerminalPaths,
    conversation_id: String,
    original_name: Option<String>,
    bytes: Vec<u8>,
    source_kind: Option<String>,
    vision_usage: Option<String>,
) -> AppResult<AiAttachment> {
    let original_name = normalize_optional_text("附件文件名", original_name, 255)?
        .unwrap_or_else(|| "clipboard-image".to_owned());
    persist_managed_image_attachment(
        storage,
        paths,
        ManagedImageImport {
            conversation_id,
            original_name,
            bytes,
            source_kind,
            vision_usage,
        },
    )
}

pub(super) fn resolve_attachment_asset(
    storage: &SqliteStore,
    paths: &KerminalPaths,
    attachment: AiAttachment,
) -> AppResult<AiAttachmentAssetInfo> {
    let file_state = attachment_file_state(paths, &attachment);
    let attachment = sync_attachment_status(storage, attachment, &file_state)?;
    let preview_path = file_state
        .path
        .as_ref()
        .filter(|_| file_state.exists)
        .map(|path| path_to_string(path));
    Ok(AiAttachmentAssetInfo {
        attachment,
        exists: file_state.exists,
        resolved_path: preview_path.clone(),
        preview_path,
    })
}

pub(super) fn open_resolved_attachment(
    attachment_id: &str,
    resolved_path: Option<String>,
) -> AppResult<bool> {
    let path = resolved_path
        .map(PathBuf::from)
        .ok_or_else(|| AppError::NotFound(format!("AI 附件文件不可用: {attachment_id}")))?;
    open_path(&path)?;
    Ok(true)
}

fn persist_managed_image_attachment(
    storage: &SqliteStore,
    paths: &KerminalPaths,
    input: ManagedImageImport,
) -> AppResult<AiAttachment> {
    let byte_len = u64::try_from(input.bytes.len())
        .map_err(|_| AppError::InvalidInput("图片文件过大".to_owned()))?;
    if byte_len == 0 {
        return Err(AppError::InvalidInput("图片文件不能为空".to_owned()));
    }
    if byte_len > MAX_IMAGE_ATTACHMENT_BYTES {
        return Err(AppError::InvalidInput(format!(
            "图片文件不能超过 {} MB",
            MAX_IMAGE_ATTACHMENT_BYTES / 1024 / 1024
        )));
    }

    let detected = detect_supported_image(&input.bytes)?;
    let (width, height) = image_dimensions(&input.bytes, detected.format)?;
    let pixels = u64::from(width) * u64::from(height);
    if pixels > MAX_IMAGE_ATTACHMENT_PIXELS {
        return Err(AppError::InvalidInput(format!(
            "图片像素过大，最多允许 {MAX_IMAGE_ATTACHMENT_PIXELS} 像素"
        )));
    }

    let attachment_id = Uuid::new_v4().to_string();
    let file_name = format!("original.{}", detected.extension);
    let asset_path =
        managed_attachment_relative_path(&input.conversation_id, &attachment_id, &file_name);
    let destination = resolve_managed_relative_path(paths, &asset_path)?;
    let destination_dir = destination
        .parent()
        .ok_or_else(|| AppError::InvalidInput("无法解析附件目录".to_owned()))?;
    fs::create_dir_all(destination_dir)?;
    let temporary_destination = destination.with_extension(format!("{}.tmp", detected.extension));
    fs::write(&temporary_destination, &input.bytes)?;
    fs::rename(&temporary_destination, &destination)?;

    let now = unix_time_millis()?;
    let source_kind =
        normalize_optional_enum("附件来源", input.source_kind, allowed_source_kinds())?
            .unwrap_or_else(|| "picker".to_owned());
    let vision_usage =
        normalize_optional_enum("视觉使用状态", input.vision_usage, allowed_vision_usages())?
            .unwrap_or_else(|| "notSent".to_owned());
    let ocr_metadata = attachment_ocr_metadata(&destination, &vision_usage);
    let size_bytes = i64::try_from(input.bytes.len())
        .map_err(|_| AppError::InvalidInput("图片文件过大".to_owned()))?;
    let attachment = AiAttachmentWrite {
        id: attachment_id,
        conversation_id: input.conversation_id,
        message_id: None,
        kind: "image".to_owned(),
        storage_mode: "managedCopy".to_owned(),
        source_kind,
        mime_type: detected.mime_type.to_owned(),
        original_name: normalize_required_owned_text("附件文件名", input.original_name, 255)?,
        original_path: None,
        asset_path: Some(asset_path),
        thumbnail_path: None,
        sha256: Some(sha256_hex(&input.bytes)),
        width: Some(i64::from(width)),
        height: Some(i64::from(height)),
        size_bytes,
        ocr_text: ocr_metadata.ocr_text,
        status: "available".to_owned(),
        missing_reason: None,
        vision_usage: Some(ocr_metadata.vision_usage),
        redaction_summary: ocr_metadata.redaction_summary,
        created_at: now,
        updated_at: now,
    };
    storage.insert_ai_attachment(&attachment)
}

fn attachment_ocr_metadata(
    image_path: &Path,
    requested_vision_usage: &str,
) -> AttachmentOcrMetadata {
    if !should_attempt_ocr(requested_vision_usage) {
        return AttachmentOcrMetadata {
            ocr_text: None,
            vision_usage: requested_vision_usage.to_owned(),
            redaction_summary: None,
        };
    }

    match run_local_ocr(image_path) {
        Ok(raw_text) => ocr_success_metadata(raw_text),
        Err(error) => AttachmentOcrMetadata {
            ocr_text: None,
            vision_usage: "metadataOnly".to_owned(),
            redaction_summary: Some(format_local_ocr_error(error)),
        },
    }
}

fn should_attempt_ocr(vision_usage: &str) -> bool {
    matches!(vision_usage, "ocrOnly" | "visionInput")
}

fn ocr_success_metadata(raw_text: String) -> AttachmentOcrMetadata {
    let normalized = normalize_ocr_text(&raw_text);
    if normalized.is_empty() {
        return AttachmentOcrMetadata {
            ocr_text: None,
            vision_usage: "metadataOnly".to_owned(),
            redaction_summary: Some("OCR 已运行但未识别到文本。".to_owned()),
        };
    }

    let (redacted, redacted_any) = redact_terminal_text(&normalized);
    let (ocr_text, truncated) = truncate_chars(&redacted, MAX_OCR_TEXT_CHARS);
    let mut summary_parts = vec!["OCR 已完成".to_owned()];
    if redacted_any {
        summary_parts.push("已脱敏敏感片段".to_owned());
    }
    if truncated {
        summary_parts.push(format!("已截断到 {MAX_OCR_TEXT_CHARS} 字符"));
    }

    AttachmentOcrMetadata {
        ocr_text: Some(ocr_text),
        vision_usage: "ocrOnly".to_owned(),
        redaction_summary: Some(format!("{}。", summary_parts.join("，"))),
    }
}

fn run_local_ocr(image_path: &Path) -> Result<String, LocalOcrError> {
    let mut child = local_ocr_command()
        .arg(image_path)
        .arg("stdout")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                LocalOcrError::Unavailable
            } else {
                LocalOcrError::Failed(format!("无法启动 OCR 进程: {error}"))
            }
        })?;

    let started_at = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let output = child.wait_with_output().map_err(|error| {
                    LocalOcrError::Failed(format!("无法读取 OCR 结果: {error}"))
                })?;
                if output.status.success() {
                    return Ok(String::from_utf8_lossy(&output.stdout).to_string());
                }
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                return Err(LocalOcrError::Failed(trim_ocr_error(&stderr)));
            }
            Ok(None) => {
                if started_at.elapsed() >= Duration::from_secs(OCR_TIMEOUT_SECONDS) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(LocalOcrError::TimedOut);
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(LocalOcrError::Failed(format!(
                    "无法检查 OCR 进程状态: {error}"
                )));
            }
        }
    }
}

fn tesseract_command() -> OsString {
    env::var_os(TESSERACT_PATH_ENV)
        .filter(|value| !value.to_string_lossy().trim().is_empty())
        .unwrap_or_else(|| OsString::from("tesseract"))
}

fn local_ocr_command() -> Command {
    let executable = tesseract_command();
    if should_execute_via_windows_cmd(&executable) {
        let mut command = Command::new("cmd");
        command.arg("/C").arg(executable);
        return command;
    }
    Command::new(executable)
}

fn should_execute_via_windows_cmd(executable: &OsString) -> bool {
    #[cfg(target_os = "windows")]
    {
        let extension = PathBuf::from(executable)
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase);
        matches!(extension.as_deref(), Some("cmd" | "bat"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = executable;
        false
    }
}

fn normalize_ocr_text(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\u{000c}', "")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_owned()
}

fn truncate_chars(value: &str, max_chars: usize) -> (String, bool) {
    if value.chars().count() <= max_chars {
        return (value.to_owned(), false);
    }
    let mut truncated = value.chars().take(max_chars).collect::<String>();
    truncated.push_str("\n[OCR 文本已截断]");
    (truncated, true)
}

fn trim_ocr_error(value: &str) -> String {
    let normalized = normalize_ocr_text(value);
    if normalized.is_empty() {
        return "OCR 命令执行失败，未返回错误详情".to_owned();
    }
    truncate_chars(&normalized, MAX_OCR_ERROR_CHARS).0
}

fn format_local_ocr_error(error: LocalOcrError) -> String {
    match error {
        LocalOcrError::Unavailable => {
            "OCR 未运行：未找到本地 tesseract 命令，图片已按 metadataOnly 附件保存。".to_owned()
        }
        LocalOcrError::TimedOut => {
            format!("OCR 超过 {OCR_TIMEOUT_SECONDS} 秒未完成，图片已按 metadataOnly 附件保存。")
        }
        LocalOcrError::Failed(message) => {
            let (redacted, _) = redact_terminal_text(&message);
            format!("OCR 失败：{redacted}")
        }
    }
}

fn detect_supported_image(bytes: &[u8]) -> AppResult<DetectedImage> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok(DetectedImage {
            format: ImageFormat::Png,
            mime_type: "image/png",
            extension: "png",
        });
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Ok(DetectedImage {
            format: ImageFormat::Jpeg,
            mime_type: "image/jpeg",
            extension: "jpg",
        });
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Ok(DetectedImage {
            format: ImageFormat::WebP,
            mime_type: "image/webp",
            extension: "webp",
        });
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Ok(DetectedImage {
            format: ImageFormat::Gif,
            mime_type: "image/gif",
            extension: "gif",
        });
    }
    if bytes.starts_with(b"BM") {
        return Ok(DetectedImage {
            format: ImageFormat::Bmp,
            mime_type: "image/bmp",
            extension: "bmp",
        });
    }
    Err(AppError::InvalidInput(
        "仅支持 PNG、JPEG、WebP、GIF 或 BMP 图片".to_owned(),
    ))
}

fn image_dimensions(bytes: &[u8], format: ImageFormat) -> AppResult<(u32, u32)> {
    ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|error| AppError::InvalidInput(format!("无法解析图片尺寸: {error}")))
}

fn managed_attachment_relative_path(
    conversation_id: &str,
    attachment_id: &str,
    file_name: &str,
) -> String {
    format!("{AI_ATTACHMENTS_DIR_NAME}/{conversation_id}/{attachment_id}/{file_name}")
}

fn resolve_managed_relative_path(paths: &KerminalPaths, value: &str) -> AppResult<PathBuf> {
    let relative = Path::new(value);
    if relative.is_absolute() {
        return Err(AppError::InvalidInput(
            "受管附件路径不能是绝对路径".to_owned(),
        ));
    }

    let mut clean = PathBuf::new();
    for component in relative.components() {
        match component {
            Component::Normal(value) => clean.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::InvalidInput("受管附件路径越界".to_owned()));
            }
        }
    }

    if clean
        .components()
        .next()
        .and_then(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        != Some(AI_ATTACHMENTS_DIR_NAME)
    {
        return Err(AppError::InvalidInput(
            "受管附件路径必须位于 ai-attachments 目录".to_owned(),
        ));
    }

    let target = paths.root.join(clean);
    if !target.starts_with(&paths.ai_attachments) {
        return Err(AppError::InvalidInput("受管附件路径越界".to_owned()));
    }
    Ok(target)
}

fn attachment_file_state(paths: &KerminalPaths, attachment: &AiAttachment) -> AttachmentFileState {
    let path = match attachment_path(paths, attachment) {
        Ok(path) => path,
        Err(reason) => {
            return AttachmentFileState {
                path: None,
                exists: false,
                missing_reason: Some(reason),
            };
        }
    };
    match fs::metadata(&path) {
        Ok(metadata) if metadata.is_file() => AttachmentFileState {
            path: Some(path),
            exists: true,
            missing_reason: None,
        },
        Ok(_) => AttachmentFileState {
            path: Some(path),
            exists: false,
            missing_reason: Some("unknown".to_owned()),
        },
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => AttachmentFileState {
            path: Some(path),
            exists: false,
            missing_reason: Some("permissionDenied".to_owned()),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => AttachmentFileState {
            path: Some(path),
            exists: false,
            missing_reason: Some("deleted".to_owned()),
        },
        Err(_) => AttachmentFileState {
            path: Some(path),
            exists: false,
            missing_reason: Some("unknown".to_owned()),
        },
    }
}

fn attachment_path(paths: &KerminalPaths, attachment: &AiAttachment) -> Result<PathBuf, String> {
    match attachment.storage_mode.as_str() {
        "managedCopy" => attachment
            .asset_path
            .as_deref()
            .ok_or_else(|| "unknown".to_owned())
            .and_then(|value| {
                resolve_managed_relative_path(paths, value).map_err(|_| "outsideScope".to_owned())
            }),
        "linkedFile" => {
            let Some(path) = attachment.original_path.as_deref() else {
                return Err("unknown".to_owned());
            };
            let path = PathBuf::from(path);
            if path.is_absolute() {
                Ok(path)
            } else {
                Err("outsideScope".to_owned())
            }
        }
        _ => Err("unknown".to_owned()),
    }
}

fn sync_attachment_status(
    storage: &SqliteStore,
    attachment: AiAttachment,
    file_state: &AttachmentFileState,
) -> AppResult<AiAttachment> {
    if attachment.status == "redacted" || attachment.status == "unsupported" {
        return Ok(attachment);
    }

    let status = if file_state.exists {
        "available"
    } else {
        "missing"
    };
    let missing_reason = if file_state.exists {
        None
    } else {
        Some(file_state.missing_reason.as_deref().unwrap_or("unknown"))
    };
    if attachment.status == status && attachment.missing_reason.as_deref() == missing_reason {
        return Ok(attachment);
    }
    storage.update_ai_attachment_status(&attachment.id, status, missing_reason, unix_time_millis()?)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn open_path(path: &Path) -> AppResult<()> {
    platform_open_file_command(path)
        .spawn()
        .map(|_| ())
        .map_err(AppError::Io)
}

#[cfg(target_os = "windows")]
fn platform_open_file_command(path: &Path) -> Command {
    let mut command = Command::new("explorer");
    command.arg(path);
    command
}

#[cfg(target_os = "macos")]
fn platform_open_file_command(path: &Path) -> Command {
    let mut command = Command::new("open");
    command.arg(path);
    command
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_open_file_command(path: &Path) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(path);
    command
}
