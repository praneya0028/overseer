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

// 7. overlay round-trip: a full-screen overlay (help / transcript view) opens
//    and closes; the restored content must NOT re-commit when it scrolls off.
const m2 = { transcript: [], liveView: [] };
ingest(m2, 'alpha\nbeta\ngamma');
ingest(m2, 'beta\ngamma\ndelta');                  // scroll → commits alpha
ingest(m2, 'OVERLAY HEADER\nmenu item\nfooter');   // overlay → commits beta/gamma/delta
ingest(m2, 'beta\ngamma\ndelta');                  // overlay closes → un-commits back to the match
ingest(m2, 'gamma\ndelta\nepsilon');               // restored content scrolls again
eq('overlay round-trip never duplicates', m2.transcript, ['alpha', 'beta']);
eq('overlay round-trip live view', m2.liveView, ['gamma', 'delta', 'epsilon']);

// 8. repetitive identical lines: only the bottom line mutates in place. With a run
//    of identical lines (e.g. closing braces) the aligner must NOT commit a spurious
//    duplicate — nothing scrolled.
const m3 = { transcript: [], liveView: [] };
ingest(m3, '}\n}\n}\n}');
ingest(m3, '}\n}\n}\nreturn;');               // bottom mutated in place, no scroll
eq('repetitive lines commit nothing', m3.transcript, []);
eq('repetitive lines live view', m3.liveView, ['}', '}', '}', 'return;']);

// 9. backward scroll (user scrolls the pager UP): the new view re-shows content that
//    is still on screen / recently committed. It must NOT duplicate history.
const m4 = { transcript: [], liveView: [] };
ingest(m4, 'L1\nL2\nL3\nL4\nL5');
ingest(m4, 'L3\nL4\nL5\nL6\nL7');             // scroll down 2 → commits L1,L2
eq('pre-scroll-up transcript', m4.transcript, ['L1', 'L2']);
ingest(m4, 'L1\nL2\nL3\nL4\nL5');             // user scrolls UP to the top
eq('scroll-up does not duplicate transcript', m4.transcript, ['L1', 'L2']);
// the full display (committed + live) must contain each line exactly once
const display = [...m4.transcript, ...m4.liveView];
eq('scroll-up display has no duplicates', display.filter((l) => l === 'L3').length, 1);

// 10. a redraw whose content COINCIDES with a buried (non-live-edge) block of
//     committed history must NOT truncate the transcript — only the live-edge
//     block (a closing overlay) un-commits. Guards against silent scrollback loss.
const m5 = { transcript: [], liveView: [] };
ingest(m5, 'KEEP1\nKEEP2\nKEEP3');
ingest(m5, 'redraw\nto\ncommit');                            // commits KEEP1/2/3
ingest(m5, 'IMPORTANT NEW 1\nIMPORTANT NEW 2\nIMPORTANT NEW 3'); // commits redraw/to/commit
ingest(m5, 'KEEP1\nKEEP2\nKEEP3');                           // coincides with a BURIED block
// the committed history before this frame must be fully preserved
const has = (l) => m5.transcript.includes(l);
eq('buried-match preserves KEEP lines', has('KEEP1') && has('KEEP2') && has('KEEP3'), true);
eq('buried-match preserves committed redraw lines', has('redraw') && has('to') && has('commit'), true);
eq('buried-match did not wipe transcript', m5.transcript.length >= 6, true);

console.log(fail === 0 ? `scrollback: ALL ${pass} PASS` : `scrollback: ${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
