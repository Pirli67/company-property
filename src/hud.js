// DOM heads-up display. Values are only written when they change, so the HUD
// costs next to nothing per frame.

import { CFG } from './config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'),
      batteryPanel: $('batteryPanel'),
      batteryFill: $('batteryFill'),
      batteryPct: $('batteryPct'),
      batteryState: $('batteryState'),
      gapPanel: $('gapPanel'),
      gap: $('gap'),
      speed: $('speed'),
      route: $('route'),
      mPlayer: $('mPlayer'),
      mChaser: $('mChaser'),
      toast: $('toast'),
      subtitle: $('subtitle'),
      subtitleText: $('subtitleText'),
    };
    this.cache = {};
    this.subtitleTimer = 0;
  }

  set(key, value, apply) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    apply(value);
  }

  show(id) {
    for (const o of ['loading', 'menu', 'pause', 'end']) $(o).classList.toggle('hidden', o !== id);
  }

  setVisible(v) {
    this.el.hud.classList.toggle('hidden', !v);
  }

  setPortrait(url) {
    const old = this.el.subtitle.querySelector('.portrait');
    const img = new Image();
    img.className = 'portrait';
    img.alt = '';
    img.onload = () => old.replaceWith(img);
    img.src = url;
  }

  setBays(bays) {
    for (const m of this.el.route.querySelectorAll('.bay')) m.remove();
    for (const b of bays) {
      if (!b.chargers) continue;
      const m = document.createElement('div');
      m.className = 'marker bay';
      m.style.left = `${(b.center / CFG.routeLength) * 100}%`;
      this.el.route.prepend(m);
    }
  }

  update({ battery, charging, boosting, speed, gap, d, chaserD }) {
    const e = this.el;
    this.set('pct', Math.round(battery * 100), (v) => {
      e.batteryPct.textContent = v;
      e.batteryFill.style.width = `${v}%`;
    });
    const state = charging ? 'charging' : battery <= 0 ? 'empty' : battery < CFG.battery.lowWarning ? 'low' : boosting ? 'boost' : '';
    this.set('bstate', state, (v) => {
      e.batteryPanel.classList.toggle('low', v === 'low' || v === 'empty');
      e.batteryPanel.classList.toggle('charging', v === 'charging');
      e.batteryState.textContent = { charging: '⚡ CHARGING', empty: '· EMPTY', low: '· LOW', boost: '· BOOST', '': '' }[v];
    });
    this.set('speed', Math.round(Math.abs(speed) * 3.6), (v) => (e.speed.textContent = v));
    this.set('gap', Math.max(0, Math.round(gap)), (v) => (e.gap.textContent = v));
    this.set('gstate', gap < 20 ? 'danger' : gap < 55 ? 'warn' : '', (v) => {
      e.gapPanel.classList.toggle('danger', v === 'danger');
      e.gapPanel.classList.toggle('warn', v === 'warn');
    });
    const pct = (v) => `${Math.min(100, Math.max(0, (v / CFG.routeLength) * 100)).toFixed(1)}%`;
    this.set('mp', pct(d), (v) => (e.mPlayer.style.left = v));
    this.set('mc', pct(chaserD), (v) => (e.mChaser.style.left = v));
  }

  toast(text, tone = '') {
    this.set('toast', `${tone}|${text}`, () => {
      this.el.toast.textContent = text;
      this.el.toast.className = text ? `on ${tone}` : '';
    });
  }

  subtitle(text, seconds) {
    this.el.subtitleText.textContent = `“${text}”`;
    this.el.subtitle.classList.remove('hidden');
    clearTimeout(this.subtitleTimer);
    this.subtitleTimer = setTimeout(() => this.el.subtitle.classList.add('hidden'), seconds * 1000 + 400);
  }

  clearSubtitle() {
    clearTimeout(this.subtitleTimer);
    this.el.subtitle.classList.add('hidden');
  }

  end({ won, title, text, stats }) {
    $('endSticker').textContent = won ? 'MAHLZEIT' : 'COMPANY PROPERTY';
    $('endTitle').textContent = title;
    $('endText').textContent = text;
    $('endStats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    $('againBtn').textContent = won ? 'Next Monday →' : 'Try again';
    this.show('end');
  }
}
