// SPDX-License-Identifier: Apache-2.0
//
// The weekly plan of modes (docs/modes.md): one slot has the shape of a school time window,
// ISO days (1 = Monday) and minutes after midnight, crossing midnight when end < start.

export interface PlanSlot {
  days: number[];
  startMinute: number;
  endMinute: number;
}

const DAY = 1440;
const WEEK = 7 * DAY;

/** The stretches of the week a slot covers, in minutes from Monday 00:00. */
function spans(slot: PlanSlot): [number, number][] {
  const length = slot.endMinute > slot.startMinute ? slot.endMinute - slot.startMinute : DAY - slot.startMinute + slot.endMinute;
  return slot.days.map((d) => {
    const from = (d - 1) * DAY + slot.startMinute;
    return [from, from + length];
  });
}

/** True when two slots are on at the same time on some day, also across midnight and Sunday into Monday. */
export function slotsOverlap(a: PlanSlot, b: PlanSlot): boolean {
  for (const [a0, a1] of spans(a)) {
    for (const [b0, b1] of spans(b)) {
      for (const shift of [-WEEK, 0, WEEK]) {
        if (a0 < b1 + shift && b0 + shift < a1) return true;
      }
    }
  }
  return false;
}

/** True when any two slots of the plan overlap. The server refuses such a plan. */
export function planOverlaps(slots: PlanSlot[]): boolean {
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      if (slotsOverlap(slots[i]!, slots[j]!)) return true;
    }
  }
  return false;
}
