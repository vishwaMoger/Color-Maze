// Haptic feedback. Android (and other browsers with the Vibration API) get
// real vibration patterns. iPhones have no Vibration API; there, Safari
// gives a light system tick whenever a switch-style checkbox is toggled.
// Older iOS ticks for a switch toggled from script (a hidden one stands in,
// one tick per pulse of the pattern); newer iOS only for a real tap on one,
// so every button also carries an invisible switch under the finger (see
// tapHaptics).
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

let tapsOn = true;

/** Turn the button tap ticks on or off (the Vibration setting). */
export function setTapHaptics(on: boolean) {
  tapsOn = on;
  document.body.classList.toggle('no-tap-haptic', !on);
}

/**
 * iPhone: a tap on any button lands on an invisible switch inside it, so
 * Safari gives its tick for a real tap. The click still reaches the button.
 */
export function tapHaptics() {
  if (!isIOS || typeof MutationObserver === 'undefined') return;
  const add = (b: Element) => {
    if (!(b instanceof HTMLButtonElement) || b.querySelector(':scope > .tap-haptic')) return;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.className = 'tap-haptic';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    // Never keeps focus (keyboard play) and never shows as a control.
    input.addEventListener('change', () => input.blur());
    // A positioned button holds it; the class gives way to any position rule.
    b.classList.add('th-host');
    b.appendChild(input);
  };
  const scan = (root: ParentNode) => {
    if (root instanceof HTMLButtonElement) add(root);
    root.querySelectorAll?.('button').forEach(add);
  };
  scan(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      m.addedNodes.forEach((n) => n instanceof Element && scan(n));
      // A button whose content was rewritten gets its switch back.
      if (m.target instanceof HTMLButtonElement) add(m.target);
    }
  }).observe(document.body, { childList: true, subtree: true });
  setTapHaptics(tapsOn);
}
