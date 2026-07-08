/** Lightweight Web Audio cues — no external files. */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.04, when = 0) {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export function playSound(kind: "tap" | "success" | "error" | "win" | "bet", enabled = true) {
  if (!enabled) return;
  try {
    switch (kind) {
      case "tap":
        tone(640, 0.05, "triangle", 0.025);
        break;
      case "bet":
        tone(420, 0.08, "sine", 0.04);
        tone(620, 0.1, "sine", 0.035, 0.06);
        break;
      case "success":
        tone(523, 0.09, "sine", 0.04);
        tone(659, 0.1, "sine", 0.035, 0.08);
        tone(784, 0.12, "sine", 0.03, 0.16);
        break;
      case "win":
        tone(523, 0.1, "triangle", 0.05);
        tone(659, 0.12, "triangle", 0.045, 0.1);
        tone(784, 0.14, "triangle", 0.04, 0.2);
        tone(1046, 0.2, "sine", 0.035, 0.32);
        break;
      case "error":
        tone(180, 0.18, "sawtooth", 0.03);
        break;
    }
  } catch { /* noop */ }
}
