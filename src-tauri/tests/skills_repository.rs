//! Agent Skills Repository 测试。
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::{
    models::settings::{AiMcpSettings, CustomMcpSkillDirectorySetting},
    services::skills_repository::SkillsRepository,
};
use tempfile::tempdir;

fn mcp_settings(path: &str) -> AiMcpSettings {
    AiMcpSettings {
        servers: Vec::new(),
        skill_directories: vec![CustomMcpSkillDirectorySetting {
            enabled: true,
            id: "team-skills".to_owned(),
            path: path.to_owned(),
        }],
    }
}

#[test]
fn discover_standard_skill_folders_from_configured_root() {
    let root = tempdir().expect("create temp skills root");
    let deploy = root.path().join("deploy");
    let review = root.path().join("review");
    let nested = root.path().join("team").join("ops");
    fs::create_dir_all(deploy.join("references")).expect("create deploy references");
    fs::create_dir_all(review.join("scripts")).expect("create review scripts");
    fs::create_dir_all(&nested).expect("create nested skill directory");
    fs::write(
        deploy.join("SKILL.md"),
        "---\nname: deploy-skill\ndescription: |\n  Deploy services safely.\n  Use for release checks.\n---\n\n# Deploy\nRun smoke tests before rollout.\n",
    )
    .expect("write deploy skill");
    fs::write(
        review.join("SKILL.md"),
        "---\nname: review-skill\ndescription: Review code before delivery.\n---\n\nCheck tests and risky diffs.\n",
    )
    .expect("write review skill");
    fs::write(
        nested.join("SKILL.md"),
        "---\nname: ops-skill\ndescription: Nested ops skill.\n---\n\nHandle nested operations.\n",
    )
    .expect("write nested skill");

    let catalog =
        SkillsRepository::new().discover(&mcp_settings(root.path().to_string_lossy().as_ref()));

    assert_eq!(catalog.directories.len(), 1);
    assert_eq!(catalog.directories[0].skill_count, 3);
    assert_eq!(catalog.entries.len(), 3);
    let deploy_entry = catalog
        .entries
        .iter()
        .find(|entry| entry.definition.id == "custom-skill.team-skills.deploy")
        .expect("deploy skill entry");
    assert_eq!(deploy_entry.definition.title, "deploy-skill");
    assert!(deploy_entry
        .definition
        .description
        .contains("Deploy services safely."));
    assert!(deploy_entry.instruction_preview.contains("Run smoke tests"));
    assert!(deploy_entry.has_references);
    assert!(!deploy_entry.has_scripts);

    let review_entry = catalog
        .entries
        .iter()
        .find(|entry| entry.definition.id == "custom-skill.team-skills.review")
        .expect("review skill entry");
    assert!(review_entry.has_scripts);
    assert!(review_entry
        .definition
        .prompt_guidance
        .contains("Check tests and risky diffs"));

    let ops_entry = catalog
        .entries
        .iter()
        .find(|entry| entry.definition.id == "custom-skill.team-skills.ops")
        .expect("nested ops skill entry");
    assert_eq!(ops_entry.definition.title, "ops-skill");
    assert!(ops_entry
        .definition
        .prompt_guidance
        .contains("Handle nested operations"));
}

#[test]
fn discover_root_skill_and_skips_disabled_or_missing_directories() {
    let root = tempdir().expect("create temp skills root");
    fs::write(
        root.path().join("SKILL.md"),
        "---\nname: root-skill\ndescription: Root level skill.\n---\n\nRoot instructions.\n",
    )
    .expect("write root skill");
    let settings = AiMcpSettings {
        servers: Vec::new(),
        skill_directories: vec![
            CustomMcpSkillDirectorySetting {
                enabled: true,
                id: "root".to_owned(),
                path: root.path().to_string_lossy().to_string(),
            },
            CustomMcpSkillDirectorySetting {
                enabled: false,
                id: "disabled".to_owned(),
                path: root.path().join("disabled").to_string_lossy().to_string(),
            },
            CustomMcpSkillDirectorySetting {
                enabled: true,
                id: "missing".to_owned(),
                path: root.path().join("missing").to_string_lossy().to_string(),
            },
        ],
    };

    let catalog = SkillsRepository::new().discover(&settings);

    assert_eq!(catalog.entries.len(), 1);
    assert!(catalog.entries[0]
        .definition
        .id
        .starts_with("custom-skill.root."));
    assert!(catalog.entries[0]
        .definition
        .prompt_guidance
        .contains("Root instructions"));
    assert_eq!(catalog.directories.len(), 3);
    assert!(!catalog.directories[1].enabled);
    assert!(!catalog.directories[2].exists);
}
