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

    tauri_build::build()
}
