import * as PARAMS from '../core/params.js';

// World sizes per preset family. Square presets use WORLD_SIZES; the World Map
// (preset 'earth') is a 2:1 rectangle whose sizes the World Map module defines
// in params.js (EARTH_SIZES, EARTH_DEFAULT_SIZE, isWidePreset, sizeForPreset).
// Every lookup is guarded so the UI also works before that module lands.
const WORLD_SIZES = PARAMS.WORLD_SIZES || [];
const touch = !!PARAMS.IS_TOUCH;

export const isWide = (preset) => (typeof PARAMS.isWidePreset === 'function' ? !!PARAMS.isWidePreset(preset) : preset === 'earth');

const EARTH_NOTES = {
  512: 'The whole planet at a glance. Lightest on phones.',
  768: 'Room for every continent to fill with realms. Recommended.',
  1024: 'Desktop only: about twice the work of Huge.',
};
const SQUARE_NOTES = {
  128: 'Quick and intimate. Lightest on phones.',
  192: 'Cosy. The default on phones and tablets.',
  256: 'The classic balance of land and sea.',
  384: 'Room for many rival realms.',
  512: 'Epic scale. Best on desktop.',
};

// [{ id, name, size, w, h, note }]
export function sizesFor(preset) {
  if (isWide(preset) && Array.isArray(PARAMS.EARTH_SIZES) && PARAMS.EARTH_SIZES.length)
    return PARAMS.EARTH_SIZES.filter((z) => !(z.desktopOnly && touch)).map((z) => ({ ...z, w: z.w ?? z.size, h: z.h ?? z.size / 2, note: EARTH_NOTES[z.size] || z.note || '' }));
  return WORLD_SIZES.map((z) => ({ ...z, w: z.size, h: z.size, note: SQUARE_NOTES[z.size] || '' }));
}

export function dimsFor(size, preset) {
  return isWide(preset) ? { w: size, h: size / 2 } : { w: size, h: size };
}

// Size to use when the preset changes: kept within a family, mapped across families.
export function sizeSwitch(size, from, to) {
  if (typeof PARAMS.sizeForPreset === 'function') return PARAMS.sizeForPreset(size, from, to);
  if (isWide(from) === isWide(to)) return size;
  if (isWide(to)) return PARAMS.EARTH_DEFAULT_SIZE ?? sizesFor(to).at(-1)?.size ?? size;
  return 256;
}

// Pick the entry for a size (or the family default when the size is not listed).
export function sizeEntry(size, preset) {
  const list = sizesFor(preset);
  const def = isWide(preset) ? (PARAMS.EARTH_DEFAULT_SIZE ?? list.at(-1)?.size) : 256;
  return list.find((z) => z.size === size) || list.find((z) => z.size === def) || list[0];
}
