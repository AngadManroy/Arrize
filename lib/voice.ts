// Voice for the coach: ElevenLabs speech-to-text and text-to-speech, server-side so the key stays here.
// Without ELEVENLABS_API_KEY the browser does both itself (Web Speech API), so voice still works.
const EL = "https://api.elevenlabs.io/v1";
const TIMEOUT_MS = 30_000;

export const elevenLabsConfigured = () => !!process.env.ELEVENLABS_API_KEY;
const key = () => (process.env.ELEVENLABS_API_KEY ?? "").trim();

async function fail(res: Response, what: string): Promise<never> {
  const text = await res.text().catch(() => "");
  throw new Error(`ElevenLabs ${what} → HTTP ${res.status}: ${text.slice(0, 200)}`);
}

/** Turns coach text into speech. Returns the MP3 as a stream so playback can start early. */
export async function textToSpeech(text: string): Promise<ReadableStream<Uint8Array>> {
  const voice = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const res = await fetch(`${EL}/text-to-speech/${voice}/stream?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok || !res.body) return fail(res, "text-to-speech");
  return res.body;
}

/** Transcribes one recorded clip from the learner. */
export async function speechToText(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v1");
  form.append("file", audio, "speech.webm");
  const res = await fetch(`${EL}/speech-to-text`, { method: "POST", headers: { "xi-api-key": key() }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return fail(res, "speech-to-text");
  const data: any = await res.json();
  return String(data.text ?? "").trim();
}

/** Coach replies can carry light markdown; speak only the words. */
export function speakable(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*•]\s+/gm, "").replace(/\s+/g, " ").trim().slice(0, 2500);
}
