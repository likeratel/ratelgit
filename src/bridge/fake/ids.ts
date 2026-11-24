/** Deterministic, realistic-looking commit IDs for the fake core. */
export function fakeHash(seed: string): string {
  let state = 0x811c9dc5;
  let hex = "";
  for (let round = 0; hex.length < 40; round += 1) {
    for (const character of `${seed}:${round}`) {
      state = Math.imul(state ^ character.charCodeAt(0), 0x01000193) >>> 0;
    }
    hex += state.toString(16).padStart(8, "0");
  }
  return hex.slice(0, 40);
}
