use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use error::{Error, Result};
pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod error;
mod models;

#[cfg(desktop)]
use desktop::EssvbTts;
#[cfg(mobile)]
use mobile::EssvbTts;

pub trait EssvbTtsExt<R: Runtime> {
    fn essvb_tts(&self) -> &EssvbTts<R>;
}

impl<R: Runtime, T: Manager<R>> EssvbTtsExt<R> for T {
    fn essvb_tts(&self) -> &EssvbTts<R> {
        self.state::<EssvbTts<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("essvb-tts")
        .setup(|app, api| {
            #[cfg(mobile)]
            let tts = mobile::init(app, api)?;
            #[cfg(desktop)]
            let tts = desktop::init(app, api)?;
            app.manage(tts);
            Ok(())
        })
        .build()
}
