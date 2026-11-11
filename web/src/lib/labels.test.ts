import { describe, expect, it } from 'vitest';
import { type Box, boxOf, type Frame, hit, type Mark, placeLabels } from './labels';

// A phone-sized plot: the scale is written left of 44, the bar's handle sits right of 336.
const frame = (line: number, fixed: Box[] = []): Frame => ({ w: 390, left: 44, bottom: 300, line, fixed });

const mark = (id: number, cx: number, cy: number, more: Partial<Mark> = {}): Mark => ({
  id,
  cx,
  cy,
  r: 6.5,
  isPick: false,
  clears: false,
  tw: 70,
  th: 18,
  ...more,
});
const pick = (id: number, cx: number, cy: number, more: Partial<Mark> = {}) =>
  mark(id, cx, cy, { r: 8, isPick: true, clears: true, tw: 110, th: 34, ...more });

function lay(marks: Mark[], f: Frame) {
  const spots = placeLabels(marks, f);
  const boxes = new Map(marks.map((m) => [m.id, boxOf(m, spots.get(m.id)!)]));
  return { spots, boxes };
}

/** No two names touch, none covers a dot that is not its own, none leaves the drawing. */
function sound(marks: Mark[], f: Frame) {
  const { boxes } = lay(marks, f);
  for (const a of marks) {
    const box = boxes.get(a.id)!;
    expect(box.x0).toBeGreaterThanOrEqual(2);
    expect(box.x1).toBeLessThanOrEqual(f.w - 2);
    for (const b of marks) {
      if (a === b) continue;
      expect(hit(box, boxes.get(b.id)!)).toBe(false);
      expect(hit(box, { x0: b.cx - b.r, x1: b.cx + b.r, y0: b.cy - b.r, y1: b.cy + b.r })).toBe(false);
    }
  }
}

describe('where the names on the chart go', () => {
  it('puts a name beside its dot, on the right, when nothing is in the way', () => {
    const { spots } = lay([mark(1, 150, 200)], frame(100));
    expect(spots.get(1)).toEqual({ x: 164.5, y: 200, anchor: 'start' });
  });

  it('has nothing to do for an empty chart', () => {
    expect(placeLabels([], frame(100)).size).toBe(0);
  });

  it('turns to the left of the dot at the right edge', () => {
    const { spots } = lay([mark(1, 350, 200)], frame(100));
    expect(spots.get(1)).toEqual({ x: 335.5, y: 200, anchor: 'end' });
  });

  it('keeps the bar from striking a name through', () => {
    for (const cy of [92, 96, 100, 104, 108]) {
      for (const clears of [true, false]) {
        const { boxes } = lay([mark(1, 150, cy, { clears })], frame(100));
        const box = boxes.get(1)!;
        expect(box.y1 <= 96 || box.y0 >= 104).toBe(true);
        // On its own side of the bar: above it when the model clears, underneath when it does not.
        expect(clears ? box.y1 <= 96 : box.y0 >= 104).toBe(true);
      }
    }
  });

  it('slides a name just clear of the bar instead of sending it away from its dot', () => {
    const { spots } = lay([mark(1, 150, 108)], frame(100));
    expect(spots.get(1)).toEqual({ x: 164.5, y: 113, anchor: 'start' });
  });

  it('keeps a name off the things drawn at a fixed place', () => {
    const caption: Box = { x0: 160, x1: 300, y0: 190, y1: 210 };
    const { boxes } = lay([mark(1, 150, 200)], frame(100, [caption]));
    expect(hit(boxes.get(1)!, caption)).toBe(false);
  });

  it('gives two close names room, so they read as two', () => {
    const marks = [mark(1, 100, 200), mark(2, 108, 222)];
    sound(marks, frame(100));
    const { boxes } = lay(marks, frame(100));
    const a = boxes.get(1)!;
    const b = boxes.get(2)!;
    const apartX = Math.max(a.x0 - b.x1, b.x0 - a.x1);
    const apartY = Math.max(a.y0 - b.y1, b.y0 - a.y1);
    expect(apartX >= 6 || apartY >= 4).toBe(true);
  });

  it('never lets a name sit beside the dot of another model', () => {
    // The pick with a second model just above and to the right of it: the pick's two lines must not
    // start level with that dot, where they would read as its name.
    const marks = [pick(1, 100, 180), mark(2, 112, 139, { clears: true })];
    const { boxes } = lay(marks, frame(197));
    const label = boxes.get(1)!;
    const other = marks[1];
    const level = other.cy > label.y0 && other.cy < label.y1;
    const next = Math.max(label.x0 - (other.cx + other.r), other.cx - other.r - label.x1) < 14;
    expect(level && next).toBe(false);
    sound(marks, frame(197));
  });

  it('does not stack one name on another like a second line', () => {
    const marks = [pick(1, 120, 160), mark(2, 150, 118, { clears: true })];
    const { boxes } = lay(marks, frame(190));
    const a = boxes.get(1)!;
    const b = boxes.get(2)!;
    const shared = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const apart = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
    expect(apart >= 10 || shared < 0.5 * Math.min(a.x1 - a.x0, b.x1 - b.x0)).toBe(true);
  });

  it('keeps every name whole and apart when the models are packed into one corner', () => {
    // Five models against the left edge, with no clean place for every name: none is cut off by the
    // edge of the drawing and no two run into each other.
    const crowd = [pick(1, 70, 90), mark(2, 60, 120), mark(3, 84, 128), mark(4, 64, 150), mark(5, 96, 104, { clears: true })];
    const f = frame(110);
    const { boxes } = lay(crowd, f);
    for (const a of crowd) {
      const box = boxes.get(a.id)!;
      expect(box.x0).toBeGreaterThanOrEqual(2);
      expect(box.x1).toBeLessThanOrEqual(f.w - 2);
      expect(box.y1).toBeLessThanOrEqual(f.bottom - 2);
      for (const b of crowd) if (a !== b) expect(hit(box, boxes.get(b.id)!)).toBe(false);
    }
  });

  it('gives the same answer every time', () => {
    const marks = [pick(1, 140, 96), mark(2, 73, 116), mark(3, 205, 136), mark(4, 73, 232), mark(5, 262, 56, { clears: true })];
    expect([...placeLabels(marks, frame(104))]).toEqual([...placeLabels(marks, frame(104))]);
    sound(marks, frame(104));
  });
});
