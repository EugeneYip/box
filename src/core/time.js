// Shared time constants (game seconds).
export const TICK = 1 / 15; // fixed simulation step
export const YEAR = 30; // one in-world year (aging, ages, history)
export const DAY = 360; // one day-night cycle
// Seasons turn with the days: each season lasts one day-night cycle, so a
// full round of spring, summer, autumn and winter takes four days.
export const SEASON = DAY;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
