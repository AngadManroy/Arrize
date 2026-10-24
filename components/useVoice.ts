"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Voice for the coach chat.
//   Listening: ElevenLabs speech-to-text when the server has a key (record → upload), else the
//              browser's SpeechRecognition (Chrome, Edge, Safari). Recording stops on a pause.
//   Speaking:  ElevenLabs text-to-speech, else the browser's speechSynthesis.

export type VoiceState = "idle" | "listening" | "transcribing";

const SILENCE_MS = 1400;
const MAX_RECORD_MS = 30_000;

function recognitionCtor(): any {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// One audio element for the page, created on first use; reusing it keeps the mobile unlock.
let player: HTMLAudioElement | null = null;
const getPlayer = () => (player ??= new Audio());

/** A tiny silent WAV, played inside a tap so iOS lets us play the reply later. */
function silentWav(): string {
  const n = 800;
  const buf = new DataView(new ArrayBuffer(44 + n));
  const str = (o: number, s: string) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); buf.setUint32(4, 36 + n, true); str(8, "WAVE"); str(12, "fmt ");
  buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, 8000, true); buf.setUint32(28, 8000, true); buf.setUint16(32, 1, true); buf.setUint16(34, 8, true);
  str(36, "data"); buf.setUint32(40, n, true);
  for (let i = 0; i < n; i++) buf.setUint8(44 + i, 128);
  let bin = "";
  new Uint8Array(buf.buffer).forEach((b) => (bin += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

export function useVoice({ onTranscript, onInterim, onError }: { onTranscript: (text: string) => void; onInterim?: (text: string) => void; onError: (msg: string) => void }) {
  const [elevenlabs, setElevenlabs] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [speaking, setSpeaking] = useState(false);
  const audioUrl = useRef<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const cb = useRef({ onTranscript, onInterim, onError });
  useEffect(() => { cb.current = { onTranscript, onInterim, onError }; });

  useEffect(() => {
    fetch("/api/voice", { cache: "no-store" })
      .then((r) => r.json())
      .then((r) => {
        const el = !!r.elevenlabs && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
        setElevenlabs(!!r.elevenlabs);
        setCanListen(el || !!recognitionCtor());
      })
      .catch(() => setCanListen(!!recognitionCtor()));
    return () => { stopRef.current?.(); };
  }, []);

  const stopSpeaking = useCallback(() => {
    player?.pause();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  /** Call inside a tap: unlocks audio playback on mobile browsers. */
  const unlock = useCallback(() => {
    const a = getPlayer();
    if (!a.src) {
      a.src = silentWav();
      a.play().catch(() => undefined);
    }
    if (typeof speechSynthesis !== "undefined" && !speechSynthesis.speaking) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  }, []);

  const browserSpeak = useCallback((text: string) => {
    if (typeof speechSynthesis === "undefined") return setSpeaking(false);
    const u = new SpeechSynthesisUtterance(text.replace(/\*\*/g, ""));
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => v.lang === "en-IN") ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
    u.rate = 1.02;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    speechSynthesis.speak(u);
  }, []);

  const speak = useCallback(async (text: string) => {
    stopSpeaking();
    if (!text.trim()) return;
    setSpeaking(true);
    if (elevenlabs) {
      try {
        const res = await fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const url = URL.createObjectURL(await res.blob());
        if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
        audioUrl.current = url;
        const a = getPlayer();
        a.src = url;
        a.onended = () => setSpeaking(false);
        a.onerror = () => setSpeaking(false);
        await a.play();
        return;
      } catch {
        // fall through to the browser voice
      }
    }
    browserSpeak(text);
  }, [elevenlabs, browserSpeak, stopSpeaking]);

  const listenElevenLabs = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setState("idle");
      return cb.current.onError("Microphone permission was denied.");
    }
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const started = Date.now();
    let heard = false;
    let quietSince = Date.now();
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += ((s - 128) / 128) ** 2;
      const loud = Math.sqrt(sum / samples.length) > 0.035;
      if (loud) { heard = true; quietSince = Date.now(); }
      if ((heard && Date.now() - quietSince > SILENCE_MS) || Date.now() - started > MAX_RECORD_MS) return stop();
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      if (rec.state !== "inactive") rec.stop();
    };
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => undefined);
      stopRef.current = null;
      if (!heard) { setState("idle"); return; }
      setState("transcribing");
      try {
        const form = new FormData();
        form.append("audio", new Blob(chunks, { type: rec.mimeType || "audio/webm" }), "speech.webm");
        const res = await fetch("/api/voice/stt", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (data.text) cb.current.onTranscript(data.text);
        else cb.current.onError("I didn't catch that. Try again?");
      } catch (e: any) {
        cb.current.onError(`Voice input failed: ${e.message}`);
      } finally {
        setState("idle");
      }
    };
    stopRef.current = stop;
    rec.start();
    setState("listening");
    raf = requestAnimationFrame(tick);
  }, []);

  const listenBrowser = useCallback(() => {
    const Ctor = recognitionCtor();
    const r = new Ctor();
    r.lang = "en-IN";
    r.interimResults = true;
    r.continuous = false;
    let final = "";
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      cb.current.onInterim?.((final + interim).trim());
    };
    r.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") cb.current.onError("Microphone permission was denied.");
      else if (e.error === "network") cb.current.onError("This browser can't reach its speech service (Brave, Arc and in-editor browsers block it). Use Chrome or Safari, or set ELEVENLABS_API_KEY on the server.");
      else if (e.error === "audio-capture") cb.current.onError("No microphone found.");
      else if (e.error !== "no-speech" && e.error !== "aborted") cb.current.onError(`Voice input failed: ${e.error}`);
    };
    r.onend = () => {
      stopRef.current = null;
      setState("idle");
      if (final.trim()) cb.current.onTranscript(final.trim());
    };
    stopRef.current = () => r.stop();
    r.start();
    setState("listening");
  }, []);

  /** Tap once to talk; tap again (or pause) to send. */
  const toggleListening = useCallback(() => {
    if (state === "listening") return stopRef.current?.();
    if (state !== "idle") return;
    unlock();
    stopSpeaking();
    if (elevenlabs && typeof MediaRecorder !== "undefined") listenElevenLabs();
    else if (recognitionCtor()) listenBrowser();
  }, [state, elevenlabs, unlock, stopSpeaking, listenElevenLabs, listenBrowser]);

  return { canListen, state, speaking, speak, stopSpeaking, unlock, toggleListening, engine: elevenlabs ? "ElevenLabs" : "browser" };
}
