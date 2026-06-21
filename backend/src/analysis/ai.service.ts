import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// The subset of Ollama's /api/generate response we care about.
// `response` is the model's generated text; `done` signals completion.
interface OllamaGenerateResponse {
  response: string;
  done: boolean;
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
  // Which model to run, e.g. llama3.2.
  private readonly model: string;

  constructor(config: ConfigService) {
    // Read connection details from .env (via ConfigService). The second
    // argument to get() is a fallback used when the var isn't set.
    this.baseUrl = config.get<string>('OLLAMA_URL', 'http://localhost:11434');
    this.model = config.get<string>('OLLAMA_MODEL', 'llama3.2');
  }

  // Sends the code to the model and returns its analysis as plain text.
  // This is the slow call (tens of seconds on CPU); it runs in the background
  // worker, never on the HTTP request path.
  async analyzeCode(code: string, language: string): Promise<string> {
    // Build the natural-language instructions wrapping the user's code.
    const prompt = this.buildPrompt(code, language);

    // Call Ollama's generate endpoint. stream:false → wait for the full
    // answer in one response instead of receiving it token-by-token.
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, stream: false }),
    });

    // Non-2xx (model not pulled, Ollama down, etc.) → throw so the processor
    // marks the analysis 'failed' and records the reason.
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama request failed (${res.status}): ${body}`);
    }

    // Pull out the generated text and trim surrounding whitespace.
    const data = (await res.json()) as OllamaGenerateResponse;
    return data.response.trim();
  }

  // Constructs the prompt: role + what to cover + the code in a fenced block.
  // The language is interpolated so the model knows how to read the code.
  private buildPrompt(code: string, language: string): string {
    return [
      `You are a senior code reviewer. Analyze the following ${language} code.`,
      'Respond with concise bullet points covering: a one-line summary, potential bugs,',
      'security concerns, and suggested improvements. Be specific and practical.',
      '',
      '```' + language,
      code,
      '```',
    ].join('\n');
  }
}
