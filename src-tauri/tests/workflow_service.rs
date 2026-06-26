//! 命令工作流服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::workflow::{
        WorkflowCreateRequest, WorkflowListRequest, WorkflowScope, WorkflowStepInput,
        WorkflowUpdateRequest,
    },
    paths::KerminalPaths,
    state::AppState,
};
use tempfile::{tempdir, TempDir};

#[test]
fn create_workflow_persists_steps_scope_tags_and_confirmation() {
    let (home, state) = test_state();

    let workflow = state
        .workflows()
        .create_workflow(WorkflowCreateRequest {
            title: "本地质量检查".to_owned(),
            description: Some("日常开发检查链路".to_owned()),
            tags: vec![
                " daily ".to_owned(),
                "DAILY".to_owned(),
                "quality".to_owned(),
            ],
            scope: WorkflowScope::Local,
            steps: vec![
                step(" 检查仓库状态 ", " git status --short ", None, false),
                step(
                    "运行质量门禁",
                    "npm run check",
                    Some(WorkflowScope::Local),
                    true,
                ),
            ],
        })
        .expect("create workflow");

    assert_eq!(workflow.title, "本地质量检查");
    assert_eq!(workflow.description.as_deref(), Some("日常开发检查链路"));
    assert_eq!(workflow.tags, vec!["daily", "quality"]);
    assert_eq!(workflow.scope, WorkflowScope::Local);
    assert_eq!(workflow.steps.len(), 2);
    assert_eq!(workflow.steps[0].title, "检查仓库状态");
    assert_eq!(workflow.steps[0].command, "git status --short");
    assert_eq!(workflow.steps[0].sort_order, 10);
    assert!(!workflow.steps[0].id.is_empty());
    assert_eq!(workflow.steps[1].scope, Some(WorkflowScope::Local));
    assert!(workflow.steps[1].requires_confirmation);
    assert!(home
        .path()
        .join(".kerminal/workflows")
        .join(format!("{}.toml", workflow.id))
        .is_file());
}

#[test]
fn list_workflows_filters_by_query_scope_and_tag() {
    let (_home, state) = test_state();

    state
        .workflows()
        .create_workflow(WorkflowCreateRequest {
            title: "本地质量检查".to_owned(),
            description: None,
            tags: vec!["quality".to_owned()],
            scope: WorkflowScope::Local,
            steps: vec![step("运行检查", "npm run check", None, false)],
        })
        .expect("create local workflow");
    state
        .workflows()
        .create_workflow(WorkflowCreateRequest {
            title: "服务器巡检".to_owned(),
            description: Some("SSH 主机健康检查".to_owned()),
            tags: vec!["ssh".to_owned(), "ops".to_owned()],
            scope: WorkflowScope::Ssh,
            steps: vec![step("查看负载", "uptime", None, false)],
        })
        .expect("create ssh workflow");

    let quality = state
        .workflows()
        .list_workflows(WorkflowListRequest {
            query: Some("npm".to_owned()),
            scope: Some(WorkflowScope::Local),
            tag: None,
        })
        .expect("filter by query and scope");
    assert_eq!(quality.len(), 1);
    assert_eq!(quality[0].title, "本地质量检查");

    let ops = state
        .workflows()
        .list_workflows(WorkflowListRequest {
            query: None,
            scope: None,
            tag: Some("OPS".to_owned()),
        })
        .expect("filter by tag");
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0].scope, WorkflowScope::Ssh);
}

#[test]
fn update_and_delete_workflow_round_trip() {
    let (_home, state) = test_state();
    let workflow = state
        .workflows()
        .create_workflow(WorkflowCreateRequest {
            title: "旧工作流".to_owned(),
            description: None,
            tags: Vec::new(),
            scope: WorkflowScope::Any,
            steps: vec![step("旧步骤", "echo old", None, false)],
        })
        .expect("create workflow");

    let updated = state
        .workflows()
        .update_workflow(WorkflowUpdateRequest {
            id: workflow.id.clone(),
            title: "新工作流".to_owned(),
            description: Some("updated".to_owned()),
            tags: vec!["shell".to_owned()],
            scope: WorkflowScope::Ssh,
            sort_order: workflow.sort_order,
            steps: vec![
                step("新步骤 1", "echo one", None, false),
                step("新步骤 2", "echo two", Some(WorkflowScope::Ssh), true),
            ],
        })
        .expect("update workflow");

    assert_eq!(updated.title, "新工作流");
    assert_eq!(updated.scope, WorkflowScope::Ssh);
    assert_eq!(updated.steps.len(), 2);
    assert_eq!(updated.steps[1].command, "echo two");

    assert!(state
        .workflows()
        .delete_workflow(&updated.id)
        .expect("delete workflow"));
    assert!(state
        .workflows()
        .list_workflows(WorkflowListRequest::default())
        .expect("list after delete")
        .is_empty());
}

#[test]
fn create_workflow_rejects_empty_steps_or_commands() {
    let (_home, state) = test_state();

    let empty_steps = state
        .workflows()
        .create_workflow(WorkflowCreateRequest {
            title: "空工作流".to_owned(),
            description: None,
            tags: Vec::new(),
            scope: WorkflowScope::Any,
            steps: Vec::new(),
        })
        .expect_err("reject empty workflow");
    assert!(matches!(empty_steps, AppError::InvalidInput(_)));

    let empty_command = state
        .workflows()
        .create_workflow(WorkflowCreateRequest {
            title: "空命令".to_owned(),
            description: None,
            tags: Vec::new(),
            scope: WorkflowScope::Any,
            steps: vec![step("空步骤", " ", None, false)],
        })
        .expect_err("reject empty command");
    assert!(matches!(empty_command, AppError::InvalidInput(_)));
}

fn step(
    title: &str,
    command: &str,
    scope: Option<WorkflowScope>,
    requires_confirmation: bool,
) -> WorkflowStepInput {
    WorkflowStepInput {
        id: None,
        title: title.to_owned(),
        command: command.to_owned(),
        description: None,
        scope,
        requires_confirmation,
    }
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}
