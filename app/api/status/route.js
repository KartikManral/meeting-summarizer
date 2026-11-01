import { pickProvider } from "@/lib/providers";

// Tells the UI which features are configured, without revealing any keys.
export async function GET() {
  return Response.json({
    passwordRequired: Boolean(process.env.APP_PASSWORD),
    audio: Boolean(process.env.GROQ_API_KEY),
    summaries: Boolean(pickProvider()),
    provider: pickProvider(),
  });
}
