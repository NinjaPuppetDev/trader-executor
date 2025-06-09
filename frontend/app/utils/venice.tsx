// utils/venice.ts

export async function fetchTradingSignal(prompt: string, apiKey: string): Promise<string> {
  if (!apiKey) {
    throw new Error("VENICE_API_KEY not set in .env");
  }

  try {
    const response = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "qwen3-4b",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Venice API error: ${response.status} ${errorBody}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    return content;

  } catch (err: any) {
    console.error("❌ Venice fetch error:", err.message || err);
    throw new Error("Failed to fetch signal from Venice");
  }
}
