import { err, readJson, withUser } from "@/lib/http";
import { elevenLabsConfigured, speakable, textToSpeech } from "@/lib/voice";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await readJson(req);
  return withUser(async () => {
    if (!elevenLabsConfigured()) return err("ElevenLabs is not configured", 501);
    const text = speakable(String(body.text ?? ""));
    if (!text) return err("Nothing to say.");
    return new Response(await textToSpeech(text), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  });
}
