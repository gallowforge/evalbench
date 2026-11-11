/** Where the names on the verdict chart go, kept apart from the dots, the bar and each other. */

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** A place for a label: the point it is anchored to, and which way the text runs from it. */
export interface Spot {
  x: number;
  y: number;
  anchor: 'start' | 'end' | 'middle';
}

/** One model on the chart: its dot, and the size of the label that names it. */
export interface Mark {
  id: number;
  cx: number;
  cy: number;
  r: number;
  isPick: boolean;
  clears: boolean;
  /** Width and height of the label. */
  tw: number;
  th: number;
}

export interface Frame {
  /** Width of the drawing. */
  w: number;
  /** Where the plot starts: the scale is written to the left of it. */
  left: number;
  /** The lowest a label may reach. */
  bottom: number;
  /** Height of the bar, the line across the plot. */
  line: number;
  /** Things drawn at a fixed place that no label may cover. */
  fixed: Box[];
}

/** Two names closer than this read as one. */
const AIR = { x: 6, y: 4 };

/** How far a label keeps from the bar. */
const BAR = 4;

/**
 * What each compromise costs. Every spot also costs a little more the further it is from "beside the dot",
 * and the layout drawn is the one with the lowest sum.
 */
const COST = {
  /** Cut off by the edge of the drawing: the last resort. */
  off: 1000,
  /** Over a dot, the handle, the scale or another label: not a place at all. */
  broken: 100,
  /** Struck through by the bar. */
  struck: 8,
  /** On the row of another model's dot and right next to it, where it reads as that model's name. */
  claimed: 5,
  /** In the column where the scale is written, between its numbers. */
  overScale: 3,
  /** Close enough to another label to read as part of it. */
  crowded: 2,
  /** Right over or under another label, like a second line of it. */
  stacked: 1.5,
};

export function boxOf(m: Mark, s: Spot): Box {
  const x0 = s.anchor === 'start' ? s.x : s.anchor === 'end' ? s.x - m.tw : s.x - m.tw / 2;
  return { x0, x1: x0 + m.tw, y0: s.y - m.th / 2, y1: s.y + m.th / 2 };
}

/** What it costs to have two labels where they are: nothing, when they are clearly two. */
function between(a: Box, b: Box): number {
  if (hit(a, b)) return COST.broken;
  if (hit({ x0: a.x0 - AIR.x, x1: a.x1 + AIR.x, y0: a.y0 - AIR.y, y1: a.y1 + AIR.y }, b)) return COST.crowded;
  const shared = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const apart = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
  if (apart < 10 && shared >= 0.5 * Math.min(a.x1 - a.x0, b.x1 - b.x0)) return COST.stacked;
  return 0;
}

interface Option {
  spot: Spot;
  box: Box;
  /** What the spot costs before any other label is placed. */
  own: number;
}

/**
 * A spot for every label: beside its dot where there is room, otherwise the nearest spot around it
 * that leaves every name clearly attached to its own dot and apart from the others.
 */
export function placeLabels(marks: Mark[], frame: Frame): Map<number, Spot> {
  // The pick wears a ring, so it takes up more room than its dot.
  const obstacle = (d: Mark): Box =>
    d.isPick
      ? { x0: d.cx - 23, x1: d.cx + 23, y0: d.cy - 17, y1: d.cy + 17 }
      : { x0: d.cx - d.r - 3, x1: d.cx + d.r + 3, y0: d.cy - d.r - 3, y1: d.cy + d.r + 3 };
  // The bar is a line across the whole plot, and no label may be struck through by it.
  const struck = (b: Box) => b.y0 < frame.line + BAR && b.y1 > frame.line - BAR;

  // A name that starts or ends right next to a dot, level with it, is read as the name of that dot.
  const beside = (o: Box, cy: number, b: Box) => cy > b.y0 - 1 && cy < b.y1 + 1 && Math.max(b.x0 - o.x1, o.x0 - b.x1) < 12;

  const optionsFor = (d: Mark): Option[] => {
    // A model that clears the bar is labelled on the clear side of it; one that does not, underneath.
    const side = d.clears ? -1 : 1;
    const near = d.r + (d.isPick ? 14 : 8);
    const list: [Spot, number][] = [
      [{ x: d.cx + near, y: d.cy, anchor: 'start' }, 0],
      [{ x: d.cx - near, y: d.cy, anchor: 'end' }, 0.1],
    ];
    // A dot close to the bar: still beside it, slid just far enough to clear the line.
    // The pick's two lines are given the open space on its side of the bar first.
    if (struck(boxOf(d, list[0][0]))) {
      const y = frame.line + side * (BAR + d.th / 2);
      if (Math.abs(y - d.cy) <= d.th / 2 - 2) {
        const rank = d.isPick ? 0.65 : 0.25;
        list.push([{ x: d.cx + near, y, anchor: 'start' }, rank], [{ x: d.cx - near, y, anchor: 'end' }, rank + 0.07]);
      }
    }
    // Then around the dot, on its own side of the bar before the other; then the same a step further out.
    for (const out of [0, 10]) {
      const gap = near + out;
      const lift = d.th / 2 + 7 + out;
      const over = gap + d.th / 2;
      const far = out ? 0.75 : 0;
      if (out) list.push([{ x: d.cx + gap, y: d.cy, anchor: 'start' }, far], [{ x: d.cx - gap, y: d.cy, anchor: 'end' }, far + 0.1]);
      for (const [s, base] of [
        [side, 0.5],
        [-side, 2],
      ]) {
        list.push(
          [{ x: d.cx + gap, y: d.cy + s * lift, anchor: 'start' }, base + far],
          [{ x: d.cx - gap, y: d.cy + s * lift, anchor: 'end' }, base + far + 0.1],
          [{ x: d.cx, y: d.cy + s * over, anchor: 'middle' }, base + far + 0.3],
          [{ x: d.cx - d.r, y: d.cy + s * over, anchor: 'start' }, base + far + 0.35],
          [{ x: d.cx + d.r, y: d.cy + s * over, anchor: 'end' }, base + far + 0.4],
        );
      }
    }
    return list.map(([spot, rank]) => {
      const box = boxOf(d, spot);
      let own = rank;
      if (box.x0 < 2 || box.x1 > frame.w - 2 || box.y0 < 20 || box.y1 > frame.bottom - 2) own += COST.off;
      else if (box.x0 < frame.left - 2) own += COST.overScale;
      if (frame.fixed.some((f) => hit(f, box))) own += COST.broken;
      if (marks.some((o) => o !== d && hit(obstacle(o), box))) own += COST.broken;
      if (struck(box)) own += COST.struck;
      if (marks.some((o) => o !== d && beside(obstacle(o), o.cy, box))) own += COST.claimed;
      return { spot, box, own };
    });
  };

  // The pick is placed first, then the rest from the top down.
  const order = [...marks].sort((a, b) => Number(b.isPick) - Number(a.isPick) || a.cy - b.cy);
  const options = order.map(optionsFor);
  if (order.length === 0) return new Map();

  // With the first label held at one spot, give every other label the cheapest spot left to it.
  const fill = (lead: number) => {
    const at: number[] = [];
    let cost = 0;
    options.forEach((list, n) => {
      let best = n === 0 ? lead : 0;
      let low = Infinity;
      for (let i = n === 0 ? lead : 0; i < (n === 0 ? lead + 1 : list.length); i++) {
        let c = list[i].own;
        for (let k = 0; k < n && c < low; k++) c += between(options[k][at[k]].box, list[i].box);
        if (c < low) {
          low = c;
          best = i;
        }
      }
      at.push(best);
      cost += low;
    });
    return { at, cost };
  };

  let best = fill(0);
  for (let lead = 1; lead < options[0].length; lead++) {
    if (options[0][lead].own >= best.cost) continue;
    const next = fill(lead);
    if (next.cost < best.cost) best = next;
  }

  // A last look at each label with all the others in place: move it if that makes the whole chart better.
  const at = best.at;
  const costOf = (n: number, i: number) => {
    let c = options[n][i].own;
    for (let k = 0; k < at.length; k++) if (k !== n) c += between(options[k][at[k]].box, options[n][i].box);
    return c;
  };
  for (let round = 0, moved = true; moved && round < 3; round++) {
    moved = false;
    for (let n = 0; n < at.length; n++) {
      let low = costOf(n, at[n]);
      for (let i = 0; i < options[n].length; i++) {
        const c = costOf(n, i);
        if (c < low - 1e-9) {
          low = c;
          at[n] = i;
          moved = true;
        }
      }
    }
  }

  return new Map(order.map((d, n) => [d.id, options[n][at[n]].spot]));
}
