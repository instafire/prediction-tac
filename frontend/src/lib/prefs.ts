/** User preferences (localStorage). */

export interface Prefs {
  haptics: boolean;
  sounds: boolean;
  reduceMotion: boolean;
  endingAlerts: boolean;
  onboardingDone: boolean;
  alertThresholdHrs: number;
}

const KEY = "ptac-prefs";
const DEFAULTS: Prefs = {
  haptics: true,
  sounds: true,
  reduceMotion: false,
  endingAlerts: false,
  onboardingDone: false,
  alertThresholdHrs: 24,
};

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: Partial<Prefs>): Prefs {
  const next = { ...loadPrefs(), ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* noop */ }
  return next;
}
