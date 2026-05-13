import OpenAI from "openai";

export function createOpenRouterClient(apiKey: string): OpenAI {
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
}

export function createClientPool(apiKeys: string[]): OpenAI[] {
  return apiKeys.map(key => createOpenRouterClient(key));
}

function sanitizeJsonResponse(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  }
  cleaned = cleaned.trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];
  return cleaned;
}

function isRetryable(error: any): boolean {
  if (!error) return true;
  if (error?.status === 429) return true;
  if (error?.status === 401 || error?.status === 403) return false;
  if (error?.status === 400) return false;
  const msg = (error?.message ?? "").toLowerCase();
  if (msg.includes("connection") || msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("timeout") || msg.includes("network") || msg.includes("fetch failed")) return true;
  return true;
}

function getBackoff(attempt: number): number {
  return Math.min(Math.pow(2, attempt) * 1000, 30000);
}

export type RetryCallback = (attempt: number, maxRetries: number, error: string) => void;

export async function chatCompletion(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  retries = 15,
  onRetry?: RetryCallback,
  maxTokens = 4096
): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
      });

      if (!response.choices || response.choices.length === 0) {
        throw new Error(`No choices in API response: ${JSON.stringify(response).slice(0, 500)}`);
      }
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("Empty response from LLM");
      return sanitizeJsonResponse(content);
    } catch (error: any) {
      const retryable = isRetryable(error);
      if (!retryable) throw error;

      if (attempt < retries) {
        const wait = getBackoff(attempt);
        onRetry?.(attempt, retries, error?.message ?? "Unknown error");
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

export async function chatWithImages(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  textPrompt: string,
  images: { base64: string; mimeType: string }[],
  retries = 5,
  onRetry?: RetryCallback
): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const imageContent = images.map((img) => ({
        type: "image_url" as const,
        image_url: {
          url: `data:${img.mimeType};base64,${img.base64}`,
        },
      }));

      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text" as const, text: textPrompt },
              ...imageContent,
            ],
          },
        ],
        temperature: 0.3,
      });

      if (!response.choices || response.choices.length === 0) {
        throw new Error(`No choices in API response: ${JSON.stringify(response).slice(0, 500)}`);
      }
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("Empty response from LLM");
      return sanitizeJsonResponse(content);
    } catch (error: any) {
      const retryable = isRetryable(error);
      if (!retryable) throw error;

      if (attempt < retries) {
        const wait = getBackoff(attempt);
        onRetry?.(attempt, retries, error?.message ?? "Unknown error");
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}
