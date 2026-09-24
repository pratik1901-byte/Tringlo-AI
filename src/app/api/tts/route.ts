import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/guard";

const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";

const BULBUL_V3_SPEAKERS = new Set([
    "aditya", "ritu", "ashutosh", "priya", "neha", "rahul", "pooja", "rohan",
    "simran", "kavya", "amit", "dev", "ishita", "shreya", "ratan", "varun",
    "manan", "sumit", "roopa", "kabir", "aayan", "shubh", "advait", "anand",
    "tanya", "tarun", "sunny", "mani", "gokul", "vijay", "shruti", "suhani",
    "mohit", "kavitha", "rehan", "soham", "rupali"
]);

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) {
        return Response.json(
            { error: "Sarvam API key not configured" },
            { status: 500 }
        );
    }

    let body: { text?: string; languageCode?: string; speaker?: string };
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { text, languageCode = "en-IN", speaker: requestedSpeaker = "priya" } = body;

    // Validate speaker against bulbul:v3 or fallback to priya
    const speaker = BULBUL_V3_SPEAKERS.has(requestedSpeaker.toLowerCase())
        ? requestedSpeaker.toLowerCase()
        : "priya";

    if (!text || text.trim().length === 0) {
        return Response.json({ error: "text is required" }, { status: 400 });
    }

    // Sarvam TTS supports up to 500 chars per request
    const truncatedText = text.slice(0, 500);

    try {
        const sarvamResponse = await fetch(SARVAM_TTS_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "api-subscription-key": apiKey,
            },
            body: JSON.stringify({
                inputs: [truncatedText],
                target_language_code: languageCode,
                speaker: speaker,
                pitch: 0,
                pace: 1.0,
                loudness: 1.5,
                speech_sample_rate: 22050,
                enable_preprocessing: true,
                model: "bulbul:v3",
            }),
        });

        if (!sarvamResponse.ok) {
            const errorText = await sarvamResponse.text();
            console.error("Sarvam TTS error:", sarvamResponse.status, errorText);
            return Response.json(
                { error: `Sarvam API error: ${sarvamResponse.status}`, details: errorText },
                { status: sarvamResponse.status }
            );
        }

        const data = await sarvamResponse.json();

        // Sarvam returns { request_id, audios: [base64String] }
        const audioBase64 = data.audios?.[0];
        if (!audioBase64) {
            return Response.json(
                { error: "No audio returned from Sarvam" },
                { status: 502 }
            );
        }

        return Response.json({
            audioBase64,
            requestId: data.request_id,
            languageCode,
            speaker,
        });
    } catch (err) {
        console.error("TTS route error:", err);
        return Response.json(
            { error: "Failed to call Sarvam TTS API" },
            { status: 500 }
        );
    }
}
