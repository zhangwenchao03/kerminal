//! AI 会话历史搜索字段集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::ai_conversation::{
        AiConversationCreateRequest, AiConversationListRequest, AiConversationMessageAppendRequest,
    },
    paths::KerminalPaths,
    state::AppState,
};
use tempfile::tempdir;

#[test]
fn list_conversation_search_matches_provider_model_and_status() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize state");
    let conversation = state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                model: Some("gpt-rust".to_owned()),
                provider_id: Some("provider-prod".to_owned()),
                scope_kind: "lockedPane".to_owned(),
                title: Some("prod deploy".to_owned()),
                ..Default::default()
            },
        )
        .expect("create conversation");
    state
        .ai_conversations()
        .append_message(
            state.storage(),
            AiConversationMessageAppendRequest {
                content: "rsync deploy failed".to_owned(),
                conversation_id: conversation.id.clone(),
                model: Some("message-model-prod".to_owned()),
                provider_id: Some("message-provider-prod".to_owned()),
                role: "assistant".to_owned(),
                status: Some("streaming".to_owned()),
                ..Default::default()
            },
        )
        .expect("append provider message");

    for query in [
        "provider-prod",
        "gpt-rust",
        "message-provider-prod",
        "streaming",
    ] {
        let rows = state
            .ai_conversations()
            .list_conversations(
                state.storage(),
                AiConversationListRequest {
                    query: Some(query.to_owned()),
                    ..Default::default()
                },
            )
            .expect("query conversation");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, conversation.id);
    }
}
