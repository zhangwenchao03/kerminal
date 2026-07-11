//! TASK-004 独立测试 harness；shared Cargo/build 接线前用于验证 compiler。
//!
//! @author kongweiguang

#[path = "../../../../../src/services/command_suggestion_service/spec_registry.rs"]
#[allow(dead_code)]
mod spec_registry;

#[cfg(test)]
mod tests {
    use super::spec_registry;

    #[test]
    fn generated_runtime_registry_uses_static_lookup_tables() {
        let root = spec_registry::root_items()
            .iter()
            .map(|item| item.name)
            .collect::<Vec<_>>();
        assert_eq!(
            root,
            [
                "cargo",
                "docker",
                "git",
                "kubectl",
                "npm",
                "ssh",
                "systemctl"
            ]
        );
        assert!(spec_registry::subcommand_items("git", &[])
            .iter()
            .any(|item| item.name == "checkout"));
        assert!(
            spec_registry::option_items("docker", &["compose".to_owned()])
                .iter()
                .any(|item| item.name == "--detach")
        );
    }
}
