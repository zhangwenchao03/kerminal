//! MCP tools-only catalog 目录。
//!
//! @author kongweiguang

mod automation;
mod container;
mod credentials;
mod foundation;
mod remote;
mod sftp;
mod tmux;

use super::{ToolDescriptor, ToolId};

pub(super) fn registered_tools() -> Vec<ToolDescriptor> {
    let mut descriptors = Vec::new();
    descriptors.extend(foundation::foundation_tools());
    descriptors.extend(credentials::credential_tools());
    descriptors.extend(remote::remote_tools());
    descriptors.extend(sftp::sftp_tools());
    descriptors.extend(container::container_tools());
    descriptors.extend(tmux::tmux_tools());
    descriptors.extend(automation::automation_tools());

    let ordered = ToolId::CATALOG_ORDER
        .iter()
        .map(|expected_id| {
            let index = descriptors
                .iter()
                .position(|descriptor| descriptor.id() == *expected_id)
                .unwrap_or_else(|| panic!("typed MCP catalog 缺少 {}", expected_id.as_str()));
            descriptors.remove(index)
        })
        .collect::<Vec<_>>();
    assert!(
        descriptors.is_empty(),
        "typed MCP catalog 存在重复或未登记 descriptor"
    );
    ordered
}
