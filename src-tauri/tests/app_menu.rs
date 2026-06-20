//! Kerminal 原生应用菜单测试。
//!
//! @author kongweiguang

use std::collections::HashSet;

use kerminal_lib::app_menu::{
    native_menu_actions, NativeMenuAction, NativeMenuActionPayload, MAIN_WINDOW_LABEL,
    NATIVE_MENU_ACTION_EVENT,
};

#[test]
fn native_menu_action_ids_are_stable_and_unique() {
    let actions = native_menu_actions();
    let action_ids: HashSet<_> = actions.iter().map(|action| action.action_id()).collect();
    let menu_ids: HashSet<_> = actions.iter().map(|action| action.menu_id()).collect();

    assert_eq!(actions.len(), 12);
    assert_eq!(action_ids.len(), actions.len());
    assert_eq!(menu_ids.len(), actions.len());
    assert!(action_ids.contains("newTerminal"));
    assert!(action_ids.contains("closeTab"));
    assert!(action_ids.contains("openSettings"));
    assert!(menu_ids.iter().all(|id| id.starts_with("kerminal:")));
}

#[test]
fn native_menu_action_round_trips_from_menu_id() {
    for action in native_menu_actions() {
        assert_eq!(
            NativeMenuAction::from_menu_id(action.menu_id()),
            Some(*action)
        );
    }

    assert_eq!(NativeMenuAction::from_menu_id("copy"), None);
    assert_eq!(NativeMenuAction::from_menu_id("kerminal:unknown"), None);
}

#[test]
fn native_menu_payload_uses_frontend_action_id() {
    let payload = NativeMenuActionPayload::from(NativeMenuAction::SplitHorizontal);

    assert_eq!(payload.action, "splitHorizontal");
    assert_eq!(NATIVE_MENU_ACTION_EVENT, "kerminal://native-menu-action");
    assert_eq!(MAIN_WINDOW_LABEL, "main");
}
