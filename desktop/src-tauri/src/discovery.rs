//! Finds phones on the local network by their mDNS (Bonjour) announcement.

use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;
use std::net::IpAddr;
use std::time::{Duration, Instant};

/// Must match `MDNS_SERVICE` in core/src/protocol.ts and the Android app.
const SERVICE: &str = "_matrixbridge._tcp.local.";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Found {
    pub name: String,
    pub host: String,
    pub port: u16,
}

/// Listens for `wait` and returns every phone that answered.
pub fn discover(wait: Duration) -> Result<Vec<Found>, String> {
    let daemon = ServiceDaemon::new().map_err(|e| format!("mDNS unavailable: {e}"))?;
    let receiver = daemon.browse(SERVICE).map_err(|e| format!("mDNS browse failed: {e}"))?;
    let deadline = Instant::now() + wait;
    let mut found: Vec<Found> = Vec::new();

    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        let Ok(event) = receiver.recv_timeout(left) else { break };
        if let ServiceEvent::ServiceResolved(info) = event {
            // Prefer IPv4: it is what people recognise and what hostel routers handle best.
            let mut addresses: Vec<IpAddr> = info.get_addresses().iter().copied().collect();
            addresses.sort_by_key(|a| !a.is_ipv4());
            let Some(address) = addresses.first() else { continue };
            let name = info
                .get_fullname()
                .trim_end_matches(SERVICE)
                .trim_end_matches('.')
                .to_string();
            let item = Found { name, host: address.to_string(), port: info.get_port() };
            if !found.contains(&item) {
                found.push(item);
            }
        }
    }
    let _ = daemon.shutdown();
    Ok(found)
}
