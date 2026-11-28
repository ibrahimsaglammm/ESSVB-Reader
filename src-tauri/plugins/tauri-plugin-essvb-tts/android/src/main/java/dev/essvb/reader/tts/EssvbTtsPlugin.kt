package dev.essvb.reader.tts

import android.app.Activity
import android.media.AudioAttributes
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

@InvokeArg
class SpeakChunkArgs {
    var text: String = ""
    var rate: Float = 1.0f
    var lang: String = "tr"
}

@InvokeArg
class NowPlayingArgs {
    var title: String = ""
    var author: String = ""
    var chapter: String = ""
    var playing: Boolean = false
}

@TauriPlugin
class EssvbTtsPlugin(private val activity: Activity) : Plugin(activity) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val pendingInvoke = AtomicReference<Invoke?>(null)
    private val ttsReady = AtomicBoolean(false)
    private var initLatch = CountDownLatch(1)

    @Volatile
    private var tts: TextToSpeech? = null

    @Volatile
    private var activeVoiceLabel: String = "Android TTS (Türkçe)"

    @Volatile
    private var mediaSession: MediaSessionCompat? = null

    private fun resolvePendingAsStopped() {
        val prev = pendingInvoke.getAndSet(null) ?: return
        val res = JSObject()
        res.put("status", "stopped")
        res.put("voiceName", activeVoiceLabel)
        prev.resolve(res)
    }

    private fun pickTurkishOfflineVoice(engine: TextToSpeech, langTag: String): Voice? {
        val voices = runCatching { engine.voices }.getOrNull() ?: return null
        val targetPrefix = if (langTag.lowercase(Locale.ROOT).startsWith("en")) "en" else "tr"
        return voices
            .filter { v ->
                !v.isNetworkConnectionRequired &&
                    v.locale.language.equals(targetPrefix, ignoreCase = true)
            }
            .sortedByDescending { v ->
                val trCountry = v.locale.country.equals("TR", ignoreCase = true)
                (if (trCountry) 100 else 0) + v.quality
            }
            .firstOrNull()
    }

    private fun ensureInitialized(langTag: String): TextToSpeech? {
        tts?.let { existing ->
            if (ttsReady.get()) return existing
        }

        synchronized(this) {
            if (tts != null && ttsReady.get()) return tts
            initLatch = CountDownLatch(1)
            val created = AtomicReference<TextToSpeech?>(null)
            mainHandler.post {
                val engine = TextToSpeech(activity.applicationContext) { status ->
                    if (status == TextToSpeech.SUCCESS) {
                        val instance = created.get()
                        if (instance != null) {
                            instance.setAudioAttributes(
                                AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_MEDIA)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                    .build()
                            )
                            val trLocale = Locale("tr", "TR")
                            val langRes = instance.setLanguage(trLocale)
                            if (langRes != TextToSpeech.LANG_MISSING_DATA &&
                                langRes != TextToSpeech.LANG_NOT_SUPPORTED
                            ) {
                                activeVoiceLabel = "Android TTS (Türkçe)"
                            } else {
                                activeVoiceLabel = "Android TTS (${Locale.getDefault().displayLanguage})"
                            }
                            pickTurkishOfflineVoice(instance, langTag)?.let { offlineVoice ->
                                instance.voice = offlineVoice
                                activeVoiceLabel = "Android Offline (${offlineVoice.locale.toLanguageTag()})"
                            }
                            instance.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                                override fun onStart(utteranceId: String?) {}

                                override fun onDone(utteranceId: String?) {
                                    val inv = pendingInvoke.getAndSet(null) ?: return
                                    val res = JSObject()
                                    res.put("status", "done")
                                    res.put("voiceName", activeVoiceLabel)
                                    inv.resolve(res)
                                }

                                override fun onStop(utteranceId: String?, interrupted: Boolean) {
                                    resolvePendingAsStopped()
                                }

                                @Deprecated("Deprecated in Android API 21")
                                override fun onError(utteranceId: String?) {
                                    val inv = pendingInvoke.getAndSet(null) ?: return
                                    inv.reject("Android TTS seslendirme hatası")
                                }

                                override fun onError(utteranceId: String?, errorCode: Int) {
                                    val inv = pendingInvoke.getAndSet(null) ?: return
                                    inv.reject("Android TTS hatası (kod: $errorCode)")
                                }
                            })
                            ttsReady.set(true)
                        }
                    }
                    initLatch.countDown()
                }
                created.set(engine)
                tts = engine
            }
        }

        initLatch.await(4, TimeUnit.SECONDS)
        return if (ttsReady.get()) tts else null
    }

    @Command
    fun get_info(invoke: Invoke) {
        val engine = ensureInitialized("tr")
        val res = JSObject()
        res.put("available", engine != null)
        res.put("voiceName", if (engine != null) activeVoiceLabel else "")
        res.put("platform", "android")
        invoke.resolve(res)
    }

    @Command
    fun speak_chunk(invoke: Invoke) {
        val args = invoke.parseArgs(SpeakChunkArgs::class.java)
        val trimmed = args.text.trim()
        if (trimmed.isEmpty()) {
            val res = JSObject()
            res.put("status", "done")
            res.put("voiceName", activeVoiceLabel)
            invoke.resolve(res)
            return
        }

        val engine = ensureInitialized(args.lang)
        if (engine == null) {
            invoke.reject("Android yerel Türkçe TTS motoru başlatılamadı")
            return
        }

        resolvePendingAsStopped()
        pendingInvoke.set(invoke)

        val safeRate = args.rate.coerceIn(0.5f, 2.0f)
        val utteranceId = "essvb-${System.currentTimeMillis()}"
        mainHandler.post {
            pickTurkishOfflineVoice(engine, args.lang)?.let { engine.voice = it }
            engine.setSpeechRate(safeRate)
            val params = Bundle()
            params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, android.media.AudioManager.STREAM_MUSIC)
            val rc = engine.speak(trimmed, TextToSpeech.QUEUE_FLUSH, params, utteranceId)
            if (rc != TextToSpeech.SUCCESS) {
                val inv = pendingInvoke.getAndSet(null)
                inv?.reject("Android TTS metni sıraya alamadı")
            }
        }
    }

    @Command
    fun pause(invoke: Invoke) {
        mainHandler.post {
            tts?.stop()
            resolvePendingAsStopped()
        }
        invoke.resolve()
    }

    @Command
    fun resume(invoke: Invoke) {
        invoke.resolve()
    }

    @Command
    fun stop(invoke: Invoke) {
        mainHandler.post {
            tts?.stop()
            resolvePendingAsStopped()
        }
        invoke.resolve()
    }

    @Command
    fun update_now_playing(invoke: Invoke) {
        val args = invoke.parseArgs(NowPlayingArgs::class.java)
        mainHandler.post {
            val session = mediaSession ?: MediaSessionCompat(activity.applicationContext, "EssvbTts").also {
                mediaSession = it
            }
            val meta = MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, args.title.ifBlank { "ESSVB-Reader" })
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, args.author.ifBlank { "Sesli Okuma" })
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, args.chapter)
                .build()
            session.setMetadata(meta)
            val stateCode = if (args.playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
            val state = PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_STOP)
                .setState(stateCode, 0L, 1.0f)
                .build()
            session.setPlaybackState(state)
            session.isActive = args.playing
        }
        invoke.resolve()
    }
}
