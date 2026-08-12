import Anthropic from "@anthropic-ai/sdk";

export type LlmState = "healthy" | "degraded" | "unavailable";

export const LLM_CONFIG = Object.freeze({
  provider: "anthropic" as const,
  apiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
  model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6",
  chatMaxTokens: 4096,
  briefMaxTokens: 200,
  maxToolIterations: 5,
});

export const anthropicClient = LLM_CONFIG.apiKey
  ? new Anthropic({ apiKey: LLM_CONFIG.apiKey })
  : null;

export interface LlmStatus {
  state: LlmState;
  provider: "anthropic";
  model: string;
  fallback: "rule-based";
  reason?: string;
}

export class LlmStateTracker {
  private state: LlmState;
  private degradedReason: string | null = null;

  constructor(private readonly configured: boolean) {
    this.state = configured ? "healthy" : "unavailable";
  }

  healthy(): void {
    if (!this.configured) return;
    this.state = "healthy";
    this.degradedReason = null;
  }

  degraded(reason: string): void {
    if (!this.configured) return;
    this.state = "degraded";
    this.degradedReason = reason;
  }

  status(): LlmStatus {
    return {
      state: this.state,
      provider: LLM_CONFIG.provider,
      model: LLM_CONFIG.model,
      fallback: "rule-based",
      ...(this.degradedReason ? { reason: this.degradedReason } : {}),
    };
  }
}

const tracker = new LlmStateTracker(Boolean(anthropicClient));

export function markLlmHealthy(): void {
  tracker.healthy();
}

export function markLlmDegraded(reason: string): void {
  tracker.degraded(reason);
}

export function getLlmStatus(): LlmStatus {
  return tracker.status();
}
