// The chaser's voice lines and the rules for when he says them.
//
// The lines are original writing in the spirit of the "who told you that you
// could fish here?" confrontation: an opening demand for who gave permission,
// incredulous one-word echoes of the excuse, a flat double-negative verdict,
// a demand for names, and an appeal to some higher authority he just phoned.
// None of the wording is taken from the original clip.

export const LINES = [
  { id: 'start_1', event: 'start', text: "Hey! Hey! Who signed that car out? Who said you kids could take it?" },
  { id: 'start_2', event: 'start', text: "Lunch? Lunch?! That vehicle ain't no lunch shuttle. That's company property!" },
  { id: 'close_1', event: 'close', text: "A pool car? Pool?! That ain't no pool car. That is company property!" },
  { id: 'close_2', event: 'close', text: "I want names! All five of you! I am writing them down!" },
  { id: 'close_3', event: 'close', text: "You got a booking? A written booking? From the fleet manager?" },
  { id: 'near_1', event: 'near', text: "Pull over, junior! Right now! Company! Property!" },
  { id: 'near_2', event: 'near', text: "I can see you in there! Five apprentices! In a company car!" },
  { id: 'charge_1', event: 'charge', text: "Oh, now you're charging it? On the company's electricity?!" },
  { id: 'charge_2', event: 'charge', text: "Go on, plug it in! Take your time! I'm right behind you!" },
  { id: 'caught_1', event: 'caught', text: "Keys. Hand them over. That's company property. You can walk to lunch!" },
  { id: 'caught_2', event: 'caught', text: "I just called the boss. You know what the boss said? Take their keys!" },
  { id: 'won_1', event: 'won', text: "This ain't over! Next Monday! I'll be standing right here next Monday!" },
];

const MIN_SPACING = 4.5; // seconds of silence between unrelated lines

export class VoiceDirector {
  constructor(audio, hud) {
    this.audio = audio;
    this.hud = hud;
    this.reset();
  }

  reset() {
    this.cooldown = 0;
    this.armed = { close: true, near: true, charge: true };
    this.last = {};
    this.started = false;
  }

  say(event, force = false) {
    if (!force && (this.cooldown > 0 || this.audio.voiceBusy())) return false;
    const pool = LINES.filter((l) => l.event === event);
    if (!pool.length) return false;
    // Never repeat the same line twice in a row for an event.
    const options = pool.length > 1 ? pool.filter((l) => l.id !== this.last[event]) : pool;
    const line = options[Math.floor(Math.random() * options.length)];
    this.last[event] = line.id;
    const seconds = this.audio.playVoice(line, force);
    this.hud.subtitle(line.text, seconds);
    this.cooldown = seconds + MIN_SPACING;
    return true;
  }

  update(dt, { gap, charging, time }) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    if (!this.started && time > 0.5) {
      this.started = this.say('start', true);
    }

    // Each trigger re-arms only after the situation has clearly passed.
    if (gap < 14 && this.armed.near) {
      if (this.say('near', true)) this.armed.near = false;
    } else if (gap > 32) this.armed.near = true;

    if (gap < 48 && gap >= 14 && this.armed.close) {
      if (this.say('close')) this.armed.close = false;
    } else if (gap > 85) this.armed.close = true;

    if (charging && this.armed.charge) {
      if (this.say('charge')) this.armed.charge = false;
    } else if (!charging) this.armed.charge = true;
  }
}
