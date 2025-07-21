export async function fetchTradingSignal(prompt: string, apiKey: string): Promise<string> {
  const createErrorResponse = (reason: string) => JSON.stringify({
    decision: "hold",
    reasoning: reason,
    tokenIn: "STABLECOIN",
    tokenOut: "VOLATILE",
    amount: "0",
    slippage: 0.5,
    confidence: "medium",
    stopLoss: 0,
    takeProfit: 0
  });

  if (!apiKey) throw new Error("VENICE_API_KEY not set");

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
        max_tokens: 8192,
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || "";

    try {
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch (jsonError) {
        // Fallback extraction for malformed JSON
        const startIdx = content.indexOf('{');
        const endIdx = content.lastIndexOf('}');
        if (startIdx !== -1 && endIdx > startIdx) {
          parsed = JSON.parse(content.substring(startIdx, endIdx + 1));
        } else {
          throw new Error("Could not parse JSON");
        }
      }
      
      // Sanitize tokens
      const tokenIn = sanitizeToken(parsed.tokenIn);
      const tokenOut = sanitizeToken(parsed.tokenOut);
      
      // Validate required fields
      if (!['buy', 'sell', 'hold'].includes(parsed.decision?.toLowerCase())) {
        throw new Error("Missing or invalid decision field");
      }
      
      // Handle SL/TP with fallbacks
      const stopLoss = parseFloat(parsed.stopLoss) || 0;
      const takeProfit = parseFloat(parsed.takeProfit) || 0;
      
      return JSON.stringify({
        decision: parsed.decision.toLowerCase(),
        tokenIn,
        tokenOut,
        amount: parsed.amount ? String(parsed.amount) : "0",
        slippage: parsed.slippage ? parseFloat(parsed.slippage) : 0.5,
        reasoning: parsed.reasoning || "No reasoning provided",
        confidence: parsed.confidence ? String(parsed.confidence).toLowerCase() : "medium",
        stopLoss,
        takeProfit
      });

    } catch (jsonError) {
      return createErrorResponse("Invalid response format: " + (jsonError as Error).message);
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return createErrorResponse(`API error: ${errorMessage}`);
  }
}

function sanitizeToken(token: any): string {
  if (typeof token !== 'string') return "STABLECOIN";
  
  const cleanToken = token.trim().toUpperCase();
  
  // Direct token match
  if (cleanToken === "STABLECOIN" || cleanToken === "VOLATILE") {
    return cleanToken;
  }
  
  // Pattern-based matching
  if (/(usdt|usdc|dai|stable)/i.test(cleanToken)) return "STABLECOIN";
  if (/(eth|btc|volatile|crypto)/i.test(cleanToken)) return "VOLATILE";
  
  return "STABLECOIN";
}