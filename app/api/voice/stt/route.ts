import { err, json, withUser } from "@/lib/http";
import { elevenLabsConfigured, speechToText } from "@/lib/voice";

export const maxDuration = 60;
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  return withUser(async () => {
    if (!elevenLabsConfigured()) return err("ElevenLabs is not configured", 501);
    const form = await req.formData().catch(() => null);
    const audio = form?.get("audio");
    if (!(audio instanceof Blob) || !audio.size) return err("No audio received.");
    if (audio.size > MAX_BYTES) return err("That clip is too long. Keep it under 30 seconds.");
    return json({ text: await speechToText(audio) });
  });
}
