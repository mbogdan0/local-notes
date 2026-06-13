import {
  KEY_WIDTH,
  KEY_FONT,
  DEFAULT_WIDTH,
  DEFAULT_FONT,
} from './constants.js';

const root = document.documentElement;

// type: 'width' | 'font'
export function applySetting(type, value) {
  const isFont = type === 'font';
  const key = isFont ? KEY_FONT : KEY_WIDTH;
  const property = isFont ? '--editor-font' : '--max-width';
  const selector = isFont ? '[data-font]' : '[data-width]';

  root.style.setProperty(property, value);
  localStorage.setItem(key, value);
  document.querySelectorAll(selector).forEach(btn => {
    const current = isFont ? btn.dataset.font : btn.dataset.width;
    btn.classList.toggle('active-setting', current === value);
  });
}

export function loadSettings() {
  applySetting('width', localStorage.getItem(KEY_WIDTH) || DEFAULT_WIDTH);
  applySetting('font', localStorage.getItem(KEY_FONT) || DEFAULT_FONT);
}
