// Scrollback-engine tests (run `npm run build` first, then `npm test`).
// The engine's contract: lines that scroll off the viewport's top are committed
// exactly once; the still-mutating bottom is never committed while visible; a
// full TUI redraw preserves the vanished view as history, idempotently.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ingest } = require('../dist/server/poller.js');

let pass = 0;
let fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
  }
}

// 1. streaming: the bottom line mutates in place (no scroll) → nothing committed
const m = { transcript: [], liveView: [] };
ingest(m, 'line A\nline B\nHello wor');
ingest(m, 'line A\nline B\nHello world, done.');
eq('mutate-in-place commits nothing', m.transcript, []);
eq('mutate-in-place live view', m.liveView, ['line A', 'line B', 'Hello world, done.']);

// 2. scroll by 2 → exactly the 2 scrolled-off lines committed (even though the
//    remaining overlap is a single line — the big-scroll sliver case)
ingest(m, 'Hello world, done.\nnext 1\nnext 2');
eq('scroll commits scrolled-off prefix', m.transcript, ['line A', 'line B']);
eq('scroll live view', m.liveView, ['Hello world, done.', 'next 1', 'next 2']);

// 3. identical re-read (TUI redraw of the same frame) → no change
ingest(m, 'Hello world, done.\nnext 1\nnext 2');
eq('identical redraw is a no-op', m.transcript, ['line A', 'line B']);

// 4. scroll AND a mutating bottom line in the same frame
ingest(m, 'next 1\nnext 2\nstreaming par');
ingest(m, 'next 1\nnext 2\nstreaming partial done\nmore');
eq('scroll+mutate commit', m.transcript, ['line A', 'line B', 'Hello world, done.']);
eq('scroll+mutate live view', m.liveView, ['next 1', 'next 2', 'streaming partial done', 'more']);

// 5. full redraw with unrelated content (clear / alt screen) → the vanished
//    view is preserved as history, not lost
ingest(m, 'totally\ndifferent\nscreen');
eq('redraw preserves vanished view', m.transcript, [
  'line A', 'line B', 'Hello world, done.', 'next 1', 'next 2', 'streaming partial done', 'more',
]);

// 6. blank frame mid-redraw → ignored entirely
ingest(m, '\n\n');
eq('blank frame ignored', m.liveView, ['totally', 'different', 'screen']);

console.log(fail === 0 ? `scrollback: ALL ${pass} PASS` : `scrollback: ${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
