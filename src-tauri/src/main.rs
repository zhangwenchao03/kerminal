// Prevents an additional console window when Kerminal is launched by external tools.
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    kerminal_lib::run()
}
