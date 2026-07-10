//! 主窗口离屏恢复策略集成测试。
//!
//! @author kongweiguang

use kerminal_lib::window_management::{
    resolve_window_placement, MainWindowStartupGate, MonitorWorkArea, WindowBounds,
    WindowPlacementDecision, WindowPosition,
};

const PRIMARY_MONITOR: MonitorWorkArea = MonitorWorkArea {
    x: 0,
    y: 0,
    width: 1920,
    height: 1040,
};

#[test]
fn keeps_normally_visible_window_position() {
    let window = WindowBounds {
        x: 120,
        y: 80,
        width: 1600,
        height: 960,
    };

    assert_eq!(
        resolve_window_placement(window, &[PRIMARY_MONITOR], Some(PRIMARY_MONITOR)),
        WindowPlacementDecision::Keep
    );
}

#[test]
fn keeps_partially_visible_window_when_title_bar_remains_operable() {
    let window = WindowBounds {
        x: 1760,
        y: 120,
        width: 1600,
        height: 960,
    };

    assert_eq!(
        resolve_window_placement(window, &[PRIMARY_MONITOR], Some(PRIMARY_MONITOR)),
        WindowPlacementDecision::Keep
    );
}

#[test]
fn keeps_visible_window_when_only_primary_monitor_is_reported() {
    let window = WindowBounds {
        x: 120,
        y: 80,
        width: 1600,
        height: 960,
    };

    assert_eq!(
        resolve_window_placement(window, &[], Some(PRIMARY_MONITOR)),
        WindowPlacementDecision::Keep
    );
}

#[test]
fn recenters_fully_offscreen_window_on_primary_monitor() {
    let window = WindowBounds {
        x: 2500,
        y: 1200,
        width: 1600,
        height: 960,
    };

    assert_eq!(
        resolve_window_placement(window, &[PRIMARY_MONITOR], Some(PRIMARY_MONITOR)),
        WindowPlacementDecision::MoveTo(WindowPosition { x: 160, y: 40 })
    );
}

#[test]
fn keeps_restored_position_when_no_monitor_is_reported() {
    let window = WindowBounds {
        x: 2500,
        y: 1200,
        width: 1600,
        height: 960,
    };

    assert_eq!(
        resolve_window_placement(window, &[], None),
        WindowPlacementDecision::Keep
    );
}

#[test]
fn startup_gate_waits_for_restore_and_page_load_in_either_order() {
    let page_first = MainWindowStartupGate::default();
    page_first.mark_page_ready();
    assert!(!page_first.try_claim_show(false));
    page_first.mark_placement_ready();
    assert!(page_first.try_claim_show(false));
    assert!(!page_first.try_claim_show(false));

    let restore_first = MainWindowStartupGate::default();
    restore_first.mark_placement_ready();
    assert!(!restore_first.try_claim_show(false));
    restore_first.mark_page_ready();
    assert!(restore_first.try_claim_show(false));
    restore_first.complete_show();
    assert!(restore_first.startup_completed());
}

#[test]
fn startup_gate_preserves_activation_across_a_failed_show_race() {
    let gate = MainWindowStartupGate::default();
    gate.mark_placement_ready();
    gate.request_activation();

    assert!(gate.try_claim_show(true));
    gate.mark_page_ready();
    assert!(!gate.try_claim_show(false));
    gate.release_show_claim();
    assert!(gate.activation_pending());
    assert!(gate.try_claim_show(false));

    gate.complete_show();
    assert!(gate.startup_completed());
    assert!(!gate.activation_pending());
}

#[test]
fn startup_gate_can_cancel_a_pending_activation() {
    let gate = MainWindowStartupGate::default();
    gate.request_activation();
    assert!(gate.activation_pending());

    gate.cancel_activation();
    assert!(!gate.activation_pending());
}
