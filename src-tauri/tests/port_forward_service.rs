//! SSH 端口转发服务集成测试。
//!
//! @author kongweiguang

#[path = "port_forward_service/fixtures.rs"]
mod fixtures;
#[path = "port_forward_service/managed.rs"]
mod managed;
#[path = "port_forward_service/native.rs"]
mod native;
#[path = "port_forward_service/restore.rs"]
mod restore;
mod support;
