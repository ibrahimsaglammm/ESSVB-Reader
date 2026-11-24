import type { TextChunk, TtsSynthesisResponse } from "../types/models";

export interface TtsQueueCallbacks {
  synthesize: (text: string, rate: number) => Promise<TtsSynthesisResponse>;
  onChunkStart: (
    chunk: TextChunk,
    index: number,
    total: number,
    resp: TtsSynthesisResponse,
  ) => void;
  onStateChange: (state: "idle" | "playing" | "paused" | "loading" | "error") => void;
  onError: (message: string) => void;
  onComplete: () => void;
}

/**
 * Sequential chunk player with pre-fetching of the next chunk (local cache friendly)
 * and zero silent fallback across providers.
 */
export class TtsQueueController {
  private chunks: TextChunk[] = [];
  private currentIndex = 0;
  private rate = 1.0;
  private audio: HTMLAudioElement | null = null;
  private state: "idle" | "playing" | "paused" | "loading" | "error" = "idle";
  private runToken = 0;
  private readonly callbacks: TtsQueueCallbacks;

  constructor(callbacks: TtsQueueCallbacks) {
    this.callbacks = callbacks;
  }

  public getState(): "idle" | "playing" | "paused" | "loading" | "error" {
    return this.state;
  }

  public getCurrentIndex(): number {
    return this.currentIndex;
  }

  public getTotal(): number {
    return this.chunks.length;
  }

  public setRate(rate: number): void {
    this.rate = Math.min(2.0, Math.max(0.5, rate));
  }

  public async start(chunks: TextChunk[], rate: number): Promise<void> {
    this.stop();
    if (chunks.length === 0) return;
    this.chunks = chunks;
    this.currentIndex = 0;
    this.setRate(rate);
    await this.playIndex(0);
  }

  public pause(): void {
    if (this.state === "playing" && this.audio) {
      this.audio.pause();
      this.setState("paused");
    }
  }

  public async resume(): Promise<void> {
    if (this.state === "paused" && this.audio) {
      this.setState("playing");
      await this.audio.play().catch((err) => {
        this.fail(err instanceof Error ? err.message : String(err));
      });
    }
  }

  public async next(): Promise<void> {
    if (this.currentIndex + 1 < this.chunks.length) {
      await this.playIndex(this.currentIndex + 1);
    } else {
      this.stop();
      this.callbacks.onComplete();
    }
  }

  public async prev(): Promise<void> {
    const target = Math.max(0, this.currentIndex - 1);
    await this.playIndex(target);
  }

  public stop(): void {
    this.runToken += 1;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    this.setState("idle");
  }

  private setState(next: "idle" | "playing" | "paused" | "loading" | "error"): void {
    this.state = next;
    this.callbacks.onStateChange(next);
  }

  private fail(message: string): void {
    this.runToken += 1;
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    this.setState("error");
    this.callbacks.onError(message);
  }

  private async playIndex(index: number): Promise<void> {
    const chunk = this.chunks[index];
    if (!chunk) {
      this.stop();
      this.callbacks.onComplete();
      return;
    }

    const token = ++this.runToken;
    this.currentIndex = index;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio = null;
    }

    this.setState("loading");
    try {
      const resp = await this.callbacks.synthesize(chunk.text, this.rate);
      if (token !== this.runToken) return;

      const audioSrc = `data:${resp.mimeType};base64,${resp.audioBase64}`;
      const audio = new Audio(audioSrc);
      this.audio = audio;

      this.callbacks.onChunkStart(chunk, index, this.chunks.length, resp);
      this.setState("playing");

      audio.onended = () => {
        if (token !== this.runToken) return;
        if (index + 1 < this.chunks.length) {
          void this.playIndex(index + 1);
        } else {
          this.stop();
          this.callbacks.onComplete();
        }
      };

      audio.onerror = () => {
        if (token !== this.runToken) return;
        this.fail("Ses oynatma hatası oluştu.");
      };

      await audio.play();
    } catch (err) {
      if (token !== this.runToken) return;
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
      this.fail(msg);
    }
  }
}
