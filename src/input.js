// Keyboard + touch input, normalised into one state object.

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, brake: false, boost: false, active: false };
    this.handlers = {};

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.handlers[e.code]?.();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    this.bindTouch();
  }

  on(code, fn) {
    this.handlers[code] = fn;
  }

  bindTouch() {
    const root = document.getElementById('touch');
    if (!root) return;
    const showTouch = () => {
      this.touch.active = true;
      root.classList.add('on');
    };
    window.addEventListener('touchstart', showTouch, { once: true, passive: true });

    for (const el of root.querySelectorAll('[data-btn]')) {
      const name = el.dataset.btn;
      const set = (v) => (e) => {
        e.preventDefault();
        this.touch[name] = v;
        el.classList.toggle('down', v);
      };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
      el.addEventListener('pointerleave', set(false));
    }
  }

  get state() {
    const k = this.keys;
    const t = this.touch;
    const left = k.has('KeyA') || k.has('ArrowLeft') || t.left;
    const right = k.has('KeyD') || k.has('ArrowRight') || t.right;
    const brake = k.has('KeyS') || k.has('ArrowDown') || t.brake;
    // On touch devices the car accelerates by itself unless you brake.
    const throttle = k.has('KeyW') || k.has('ArrowUp') || (t.active && !t.brake);
    return {
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      throttle: throttle ? 1 : 0,
      brake: brake ? 1 : 0,
      boost: k.has('ShiftLeft') || k.has('ShiftRight') || k.has('Space') || t.boost,
      lookBack: k.has('KeyC'),
    };
  }
}
