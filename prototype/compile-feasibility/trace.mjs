// Cross-engine determinism probe: hash the event log and the frames separately and
// return a few sample frames with full precision. Used from Node and the browser.
import { runProgram } from './runtime.mjs';

async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function trace(appModule) {
  const run = await runProgram(appModule, { stopMs: 15000 });
  return {
    logHash: await sha(run.log.join('\n')),
    framesHash: await sha(JSON.stringify(run.frames)),
    samples: [100, 300, 500, 700, 900].map((i) => run.frames[i]),
    probes: [Math.sin(1.2345), Math.cos(0.987), Math.atan2(3, 7), Math.hypot(3.3, 4.4), Math.sqrt(2.5)],
  };
}
