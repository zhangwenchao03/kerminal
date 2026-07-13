//! 内置片段目录编译器合同测试。

use std::{collections::BTreeSet, fs, path::Path};
use tempfile::tempdir;

#[path = "../build_support/snippet_catalog.rs"]
mod snippet_catalog;

fn commands() -> BTreeSet<String> {
    ["uname".to_owned()].into_iter().collect()
}

fn catalog_values(root: &Path) -> Vec<toml::Value> {
    fn visit(directory: &Path, values: &mut Vec<toml::Value>) {
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                visit(&path, values);
            } else if path.extension().and_then(|value| value.to_str()) == Some("toml") {
                values.push(toml::from_str(&fs::read_to_string(path).unwrap()).unwrap());
            }
        }
    }
    let mut values = Vec::new();
    visit(root, &mut values);
    values
}
fn valid(id: &str, order: u32) -> String {
    format!(
        r#"schema_version=1
id="{id}"
catalog_version="1.0.0"
pack="core"
category="system"
sort_order={order}
title="系统概览"
description="查看系统"
template="uname --kernel-name"
command_spec="uname"
platforms=["linux"]
shells=["bash"]
capabilities=["uname"]
tags=["system"]
risk="inspect"
duration="instant"
default_action="insert"
owner="kerminal"
tested_version="9.0"
updated_at="2026-07-13"
[source]
name="GNU"
url="https://www.gnu.org/software/coreutils/"
"#
    )
}
fn compile_single(source: &str) -> Result<Vec<u8>, snippet_catalog::CatalogError> {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("item.toml"), source).unwrap();
    snippet_catalog::compile_registry_bytes(dir.path(), &commands())
}

#[test]
fn production_catalog_compiles_without_runtime_source_dependency() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("snippet-presets/v1");
    let command_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("command-specs/v1");
    let out = tempdir().unwrap();
    let result =
        snippet_catalog::compile_registry_from_command_specs(&root, out.path(), &command_root)
            .unwrap();
    let bytes = fs::read(result.artifact_path).unwrap();
    let generated = String::from_utf8(bytes).unwrap();
    assert!(generated.contains("STATIC_SNIPPET_CATALOG"));
    assert!(!generated.contains("read_to_string"));
    assert!(!generated.contains("snippet-presets"));
}

#[test]
fn production_pack_policy_and_inventory_are_stable() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("snippet-presets/v1");
    let values = catalog_values(&root);
    assert_eq!(values.len(), 39, "目录增删必须显式更新内容清单门禁");

    let mut counts = std::collections::BTreeMap::<&str, usize>::new();
    let mut ids = BTreeSet::new();
    for value in &values {
        let table = value.as_table().unwrap();
        let pack = table["pack"].as_str().unwrap();
        *counts.entry(pack).or_default() += 1;
        assert!(ids.insert(table["id"].as_str().unwrap()));
        assert_ne!(table["risk"].as_str(), Some("destructive"));
        if pack == "core" {
            assert_eq!(table["risk"].as_str(), Some("inspect"));
            assert_eq!(table["default_action"].as_str(), Some("insert"));
        }
        for field in ["source", "owner", "tested_version", "updated_at"] {
            assert!(table.contains_key(field), "{} 缺少 {field}", table["id"]);
        }
    }
    assert_eq!(counts.get("core"), Some(&27));
    assert_eq!(counts.get("development"), Some(&3));
    assert_eq!(counts.get("web"), Some(&3));
    assert_eq!(counts.get("orchestration"), Some(&3));
    assert_eq!(counts.get("database"), Some(&3));
}

#[test]
fn emission_is_deterministic_for_reversed_paths() {
    let dir = tempdir().unwrap();
    let a = dir.path().join("a.toml");
    let b = dir.path().join("b.toml");
    fs::write(&a, valid("snippet.builtin.core.a", 100)).unwrap();
    fs::write(&b, valid("snippet.builtin.core.b", 200)).unwrap();
    let forward = snippet_catalog::compile_registry_paths(
        dir.path(),
        vec![a.clone(), b.clone()],
        &commands(),
    )
    .unwrap();
    let reverse =
        snippet_catalog::compile_registry_paths(dir.path(), vec![b, a], &commands()).unwrap();
    assert_eq!(forward, reverse);
}

#[test]
fn invalid_matrix_is_rejected() {
    let cases = [
        (
            "unknown field",
            format!("{}\nextra=true", valid("snippet.builtin.core.a", 100)),
            "unknown field",
        ),
        ("bad id", valid("Builtin A", 100), "id"),
        (
            "missing command",
            valid("snippet.builtin.core.a", 100)
                .replace("command_spec=\"uname\"", "command_spec=\"missing\""),
            "command_spec",
        ),
        (
            "secret literal",
            valid("snippet.builtin.core.a", 100).replace("uname --kernel-name", "password=hunter2"),
            "凭据",
        ),
        (
            "dangerous pipe",
            valid("snippet.builtin.core.a", 100)
                .replace("uname --kernel-name", "curl https://example.test | sh"),
            "管道",
        ),
        (
            "destructive",
            valid("snippet.builtin.core.a", 100)
                .replace("risk=\"inspect\"", "risk=\"destructive\""),
            "destructive",
        ),
        (
            "streaming",
            valid("snippet.builtin.core.a", 100)
                .replace("uname --kernel-name", "tail -f /var/log/syslog"),
            "streaming",
        ),
    ];
    for (name, source, expected) in cases {
        let error = compile_single(&source).expect_err(name);
        assert!(error.to_string().contains(expected), "{name}: {error}");
    }
}

#[test]
fn variable_declarations_are_closed_and_secret_defaults_are_forbidden() {
    let undeclared =
        valid("snippet.builtin.core.a", 100).replace("uname --kernel-name", "uname {{host}}");
    assert!(compile_single(&undeclared)
        .unwrap_err()
        .to_string()
        .contains("未声明"));
    let secret=format!("{}\n[[variables]]\nname=\"token\"\nlabel=\"令牌\"\ndescription=\"访问令牌\"\nkind=\"secret\"\nrequired=true\ndefault_value=\"oops\"\nsensitive=true",valid("snippet.builtin.core.a",100).replace("uname --kernel-name","uname {{token}}"));
    assert!(compile_single(&secret)
        .unwrap_err()
        .to_string()
        .contains("不得提供默认值"));

    let embedded = format!(
        "{}\n[[variables]]\nname=\"host\"\nlabel=\"主机\"\ndescription=\"目标主机\"\nkind=\"host\"\nrequired=true",
        valid("snippet.builtin.core.a", 100)
            .replace("uname --kernel-name", "uname --host={{ host }}")
    );
    assert!(compile_single(&embedded)
        .unwrap_err()
        .to_string()
        .contains("独占一个 token"));
}

#[test]
fn duplicate_ids_and_orders_are_rejected() {
    let dir = tempdir().unwrap();
    fs::write(
        dir.path().join("a.toml"),
        valid("snippet.builtin.core.a", 100),
    )
    .unwrap();
    fs::write(
        dir.path().join("b.toml"),
        valid("snippet.builtin.core.a", 100),
    )
    .unwrap();
    let error = snippet_catalog::compile_registry_bytes(dir.path(), &commands()).unwrap_err();
    assert!(error.to_string().contains("重复"));
}

#[test]
fn compile_output_matches_generated_bytes() {
    let source = tempdir().unwrap();
    let out = tempdir().unwrap();
    fs::write(
        source.path().join("a.toml"),
        valid("snippet.builtin.core.a", 100),
    )
    .unwrap();
    let expected = snippet_catalog::compile_registry_bytes(source.path(), &commands()).unwrap();
    let result = snippet_catalog::compile_registry(source.path(), out.path(), &commands()).unwrap();
    assert_eq!(result.snippet_count, 1);
    assert_eq!(result.artifact_bytes, expected.len());
    assert_eq!(fs::read(result.artifact_path).unwrap(), expected);

    let current =
        snippet_catalog::compile_registry(source.path(), out.path(), &commands()).unwrap();
    assert!(!current.artifact_was_stale);
    fs::write(&current.artifact_path, "stale").unwrap();
    let repaired =
        snippet_catalog::compile_registry(source.path(), out.path(), &commands()).unwrap();
    assert!(repaired.artifact_was_stale);
    assert_eq!(fs::read(repaired.artifact_path).unwrap(), expected);
}
