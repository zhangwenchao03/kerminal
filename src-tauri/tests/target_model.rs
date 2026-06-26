//! 目标模型集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::target::{
        ContainerRuntime, FileLocation, RemoteTargetRef, TargetCapabilities, TargetDescriptor,
        TargetKind,
    },
};
use serde_json::json;

#[test]
fn target_ref_serializes_as_camel_case_discriminated_union() {
    let target = RemoteTargetRef::DockerContainer {
        host_id: "host-1".to_owned(),
        container_id: "abc123".to_owned(),
        runtime: ContainerRuntime::Docker,
        container_name: Some("api".to_owned()),
        user: Some("app".to_owned()),
        workdir: Some("/srv/app".to_owned()),
    };

    let value = serde_json::to_value(&target).expect("serialize target");

    assert_eq!(
        value,
        json!({
            "kind": "dockerContainer",
            "hostId": "host-1",
            "containerId": "abc123",
            "runtime": "docker",
            "containerName": "api",
            "user": "app",
            "workdir": "/srv/app"
        })
    );
    assert_eq!(target.kind(), TargetKind::DockerContainer);
    assert_eq!(target.host_id(), Some("host-1"));
    assert_eq!(target.stable_id(), "docker:host-1:abc123");
}

#[test]
fn target_ref_rejects_missing_container_identity() {
    let error = RemoteTargetRef::DockerContainer {
        host_id: "host-1".to_owned(),
        container_id: " ".to_owned(),
        runtime: ContainerRuntime::Docker,
        container_name: None,
        user: None,
        workdir: None,
    }
    .validate()
    .expect_err("reject empty container id");

    assert!(matches!(error, AppError::InvalidInput(_)));
}

#[test]
fn telnet_and_serial_targets_are_terminal_only() {
    let telnet = RemoteTargetRef::Telnet {
        host_id: "host-telnet".to_owned(),
    };
    let serial = RemoteTargetRef::Serial {
        host_id: "host-serial".to_owned(),
    };

    assert_eq!(telnet.kind(), TargetKind::Telnet);
    assert_eq!(telnet.host_id(), Some("host-telnet"));
    assert_eq!(telnet.stable_id(), "telnet:host-telnet");
    assert_eq!(serial.kind(), TargetKind::Serial);
    assert_eq!(serial.host_id(), Some("host-serial"));
    assert_eq!(serial.stable_id(), "serial:host-serial");
    assert_eq!(TargetCapabilities::telnet(), TargetCapabilities::serial());
    assert!(TargetCapabilities::telnet().terminal);
    assert!(!TargetCapabilities::serial().exec);
    telnet.validate().expect("valid telnet target");
    serial.validate().expect("valid serial target");
}

#[test]
fn telnet_and_serial_targets_reject_empty_host_id() {
    let telnet_error = RemoteTargetRef::Telnet {
        host_id: " ".to_owned(),
    }
    .validate()
    .expect_err("reject empty telnet host id");
    let serial_error = RemoteTargetRef::Serial {
        host_id: "\n".to_owned(),
    }
    .validate()
    .expect_err("reject invalid serial host id");

    assert!(matches!(telnet_error, AppError::InvalidInput(_)));
    assert!(matches!(serial_error, AppError::InvalidInput(_)));
}

#[test]
fn file_location_normalizes_remote_paths() {
    let location = FileLocation::new(
        RemoteTargetRef::Ssh {
            host_id: "host-1".to_owned(),
        },
        " var//log/ ",
    )
    .expect("normalize file location");

    assert_eq!(location.path, "/var/log");
    assert_eq!(location.target.stable_id(), "ssh:host-1");
}

#[test]
fn target_descriptor_uses_target_stable_id() {
    let descriptor = TargetDescriptor::new(
        "prod",
        "deploy@prod",
        RemoteTargetRef::Ssh {
            host_id: "host-prod".to_owned(),
        },
        TargetCapabilities::ssh(),
    )
    .expect("create descriptor");

    assert_eq!(descriptor.id, "ssh:host-prod");
    assert!(descriptor.capabilities.files);
}
