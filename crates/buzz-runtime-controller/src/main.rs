use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result};
use buzz_runtime_controller::config::ControllerConfig;
use buzz_runtime_controller::controller::{run_relay_loop, Controller};
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
    let mut controller = Controller::open(config).context("open controller state")?;

    loop {
        match run_relay_loop(&mut controller).await {
            Ok(()) => info!("runtime controller relay loop ended"),
            Err(error) => error!(error = %error, "runtime controller disconnected"),
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}
