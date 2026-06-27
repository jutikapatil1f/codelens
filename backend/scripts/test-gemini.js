// Ad-hoc local test for the Gemini provider path.
// Drives the REAL AiService.analyzeCode (Gemini call + parseAnalysis) against
// a deliberately buggy snippet. Run after setting AI_PROVIDER=gemini and a real
// GEMINI_API_KEY in backend/.env:  node scripts/test-gemini.js
require('dotenv').config();
const { AiService } = require('../dist/analysis/ai.service');

// Minimal ConfigService stand-in: get(key, fallback) reading from process.env.
const config = { get: (key, fallback) => process.env[key] ?? fallback };

const buggyCode = `function getDiscount(price, percent) {
  // clamp percent to the 0-100 range
  if (percent < 0) percent = 0;
  if (percent > 90) percent = 90;
  // apply discount
  return price - price * percent;
}`;

(async () => {
  const svc = new AiService(config);
  console.log('Provider:', process.env.AI_PROVIDER, '| Model:', process.env.GEMINI_MODEL ?? 'gemini-2.5-flash (default)');
  console.time('analyzeCode');
  const json = await svc.analyzeCode(buggyCode, 'javascript');
  console.timeEnd('analyzeCode');
  const parsed = JSON.parse(json);
  console.log('\nSummary:', parsed.summary);
  console.log('Complexity:', parsed.complexity);
  console.log('Findings:', parsed.findings.length);
  for (const f of parsed.findings) {
    console.log(`  [${f.type}] L${f.line ?? '-'} ${f.title}: ${f.message}${f.fix ? `  FIX: ${f.fix}` : ''}`);
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
