// app/api/venice/route.ts
import { fetchTradingSignal } from "../../utils/venice"; // Adjust the import path as needed

export async function POST(req: Request) {
    try {
        const { prompt } = await req.json();

        if (!prompt || typeof prompt !== "string") {
            return new Response("Invalid prompt", { status: 400 });
        }

        const apiKey = process.env.VENICE_API_KEY;
        const signal = await fetchTradingSignal(prompt, apiKey!);
        return Response.json({ signal });

    } catch (err: any) {
        console.error("❌ Venice fetch error:", err.message || err);
        return new Response("Internal server error", { status: 500 });
    }
}
