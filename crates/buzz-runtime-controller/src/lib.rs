#![deny(unsafe_code)]

//! Durable reconciliation for owner-controlled hosted-agent runtime defaults.

pub mod audit;
pub mod config;
pub mod controller;
pub mod reconcile;
pub mod state_store;

pub use config::{AgentServiceMapping, ControllerConfig};
pub use controller::{Controller, ControllerEffect, RuntimeRequestContext};
pub use state_store::{AgentRuntimeState, ControllerState, StateStore};
