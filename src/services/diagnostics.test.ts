import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentEvents, recordEvent, scrub } from './diagnostics';

test('scrubbed: quotes, long text, identifiers and e-mails never go into a report', () => {
  assert.equal(scrub('GeneralException: „A Vevő a vételárat 26 000 000 Ft-ot fizet” nem található'), 'GeneralException: [szöveg] nem található');
  assert.equal(scrub('account 1177300112345678 and kovacs.janos@pelda.hu'), 'account [szám] and [e-mail]');
  assert.match(scrub('a b c d e f g h i j k l m n o p'), /^\[szöveg\]/);
  assert.equal(scrub('ItemNotFound'), 'ItemNotFound');
});

test('events are kept, the oldest dropped beyond the limit', () => {
  for (let i = 0; i < 205; i++) recordEvent('action', `event ${i}`);
  const events = recentEvents();
  assert.equal(events.length, 200);
  assert.equal(events[0].message, 'event 5');
});
