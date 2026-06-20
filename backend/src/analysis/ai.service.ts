import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface OllamaGenerateResponse {
  response: string;
  done: boolean;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('OLLAMA_URL', 'http://localhost:11434');
    this.model = config.get<string>('OLLAMA_MODEL', 'llama3.2');
  }

  async analyzeCode(code: string, language: string): Promise<string> {
    const prompt = this.buildPrompt(code, language);

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, stream: false }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama request failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as OllamaGenerateResponse;
    return data.response.trim();
  }

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
