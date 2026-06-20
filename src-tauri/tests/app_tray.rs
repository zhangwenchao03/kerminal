//! Kerminal 系统托盘测试。
//!
//! @author kongweiguang

use std::collections::HashSet;

use kerminal_lib::app_tray::{tray_menu_actions, TrayMenuAction, TRAY_ID};

#[test]
fn tray_menu_action_ids_are_stable_and_unique() {
    let actions = tray_menu_actions();
    let menu_ids: HashSet<_> = actions.iter().map(|action| action.menu_id()).collect();

    assert_eq!(TRAY_ID, "kerminal:tray");
    assert_eq!(actions.len(), 3);
    assert_eq!(menu_ids.len(), actions.len());
    assert!(menu_ids.contains("kerminal:tray:show"));
    assert!(menu_ids.contains("kerminal:tray:hide"));
    assert!(menu_ids.contains("kerminal:tray:quit"));
}

#[test]
fn tray_menu_action_round_trips_from_menu_id() {
    for action in tray_menu_actions() {
        assert_eq!(
            TrayMenuAction::from_menu_id(action.menu_id()),
            Some(*action)
        );
    }

    assert_eq!(TrayMenuAction::from_menu_id("kerminal:show"), None);
    assert_eq!(TrayMenuAction::from_menu_id("kerminal:tray:unknown"), None);
}
