/**
 * Minimal browser Web Speech API wrapper (SpeechRecognition for input,
 * speechSynthesis for output). These APIs aren't in the default DOM lib types,
 * so we declare just what we use. No keys, no backend — Chrome does it locally.
 */

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  0: RecognitionAlternative;
  isFinal: boolean;
}
interface RecognitionEvent {
  results: ArrayLike<RecognitionResult>;
}
export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const sttSupported = recognitionCtor() !== null;
export const ttsSupported =
  typeof window !== "undefined" && "speechSynthesis" in window;

export function createRecognition(): Recognition | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  return rec;
}

/** Speak text aloud, cancelling anything already playing. */
export function speak(text: string): void {
  if (!ttsSupported || !text.trim()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.03;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

export function cancelSpeech(): void {
  if (ttsSupported) window.speechSynthesis.cancel();
}
