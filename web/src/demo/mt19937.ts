/**
 * The Mersenne Twister as Python's `random.Random(seed)` runs it, so a bootstrap here draws the
 * same resamples as the server and lands on the same confidence intervals.
 */
export class PythonRandom {
  private mt = new Uint32Array(624);
  private index = 624;

  constructor(seed: number) {
    const mt = this.mt;
    mt[0] = 19650218;
    for (let i = 1; i < 624; i++) mt[i] = Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i;
    // init_by_array with the one-word key [seed]
    let i = 1;
    for (let k = 624; k > 0; k--) {
      mt[i] = (mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + seed;
      if (++i >= 624) {
        mt[0] = mt[623];
        i = 1;
      }
    }
    for (let k = 623; k > 0; k--) {
      mt[i] = (mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i;
      if (++i >= 624) {
        mt[0] = mt[623];
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  private uint32(): number {
    const mt = this.mt;
    if (this.index >= 624) {
      for (let k = 0; k < 624; k++) {
        const y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7fffffff);
        mt[k] = mt[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.index = 0;
    }
    let y = mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** `random.randrange(n)` for 0 < n < 2**32: draw just enough bits, try again when over. */
  randrange(n: number): number {
    const bits = 32 - Math.clz32(n);
    for (;;) {
      const r = this.uint32() >>> (32 - bits);
      if (r < n) return r;
    }
  }
}
