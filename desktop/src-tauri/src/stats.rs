//! CPU and memory readings for the system meter widget.

use serde::Serialize;
use std::sync::Mutex;
use sysinfo::System;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Sample {
    /// 0-100 across all cores.
    pub cpu: f32,
    /// 0-100 of physical memory in use.
    pub ram: f32,
}

/// Holds one `System` between calls: CPU usage is measured as the change since the last call.
pub struct Stats(Mutex<System>);

impl Stats {
    pub fn new() -> Self {
        let mut system = System::new();
        system.refresh_cpu();
        system.refresh_memory();
        Stats(Mutex::new(system))
    }

    pub fn sample(&self) -> Sample {
        let mut system = self.0.lock().unwrap_or_else(|e| e.into_inner());
        system.refresh_cpu();
        system.refresh_memory();
        let total = system.total_memory().max(1) as f32;
        Sample {
            cpu: system.global_cpu_info().cpu_usage().clamp(0.0, 100.0),
            ram: (system.used_memory() as f32 / total * 100.0).clamp(0.0, 100.0),
        }
    }
}
