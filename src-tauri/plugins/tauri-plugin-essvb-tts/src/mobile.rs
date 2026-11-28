use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::{MobileTtsInfo, NowPlayingRequest, SpeakChunkRequest, SpeakChunkResponse};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_essvb_tts);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<EssvbTts<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("dev.essvb.reader.tts", "EssvbTtsPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_essvb_tts)?;
    Ok(EssvbTts(handle))
}

pub struct EssvbTts<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> EssvbTts<R> {
    pub fn get_info(&self) -> crate::Result<MobileTtsInfo> {
        self.0.run_mobile_plugin("get_info", ()).map_err(Into::into)
    }

    pub fn speak_chunk(&self, payload: SpeakChunkRequest) -> crate::Result<SpeakChunkResponse> {
        self.0
            .run_mobile_plugin("speak_chunk", payload)
            .map_err(Into::into)
    }

    pub fn pause(&self) -> crate::Result<()> {
        self.0.run_mobile_plugin("pause", ()).map_err(Into::into)
    }

    pub fn resume(&self) -> crate::Result<()> {
        self.0.run_mobile_plugin("resume", ()).map_err(Into::into)
    }

    pub fn stop(&self) -> crate::Result<()> {
        self.0.run_mobile_plugin("stop", ()).map_err(Into::into)
    }

    pub fn update_now_playing(&self, payload: NowPlayingRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("update_now_playing", payload)
            .map_err(Into::into)
    }
}
