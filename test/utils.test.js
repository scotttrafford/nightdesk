import './env.js';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const { applyTemplate } = await import('../src/services/utils.js');

describe('applyTemplate: personalising system_config messages', () => {
  test('replaces placeholders', () => {
    assert.equal(applyTemplate("I'll make sure {first_name} gets that.", { first_name: 'Alex' }),
      "I'll make sure Alex gets that.");
  });
  test('replaces several placeholders, including repeats', () => {
    assert.equal(applyTemplate('{a}-{b}-{a}', { a: '1', b: '2' }), '1-2-1');
  });
  test('leaves unknown placeholders visible', () => {
    assert.equal(applyTemplate('Hi {first_name} {last_name}', { first_name: 'Alex' }), 'Hi Alex {last_name}');
  });
  test('text without placeholders is unchanged', () => {
    assert.equal(applyTemplate('Goodbye!', {}), 'Goodbye!');
  });
});
