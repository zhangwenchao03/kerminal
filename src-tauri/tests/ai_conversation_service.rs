//! AI 会话持久化服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::ai_conversation::{
        AiAttachmentInput, AiContextSnapshotCreateRequest, AiConversationAttachmentAddRequest,
        AiConversationAttachmentBindMessageRequest, AiConversationAttachmentImportBytesRequest,
        AiConversationAttachmentImportRequest, AiConversationCreateRequest,
        AiConversationListRequest, AiConversationMessageAppendRequest,
        AiConversationSlotSaveDraftRequest, AiConversationSlotSetActiveRequest,
    },
    paths::KerminalPaths,
    state::AppState,
};
use rusqlite::Connection;
use std::{env, ffi::OsString, path::Path};
use tempfile::tempdir;

#[test]
fn conversation_messages_slot_and_attachments_survive_reopen() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize state");

    let conversation = state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                title: Some("排查 prod-api".to_owned()),
                scope_kind: "lockedHost".to_owned(),
                scope_ref_json: Some(r#"{"hostId":"host-prod"}"#.to_owned()),
                target_key: Some("host:ssh:host-prod".to_owned()),
                host_id: Some("host-prod".to_owned()),
                tab_id: Some("tab-prod".to_owned()),
                pane_id: Some("pane-prod".to_owned()),
                provider_id: Some("provider-main".to_owned()),
                model: Some("gpt-test".to_owned()),
            },
        )
        .expect("create conversation");

    let context_snapshot = state
        .ai_conversations()
        .create_context_snapshot(
            state.storage(),
            AiContextSnapshotCreateRequest {
                application_context_json: Some(
                    r#"{"focusedPane":{"id":"pane-prod","sessionId":"session-prod"}}"#.to_owned(),
                ),
                attachment_refs_json: Some(r#"[{"id":"att-pending","kind":"image"}]"#.to_owned()),
                conversation_id: conversation.id.clone(),
                policy_json: Some(
                    r#"{"providerId":"provider-main","terminalContextRequested":true}"#.to_owned(),
                ),
                route_mode: Some("followWorkspaceTarget".to_owned()),
                scope_kind: "lockedHost".to_owned(),
                scope_ref_json: Some(r#"{"hostId":"host-prod"}"#.to_owned()),
                target_ref_json: Some(r#"{"paneId":"pane-prod"}"#.to_owned()),
                terminal_context_json: Some(
                    r#"{"snapshot":{"output":{"data":"ssh user@example.com -p 2222"}}}"#.to_owned(),
                ),
            },
        )
        .expect("create context snapshot");

    let message = state
        .ai_conversations()
        .append_message(
            state.storage(),
            AiConversationMessageAppendRequest {
                conversation_id: conversation.id.clone(),
                role: "user".to_owned(),
                content: "这张图里的 SSH 怎么配置？".to_owned(),
                status: Some("complete".to_owned()),
                provider_id: Some("provider-main".to_owned()),
                model: Some("gpt-test".to_owned()),
                token_estimate: Some(42),
                context_snapshot_id: Some(context_snapshot.id.clone()),
                metadata_json: None,
                attachments: vec![ssh_screenshot_attachment()],
            },
        )
        .expect("append message");

    assert_eq!(message.conversation_id, conversation.id);
    assert_eq!(message.role, "user");
    assert_eq!(
        message.context_snapshot_id.as_deref(),
        Some(context_snapshot.id.as_str())
    );

    let slot = state
        .ai_conversations()
        .set_slot_active(
            state.storage(),
            AiConversationSlotSetActiveRequest {
                slot_key: "pane:pane-prod".to_owned(),
                route_mode: "followWorkspaceTarget".to_owned(),
                target_ref_json: r#"{"paneId":"pane-prod"}"#.to_owned(),
                active_conversation_id: Some(conversation.id.clone()),
            },
        )
        .expect("set slot active");
    assert_eq!(
        slot.active_conversation_id.as_deref(),
        Some(conversation.id.as_str())
    );

    state
        .ai_conversations()
        .save_slot_draft(
            state.storage(),
            AiConversationSlotSaveDraftRequest {
                slot_key: "pane:pane-prod".to_owned(),
                route_mode: "followWorkspaceTarget".to_owned(),
                target_ref_json: r#"{"paneId":"pane-prod"}"#.to_owned(),
                active_conversation_id: Some(conversation.id.clone()),
                draft_text: Some("继续查 systemctl 状态".to_owned()),
            },
        )
        .expect("save draft");

    let summaries = state
        .ai_conversations()
        .list_conversations(
            state.storage(),
            AiConversationListRequest {
                host_id: Some("host-prod".to_owned()),
                ..Default::default()
            },
        )
        .expect("list conversations");
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].message_count, 1);
    assert_eq!(summaries[0].attachment_count, 1);

    drop(state);
    let reopened = AppState::initialize_with_paths(paths.clone()).expect("reopen state");
    let restored = reopened
        .ai_conversations()
        .get_conversation(reopened.storage(), &conversation.id)
        .expect("get restored conversation");

    assert_eq!(restored.messages.len(), 1);
    assert_eq!(
        restored.messages[0].context_snapshot_id.as_deref(),
        Some(context_snapshot.id.as_str())
    );
    assert_eq!(restored.attachments.len(), 1);
    assert_eq!(
        restored.attachments[0].message_id.as_deref(),
        Some(message.id.as_str())
    );
    assert_eq!(restored.attachments[0].storage_mode, "managedCopy");
    assert_eq!(
        restored.attachments[0].vision_usage.as_deref(),
        Some("ocrOnly")
    );
    let restored_snapshot = reopened
        .ai_conversations()
        .get_context_snapshot(reopened.storage(), &context_snapshot.id)
        .expect("get context snapshot");
    assert_eq!(
        restored_snapshot.message_id.as_deref(),
        Some(message.id.as_str())
    );
    assert!(restored_snapshot
        .terminal_context_json
        .as_deref()
        .is_some_and(|value| value.contains("ssh user@example.com")));

    let restored_slot = reopened
        .storage()
        .ai_conversation_slot_by_key("pane:pane-prod")
        .expect("read slot")
        .expect("slot exists");
    assert_eq!(
        restored_slot.draft_text.as_deref(),
        Some("继续查 systemctl 状态")
    );
}

#[test]
fn list_conversations_supports_filters_pagination_and_message_attachment_query() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize state");

    let staging = state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                title: Some("staging nginx".to_owned()),
                scope_kind: "lockedPane".to_owned(),
                scope_ref_json: Some(r#"{"paneId":"pane-stage"}"#.to_owned()),
                target_key: Some("pane:pane-stage".to_owned()),
                host_id: Some("host-stage".to_owned()),
                tab_id: Some("tab-stage".to_owned()),
                pane_id: Some("pane-stage".to_owned()),
                ..Default::default()
            },
        )
        .expect("create staging conversation");
    state
        .ai_conversations()
        .append_message(
            state.storage(),
            AiConversationMessageAppendRequest {
                conversation_id: staging.id.clone(),
                role: "user".to_owned(),
                content: "nginx access log".to_owned(),
                ..Default::default()
            },
        )
        .expect("append staging message");
    std::thread::sleep(std::time::Duration::from_millis(2));

    let prod = state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                title: Some("prod deploy".to_owned()),
                scope_kind: "lockedPane".to_owned(),
                scope_ref_json: Some(r#"{"paneId":"pane-prod"}"#.to_owned()),
                target_key: Some("pane:pane-prod".to_owned()),
                host_id: Some("host-prod".to_owned()),
                model: Some("gpt-rust".to_owned()),
                tab_id: Some("tab-prod".to_owned()),
                pane_id: Some("pane-prod".to_owned()),
                provider_id: Some("provider-prod".to_owned()),
            },
        )
        .expect("create prod conversation");
    state
        .ai_conversations()
        .append_message(
            state.storage(),
            AiConversationMessageAppendRequest {
                conversation_id: prod.id.clone(),
                role: "user".to_owned(),
                content: "rsync deploy failed".to_owned(),
                model: Some("message-model-prod".to_owned()),
                provider_id: Some("message-provider-prod".to_owned()),
                status: Some("streaming".to_owned()),
                attachments: vec![ssh_screenshot_attachment()],
                ..Default::default()
            },
        )
        .expect("append prod message");
    for index in 0..8 {
        state
            .ai_conversations()
            .create_conversation(
                state.storage(),
                AiConversationCreateRequest {
                    title: Some(format!("empty host {index}")),
                    scope_kind: "lockedHost".to_owned(),
                    scope_ref_json: Some(format!(r#"{{"hostId":"host-empty-{index}"}}"#)),
                    target_key: Some(format!("host:ssh:host-empty-{index}")),
                    host_id: Some(format!("host-empty-{index}")),
                    ..Default::default()
                },
            )
            .expect("create empty host conversation");
    }

    let by_message = state
        .ai_conversations()
        .list_conversations(
            state.storage(),
            AiConversationListRequest {
                query: Some("rsync".to_owned()),
                ..Default::default()
            },
        )
        .expect("query by message");
    assert_eq!(by_message.len(), 1);
    assert_eq!(by_message[0].id, prod.id);

    let by_attachment = state
        .ai_conversations()
        .list_conversations(
            state.storage(),
            AiConversationListRequest {
                query: Some("ssh-setup".to_owned()),
                ..Default::default()
            },
        )
        .expect("query by attachment");
    assert_eq!(by_attachment.len(), 1);
    assert_eq!(by_attachment[0].attachment_count, 1);
    assert_eq!(by_attachment[0].scope_ref_json, r#"{"paneId":"pane-prod"}"#);

    let by_target = state
        .ai_conversations()
        .list_conversations(
            state.storage(),
            AiConversationListRequest {
                host_id: Some("host-prod".to_owned()),
                pane_id: Some("pane-prod".to_owned()),
                target_key: Some("pane:pane-prod".to_owned()),
                ..Default::default()
            },
        )
        .expect("filter by target");
    assert_eq!(by_target.len(), 1);
    assert_eq!(by_target[0].id, prod.id);

    let by_tab = state
        .ai_conversations()
        .list_conversations(
            state.storage(),
            AiConversationListRequest {
                tab_id: Some("tab-prod".to_owned()),
                ..Default::default()
            },
        )
        .expect("filter by tab");
    assert_eq!(by_tab.len(), 1);
    assert_eq!(by_tab[0].id, prod.id);
    assert_eq!(by_tab[0].tab_id.as_deref(), Some("tab-prod"));

    let all_hosts = state
        .ai_conversations()
        .list_conversations(
            state.storage(),
            AiConversationListRequest {
                limit: Some(10),
                offset: Some(0),
                ..Default::default()
            },
        )
        .expect("all hosts history");
    assert_eq!(
        all_hosts
            .iter()
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>(),
        vec![prod.id.as_str(), staging.id.as_str()]
    );
    assert_eq!(
        all_hosts
            .iter()
            .filter_map(|row| row.host_id.as_deref())
            .collect::<Vec<_>>(),
        vec!["host-prod", "host-stage"]
    );

    let newest = state
        .ai_conversations()
        .list_conversations(
            state.storage(),
            AiConversationListRequest {
                limit: Some(1),
                offset: Some(0),
                ..Default::default()
            },
        )
        .expect("first page");
    assert_eq!(newest.len(), 1);
    assert_eq!(newest[0].id, prod.id);

    let second_page = state
        .ai_conversations()
        .list_conversations(
            state.storage(),
            AiConversationListRequest {
                limit: Some(1),
                offset: Some(1),
                ..Default::default()
            },
        )
        .expect("second page");
    assert_eq!(second_page.len(), 1);
    assert_eq!(second_page[0].id, staging.id);
}

#[test]
fn message_append_request_defaults_missing_attachments_to_empty() {
    let request: AiConversationMessageAppendRequest = serde_json::from_value(serde_json::json!({
        "conversationId": "conversation-1",
        "role": "user",
        "content": "无附件消息"
    }))
    .expect("deserialize request without attachments");

    assert!(request.attachments.is_empty());
}

#[test]
fn assistant_message_metadata_survives_reopen_and_rejects_invalid_json() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize state");
    let conversation = state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                scope_kind: "noContext".to_owned(),
                ..Default::default()
            },
        )
        .expect("create conversation");
    let metadata_json = r#"{"visionUsage":{"providerSupportsVision":true,"visionAdapterEnabled":true,"attachments":[{"id":"att-image","requestedUsage":"visionInput","effectiveUsage":"visionInput","modelInput":"visionInput"}]}}"#;

    let message = state
        .ai_conversations()
        .append_message(
            state.storage(),
            AiConversationMessageAppendRequest {
                conversation_id: conversation.id.clone(),
                role: "assistant".to_owned(),
                content: "图片里是 ssh deploy@prod.example.com".to_owned(),
                metadata_json: Some(metadata_json.to_owned()),
                ..Default::default()
            },
        )
        .expect("append assistant metadata message");

    assert_eq!(message.metadata_json, metadata_json);
    let invalid_metadata = state.ai_conversations().append_message(
        state.storage(),
        AiConversationMessageAppendRequest {
            conversation_id: conversation.id.clone(),
            role: "assistant".to_owned(),
            content: "invalid metadata".to_owned(),
            metadata_json: Some("{not-json".to_owned()),
            ..Default::default()
        },
    );
    assert!(invalid_metadata.is_err());

    drop(state);
    let reopened = AppState::initialize_with_paths(paths).expect("reopen state");
    let restored = reopened
        .ai_conversations()
        .get_conversation(reopened.storage(), &conversation.id)
        .expect("restore conversation");
    assert_eq!(restored.messages.len(), 1);
    assert_eq!(restored.messages[0].id, message.id);
    assert_eq!(restored.messages[0].metadata_json, metadata_json);
}

#[test]
fn slot_updates_preserve_independent_active_conversation_and_draft_fields() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize state");
    let conversation = state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                scope_kind: "lockedPane".to_owned(),
                scope_ref_json: Some(r#"{"paneId":"pane-1"}"#.to_owned()),
                ..Default::default()
            },
        )
        .expect("create conversation");

    state
        .ai_conversations()
        .set_slot_active(
            state.storage(),
            AiConversationSlotSetActiveRequest {
                slot_key: "pane:pane-1".to_owned(),
                route_mode: "followWorkspaceTarget".to_owned(),
                target_ref_json: r#"{"paneId":"pane-1"}"#.to_owned(),
                active_conversation_id: Some(conversation.id.clone()),
            },
        )
        .expect("set active");

    let with_draft = state
        .ai_conversations()
        .save_slot_draft(
            state.storage(),
            AiConversationSlotSaveDraftRequest {
                slot_key: "pane:pane-1".to_owned(),
                route_mode: "followWorkspaceTarget".to_owned(),
                target_ref_json: r#"{"paneId":"pane-1"}"#.to_owned(),
                active_conversation_id: None,
                draft_text: Some("保留 active 的草稿".to_owned()),
            },
        )
        .expect("save draft");
    assert_eq!(
        with_draft.active_conversation_id.as_deref(),
        Some(conversation.id.as_str())
    );
    let restored_slot = state
        .ai_conversations()
        .get_slot(state.storage(), "pane:pane-1")
        .expect("get slot")
        .expect("slot exists");
    assert_eq!(
        restored_slot.active_conversation_id.as_deref(),
        Some(conversation.id.as_str())
    );
    assert_eq!(
        restored_slot.draft_text.as_deref(),
        Some("保留 active 的草稿")
    );
    assert!(state
        .ai_conversations()
        .get_slot(state.storage(), "pane:missing")
        .expect("get missing slot")
        .is_none());

    let cleared_active = state
        .ai_conversations()
        .set_slot_active(
            state.storage(),
            AiConversationSlotSetActiveRequest {
                slot_key: "pane:pane-1".to_owned(),
                route_mode: "followWorkspaceTarget".to_owned(),
                target_ref_json: r#"{"paneId":"pane-1"}"#.to_owned(),
                active_conversation_id: None,
            },
        )
        .expect("clear active");
    assert_eq!(cleared_active.active_conversation_id, None);
    assert_eq!(
        cleared_active.draft_text.as_deref(),
        Some("保留 active 的草稿")
    );
}

#[test]
fn preimported_attachment_metadata_can_bind_to_later_message() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize state");
    let conversation = state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                scope_kind: "noContext".to_owned(),
                ..Default::default()
            },
        )
        .expect("create conversation");

    let attachment = state
        .ai_conversations()
        .add_attachment_metadata(
            state.storage(),
            AiConversationAttachmentAddRequest {
                conversation_id: conversation.id.clone(),
                attachment: ssh_screenshot_attachment(),
            },
        )
        .expect("add attachment metadata");
    assert_eq!(attachment.message_id, None);

    let message = state
        .ai_conversations()
        .append_message(
            state.storage(),
            AiConversationMessageAppendRequest {
                conversation_id: conversation.id.clone(),
                role: "user".to_owned(),
                content: "绑定已导入图片".to_owned(),
                ..Default::default()
            },
        )
        .expect("append message");
    let bound = state
        .ai_conversations()
        .bind_attachment_to_message(
            state.storage(),
            AiConversationAttachmentBindMessageRequest {
                attachment_id: attachment.id,
                message_id: message.id.clone(),
            },
        )
        .expect("bind attachment");

    assert_eq!(bound.message_id.as_deref(), Some(message.id.as_str()));
}

#[test]
fn managed_image_import_copies_file_and_refreshes_missing_status() {
    let home = tempdir().expect("create temp home");
    let source_dir = tempdir().expect("create source dir");
    let source_path = source_dir.path().join("ssh-setup.png");
    std::fs::write(&source_path, tiny_png()).expect("write source image");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize state");
    let conversation = state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                scope_kind: "noContext".to_owned(),
                ..Default::default()
            },
        )
        .expect("create conversation");

    let attachment = state
        .ai_conversations()
        .import_image_attachment(
            state.storage(),
            state.paths(),
            AiConversationAttachmentImportRequest {
                conversation_id: conversation.id.clone(),
                source_kind: Some("drag".to_owned()),
                source_path: source_path.to_string_lossy().into_owned(),
                vision_usage: Some("notSent".to_owned()),
            },
        )
        .expect("import image");

    assert_eq!(attachment.storage_mode, "managedCopy");
    assert_eq!(attachment.mime_type, "image/png");
    assert_eq!(attachment.original_name, "ssh-setup.png");
    assert_eq!(attachment.original_path, None);
    assert_eq!(attachment.width, Some(1));
    assert_eq!(attachment.height, Some(1));
    assert_eq!(attachment.size_bytes as usize, tiny_png().len());
    assert!(attachment
        .sha256
        .as_ref()
        .is_some_and(|hash| hash.len() == 64));
    let asset_path = attachment.asset_path.as_deref().expect("asset path");
    assert!(asset_path.starts_with("ai-attachments/"));
    assert!(asset_path.ends_with("/original.png"));
    let copied_path = paths.root.join(asset_path);
    assert!(copied_path.is_file());

    let asset_info = state
        .ai_conversations()
        .resolve_attachment_asset(state.storage(), state.paths(), &attachment.id)
        .expect("resolve asset");
    assert!(asset_info.exists);
    assert_eq!(asset_info.attachment.status, "available");
    assert_eq!(
        std::path::PathBuf::from(asset_info.resolved_path.as_deref().expect("resolved path"))
            .canonicalize()
            .expect("canonical resolved path"),
        copied_path.canonicalize().expect("canonical copied path")
    );

    std::fs::remove_file(&copied_path).expect("remove managed copy");
    let refreshed = state
        .ai_conversations()
        .refresh_attachment_status(state.storage(), state.paths(), &attachment.id)
        .expect("refresh status");
    assert_eq!(refreshed.status, "missing");
    assert_eq!(refreshed.missing_reason.as_deref(), Some("deleted"));
}

#[test]
fn managed_image_import_accepts_clipboard_bytes_without_source_path() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize state");
    let conversation = state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                scope_kind: "noContext".to_owned(),
                ..Default::default()
            },
        )
        .expect("create conversation");

    let attachment = state
        .ai_conversations()
        .import_image_attachment_bytes(
            state.storage(),
            state.paths(),
            AiConversationAttachmentImportBytesRequest {
                bytes: tiny_png().to_vec(),
                conversation_id: conversation.id,
                original_name: Some("clipboard.png".to_owned()),
                source_kind: Some("paste".to_owned()),
                vision_usage: Some("notSent".to_owned()),
            },
        )
        .expect("import image bytes");

    assert_eq!(attachment.storage_mode, "managedCopy");
    assert_eq!(attachment.source_kind, "paste");
    assert_eq!(attachment.original_name, "clipboard.png");
    assert_eq!(attachment.original_path, None);
    assert_eq!(attachment.mime_type, "image/png");
    assert_eq!(attachment.width, Some(1));
    assert_eq!(attachment.height, Some(1));
    assert_eq!(attachment.size_bytes as usize, tiny_png().len());
    let asset_path = attachment.asset_path.as_deref().expect("asset path");
    assert!(paths.root.join(asset_path).is_file());
}

#[test]
fn managed_image_import_runs_local_ocr_when_requested() {
    let home = tempdir().expect("create temp home");
    let source_dir = tempdir().expect("create source dir");
    let source_path = source_dir.path().join("ssh-setup.png");
    std::fs::write(&source_path, tiny_png()).expect("write source image");
    let fake_tesseract = write_fake_tesseract(source_dir.path());
    let _ocr_env = ScopedEnvVar::set("KERMINAL_TESSERACT_PATH", &fake_tesseract);
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize state");
    let conversation = state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                scope_kind: "noContext".to_owned(),
                ..Default::default()
            },
        )
        .expect("create conversation");

    let attachment = state
        .ai_conversations()
        .import_image_attachment(
            state.storage(),
            state.paths(),
            AiConversationAttachmentImportRequest {
                conversation_id: conversation.id,
                source_kind: Some("picker".to_owned()),
                source_path: source_path.to_string_lossy().into_owned(),
                vision_usage: Some("ocrOnly".to_owned()),
            },
        )
        .expect("import image with ocr");

    assert_eq!(attachment.vision_usage.as_deref(), Some("ocrOnly"));
    let ocr_text = attachment.ocr_text.as_deref().expect("ocr text");
    assert!(ocr_text.contains("ssh -p 2222 deploy@prod.example.com"));
    assert!(ocr_text.contains("password=[已脱敏]"));
    assert!(!ocr_text.contains("hunter2"));
    assert!(attachment
        .redaction_summary
        .as_deref()
        .is_some_and(|summary| summary.contains("已脱敏")));
}

#[test]
fn image_import_rejects_unsupported_files() {
    let home = tempdir().expect("create temp home");
    let source_dir = tempdir().expect("create source dir");
    let source_path = source_dir.path().join("not-image.svg");
    std::fs::write(&source_path, "<svg></svg>").expect("write source file");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize state");
    let conversation = state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                scope_kind: "noContext".to_owned(),
                ..Default::default()
            },
        )
        .expect("create conversation");

    let result = state.ai_conversations().import_image_attachment(
        state.storage(),
        state.paths(),
        AiConversationAttachmentImportRequest {
            conversation_id: conversation.id,
            source_kind: Some("picker".to_owned()),
            source_path: source_path.to_string_lossy().into_owned(),
            vision_usage: None,
        },
    );

    assert!(result.is_err());
}

#[test]
fn managed_asset_resolution_rejects_relative_path_escape() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize state");
    let conversation = state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                scope_kind: "noContext".to_owned(),
                ..Default::default()
            },
        )
        .expect("create conversation");
    let attachment = state
        .ai_conversations()
        .add_attachment_metadata(
            state.storage(),
            AiConversationAttachmentAddRequest {
                conversation_id: conversation.id,
                attachment: AiAttachmentInput {
                    asset_path: Some("../secret.png".to_owned()),
                    ..ssh_screenshot_attachment()
                },
            },
        )
        .expect("add metadata");

    let asset_info = state
        .ai_conversations()
        .resolve_attachment_asset(state.storage(), state.paths(), &attachment.id)
        .expect("resolve escaped asset");

    assert!(!asset_info.exists);
    assert_eq!(asset_info.attachment.status, "missing");
    assert_eq!(
        asset_info.attachment.missing_reason.as_deref(),
        Some("outsideScope")
    );
    assert_eq!(asset_info.resolved_path, None);
}

#[test]
fn deleting_conversation_cascades_messages_and_attachments() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize state");
    let conversation = state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                title: Some("临时会话".to_owned()),
                scope_kind: "noContext".to_owned(),
                scope_ref_json: Some("{}".to_owned()),
                ..Default::default()
            },
        )
        .expect("create conversation");

    state
        .ai_conversations()
        .append_message(
            state.storage(),
            AiConversationMessageAppendRequest {
                conversation_id: conversation.id.clone(),
                role: "user".to_owned(),
                content: "hello".to_owned(),
                attachments: vec![ssh_screenshot_attachment()],
                ..Default::default()
            },
        )
        .expect("append message");

    assert!(state
        .ai_conversations()
        .delete_conversation(state.storage(), &conversation.id)
        .expect("delete conversation"));
    assert!(state
        .storage()
        .ai_conversation_by_id(&conversation.id)
        .expect("lookup deleted conversation")
        .is_none());

    let conn = Connection::open(paths.database_file).expect("open db");
    let messages: i64 = conn
        .query_row("SELECT COUNT(*) FROM ai_messages", [], |row| row.get(0))
        .expect("count messages");
    let attachments: i64 = conn
        .query_row("SELECT COUNT(*) FROM ai_attachments", [], |row| row.get(0))
        .expect("count attachments");
    assert_eq!(messages, 0);
    assert_eq!(attachments, 0);
}

#[test]
fn rejects_unknown_scope_and_attachment_modes() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize state");

    let invalid_scope = state.ai_conversations().create_conversation(
        state.storage(),
        AiConversationCreateRequest {
            title: Some("bad".to_owned()),
            scope_kind: "random".to_owned(),
            scope_ref_json: Some("{}".to_owned()),
            ..Default::default()
        },
    );
    assert!(invalid_scope.is_err());

    let conversation = state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                scope_kind: "noContext".to_owned(),
                ..Default::default()
            },
        )
        .expect("create valid conversation");
    let invalid_attachment = state.ai_conversations().append_message(
        state.storage(),
        AiConversationMessageAppendRequest {
            conversation_id: conversation.id.clone(),
            role: "user".to_owned(),
            content: "bad attachment".to_owned(),
            attachments: vec![AiAttachmentInput {
                storage_mode: "blobOnly".to_owned(),
                ..ssh_screenshot_attachment()
            }],
            ..Default::default()
        },
    );
    assert!(invalid_attachment.is_err());

    let invalid_token = state.ai_conversations().append_message(
        state.storage(),
        AiConversationMessageAppendRequest {
            conversation_id: conversation.id.clone(),
            role: "user".to_owned(),
            content: "bad token".to_owned(),
            token_estimate: Some(-1),
            ..Default::default()
        },
    );
    assert!(invalid_token.is_err());

    let missing_asset_path = state.ai_conversations().append_message(
        state.storage(),
        AiConversationMessageAppendRequest {
            conversation_id: conversation.id,
            role: "user".to_owned(),
            content: "missing managed asset".to_owned(),
            attachments: vec![AiAttachmentInput {
                asset_path: None,
                ..ssh_screenshot_attachment()
            }],
            ..Default::default()
        },
    );
    assert!(missing_asset_path.is_err());
}

fn ssh_screenshot_attachment() -> AiAttachmentInput {
    AiAttachmentInput {
        kind: "image".to_owned(),
        storage_mode: "managedCopy".to_owned(),
        source_kind: Some("paste".to_owned()),
        mime_type: "image/png".to_owned(),
        original_name: "ssh-setup.png".to_owned(),
        original_path: None,
        asset_path: Some("ai-attachments/conversation/hash.png".to_owned()),
        thumbnail_path: Some("ai-attachments/conversation/hash.thumb.png".to_owned()),
        sha256: Some("a".repeat(64)),
        width: Some(1280),
        height: Some(720),
        size_bytes: 24_000,
        ocr_text: Some("ssh user@example.com -p 2222".to_owned()),
        status: Some("available".to_owned()),
        missing_reason: None,
        vision_usage: Some("ocrOnly".to_owned()),
        redaction_summary: None,
    }
}

fn tiny_png() -> &'static [u8] {
    &[
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9,
        251, 3, 253, 160, 105, 45, 164, 0, 0, 0, 0, 73, 69, 68, 174, 66, 96, 130,
    ]
}

struct ScopedEnvVar {
    key: &'static str,
    previous: Option<OsString>,
}

impl ScopedEnvVar {
    fn set(key: &'static str, value: &Path) -> Self {
        let previous = env::var_os(key);
        env::set_var(key, value);
        Self { key, previous }
    }
}

impl Drop for ScopedEnvVar {
    fn drop(&mut self) {
        if let Some(previous) = self.previous.as_ref() {
            env::set_var(self.key, previous);
        } else {
            env::remove_var(self.key);
        }
    }
}

#[cfg(target_os = "windows")]
fn write_fake_tesseract(dir: &Path) -> std::path::PathBuf {
    let path = dir.join("fake-tesseract.cmd");
    std::fs::write(
        &path,
        "@echo off\r\necho ssh -p 2222 deploy@prod.example.com\r\necho password: hunter2\r\n",
    )
    .expect("write fake tesseract");
    path
}

#[cfg(not(target_os = "windows"))]
fn write_fake_tesseract(dir: &Path) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;

    let path = dir.join("fake-tesseract");
    std::fs::write(
        &path,
        "#!/bin/sh\nprintf '%s\\n' 'ssh -p 2222 deploy@prod.example.com' 'password: hunter2'\n",
    )
    .expect("write fake tesseract");
    let mut permissions = std::fs::metadata(&path)
        .expect("fake tesseract metadata")
        .permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&path, permissions).expect("make fake tesseract executable");
    path
}
