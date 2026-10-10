// Haptic feedback. Android (and other browsers with the Vibration API) get
// real vibration patterns. iPhones have no Vibration API; there, iOS 18+
// Safari gives a light system tick whenever a switch-style checkbox is
// toggled, so a hidden one stands in: one tick per pulse of the pattern.
const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

let toggle: HTMLLabelElement | null = null;

function iosTick() {
  if (!toggle) {
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:fixed;left:-50px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.id = 'haptic-tick';
    input.tabIndex = -1;
    const label = document.createElement('label');
    label.htmlFor = input.id;
    box.append(input, label);
    document.body.appendChild(box);
    toggle = label;
  }
  toggle.click();
  // Never keep focus away from the game (keyboard controls).
  const focused = document.activeElement as HTMLElement | null;
  if (focused?.id === 'haptic-tick') focused.blur();
}

/** Whether this device can give any haptic feedback. */
export const hapticsSupported = canVibrate || isIOS;

/** A vibration pattern in ms (on, off, on, ...), or one pulse. */
export function haptic(pattern: number | number[]) {
  if (canVibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* not allowed here */
    }
    return;
  }
  if (!isIOS) return;
  const p = Array.isArray(pattern) ? pattern : [pattern];
  // A tick per pulse, at most three (a tick is all iOS offers).
  let at = 0;
  for (let i = 0; i < p.length && i < 6; i += 2) {
    window.setTimeout(iosTick, at);
    at += (p[i] ?? 0) + (p[i + 1] ?? 0);
  }
}
