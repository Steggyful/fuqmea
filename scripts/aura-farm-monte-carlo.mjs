#!/usr/bin/env node
/**
 * Aura Farm — crash-point and pacing smoke stats (fun-token arcade; not legal RTP advice).
 * Matches games.js: sampleCrashPoint numerator 0.99, exponent 0.92, clamp [1.02, 88],
 * tick growth: mult += 0.012 + mult * 0.0048 + U(0,0.01), round to 2 decimals.
 *
 * Run: node scripts/aura-farm-monte-carlo.mjs
 */

const SAMPLES = 200_000;
const TICK_MS = 50;

function sampleCrashPoint() {
  const u = Math.max(1e-9, Math.random());
  let m = 0.99 / u ** 0.92;
  m = Math.min(88, Math.max(1.02, m));
  return Math.round(m * 100) / 100;
}

function tickMult(m) {
  return Math.round((m + 0.012 + m * 0.0048 + Math.random() * 0.01) * 100) / 100;
}

function ticksUntilCrash(crashPoint) {
  let m = 1;
  let n = 0;
  const cap = 500_000;
  while (m < crashPoint && n < cap) {
    m = tickMult(m);
    n++;
  }
  return n;
}

function pct(sorted, p) {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[i];
}

function main() {
  const crashes = [];
  let sum = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const c = sampleCrashPoint();
    crashes.push(c);
    sum += c;
  }
  crashes.sort((a, b) => a - b);

  const probAbove = (x) => crashes.filter((c) => c >= x).length / SAMPLES;

  console.log(`samples=${SAMPLES}  formula: min(88,max(1.02,0.99/u^0.92)), u~U(0,1]`);
  console.log(`crash mean=${(sum / SAMPLES).toFixed(3)}  p50=${pct(crashes, 50).toFixed(2)}  p90=${pct(crashes, 90).toFixed(2)}  p99=${pct(crashes, 99).toFixed(2)}`);
  console.log(`P(C>=1.5)=${probAbove(1.5).toFixed(3)}  P(C>=2)=${probAbove(2).toFixed(3)}  P(C>=10)=${probAbove(10).toFixed(4)}`);

  const tickSamples = 15_000;
  let tickSum = 0;
  for (let i = 0; i < tickSamples; i++) {
    tickSum += ticksUntilCrash(sampleCrashPoint());
  }
  const avgTicks = tickSum / tickSamples;
  console.log(
    `avg ticks to reach sampled crash (~${TICK_MS}ms/tick): ${avgTicks.toFixed(1)} (~${((avgTicks * TICK_MS) / 1000).toFixed(1)}s wall)`
  );
  console.log(
    'Benchmark: proprietary crash originals often cite ~1% house edge / ~99% RTP; fun-token tuning uses numerator 0.99 toward that band vs 0.97.'
  );
}

main();
