/**
 * 攻城推波 — 音效。全部是 `assets/audio/` 裡的真實取樣（Kenney／OpenGameArt，CC0），
 * 沒有合成音、沒有遠端素材。
 *
 * 戰場上刀劍與箭矢是密集重疊的，所以每個音各留一小池 <audio>：
 * 十個兵同時揮刀時可以疊著響，不會互相切斷成「一聲」。
 */

const BANK = {
  melee0: { src: "./assets/audio/melee-0.ogg", volume: 0.3, size: 3 },
  melee1: { src: "./assets/audio/melee-1.ogg", volume: 0.3, size: 3 },
  melee2: { src: "./assets/audio/melee-2.ogg", volume: 0.28, size: 3 },
  bow: { src: "./assets/audio/bowshot.ogg", volume: 0.26, size: 4 },
  arrowHit: { src: "./assets/audio/arrow-hit.ogg", volume: 0.26, size: 4 },
  ram0: { src: "./assets/audio/ram-0.ogg", volume: 0.42, size: 2 },
  ram1: { src: "./assets/audio/ram-1.ogg", volume: 0.42, size: 2 },
  breach: { src: "./assets/audio/breach.ogg", volume: 0.45, size: 2 },
  die: { src: "./assets/audio/unit-die.ogg", volume: 0.24, size: 3 },
  collapse: { src: "./assets/audio/collapse.ogg", volume: 0.5, size: 2 },
  alarm: { src: "./assets/audio/alarm.ogg", volume: 0.4, size: 1 },
  horn: { src: "./assets/audio/horn.ogg", volume: 0.4, size: 1 },
  coin: { src: "./assets/audio/coin.ogg", volume: 0.3, size: 2 },
  deploy: { src: "./assets/audio/deploy.ogg", volume: 0.4, size: 3 },
  deny: { src: "./assets/audio/deny.ogg", volume: 0.34, size: 1 },
  ui: { src: "./assets/audio/ui-click.ogg", volume: 0.32, size: 2 },
  stageClear: { src: "./assets/audio/stage-clear.ogg", volume: 0.5, size: 1 },
  win: { src: "./assets/audio/win.ogg", volume: 0.55, size: 1 },
  lose: { src: "./assets/audio/lose.ogg", volume: 0.5, size: 1 },
};

const MELEE_KEYS = ["melee0", "melee1", "melee2"];
const RAM_KEYS = ["ram0", "ram1"];

class Pool {
  constructor({ src, volume, size }) {
    this.volume = volume;
    this.cursor = 0;
    this.nodes = Array.from({ length: size }, () => {
      const node = new Audio(src);
      node.preload = "auto";
      node.volume = volume;
      return node;
    });
  }

  play(rate = 1, gain = 1) {
    const node = this.nodes[this.cursor];
    this.cursor = (this.cursor + 1) % this.nodes.length;
    try {
      node.pause();
      node.currentTime = 0;
      node.playbackRate = rate;
      node.volume = Math.max(0, Math.min(1, this.volume * gain));
      const played = node.play();
      if (played && typeof played.catch === "function") played.catch(() => {});
    } catch {
      // 還沒被使用者手勢解鎖，或瀏覽器不給播：靜靜跳過。
    }
  }
}

export class SiegeAudio {
  constructor() {
    this.enabled = true;
    this.pools = null;
    this.music = null;
    this.turn = 0;
    /** 同一幀裡幾十個兵一起揮刀，只放最前面幾聲，不然會糊成雜訊。 */
    this.budget = 0;
  }

  /** 第一個使用者手勢時呼叫：建池並戳一下，讓行動裝置解鎖播放。 */
  unlock() {
    if (this.pools) return;
    this.pools = {};
    for (const [name, spec] of Object.entries(BANK)) this.pools[name] = new Pool(spec);
    this.music = new Audio("./assets/audio/bgm.ogg");
    this.music.loop = true;
    this.music.volume = 0.16;
    this.music.preload = "auto";
    const primer = this.pools.ui.nodes[0];
    try {
      primer.volume = 0;
      const played = primer.play();
      if (played && typeof played.catch === "function") played.catch(() => {});
      primer.pause();
      primer.currentTime = 0;
      primer.volume = BANK.ui.volume;
    } catch {
      // 忽略：真正播放時還會再試一次。
    }
    if (this.enabled) void this.music.play().catch(() => {});
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.music) return;
    if (this.enabled) void this.music.play().catch(() => {});
    else this.music.pause();
  }

  /** 每一幀開頭呼叫，重置這一幀的戰鬥音配額。 */
  frame() {
    this.budget = 4;
  }

  play(name, rate = 1, gain = 1) {
    if (!this.enabled) return;
    this.unlock();
    this.pools?.[name]?.play(rate, gain);
  }

  /** 有配額才發聲的戰鬥音：刀劍、弓弦、箭落。 */
  combat(name, rate = 1, gain = 1) {
    if (this.budget <= 0) return;
    this.budget -= 1;
    this.play(name, rate, gain);
  }

  meleeSfx() {
    const key = MELEE_KEYS[this.turn % MELEE_KEYS.length];
    this.turn += 1;
    this.combat(key, 0.92 + Math.random() * 0.2, 0.9);
  }

  bowSfx() {
    this.combat("bow", 1.05 + Math.random() * 0.15);
  }

  arrowHitSfx() {
    this.combat("arrowHit", 0.95 + Math.random() * 0.2, 0.8);
  }

  /** 攻城槌／近戰砸城牆：撞得越重越低沉。 */
  ramSfx(amount = 10) {
    const key = RAM_KEYS[this.turn % RAM_KEYS.length];
    this.turn += 1;
    const heavy = Math.min(1, amount / 60);
    this.combat(key, 1.1 - heavy * 0.35, 0.6 + heavy * 0.6);
  }

  dieSfx() {
    this.combat("die", 0.9 + Math.random() * 0.25, 0.85);
  }

  breachSfx() {
    this.play("breach");
  }

  collapseSfx() {
    this.play("collapse", 0.85);
  }

  alarmSfx() {
    this.play("alarm", 0.9);
  }

  hornSfx() {
    this.play("horn", 0.8);
  }

  coinSfx() {
    this.play("coin", 1.1, 0.7);
  }

  deploySfx() {
    this.play("deploy");
  }

  denySfx() {
    this.play("deny");
  }

  uiSfx() {
    this.play("ui");
  }

  stageClearSfx() {
    this.play("stageClear");
  }

  winSfx() {
    this.play("win");
  }

  loseSfx() {
    this.play("lose", 0.92);
  }
}
