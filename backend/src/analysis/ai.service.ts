import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// The subset of Ollama's /api/generate response we care about.
// `response` is the model's generated text; `done` signals completion.
interface OllamaGenerateResponse {
  response: string;
  done: boolean;
}

// A single turn in a chat conversation, in Ollama's /api/chat shape.
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// The subset of Ollama's /api/chat response we care about: the reply lives
// under `message`, not the top-level `response` that /api/generate uses.
interface OllamaChatResponse {
  message: { role: string; content: string };
}

// The structured shape we ask the model to return and persist as the
// analysis `result` (stored as a JSON string in the text column). The
// frontend renders each finding as a colored card plus the complexity tiles.
type FindingType = 'bug' | 'improvement' | 'good';

interface Finding {
  type: FindingType;
  // 1-based source line the finding refers to, or null when not line-specific.
  line: number | null;
  // Short headline for the finding (e.g. "Off-by-one error").
  title: string;
  message: string;
  // A suggested replacement / fix snippet, or null when not applicable.
  fix: string | null;
}

interface StructuredAnalysis {
  // A 1-2 sentence plain-language overview of the review.
  summary: string;
  findings: Finding[];
  complexity: { time: string; space: string };
}

/**
 * Wraps the call to the local AI model (Ollama).
 *
 * The processor uses this to turn submitted code into a written review.
 * Isolating the AI call here means the rest of the app doesn't care which
 * provider/model is used — swapping Ollama for Gemini later only touches
 * this file.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  // Where Ollama is reachable, e.g. http://localhost:11434.
  private readonly baseUrl: string;
  // Which model to run, e.g. qwen2.5-coder:7b.
  private readonly model: string;

  constructor(config: ConfigService) {
    // Read connection details from .env (via ConfigService). The second
    // argument to get() is a fallback used when the var isn't set.
    this.baseUrl = config.get<string>('OLLAMA_URL', 'http://localhost:11434');
    this.model = config.get<string>('OLLAMA_MODEL', 'qwen2.5-coder:7b');
  }

  // Sends the code to the model and returns a structured analysis serialized
  // as a JSON string (findings + complexity). This is the slow call (tens of
  // seconds on CPU); it runs in the background worker, never on the HTTP path.
  async analyzeCode(code: string, language: string): Promise<string> {
    // Build the natural-language instructions wrapping the user's code.
    const prompt = this.buildPrompt(code, language);

    // Call Ollama's generate endpoint. stream:false → wait for the full
    // answer in one response. format:'json' forces the model to emit a single
    // valid JSON object, which we then validate against our own schema.
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        format: 'json',
        // Low temperature → more deterministic, less rambly reviews.
        options: { temperature: 0.2 },
      }),
    });

    // Non-2xx (model not pulled, Ollama down, etc.) → throw so the processor
    // marks the analysis 'failed' and records the reason.
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama request failed (${res.status}): ${body}`);
    }

    // Pull out the generated text and coerce it into our structured shape.
    const data = (await res.json()) as OllamaGenerateResponse;
    const structured = this.parseAnalysis(data.response);
    return JSON.stringify(structured);
  }

  // Sends a multi-turn conversation to the model and returns the reply text.
  // Used by follow-up questions, where the caller assembles the system context
  // (original code + analysis) plus the prior turns. Like analyzeCode, this is
  // the slow call and must run off the HTTP request path... well, here it runs
  // on the request itself, so the endpoint waits for it.
  async chat(messages: ChatMessage[]): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: { temperature: 0.2 },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama chat failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    return data.message.content.trim();
  }

  // Constructs the prompt: role + the exact JSON contract + the fenced code.
  // The language is interpolated so the model knows how to read the code.
  private buildPrompt(code: string, language: string): string {
    return [
      `You are a senior code reviewer auditing ${language} code for a regulated fintech product.`,
      'Your job is to be EXHAUSTIVE. Missing a bug is worse than reporting too many.',
      '',
      'Review the code in these passes, in order. For each pass, find ALL issues before moving on:',
      '',
      'PASS 1 — Security: insecure RNG, timing attacks, injection risks, sensitive data in logs, weak auth.',
      'PASS 2 — Logic bugs: compare every comment to the code beneath it and flag mismatches. Check every numeric constant against its name or comment. Off-by-one errors. Boundary conditions.',
      'PASS 3 — Resource management: memory leaks, uncleaned timers/listeners, mutation of inputs, race conditions.',
      'PASS 4 — Performance: nested loops, O(n²) where a stdlib call exists, redundant work.',
      'PASS 5 — Code quality: loose equality, magic numbers, unused imports, inconsistent error handling.',
      '',
      'Before producing JSON, briefly think through each pass in a <thinking> block. Then output the JSON.',
      '',
      'Return a JSON object with this exact shape (after the thinking block):',
      '{',
      '  "summary": "<2-3 sentences: what the code does and the headline issues>",',
      '  "findings": [',
      '    {',
      '      "type": "bug" | "improvement" | "good",',
      '      "severity": "critical" | "high" | "medium" | "low",',
      '      "category": "security" | "logic" | "resource" | "performance" | "quality",',
      '      "line": <1-based line number or null>,',
      '      "title": "<short title, 3-6 words>",',
      '      "message": "<1-2 sentences explaining the issue>",',
      '      "fix": "<ONLY the corrected line(s) of code, verbatim — no prose, no \\"change X to Y\\"; null if not applicable>"',
      '    }',
      '  ],',
      '  "complexity": { "time": "<Big-O>", "space": "<Big-O>" }',
      '}',
      '',
      'Rules:',
      '- Limit "good" findings to a MAXIMUM of 2. Prioritize bugs and improvements.',
      '- For every bug, include a concrete fix in the "fix" field — the replacement code line ONLY, never a sentence.',
      '- If a comment says X and the code does Y, that is a logic bug — always flag it.',
      '- Report all real issues even if there are 10+.',
      '',
      '```' + language,
      code,
      '```',
    ].join('\n');
  }

  // Validates and normalizes the model's raw output into a StructuredAnalysis.
  // The model is asked for clean JSON, but we defend against fenced output,
  // missing fields, and bad types so a sloppy response never crashes the job.
  private parseAnalysis(raw: string): StructuredAnalysis {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.stripFences(raw));
    } catch {
      this.logger.warn('Model returned non-JSON; falling back to a summary');
      // Degrade gracefully: surface whatever text we got as a single note.
      return {
        summary: raw.trim().slice(0, 280),
        findings: [
          {
            type: 'improvement',
            line: null,
            title: 'Analysis',
            message: raw.trim(),
            fix: null,
          },
        ],
        complexity: { time: 'unknown', space: 'unknown' },
      };
    }

    const obj = (parsed ?? {}) as Record<string, unknown>;
    const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
    const findings: Finding[] = rawFindings
      .map((f): Finding | null => {
        const item = (f ?? {}) as Record<string, unknown>;
        const type =
          item.type === 'bug' || item.type === 'good'
            ? item.type
            : 'improvement';
        const message = typeof item.message === 'string' ? item.message : '';
        if (!message) return null;
        const line =
          typeof item.line === 'number' && Number.isFinite(item.line)
            ? item.line
            : null;
        const title =
          typeof item.title === 'string' && item.title.trim()
            ? item.title.trim()
            : type;
        const fix =
          typeof item.fix === 'string' && item.fix.trim()
            ? item.fix.trim()
            : null;
        return { type, line, title, message, fix };
      })
      .filter((f): f is Finding => f !== null);

    const c = (obj.complexity ?? {}) as Record<string, unknown>;
    const complexity = {
      time: typeof c.time === 'string' ? c.time : 'unknown',
      space: typeof c.space === 'string' ? c.space : 'unknown',
    };

    const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';

    return { summary, findings, complexity };
  }

  // Removes a ```json ... ``` (or bare ``` ... ```) wrapper if the model added
  // one despite being asked for raw JSON.
  private stripFences(text: string): string {
    return text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }
}
