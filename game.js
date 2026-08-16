/** pg-siegepush — 攻城推波 (逆向塔防) */

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function mulberry32(a) {
  return function() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function deep(o) { return JSON.parse(JSON.stringify(o)); }


export function createGame({ seed = 1 } = {}) {
  return { seed, turn: 0, score: 0, level: 1, meter: 0, resources: 10, flags: {}, log: ["攻城推波：產兵／升級／進攻"], outcome: "playing", msg: "攻城推波：產兵／升級／進攻" };
}
export function getLegalActions(s) {
  if (s.outcome !== "playing") return [];
  return ["spawn","upgrade","push","eco"];
}
export function applyAction(state, action) {
  const s = deep(state);
  if (s.outcome !== "playing") return s;
  const rnd = mulberry32(s.seed + s.turn * 19);
  s.turn++;
  
  if (action === "eco") { s.resources += 4; s.msg = "收稅"; }
  else if (action === "spawn") { if (s.resources >= 2) { s.resources -= 2; s.flags.army = (s.flags.army||0)+1; s.msg = "召募"; } else s.msg = "缺金"; }
  else if (action === "upgrade") { if (s.resources >= 3) { s.resources -= 3; s.flags.pow = (s.flags.pow||0)+1; s.msg = "強化"; } else s.msg = "缺金"; }
  else {
    const atk = (s.flags.army||0) * (1 + (s.flags.pow||0));
    s.meter += atk * 8;
    s.score += atk * 5;
    s.msg = "推波傷害 "+(atk*8);
    if (rnd()<0.3) { s.flags.army = Math.max(0,(s.flags.army||0)-1); s.msg += "（有傷亡）"; }
  }

  if (s.resources < 0) s.resources = 0;
  if (s.outcome === "playing" && s.level >= 5 && s.meter >= 100) {
    s.outcome = "won";
    s.msg = "目標達成！";
  }
  if (s.outcome === "playing" && (s.resources <= 0 && s.meter < 20 && s.turn > 8)) {
    s.outcome = "lost";
    s.msg = "資源崩盤";
  }
  return s;
}
export function summarize(s) {
  return { turn: s.turn, level: s.level, meter: s.meter, score: s.score, resources: s.resources, msg: s.msg, outcome: s.outcome, flags: s.flags };
}
export function getOutcome(s) { return s.outcome; }

