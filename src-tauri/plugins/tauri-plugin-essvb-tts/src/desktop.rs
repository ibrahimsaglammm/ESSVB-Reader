use std::marker::PhantomData;

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::{MobileTtsInfo, NowPlayingRequest, SpeakChunkRequest, SpeakChunkResponse};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<EssvbTts<R>> {
    Ok(EssvbTts(PhantomData))
}

pub struct EssvbTts<R: Runtime>(PhantomData<fn() -> R>);

impl<R: Runtime> EssvbTts<R> {
    pub fn get_info(&self) -> crate::Result<MobileTtsInfo> {
        Ok(MobileTtsInfo {
            available: false,
            voice_name: String::new(),
            platform: std::env::consts::OS.to_string(),
        })
    }

    pub fn speak_chunk(&self, _payload: SpeakChunkRequest) -> crate::Result<SpeakChunkResponse> {
        Err(crate::Error::Message(
            "Yerel mobil TTS yalnızca Android ve iOS/iPadOS hedeflerinde kullanılır.".to_string(),
        ))
    }

    pub fn pause(&self) -> crate::Result<()> {
        Ok(())
    }

    pub fn resume(&self) -> crate::Result<()> {
        Ok(())
    }

    pub fn stop(&self) -> crate::Result<()> {
        Ok(())
    }

    pub fn update_now_playing(&self, _payload: NowPlayingRequest) -> crate::Result<()> {
        Ok(())
    }
}
