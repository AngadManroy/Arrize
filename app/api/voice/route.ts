import { json, withUser } from "@/lib/http";
import { elevenLabsConfigured } from "@/lib/voice";

export async function GET() {
  return withUser(async () => json({ elevenlabs: elevenLabsConfigured() }));
}
