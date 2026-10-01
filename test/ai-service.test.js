import './env.js';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const { extractJSON, buildSystemPrompt, buildClarifyPrompt } = await import('../src/services/ai-service.js');

describe('extractJSON: reading the AI reply', () => {
  test('plain JSON', () => {
    assert.deepEqual(extractJSON('{"action":"clarify","person":null}'), { action: 'clarify', person: null });
  });
  test('JSON in a markdown code fence', () => {
    assert.deepEqual(extractJSON('```json\n{"action":"transfer"}\n```'), { action: 'transfer' });
  });
  test('JSON surrounded by prose', () => {
    assert.deepEqual(extractJSON('Sure! Here you go: {"urgency":"HARD"} Hope that helps.'), { urgency: 'HARD' });
  });
  test('not JSON at all', () => {
    assert.equal(extractJSON('Who would you like to speak with?'), null);
  });
  test('broken JSON', () => {
    assert.equal(extractJSON('{"action": "clarify",'), null);
  });
});

const people = [{ name: 'Alex', alternate_names: ['Al'] }, { name: 'Priya', alternate_names: [] }];
const hard = [{ phrase: 'emergency' }, { phrase: 'pipes burst' }];
const soft = [{ phrase: 'I really need to' }];
const routine = [{ phrase: 'when you get a chance' }];

describe('buildSystemPrompt', () => {
  test('lists people with their nicknames', () => {
    const p = buildSystemPrompt(people, hard, soft, routine, true, true);
    assert.match(p, /- Alex \(also: Al\)/);
    assert.match(p, /- Priya\n/);
  });
  test('includes every trigger phrase', () => {
    const p = buildSystemPrompt(people, hard, soft, routine, true, true);
    for (const phrase of ['"emergency"', '"pipes burst"', '"I really need to"', '"when you get a chance"']) {
      assert.ok(p.includes(phrase), phrase);
    }
  });
  test('states whether the business is open', () => {
    assert.match(buildSystemPrompt(people, hard, soft, routine, true, true), /CURRENT STATUS: OPEN/);
    assert.match(buildSystemPrompt(people, hard, soft, routine, false, true), /CURRENT STATUS: CLOSED/);
  });
  test('offers the main line only when it can be reached', () => {
    const withLine = buildSystemPrompt(people, hard, soft, routine, true, true);
    assert.ok(withLine.includes('"action": "main_line"'));
    assert.ok(withLine.includes('or the main line.'));

    const noLine = buildSystemPrompt(people, hard, soft, routine, true, false);
    assert.ok(!noLine.includes('"action": "main_line"'));
    assert.match(noLine, /There is NO main line/);
    assert.ok(noLine.includes('I can take a message for Alex, Priya.'));
  });
  test('falls back to built-in trigger examples when none are configured', () => {
    const p = buildSystemPrompt(people, [], [], [], true, true);
    assert.match(p, /- "urgent"/);
    assert.match(p, /- "it's important"/);
    assert.match(p, /- "I would like to"/);
  });
});

describe('buildClarifyPrompt', () => {
  test('includes the original words, the first-stage reasoning and the triggers', () => {
    const p = buildClarifyPrompt('I really need to talk to Alex', hard, 'Soft urgency');
    assert.ok(p.includes('The caller initially said: "I really need to talk to Alex"'));
    assert.ok(p.includes('Initial analysis: Soft urgency'));
    assert.ok(p.includes('- "pipes burst"'));
  });
});
