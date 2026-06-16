/**
 * The `ta` indicator standard library injected as PLAIN JS SOURCE into the QuickJS
 * sandbox (so it runs inside the VM, with no host marshaling of functions). Pure,
 * dependency-free, defensive (guards length/NaN). Mirrors the conventions of the
 * native indicator library but is self-contained text so the VM is the only place
 * it executes. Exposed to user code as the second `strategy(bars, ta)` argument.
 *
 * Kept deliberately small + obvious — these are the building blocks; users compose
 * the rest. Every function takes a numeric array (e.g. closes) unless noted and
 * returns an array aligned to the input (leading values undefined until warmed up).
 */
export const TA_STDLIB_SOURCE = String.raw`
const ta = (function () {
  function closes(bars) { return bars.map(function (b) { return b.c; }); }
  function sma(arr, n) {
    var out = new Array(arr.length).fill(undefined);
    if (n <= 0) return out;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) {
      sum += arr[i];
      if (i >= n) sum -= arr[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }
  function ema(arr, n) {
    var out = new Array(arr.length).fill(undefined);
    if (n <= 0 || arr.length === 0) return out;
    var k = 2 / (n + 1), e = arr[0];
    out[0] = e;
    for (var i = 1; i < arr.length; i++) { e = arr[i] * k + e * (1 - k); out[i] = e; }
    return out;
  }
  function rsi(arr, n) {
    var out = new Array(arr.length).fill(undefined);
    if (arr.length < 2 || n <= 0) return out;
    var gain = 0, loss = 0;
    for (var i = 1; i < arr.length; i++) {
      var ch = arr[i] - arr[i - 1];
      var g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
      if (i <= n) { gain += g; loss += l; if (i === n) { gain /= n; loss /= n; out[i] = 100 - 100 / (1 + (loss === 0 ? Infinity : gain / loss)); } }
      else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; out[i] = 100 - 100 / (1 + (loss === 0 ? Infinity : gain / loss)); }
    }
    return out;
  }
  function highest(arr, n) {
    var out = new Array(arr.length).fill(undefined);
    for (var i = 0; i < arr.length; i++) { if (i < n - 1) continue; var m = -Infinity; for (var j = i - n + 1; j <= i; j++) if (arr[j] > m) m = arr[j]; out[i] = m; }
    return out;
  }
  function lowest(arr, n) {
    var out = new Array(arr.length).fill(undefined);
    for (var i = 0; i < arr.length; i++) { if (i < n - 1) continue; var m = Infinity; for (var j = i - n + 1; j <= i; j++) if (arr[j] < m) m = arr[j]; out[i] = m; }
    return out;
  }
  function stdev(arr, n) {
    var out = new Array(arr.length).fill(undefined);
    var s = sma(arr, n);
    for (var i = n - 1; i < arr.length; i++) {
      var mu = s[i], acc = 0;
      for (var j = i - n + 1; j <= i; j++) { var d = arr[j] - mu; acc += d * d; }
      out[i] = Math.sqrt(acc / n);
    }
    return out;
  }
  function atr(bars, n) {
    var tr = new Array(bars.length).fill(undefined);
    for (var i = 0; i < bars.length; i++) {
      if (i === 0) { tr[i] = bars[i].h - bars[i].l; continue; }
      var pc = bars[i - 1].c;
      tr[i] = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - pc), Math.abs(bars[i].l - pc));
    }
    return ema(tr.map(function (x) { return x === undefined ? 0 : x; }), n);
  }
  // crossover(a,b) at index i: a was <= b at i-1 and > b at i.
  function crossover(a, b, i) { return i > 0 && a[i - 1] !== undefined && b[i - 1] !== undefined && a[i - 1] <= b[i - 1] && a[i] > b[i]; }
  function crossunder(a, b, i) { return i > 0 && a[i - 1] !== undefined && b[i - 1] !== undefined && a[i - 1] >= b[i - 1] && a[i] < b[i]; }
  return { closes: closes, sma: sma, ema: ema, rsi: rsi, highest: highest, lowest: lowest, stdev: stdev, atr: atr, crossover: crossover, crossunder: crossunder };
})();
`;
