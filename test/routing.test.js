import './env.js';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const {
  routineHandling, acceptsTransfers, mainLineAvailable,
  findPeople, findPerson, resolveAmbiguousPerson, personTemplateVars,
  wantsDirectTransfer, fullName,
} = await import('../src/services/routing.js');

const person = (routing_preference) => ({ name: 'Sam', routing_preference });

describe('routineHandling: how a routine call reaches a person', () => {
  const cases = [
    // preference        open        closed
    ['business_hours',   'offer',    'message'],
    ['always_direct',    'transfer', 'transfer'],
    ['always_screen',    'offer',    'offer'],
    ['message_only',     'message',  'message'],
  ];
  for (const [pref, open, closed] of cases) {
    test(`${pref}: ${open} when open, ${closed} when closed`, () => {
      assert.equal(routineHandling(person(pref), true), open);
      assert.equal(routineHandling(person(pref), false), closed);
    });
  }

  test('missing preference behaves like business_hours', () => {
    assert.equal(routineHandling(person(null), true), 'offer');
    assert.equal(routineHandling(person(undefined), false), 'message');
  });
});

describe('acceptsTransfers', () => {
  test('message_only people never take transferred calls', () => {
    assert.equal(acceptsTransfers(person('message_only')), false);
  });
  test('everyone else can be transferred to', () => {
    for (const pref of ['business_hours', 'always_direct', 'always_screen', null]) {
      assert.equal(acceptsTransfers(person(pref)), true, pref);
    }
  });
});

describe('mainLineAvailable', () => {
  test('no main line configured: never available', () => {
    assert.equal(mainLineAvailable('', true, true), false);
    assert.equal(mainLineAvailable(null, true, false), false);
  });
  test('open: available', () => {
    assert.equal(mainLineAvailable('+15550009999', true, true), true);
  });
  test('closed with operator_business_hours_only: unavailable', () => {
    assert.equal(mainLineAvailable('+15550009999', false, true), false);
  });
  test('closed without business-hours-only restriction: available', () => {
    assert.equal(mainLineAvailable('+15550009999', false, false), true);
  });
});

const people = [
  { name: 'Alex',   last_name: 'Morgan', alternate_names: ['Al'] },
  { name: 'Jordan', last_name: 'Lee',    alternate_names: [] },
  { name: 'Jordan', last_name: 'Patel',  alternate_names: ['Jordy'] },
  { name: 'Priya',  last_name: null,     alternate_names: null },
];

describe('findPeople / findPerson', () => {
  test('matches first name, case-insensitively', () => {
    assert.deepEqual(findPeople(people, 'alex').map(p => p.last_name), ['Morgan']);
    assert.deepEqual(findPeople(people, '  ALEX ').map(p => p.last_name), ['Morgan']);
  });
  test('matches full name', () => {
    assert.deepEqual(findPeople(people, 'Jordan Patel').map(p => p.last_name), ['Patel']);
  });
  test('matches nicknames', () => {
    assert.equal(findPerson(people, 'Al').name, 'Alex');
    assert.equal(findPerson(people, 'jordy').last_name, 'Patel');
  });
  test('returns every person sharing a first name', () => {
    assert.equal(findPeople(people, 'Jordan').length, 2);
  });
  test('works for people without a last name or nicknames', () => {
    assert.equal(findPerson(people, 'Priya').name, 'Priya');
  });
  test('no match, empty or missing name', () => {
    assert.deepEqual(findPeople(people, 'Zed'), []);
    assert.deepEqual(findPeople(people, ''), []);
    assert.deepEqual(findPeople(people, null), []);
    assert.equal(findPerson(people, 'Zed'), null);
  });
});

describe('resolveAmbiguousPerson: picking the right Jordan', () => {
  const lastName = (speech) => resolveAmbiguousPerson(people, 'Jordan', speech)?.last_name ?? null;

  test('last name alone', () => assert.equal(lastName('Patel'), 'Patel'));
  test('full name', () => assert.equal(lastName('Jordan Lee'), 'Lee'));
  test('last name inside a sentence, with punctuation', () => {
    assert.equal(lastName("It's Jordan Patel, please."), 'Patel');
  });
  test('misheard last name within two edits', () => assert.equal(lastName('Patell'), 'Patel'));
  test('unrelated words: no match', () => assert.equal(lastName('the plumber'), null));
  test('short everyday words do not match short last names', () => {
    assert.equal(lastName('the one from the office'), null);   // "the" is 2 edits from "lee"
    assert.equal(lastName('Leo'), 'Lee');                      // 1 edit is still allowed
  });
  test('longer names tolerate two edits', () => {
    const p = [{ name: 'Sam', last_name: 'Hartley' }];
    assert.equal(resolveAmbiguousPerson(p, 'Sam', 'Hardlee')?.last_name, 'Hartley');   // two edits
  });
  test('the closest name wins when several are near', () => {
    const p = [{ name: 'Sam', last_name: 'Johnston' }, { name: 'Sam', last_name: 'Johnson' }];
    assert.equal(resolveAmbiguousPerson(p, 'Sam', 'Jonson')?.last_name, 'Johnson');
  });
  test('only considers people with that first name', () => {
    assert.equal(resolveAmbiguousPerson(people, 'Jordan', 'Morgan'), null);
  });
});

describe('personTemplateVars', () => {
  test('builds names from a person row', () => {
    assert.deepEqual(personTemplateVars({ name: 'Alex', last_name: 'Morgan' }, 'ignored'), {
      first_name: 'Alex', last_name: 'Morgan', full_name: 'Alex Morgan', person: 'Alex',
    });
  });
  test('falls back to the spoken name when the person is unknown', () => {
    assert.deepEqual(personTemplateVars(null, 'Chris'), {
      first_name: 'Chris', last_name: '', full_name: 'Chris', person: 'Chris',
    });
  });
});

describe('wantsDirectTransfer: answer to "transfer directly, or take a message?"', () => {
  const transfers = ['Yes please', 'yeah sure', 'Transfer me', 'connect me directly', 'put me through', 'okay'];
  const messages  = [
    "Do not transfer me, take a message",
    "don't transfer me",
    'No thanks',
    "I'll leave a message",
    'yes, take a message please',
    'not right now',
    'call me later',
  ];
  for (const s of transfers) test(`transfers: "${s}"`, () => assert.equal(wantsDirectTransfer(s), true));
  for (const s of messages)  test(`takes a message: "${s}"`, () => assert.equal(wantsDirectTransfer(s), false));
  test('unclear or empty answers take a message', () => {
    assert.equal(wantsDirectTransfer('hmm'), false);
    assert.equal(wantsDirectTransfer(''), false);
    assert.equal(wantsDirectTransfer(undefined), false);
  });
});

describe('fullName', () => {
  test('first and last', () => assert.equal(fullName({ name: 'Jordan', last_name: 'Patel' }), 'Jordan Patel'));
  test('first only', () => assert.equal(fullName({ name: 'Priya', last_name: null }), 'Priya'));
});
