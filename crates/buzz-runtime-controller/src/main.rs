use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use buzz_runtime_controller::config::ControllerConfig;
use buzz_runtime_controller::controller::{run_relay_loop, Controller};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("failed to install rustls crypto provider"))?;
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .json()
        .init();
    let path = std::env::var_os("BUZZ_RUNTIME_CONTROLLER_CONFIG")
        .map(PathBuf::from)
        .context("BUZZ_RUNTIME_CONTROLLER_CONFIG is required")?;
    let json = std::fs::read_to_string(&path)
        .with_context(|| format!("read controller configuration at {}", path.display()))?;
    let config = ControllerConfig::from_json(&json).context("validate controller configuration")?;
    if std::env::args().nth(1).as_deref() == Some("--check-config") {
        info!("runtime controller configuration is valid");
        return Ok(());
    }
    let mut controller = Controller::open(config).context("open controller state")?;
    let ready = Arc::new(AtomicBool::new(false));
    let health_addr = std::env::var("BUZZ_RUNTIME_CONTROLLER_HEALTH_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8081".to_owned());
    tokio::spawn(serve_health(health_addr, Arc::clone(&ready)));

    loop {
        ready.store(false, Ordering::Release);
        match run_relay_loop(&mut controller, &ready).await {
            Ok(()) => info!("runtime controller relay loop ended"),
            Err(error) => error!(error = %error, "runtime controller disconnected"),
        }
        ready.store(false, Ordering::Release);
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

async fn serve_health(address: String, ready: Arc<AtomicBool>) {
    let listener = match TcpListener::bind(&address).await {
        Ok(listener) => listener,
        Err(error) => {
            error!(error = %error, "runtime controller health listener failed");
            return;
        }
    };
    loop {
        let Ok((mut stream, _peer)) = listener.accept().await else {
            continue;
        };
        let is_ready = ready.load(Ordering::Acquire);
        tokio::spawn(async move {
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).await;
            let (status, body) = if is_ready {
                ("200 OK", "ready")
            } else {
                ("503 Service Unavailable", "not ready")
            };
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.shutdown().await;
        });
    }
}
