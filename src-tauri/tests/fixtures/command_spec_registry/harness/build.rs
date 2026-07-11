//! 独立 harness 的 spec 生成入口。
//!
//! @author kongweiguang

#[path = "../../../../build_support/command_spec_registry.rs"]
#[allow(dead_code)]
mod command_spec_registry;

fn main() {
    let manifest = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("harness manifest directory"),
    );
    let src_tauri = manifest
        .ancestors()
        .find(|ancestor| ancestor.join("command-specs").is_dir())
        .expect("locate src-tauri");
    let output =
        std::path::PathBuf::from(std::env::var("OUT_DIR").expect("harness output directory"));
    command_spec_registry::compile_registry(&src_tauri.join("command-specs/v1"), &output)
        .unwrap_or_else(|error| panic!("compile command specs: {error}"));
}
