import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { chip } from "@/components/staff/field-styles";

/**
 * Speak instead of typing: a button beside a notes box that writes what the rep says into it.
 * It uses the browser's own speech recognition (Chrome, Edge and Safari, on a computer or a phone),
 * so there's no recording, no upload and nothing to pay for. In a browser without it the button
 * doesn't show. Each finished phrase goes to onPhrase; the words still being heard show under the
 * button until they're final.
 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Allow the microphone for getlamp.app in your browser, then try again.",
  "service-not-allowed": "Allow the microphone for getlamp.app in your browser, then try again.",
  "audio-capture": "No microphone found.",
  network: "Speech needs an internet connection. Type it instead.",
};

export function SpeakButton({
  onPhrase,
  disabled = false,
  className,
}: {
  onPhrase: (text: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  // decided after the first render, so the server's page and the browser's match
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState("");
  const rec = useRef<Recognition | null>(null);
  const phrase = useRef(onPhrase);
  phrase.current = onPhrase;

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
    return () => rec.current?.abort();
  }, []);

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor || listening) return;
    setError("");
    setHeard("");
    const r = new Ctor();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const text = res[0].transcript;
        if (res.isFinal) phrase.current(text);
        else pending += text;
      }
      setHeard(pending.trim());
    };
    r.onerror = (e) => {
      // "no-speech" and "aborted" just end the session; the others need telling
      if (ERRORS[e.error]) setError(ERRORS[e.error]!);
    };
    r.onend = () => {
      setListening(false);
      setHeard("");
      rec.current = null;
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      setError("Couldn't start the microphone. Try again.");
    }
  }

  if (!supported) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-speak>
      <button
        type="button"
        className={cn(chip, "px-3 py-1.5", listening && "bg-ink text-white ring-ink")}
        disabled={disabled && !listening}
        aria-pressed={listening}
        onClick={() => (listening ? rec.current?.stop() : start())}
        data-speak-button
      >
        {listening ? <Square className="size-3.5" /> : <Mic className="size-3.5" />}
        {listening ? "Stop" : "Speak"}
      </button>
      {listening && (
        <span className="min-w-0 flex-1 truncate text-xs text-smoke" aria-live="polite">
          {heard ? heard : "Listening… talk, then tap Stop."}
        </span>
      )}
      {error && !listening && (
        <span className="text-xs text-destructive" role="status">
          {error}
        </span>
      )}
    </div>
  );
}
