export async function fetchTradingSignal(prompt: string, apiKey: string): Promise<string> {
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  // Helper function for consistent error responses
  const createErrorResponse = (reason: string) => JSON.stringify({
    decision: "hold",
    reasoning: reason,
    tokenIn: ZERO_ADDRESS,
    tokenOut: ZERO_ADDRESS,
    amount: "0",
    slippage: 0
  });

  // Validate API key
  if (!apiKey) {
    throw new Error("VENICE_API_KEY not set in environment variables");
  }

  try {
    // Configure API request
    const apiUrl = "https://api.venice.ai/api/v1/chat/completions";
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "qwen3-4b",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 8192,
        response_format: { type: "json_object" }
      }),
    });

    // Handle HTTP errors
    if (!response.ok) {
      const errorBody = await response.text();
      const status = response.status;
      throw new Error(`Venice API error (${status}): ${errorBody}`);
    }

    // Process successful response
    const data = await response.json();
    const content = data.choices[0]?.message?.content || "";

    // Validate JSON structure
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === 'object' && parsed !== null) {
        return content;
      }
      return createErrorResponse("API returned non-object JSON");
    } catch (jsonError) {
      return createErrorResponse("API returned invalid JSON format");
    }

  } catch (error: unknown) {
    // Handle all possible errors
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error occurred";
    console.error("❌ Venice fetch error:", errorMessage);
    return createErrorResponse(`Network/API error: ${errorMessage}`);
  }
}