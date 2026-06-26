//! SFTP integration test support.
//!
//! @author kongweiguang

pub(crate) mod loopback;

use kerminal_lib::{
    models::remote_host::{RemoteHostAuthType, RemoteHostCreateRequest, SshOptions},
    paths::KerminalPaths,
    state::AppState,
};
use tempfile::{tempdir, TempDir};

pub(crate) fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}

pub(crate) fn create_password_remote_host(state: &AppState, name: &str, port: u16) -> String {
    create_password_remote_host_with_options(state, name, port, SshOptions::default())
}

pub(crate) fn create_password_remote_host_with_options(
    state: &AppState,
    name: &str,
    port: u16,
    ssh_options: SshOptions,
) -> String {
    create_password_remote_host_with_credentials(state, name, port, "deploy", "secret", ssh_options)
}

pub(crate) fn create_password_remote_host_with_credentials(
    state: &AppState,
    name: &str,
    port: u16,
    username: &str,
    password: &str,
    ssh_options: SshOptions,
) -> String {
    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(password.to_owned()),
            group_id: None,
            host: "127.0.0.1".to_owned(),
            name: name.to_owned(),
            port,
            production: false,
            ssh_options,
            tags: vec!["loopback".to_owned()],
            username: username.to_owned(),
        })
        .expect("create loopback remote host")
        .id
}
