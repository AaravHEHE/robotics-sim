// Splits a STEP file off the main thread: parsing 100+ MB of STEP text takes seconds.
import { splitStep } from './step-split.ts';

self.onmessage = (e: MessageEvent<{ data: Uint8Array }>) => {
  try {
    const chunks = splitStep(new TextDecoder('latin1').decode(e.data.data));
    self.postMessage({ ok: true, chunks });
  } catch (err) {
    self.postMessage({ ok: false, message: String((err as Error)?.message ?? err) });
  }
};
