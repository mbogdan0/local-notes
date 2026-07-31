import {
  KEY_WIDTH,
  KEY_FONT,
  KEY_SCALE,
  DEFAULT_WIDTH,
  DEFAULT_FONT,
  DEFAULT_SCALE,
} from './constants.js';

const root = document.documentElement;

// Each view preference is one custom property on :root, persisted under its own
// key and reflected by a `data-<name>` segmented control.
const SETTINGS = {
  width: { key: KEY_WIDTH, property: '--max-width', fallback: DEFAULT_WIDTH },
  font: { key: KEY_FONT, property: '--editor-font', fallback: DEFAULT_FONT },
  scale: { key: KEY_SCALE, property: '--font-scale', fallback: DEFAULT_SCALE },
};

export const SETTING_TYPES = Object.keys(SETTINGS);

// type: 'width' | 'font' | 'scale'
export function applySetting(type, value) {
  const setting = SETTINGS[type];
  if (!setting) return;

  root.style.setProperty(setting.property, value);
  try {
    localStorage.setItem(setting.key, value);
  } catch {
    // A full quota must not stop the preference from applying this session.
  }
  document.querySelectorAll(`[data-${type}]`).forEach(btn => {
    btn.classList.toggle('active-setting', btn.dataset[type] === value);
  });
}

export function loadSettings() {
  for (const [type, setting] of Object.entries(SETTINGS)) {
    applySetting(type, localStorage.getItem(setting.key) || setting.fallback);
  }
}
