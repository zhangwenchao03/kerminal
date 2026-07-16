//! 启动阶段的只读配置恢复诊断模型。
//!
//! @author kongweiguang

use crate::models::config_change::ConfigDomain;

/// 启动阶段发现的只读配置恢复诊断；只保留固定相对路径和可操作说明。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StartupRecoverySnapshot {
    /// 存在未修复配置时为 true，运行态使用内存默认值且不写回损坏文件。
    pub read_only: bool,
    /// 脱敏诊断列表，不包含本机绝对路径、原始 TOML 或字段值。
    pub diagnostics: Vec<StartupRecoveryDiagnostic>,
}

/// 单个启动配置恢复诊断。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartupRecoveryDiagnostic {
    /// 配置所属领域。
    pub domain: ConfigDomain,
    /// 固定的安全相对路径标签。
    pub path: String,
    /// 不包含解析器原文的稳定错误说明。
    pub message: String,
    /// 用户修复配置后的恢复口径。
    pub recovery: String,
}

impl StartupRecoverySnapshot {
    pub(super) fn record_invalid(&mut self, domain: ConfigDomain, path: &str, message: &str) {
        self.read_only = true;
        self.diagnostics.push(StartupRecoveryDiagnostic {
            domain,
            path: path.to_owned(),
            message: message.to_owned(),
            recovery: "read-only recovery: 修复原配置并重新启动；Kerminal 不会覆盖损坏文件。"
                .to_owned(),
        });
    }
}
