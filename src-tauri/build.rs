//! Kerminal Tauri build script.
//!
//! @author kongweiguang

fn main() {
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

    ensure_launch_shim_sidecar_placeholder();
    tauri_build::build()
}

fn ensure_launch_shim_sidecar_placeholder() {
    println!("cargo:rerun-if-env-changed=TARGET");

    let manifest_dir = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR")
            .expect("CARGO_MANIFEST_DIR is provided by Cargo when running the build script"),
    );
    let target_triple =
        std::env::var("TARGET").expect("TARGET is provided by Cargo when running the build script");
    let extension = if target_triple.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let sidecar_path = manifest_dir.join("binaries").join(format!(
        "kerminal-launch-shim-sidecar-{target_triple}{extension}"
    ));

    if sidecar_path.exists() {
        return;
    }

    if let Some(parent) = sidecar_path.parent() {
        std::fs::create_dir_all(parent)
            .expect("failed to create Tauri externalBin sidecar directory");
    }
    std::fs::write(
        &sidecar_path,
        b"bootstrap placeholder replaced by scripts/prepare-launch-shim-sidecar.mjs\n",
    )
    .expect("failed to create Tauri externalBin sidecar placeholder");
}
