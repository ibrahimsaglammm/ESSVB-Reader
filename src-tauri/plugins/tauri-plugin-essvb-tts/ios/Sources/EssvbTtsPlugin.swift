import AVFoundation
import Foundation
import MediaPlayer
import Tauri

private struct SpeakChunkArgs: Decodable {
  let text: String
  let rate: Float
  let lang: String
}

private struct NowPlayingArgs: Decodable {
  let title: String
  let author: String
  let chapter: String
  let playing: Bool
}

@objc public class EssvbTtsPlugin: Plugin, AVSpeechSynthesizerDelegate {
  private let synthesizer = AVSpeechSynthesizer()
  private let queue = DispatchQueue(label: "dev.essvb.reader.tts.serial")
  private var pendingInvoke: Invoke?
  private var currentVoiceName = "iOS AVSpeechSynthesizer (Türkçe)"

  public override init() {
    super.init()
    synthesizer.delegate = self
    configureAudioSession()
  }

  private func configureAudioSession() {
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(
      .playback,
      mode: .spokenAudio,
      options: [.allowBluetooth, .allowBluetoothA2DP]
    )
    try? session.setActive(true)
  }

  private func pickVoice(lang: String) -> AVSpeechSynthesisVoice? {
    let prefix = lang.lowercased().hasPrefix("en") ? "en" : "tr"
    let matching = AVSpeechSynthesisVoice.speechVoices().filter {
      $0.language.lowercased().hasPrefix(prefix)
    }
    if let best = matching.sorted(by: { lhs, rhs in
      lhs.quality.rawValue > rhs.quality.rawValue
    }).first {
      currentVoiceName = "iOS \(best.name) (\(best.language))"
      return best
    }
    return AVSpeechSynthesisVoice(language: prefix == "en" ? "en-US" : "tr-TR")
  }

  private func finishPending(status: String) {
    var toResolve: Invoke?
    queue.sync {
      toResolve = pendingInvoke
      pendingInvoke = nil
    }
    toResolve?.resolve([
      "status": status,
      "voiceName": currentVoiceName,
    ])
  }

  @objc public func get_info(_ invoke: Invoke) {
    _ = pickVoice(lang: "tr")
    invoke.resolve([
      "available": true,
      "voiceName": currentVoiceName,
      "platform": "ios",
    ])
  }

  @objc public func speak_chunk(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SpeakChunkArgs.self)
      let trimmed = args.text.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.isEmpty {
        invoke.resolve([
          "status": "done",
          "voiceName": currentVoiceName,
        ])
        return
      }

      configureAudioSession()
      finishPending(status: "stopped")
      if synthesizer.isSpeaking {
        synthesizer.stopSpeaking(at: .immediate)
      }

      queue.sync {
        pendingInvoke = invoke
      }

      let utterance = AVSpeechUtterance(string: trimmed)
      utterance.voice = pickVoice(lang: args.lang)
      let clampedRate = min(max(args.rate, 0.5), 2.0)
      let mappedRate = AVSpeechUtteranceDefaultSpeechRate * clampedRate
      utterance.rate = min(
        max(mappedRate, AVSpeechUtteranceMinimumSpeechRate),
        AVSpeechUtteranceMaximumSpeechRate
      )
      synthesizer.speak(utterance)
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  @objc public func pause(_ invoke: Invoke) {
    if synthesizer.isSpeaking {
      synthesizer.pauseSpeaking(at: .word)
    }
    invoke.resolve()
  }

  @objc public func resume(_ invoke: Invoke) {
    if synthesizer.isPaused {
      synthesizer.continueSpeaking()
    }
    invoke.resolve()
  }

  @objc public func stop(_ invoke: Invoke) {
    if synthesizer.isSpeaking || synthesizer.isPaused {
      synthesizer.stopSpeaking(at: .immediate)
    }
    finishPending(status: "stopped")
    invoke.resolve()
  }

  @objc public func update_now_playing(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(NowPlayingArgs.self)
      var info: [String: Any] = [
        MPMediaItemPropertyTitle: args.title.isEmpty ? "ESSVB-Reader" : args.title,
        MPMediaItemPropertyArtist: args.author.isEmpty ? "Sesli Okuma" : args.author,
        MPNowPlayingInfoPropertyPlaybackRate: args.playing ? 1.0 : 0.0,
      ]
      if !args.chapter.isEmpty {
        info[MPMediaItemPropertyAlbumTitle] = args.chapter
      }
      MPNowPlayingInfoCenter.default().nowPlayingInfo = info
      invoke.resolve()
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  public func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didFinish utterance: AVSpeechUtterance
  ) {
    finishPending(status: "done")
  }

  public func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didCancel utterance: AVSpeechUtterance
  ) {
    finishPending(status: "stopped")
  }
}

@_cdecl("init_plugin_essvb_tts")
func initPlugin() -> Plugin {
  return EssvbTtsPlugin()
}
