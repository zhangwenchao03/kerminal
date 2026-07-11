//! Kerminal Tauri build script.
//!
//! @author kongweiguang

#[path = "build_support/command_spec_registry.rs"]
mod command_spec_registry;

fn main() {
    let manifest_dir = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR")
            .expect("CARGO_MANIFEST_DIR is provided by Cargo when running the build script"),
    );
    let source_root = manifest_dir.join("command-specs/v1");
    let out_dir = std::path::PathBuf::from(
        std::env::var("OUT_DIR")
            .expect("OUT_DIR is provided by Cargo when running the build script"),
    );
    println!("cargo:rerun-if-changed=command-specs/v1");
    command_spec_registry::compile_registry(&source_root, &out_dir)
        .unwrap_or_else(|error| panic!("command spec registry validation failed: {error}"));

    println!("cargo:rerun-if-changed=windows-common-controls-v6.manifest");
    if cfg!(windows) {
        let manifest = std::path::Path::new(
            &std::env::var("CARGO_MANIFEST_DIR")
                .expect("CARGO_MANIFEST_DIR is provided by Cargo when running the build script"),
        )
        .join("windows-common-controls-v6.manifest");
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }

    tauri_build::build()
}
