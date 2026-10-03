import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMultiAgentReview, SPECIALISTS, parseFindingList } from './multiAgent';
import { parseRequest } from './prompts';
import type { GenerateOptions, ModelProvider, StreamEvent } from './ai/types';
import type { AIRequestBody } from '../src/shared/aiConfig';
import { multiAgentByDefault } from '../src/services/settings';

const usage = { prompt: 10, output: 2, thoughts: 1, total: 13 };

function fakeProvider(answer: (options: GenerateOptions) => string | Error): ModelProvider & { calls: GenerateOptions[] } {
  const calls: GenerateOptions[] = [];
  return {
    calls,
    model: 'm', location: 'l', euResident: true,
    modelFor: () => 'm',
    async generate(options: GenerateOptions, onEvent: (e: StreamEvent) => void) {
      calls.push(options);
      const result = answer(options);
      if (result instanceof Error) throw result;
      onEvent({ type: 'text', text: result });
      return { reason: 'stop' as const, usage };
    },
    async transcribe() { return { text: '' }; },
  };
}

const request: AIRequestBody = { mode: 'review', instruction: 'Kockázatok', originalText: '', documentContext: 'A Vevő fizet. A felek vitás ügyeiket rendezik.', multiAgent: true };

test('multi-agent review: specialists in parallel, each on its own field, then one merged answer streamed', async () => {
  const thoughts: string[] = [];
  let streamed = '';
  const provider = fakeProvider(o => (/SPECIALIST FINDINGS/.test(o.prompt)
    ? JSON.stringify([{ quote: 'A Vevő fizet.', comment: 'Összegzett', severity: 'high', suggestion: '' }])
    : /pénzügy|vételár/i.test(o.prompt.split('INSTRUCTION')[1] ?? '') ? JSON.stringify([{ quote: 'A Vevő fizet.', comment: 'Nincs határidő', severity: 'high', suggestion: '' }]) : '[]'));
  const finish = await runMultiAgentReview(provider, request, { signal: new AbortController().signal, onThought: t => thoughts.push(t), onText: t => { streamed += t; } });
  assert.equal(provider.calls.length, SPECIALISTS.length + 1);
  // Every specialist gets the whole document and its own field
  const specialistCalls = provider.calls.slice(0, SPECIALISTS.length);
  SPECIALISTS.forEach(s => assert.ok(specialistCalls.some(c => c.prompt.includes(`SZAKTERÜLETED: csak ezt vizsgáld: ${s.focus}`) && c.prompt.includes('A Vevő fizet.'))));
  const merge = provider.calls.at(-1)!;
  assert.match(merge.systemInstruction, /SUPERVISING REVIEWER/);
  assert.match(merge.prompt, /### Pénzügyi feltételek\n\[\{"quote":"A Vevő fizet\.","comment":"Nincs határidő"/);
  assert.doesNotMatch(merge.prompt, /### Felelősség és kockázat/, 'a specialist with nothing to say is left out');
  assert.equal(JSON.parse(streamed)[0].comment, 'Összegzett');
  assert.deepEqual(finish.usage, { prompt: 60, output: 12, thoughts: 6, total: 78 });
  assert.equal(finish.specialists, 5);
  assert.match(thoughts[0], /^5 szakértő vizsgálja párhuzamosan/);
  assert.ok(thoughts.some(t => /^Pénzügyi feltételek: 1 észrevétel\.$/.test(t)));
});

test('multi-agent review: a failed specialist is left out and said, all failing is an error', async () => {
  const thoughts: string[] = [];
  const partly = fakeProvider(o => (o.prompt.includes(SPECIALISTS[0].focus) ? new Error('quota') : '[]'));
  const finish = await runMultiAgentReview(partly, request, { signal: new AbortController().signal, onThought: t => thoughts.push(t), onText: () => {} });
  assert.equal(finish.specialists, 4);
  assert.ok(thoughts.some(t => t === 'Felelősség és kockázat: nem sikerült (quota).'));
  assert.ok(thoughts.some(t => /\(1 szakértő kimaradt\)/.test(t)));
  const none = fakeProvider(() => new Error('down'));
  await assert.rejects(runMultiAgentReview(none, request, { signal: new AbortController().signal, onThought: () => {}, onText: () => {} }), /Every specialist reviewer failed/);
});

test('multi-agent: only for a free review, never with a playbook; default from the settings', () => {
  const ok = parseRequest({ mode: 'review', instruction: 'x', documentContext: 'y', multiAgent: true });
  assert.ok('value' in ok && ok.value.multiAgent === true);
  const edit = parseRequest({ mode: 'edit', instruction: 'x', originalText: 'y', multiAgent: true });
  assert.ok('value' in edit && !edit.value.multiAgent);
  const playbook = { name: 'P', rules: [{ topic: 'T', standard: 'S' }] };
  const withPlaybook = parseRequest({ mode: 'review', instruction: 'x', documentContext: 'y', multiAgent: true, playbook });
  assert.ok('value' in withPlaybook && !withPlaybook.value.multiAgent && withPlaybook.value.playbook);
  assert.deepEqual(parseFindingList('[{"quote":"a","comment":"b"},{"x":1},"z"]'), [{ quote: 'a', comment: 'b' }]);
  assert.equal(multiAgentByDefault({ multiAgent: 'off', depth: 'deep' }), false);
  assert.equal(multiAgentByDefault({ multiAgent: 'deep', depth: 'deep' }), true);
  assert.equal(multiAgentByDefault({ multiAgent: 'deep', depth: 'auto' }), false);
  assert.equal(multiAgentByDefault({ multiAgent: 'always', depth: 'fast' }), true);
});
