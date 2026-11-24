import { describe, expect, it, vi, beforeEach } from "vitest";
import { TtsQueueController } from "./ttsQueue";
import type { TextChunk, TtsSynthesisResponse } from "../types/models";

class MockAudio {
  public src = "";
  public onended: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public paused = false;
  public static instances: MockAudio[] = [];

  constructor(src: string) {
    this.src = src;
    MockAudio.instances.push(this);
  }

  async play(): Promise<void> {
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }
}

describe("TtsQueueController", () => {
  beforeEach(() => {
    MockAudio.instances = [];
    vi.stubGlobal("Audio", MockAudio);
  });

  it("plays chunks sequentially and pauses/resumes/stops cleanly", async () => {
    const chunks: TextChunk[] = [
      { index: 0, text: "Birinci cümle.", startOffset: 0, endOffset: 14 },
      { index: 1, text: "İkinci cümle.", startOffset: 15, endOffset: 28 },
    ];
    const started: number[] = [];
    let completed = false;

    const synthesize = vi.fn(
      async (text: string): Promise<TtsSynthesisResponse> => ({
        audioBase64: "AAAA",
        mimeType: "audio/wav",
        providerId: "local",
        voiceName: "Microsoft Tolga",
        fromCache: false,
        preparedText: text,
      }),
    );

    const ctrl = new TtsQueueController({
      synthesize,
      onChunkStart: (_c, idx) => started.push(idx),
      onStateChange: () => {},
      onError: () => {},
      onComplete: () => {
        completed = true;
      },
    });

    await ctrl.start(chunks, 1.0);
    expect(ctrl.getState()).toBe("playing");
    expect(started).toEqual([0]);

    ctrl.pause();
    expect(ctrl.getState()).toBe("paused");
    await ctrl.resume();
    expect(ctrl.getState()).toBe("playing");

    // Simulate first chunk finishing
    MockAudio.instances[0]?.onended?.();
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toEqual([0, 1]);

    // Simulate second chunk finishing
    MockAudio.instances[1]?.onended?.();
    expect(completed).toBe(true);
    expect(ctrl.getState()).toBe("idle");
  });

  it("fails explicitly without silent fallback when synthesize throws", async () => {
    const chunks: TextChunk[] = [
      { index: 0, text: "Deneme metni.", startOffset: 0, endOffset: 13 },
    ];
    const errors: string[] = [];
    const synthesize = vi.fn(async () => {
      throw new Error("Ollama bağlantısı kurulamadı");
    });

    const ctrl = new TtsQueueController({
      synthesize,
      onChunkStart: () => {},
      onStateChange: () => {},
      onError: (msg) => errors.push(msg),
      onComplete: () => {},
    });

    await ctrl.start(chunks, 1.0);
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(ctrl.getState()).toBe("error");
    expect(errors[0]).toContain("Ollama");
  });
});
