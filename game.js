/**
 * 攻城推波 — 遊戲核心（純邏輯，不碰 DOM）。
 *
 * 逆向塔防：你是攻方。戰場是三條由下往上的推進路線，底下是你的大營、
 * 頂上是敵方城堡，中間散著箭塔與弩台。你花金幣把兵種部署到某一路，
 * 部隊自己行軍、接敵、拆塔、砸城門；敵方每隔一段時間放出一波守軍反推你的大營。
 *
 * 兩種操作都直接作用在戰場上：
 *   1. 部署——選兵種後點（或從兵牌拖到）某一路，新兵從部署線出發。
 *   2. 推進路線——每一路有一條可拖曳的集結線；部隊只推進到集結線為止。
 *      壓到底就是全軍突擊，往回拉就是屯兵／回防。
 *
 * `step()` 不就地改寫呼叫端的 state：吃 state 與 dt，回傳新 state 與這段時間
 * 發生的事件。呈現層（app.js）只負責畫 state、把事件轉成音效與特效。
 *
 * 座標：邏輯像素，y 往下為大。我方由大 y 往小 y 推進。
 */

// ── 戰場 ────────────────────────────────────────────────
export const FIELD_W = 360;
export const FIELD_H = 660;
export const LANES = 3;
export const LANE_MARGIN = 9;
export const LANE_W = (FIELD_W - LANE_MARGIN * 2) / LANES;
export const LANE_NAMES = ["左路", "中路", "右路"];

/** 敵堡城牆的接觸線：打到這條線就是在砸城門。 */
export const ENEMY_BASE_Y = 76;
/** 我方大營的接觸線。 */
export const HOME_BASE_Y = 604;
/** 部署線：新兵出現的位置。 */
export const DEPLOY_Y = 556;
/** 集結線最遠只能推到城牆前，最近只能拉回部署線。 */
export const FRONT_MIN_Y = ENEMY_BASE_Y + 24;
export const FRONT_MAX_Y = DEPLOY_Y - 8;
/** 「守營」的集結線位置：擋在大營前面。 */
export const HOLD_Y = 486;
/** 敵軍推到這裡就開始砸我方大營。 */
export const HOME_STOP_Y = HOME_BASE_Y - 24;

/** 集結線把手的抓取範圍（供觸控用，刻意給大一點）。 */
export const RALLY_GRIP_W = 84;
export const RALLY_GRIP_H = 24;

/** 同一路的隊形間距：後面的兵不會疊到前面的兵身上。 */
export const SPACING = 16;
export const UNIT_R = 9;
export const TOWER_R = 17;
/** 城牆／大營是一整面，接觸判定給得比單位寬：牆前可以站好幾排人一起砸。 */
export const BASE_R = 26;
/** 部署時左右錯開的幅度，讓一路看起來是一群人而不是一條線。 */
export const JITTER = 12;

export const SUB_DT = 1 / 60;
export const MAX_FRAME_DT = 0.25;
export const STAGE_CLEAR_PAUSE = 2.2;

// ── 經濟 ────────────────────────────────────────────────
export const GOLD_CAP = 120;
export const START_GOLD = 14;
/** 打死一個敵兵回收的軍資。 */
export const KILL_GOLD = 3;
/** 拆掉一座塔的賞金與帶來的常態收入。 */
export const TOWER_GOLD = 10;
export const TOWER_INCOME = 0.18;
export const HOME_BASE_HP = 380;
/** 過關時大營修補的比例。 */
export const STAGE_REPAIR = 0.3;

// ── 兵種 ────────────────────────────────────────────────
/**
 * `dmg` 打人、`siege` 打建築（塔與城牆）——攻城槌對人幾乎沒殺傷力，
 * 但一槌就是箭塔的十分之一血；弓手剛好相反。
 */
export const UNIT_TYPES = {
  militia: {
    id: "militia",
    name: "民兵",
    icon: "sword",
    cost: 4,
    pop: 1,
    hp: 80,
    dmg: 9,
    siege: 7,
    range: 30,
    interval: 0.75,
    speed: 46,
    blurb: "便宜又跑得快，用來擋住敵軍的第一線。",
  },
  archer: {
    id: "archer",
    name: "弓手",
    icon: "bow",
    cost: 7,
    pop: 1,
    hp: 40,
    dmg: 12,
    siege: 5,
    range: 110,
    interval: 0.95,
    speed: 38,
    ranged: true,
    blurb: "射程長、身板薄；前面要有人擋才活得久。",
  },
  shield: {
    id: "shield",
    name: "盾衛",
    icon: "shield",
    cost: 10,
    pop: 2,
    hp: 230,
    dmg: 7,
    siege: 8,
    range: 30,
    interval: 1,
    speed: 33,
    blurb: "替後面的人吃箭塔火力的肉盾，傷害不高。",
  },
  ram: {
    id: "ram",
    name: "攻城槌",
    icon: "structure_gate",
    cost: 15,
    pop: 3,
    hp: 320,
    dmg: 3,
    siege: 60,
    range: 36,
    interval: 1.3,
    speed: 27,
    blurb: "專拆箭塔與城牆；沒人護送就只是活靶。",
  },
};

export const UNIT_ORDER = ["militia", "archer", "shield", "ram"];

export const ENEMY_TYPES = {
  guard: {
    id: "guard",
    name: "守兵",
    hp: 72,
    dmg: 10,
    siege: 5,
    range: 30,
    interval: 0.8,
    speed: 40,
  },
  crossbow: {
    id: "crossbow",
    name: "弩手",
    hp: 44,
    dmg: 13,
    siege: 4,
    range: 118,
    interval: 1.1,
    speed: 32,
    ranged: true,
  },
  knight: {
    id: "knight",
    name: "重騎",
    hp: 200,
    dmg: 19,
    siege: 9,
    range: 32,
    interval: 0.9,
    speed: 48,
  },
};

export const TOWER_TYPES = {
  arrow: {
    id: "arrow",
    name: "箭塔",
    icon: "structure_tower",
    hp: 280,
    dmg: 13,
    range: 132,
    interval: 0.85,
  },
  bolt: {
    id: "bolt",
    name: "弩台",
    icon: "structure_watchtower",
    hp: 380,
    dmg: 22,
    range: 158,
    interval: 1.6,
  },
};

export const PROJECTILE_SPEED = 330;
/** 飛到目標這麼近就算命中。 */
export const PROJECTILE_HIT_R = 9;

// ── 關卡（三道防線，一道比一道硬） ───────────────────────
export const STAGES = [
  {
    id: 1,
    name: "外郭木柵",
    hint: "左右兩路各一座箭塔。民兵先擋線，弓手躲在後面清兵。",
    baseHp: 720,
    popCap: 14,
    income: 2.6,
    waveEvery: 26,
    waveBase: 2,
    waveGrowth: 0.6,
    waveCap: 6,
    garrison: 8,
    knightFrom: 99,
    waveMix: ["guard", "guard", "crossbow"],
    towers: [
      { lane: 0, y: 262, kind: "arrow" },
      { lane: 2, y: 262, kind: "arrow" },
    ],
  },
  {
    id: 2,
    name: "石牆內城",
    hint: "中路多了一座弩台，射程蓋過弓手；盾衛吸火、攻城槌拆塔。",
    baseHp: 1200,
    popCap: 16,
    income: 3.3,
    waveEvery: 23,
    waveBase: 3,
    waveGrowth: 0.7,
    waveCap: 7,
    garrison: 10,
    knightFrom: 5,
    waveMix: ["guard", "crossbow", "guard", "crossbow"],
    towers: [
      { lane: 0, y: 250, kind: "arrow" },
      { lane: 1, y: 206, kind: "bolt" },
      { lane: 2, y: 250, kind: "arrow" },
    ],
  },
  {
    id: 3,
    name: "主堡天守",
    hint: "三路都有塔，重騎會不斷衝營。留一路守營，另外兩路壓上去。",
    baseHp: 1800,
    popCap: 18,
    income: 4,
    waveEvery: 22,
    waveBase: 3,
    waveGrowth: 0.8,
    waveCap: 7,
    garrison: 12,
    knightFrom: 3,
    waveMix: ["guard", "crossbow", "knight", "crossbow"],
    towers: [
      { lane: 0, y: 286, kind: "arrow" },
      { lane: 1, y: 214, kind: "bolt" },
      { lane: 2, y: 286, kind: "arrow" },
    ],
  },
];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export const laneX = (lane) => LANE_MARGIN + LANE_W * (lane + 0.5);

/** 點在哪一路上；戰場外回傳 null。 */
export function laneAt(point) {
  const lane = Math.floor((point.x - LANE_MARGIN) / LANE_W);
  return lane >= 0 && lane < LANES ? lane : null;
}

/** 部署時的左右錯位：由 id 決定，所以同一場重播長得一樣。 */
function jitterFor(id) {
  const t = Math.sin(id * 12.9898) * 43758.5453;
  return (t - Math.floor(t) - 0.5) * 2 * JITTER;
}

// ── 開局 ────────────────────────────────────────────────

function makeTowers(stageIndex, startId) {
  return STAGES[stageIndex].towers.map((spec, index) => {
    const type = TOWER_TYPES[spec.kind];
    return {
      id: startId + index,
      kind: spec.kind,
      lane: spec.lane,
      x: laneX(spec.lane),
      y: spec.y,
      hp: type.hp,
      maxHp: type.hp,
      cd: type.interval * 0.5,
    };
  });
}

function loadStage(state, stageIndex) {
  const stage = STAGES[stageIndex];
  const towers = makeTowers(stageIndex, state.nextId);
  return {
    ...state,
    stageIndex,
    phase: "battle",
    time: 0,
    wave: 1,
    waveTimer: stage.waveEvery * 0.75,
    gold: Math.max(state.gold, START_GOLD),
    income: stage.income,
    pop: 0,
    popCap: stage.popCap,
    units: [],
    projectiles: [],
    towers,
    nextId: state.nextId + towers.length,
    enemyBase: { hp: stage.baseHp, maxHp: stage.baseHp },
    rally: Array.from({ length: LANES }, () => FRONT_MIN_Y),
    clearTimer: 0,
  };
}

export function createGame() {
  const base = {
    phase: "ready",
    stageIndex: 0,
    time: 0,
    wave: 1,
    waveTimer: 0,
    gold: START_GOLD,
    income: STAGES[0].income,
    pop: 0,
    popCap: STAGES[0].popCap,
    selected: UNIT_ORDER[0],
    units: [],
    towers: [],
    projectiles: [],
    enemyBase: { hp: STAGES[0].baseHp, maxHp: STAGES[0].baseHp },
    homeBase: { hp: HOME_BASE_HP, maxHp: HOME_BASE_HP },
    rally: Array.from({ length: LANES }, () => FRONT_MIN_Y),
    nextId: 1,
    clearTimer: 0,
    score: 0,
    stats: { deployed: 0, kills: 0, towers: 0, waves: 0, lost: 0, goldSpent: 0 },
  };
  return { ...loadStage(base, 0), phase: "ready" };
}

export function startGame() {
  return { ...createGame(), phase: "battle" };
}

// ── 玩家指令 ────────────────────────────────────────────

export function selectUnit(state, type) {
  if (!UNIT_TYPES[type]) return state;
  return { ...state, selected: type };
}

/** 部署前的檢查：回傳 `{ ok, reason }`，reason 直接對應介面上的提示。 */
export function canDeploy(state, type) {
  const spec = UNIT_TYPES[type];
  if (!spec) return { ok: false, reason: "type" };
  if (state.phase !== "battle") return { ok: false, reason: "phase" };
  if (state.gold < spec.cost) return { ok: false, reason: "gold" };
  if (state.pop + spec.pop > state.popCap) return { ok: false, reason: "pop" };
  return { ok: true, reason: null };
}

/**
 * 造一個單位。部署與波次都走這裡，測試也用它擺盤（擺完再自己覆寫 x／y）。
 */
export function createUnit(id, side, type, lane) {
  const spec = side === "player" ? UNIT_TYPES[type] : ENEMY_TYPES[type];
  if (!spec) throw new Error(`unknown ${side} unit ${type}`);
  return makeUnit(id, side, type, lane, spec);
}

function makeUnit(id, side, type, lane, spec) {
  // 前後也錯開一點：同一瞬間放兩個兵才不會完全重疊、卡在同一個 y 上。
  const stagger = jitterFor(id + 313) * 0.9;
  return {
    id,
    side,
    type,
    lane,
    x: laneX(lane) + jitterFor(id),
    y: side === "player" ? DEPLOY_Y + stagger : ENEMY_BASE_Y + 20 + Math.abs(stagger),
    hp: spec.hp,
    maxHp: spec.hp,
    cd: 0,
    swing: 0,
    engaged: false,
  };
}

/**
 * 把一個兵放到某一路的部署線上。金幣或人口不夠就原封不動回傳，
 * 並附上一個 `denied` 事件讓介面播回絕音。
 */
export function deploy(state, type, lane) {
  const check = canDeploy(state, type);
  if (!check.ok) return { state, events: [{ type: "denied", reason: check.reason }] };
  if (!(lane >= 0 && lane < LANES)) return { state, events: [{ type: "denied", reason: "lane" }] };

  const spec = UNIT_TYPES[type];
  const unit = makeUnit(state.nextId, "player", type, lane, spec);
  return {
    state: {
      ...state,
      gold: state.gold - spec.cost,
      pop: state.pop + spec.pop,
      units: [...state.units, unit],
      nextId: state.nextId + 1,
      selected: type,
      stats: {
        ...state.stats,
        deployed: state.stats.deployed + 1,
        goldSpent: state.stats.goldSpent + spec.cost,
      },
    },
    events: [{ type: "deploy", unit: type, lane, x: unit.x, y: unit.y }],
  };
}

/** 抓到哪一路的集結線把手；沒抓到回傳 null。 */
export function hitRallyLane(state, point) {
  for (let lane = 0; lane < LANES; lane += 1) {
    const dx = Math.abs(point.x - laneX(lane));
    const dy = Math.abs(point.y - state.rally[lane]);
    if (dx <= RALLY_GRIP_W / 2 && dy <= RALLY_GRIP_H) return lane;
  }
  return null;
}

export function setRally(state, lane, y) {
  if (!(lane >= 0 && lane < LANES)) return state;
  const rally = [...state.rally];
  rally[lane] = clamp(y, FRONT_MIN_Y, FRONT_MAX_Y);
  return { ...state, rally };
}

/** 集結線壓到城牆前就是「壓上」，其餘都算「守」。 */
export function laneStance(state, lane) {
  return state.rally[lane] <= FRONT_MIN_Y + 1 ? "push" : "hold";
}

export function setLaneStance(state, lane, stance) {
  return setRally(state, lane, stance === "push" ? FRONT_MIN_Y : HOLD_Y);
}

export function toggleLaneStance(state, lane) {
  return setLaneStance(state, lane, laneStance(state, lane) === "push" ? "hold" : "push");
}

// ── 波次 ────────────────────────────────────────────────

/**
 * 第 `wave` 波的守軍組成。純函式、不吃亂數，所以同一關的第 N 波永遠一樣，
 * 玩家可以背下節奏，測試也能直接斷言。
 */
export function waveComposition(stageIndex, wave) {
  const stage = STAGES[stageIndex];
  if (!stage || wave < 1) return [];
  const size = Math.min(stage.waveCap, stage.waveBase + Math.floor((wave - 1) * stage.waveGrowth));
  const out = [];
  for (let i = 0; i < size; i += 1) {
    out.push({
      type: stage.waveMix[(i + wave - 1) % stage.waveMix.length],
      lane: (i + wave - 1) % LANES,
    });
  }
  if (wave >= stage.knightFrom) {
    const knights = 1 + Math.floor((wave - stage.knightFrom) / 3);
    for (let i = 0; i < knights; i += 1) out.push({ type: "knight", lane: (i + wave) % LANES });
  }
  return out;
}

function spawnWave(draft, events) {
  const stage = STAGES[draft.stageIndex];
  // 城裡的營房是有上限的：上一波沒清乾淨，這一波就放不滿。
  // 沒有這條，守軍會無限堆積，攻方再會打也只是拖時間。
  const alive = draft.units.filter((unit) => unit.side === "enemy").length;
  const roster = waveComposition(draft.stageIndex, draft.wave).slice(
    0,
    Math.max(0, stage.garrison - alive),
  );
  for (const slot of roster) {
    const spec = ENEMY_TYPES[slot.type];
    draft.units.push(makeUnit(draft.nextId, "enemy", slot.type, slot.lane, spec));
    draft.nextId += 1;
  }
  events.push({ type: "waveIncoming", wave: draft.wave, size: roster.length });
  draft.stats.waves += 1;
  draft.wave += 1;
  draft.waveTimer = STAGES[draft.stageIndex].waveEvery;
}

// ── 目標選擇與戰鬥 ───────────────────────────────────────

function specOf(unit) {
  return unit.side === "player" ? UNIT_TYPES[unit.type] : ENEMY_TYPES[unit.type];
}

/**
 * 找最近的可打目標。距離是實際的歐氏距離減掉目標半徑，所以近戰只打得到
 * 同一路的人，弓手則可以斜著射到隔壁路。城牆／大營一律用該路正前方計算。
 */
function nearestTarget(draft, unit) {
  let best = null;
  const consider = (kind, ref, x, y, r) => {
    const dist = Math.hypot(unit.x - x, unit.y - y) - r;
    if (!best || dist < best.dist) best = { kind, ref, x, y, dist };
  };

  if (unit.side === "player") {
    for (const other of draft.units) {
      if (other.side === "enemy" && other.hp > 0) consider("unit", other, other.x, other.y, UNIT_R);
    }
    for (const tower of draft.towers) {
      if (tower.hp > 0) consider("tower", tower, tower.x, tower.y, TOWER_R);
    }
    if (draft.enemyBase.hp > 0) consider("base", draft.enemyBase, unit.x, ENEMY_BASE_Y, BASE_R);
  } else {
    for (const other of draft.units) {
      if (other.side === "player" && other.hp > 0) consider("unit", other, other.x, other.y, UNIT_R);
    }
    if (draft.homeBase.hp > 0) consider("base", draft.homeBase, unit.x, HOME_BASE_Y, BASE_R);
  }
  return best;
}

function damageTarget(draft, attacker, target, events) {
  const spec = specOf(attacker);
  const amount = target.kind === "unit" ? spec.dmg : spec.siege;
  target.ref.hp -= amount;
  events.push({
    type: "hit",
    kind: target.kind,
    side: attacker.side,
    x: target.x,
    y: target.y,
    amount,
    fatal: target.ref.hp <= 0,
  });
  if (target.kind === "base") {
    events.push({
      type: "baseHit",
      side: attacker.side === "player" ? "enemy" : "home",
      x: target.x,
      y: target.y,
    });
  }
}

function fire(draft, attacker, target, events) {
  const spec = specOf(attacker);
  attacker.cd = spec.interval;
  attacker.swing = 0.18;
  if (!spec.ranged) {
    events.push({ type: "melee", side: attacker.side, x: attacker.x, y: attacker.y });
    damageTarget(draft, attacker, target, events);
    return;
  }
  draft.projectiles.push({
    id: draft.nextId,
    side: attacker.side,
    x: attacker.x,
    y: attacker.y,
    tx: target.x,
    ty: target.y,
    targetKind: target.kind,
    targetId: target.kind === "base" ? 0 : target.ref.id,
    dmg: spec.dmg,
    siege: spec.siege,
  });
  draft.nextId += 1;
  events.push({ type: "shoot", side: attacker.side, x: attacker.x, y: attacker.y });
}

function towerFire(draft, tower, events) {
  const type = TOWER_TYPES[tower.kind];
  let best = null;
  for (const unit of draft.units) {
    if (unit.side !== "player" || unit.hp <= 0) continue;
    const dist = Math.hypot(unit.x - tower.x, unit.y - tower.y);
    if (dist > type.range) continue;
    if (!best || dist < best.dist) best = { unit, dist };
  }
  if (!best) return;
  tower.cd = type.interval;
  draft.projectiles.push({
    id: draft.nextId,
    side: "enemy",
    x: tower.x,
    y: tower.y,
    tx: best.unit.x,
    ty: best.unit.y,
    targetKind: "unit",
    targetId: best.unit.id,
    dmg: type.dmg,
    siege: type.dmg,
  });
  draft.nextId += 1;
  events.push({ type: "shoot", side: "enemy", from: "tower", x: tower.x, y: tower.y });
}

/** 後面的兵不會走進前面同袍的背上：把落點夾在間距之外。 */
function formationLimit(draft, unit, wanted) {
  let limited = wanted;
  for (const other of draft.units) {
    if (other === unit || other.hp <= 0) continue;
    if (other.side !== unit.side || other.lane !== unit.lane) continue;
    if (unit.side === "player") {
      if (other.y < unit.y) limited = Math.max(limited, other.y + SPACING);
    } else if (other.y > unit.y) {
      limited = Math.min(limited, other.y - SPACING);
    }
  }
  return limited;
}

function stepUnits(draft, dt, events) {
  for (const unit of draft.units) {
    if (unit.hp <= 0) continue;
    const spec = specOf(unit);
    unit.cd = Math.max(0, unit.cd - dt);
    unit.swing = Math.max(0, unit.swing - dt);

    const target = nearestTarget(draft, unit);
    const inRange = target && target.dist <= spec.range;
    unit.engaged = !!inRange;

    if (inRange) {
      if (unit.cd <= 0) fire(draft, unit, target, events);
      // 遇到人或塔就停下來打；砸城牆則是邊推邊砸，後面的人才擠得上牆。
      if (target.kind !== "base") continue;
    }

    if (unit.side === "player") {
      const limit = Math.max(draft.rally[unit.lane], FRONT_MIN_Y);
      const wanted = Math.max(limit, unit.y - spec.speed * dt);
      unit.y = Math.min(unit.y, formationLimit(draft, unit, wanted));
    } else {
      const wanted = Math.min(HOME_STOP_Y, unit.y + spec.speed * dt);
      unit.y = Math.max(unit.y, formationLimit(draft, unit, wanted));
    }
  }
}

function stepTowers(draft, dt, events) {
  for (const tower of draft.towers) {
    if (tower.hp <= 0) continue;
    tower.cd = Math.max(0, tower.cd - dt);
    if (tower.cd <= 0) towerFire(draft, tower, events);
  }
}

function findTarget(draft, projectile) {
  if (projectile.targetKind === "base") {
    const base = projectile.side === "player" ? draft.enemyBase : draft.homeBase;
    return base.hp > 0 ? { kind: "base", ref: base, x: projectile.tx, y: projectile.ty } : null;
  }
  if (projectile.targetKind === "tower") {
    const tower = draft.towers.find((item) => item.id === projectile.targetId && item.hp > 0);
    return tower ? { kind: "tower", ref: tower, x: tower.x, y: tower.y } : null;
  }
  const unit = draft.units.find((item) => item.id === projectile.targetId && item.hp > 0);
  return unit ? { kind: "unit", ref: unit, x: unit.x, y: unit.y } : null;
}

function stepProjectiles(draft, dt, events) {
  const alive = [];
  for (const projectile of draft.projectiles) {
    const target = findTarget(draft, projectile);
    // 目標已經死了：箭照樣飛完最後一段再消失，不會憑空不見。
    const aimX = target ? target.x : projectile.tx;
    const aimY = target ? target.y : projectile.ty;
    projectile.tx = aimX;
    projectile.ty = aimY;

    const dx = aimX - projectile.x;
    const dy = aimY - projectile.y;
    const dist = Math.hypot(dx, dy);
    const travel = PROJECTILE_SPEED * dt;

    if (dist <= Math.max(PROJECTILE_HIT_R, travel)) {
      projectile.x = aimX;
      projectile.y = aimY;
      if (target) {
        const amount = target.kind === "unit" ? projectile.dmg : projectile.siege;
        target.ref.hp -= amount;
        events.push({
          type: "hit",
          kind: target.kind,
          side: projectile.side,
          x: aimX,
          y: aimY,
          amount,
          fatal: target.ref.hp <= 0,
          ranged: true,
        });
        if (target.kind === "base") {
          events.push({
            type: "baseHit",
            side: projectile.side === "player" ? "enemy" : "home",
            x: aimX,
            y: aimY,
          });
        }
      } else {
        events.push({ type: "miss", x: aimX, y: aimY });
      }
      continue;
    }

    projectile.x += (dx / dist) * travel;
    projectile.y += (dy / dist) * travel;
    alive.push(projectile);
  }
  draft.projectiles = alive;
}

function reap(draft, events) {
  const survivors = [];
  for (const unit of draft.units) {
    if (unit.hp > 0) {
      survivors.push(unit);
      continue;
    }
    events.push({ type: "unitDie", side: unit.side, unit: unit.type, x: unit.x, y: unit.y });
    if (unit.side === "player") {
      draft.pop -= UNIT_TYPES[unit.type].pop;
      draft.stats.lost += 1;
    } else {
      draft.gold = Math.min(GOLD_CAP, draft.gold + KILL_GOLD);
      draft.stats.kills += 1;
      draft.score += 12;
      events.push({ type: "loot", amount: KILL_GOLD, x: unit.x, y: unit.y });
    }
  }
  draft.units = survivors;
  draft.pop = Math.max(0, draft.pop);

  const towers = [];
  for (const tower of draft.towers) {
    if (tower.hp > 0) {
      towers.push(tower);
      continue;
    }
    draft.gold = Math.min(GOLD_CAP, draft.gold + TOWER_GOLD);
    draft.income += TOWER_INCOME;
    draft.stats.towers += 1;
    draft.score += 80;
    events.push({ type: "towerDestroy", x: tower.x, y: tower.y, kind: tower.kind });
  }
  draft.towers = towers;
}

function advanceStage(draft, events) {
  const nextIndex = draft.stageIndex + 1;
  draft.score += 400 + Math.round(draft.homeBase.hp);
  if (nextIndex >= STAGES.length) {
    draft.phase = "won";
    events.push({ type: "win", score: draft.score });
    return;
  }
  const repaired = Math.min(
    draft.homeBase.maxHp,
    draft.homeBase.hp + draft.homeBase.maxHp * STAGE_REPAIR,
  );
  Object.assign(draft, loadStage(draft, nextIndex));
  draft.homeBase = { ...draft.homeBase, hp: repaired };
  events.push({ type: "stageStart", stage: nextIndex + 1, name: STAGES[nextIndex].name });
}

function advanceOnce(draft, dt, events) {
  if (draft.phase === "stageClear") {
    draft.clearTimer -= dt;
    if (draft.clearTimer <= 0) advanceStage(draft, events);
    return;
  }
  if (draft.phase !== "battle") return;

  draft.time += dt;
  draft.gold = Math.min(GOLD_CAP, draft.gold + draft.income * dt);

  draft.waveTimer -= dt;
  if (draft.waveTimer <= 0) spawnWave(draft, events);

  stepUnits(draft, dt, events);
  stepTowers(draft, dt, events);
  stepProjectiles(draft, dt, events);
  reap(draft, events);

  if (draft.homeBase.hp <= 0) {
    draft.homeBase.hp = 0;
    draft.phase = "lost";
    events.push({ type: "lose", score: draft.score, stage: draft.stageIndex + 1 });
    return;
  }
  if (draft.enemyBase.hp <= 0) {
    draft.enemyBase.hp = 0;
    draft.phase = "stageClear";
    draft.clearTimer = STAGE_CLEAR_PAUSE;
    draft.projectiles = [];
    events.push({ type: "stageClear", stage: draft.stageIndex + 1 });
  }
}

function draftOf(state) {
  return {
    ...state,
    units: state.units.map((unit) => ({ ...unit })),
    towers: state.towers.map((tower) => ({ ...tower })),
    projectiles: state.projectiles.map((projectile) => ({ ...projectile })),
    enemyBase: { ...state.enemyBase },
    homeBase: { ...state.homeBase },
    rally: [...state.rally],
    stats: { ...state.stats },
  };
}

/**
 * 推進 dt 秒。內部固定切成 1/60 秒的小步，所以掉幀（或測試裡一次餵一大塊
 * 時間）不會讓部隊穿過彼此、也不會漏掉射擊。
 */
export function step(state, dt) {
  if (!(dt > 0)) return { state, events: [] };
  if (state.phase !== "battle" && state.phase !== "stageClear") return { state, events: [] };

  const draft = draftOf(state);
  const events = [];
  let remaining = Math.min(dt, MAX_FRAME_DT);
  while (remaining > 1e-9) {
    const h = Math.min(SUB_DT, remaining);
    advanceOnce(draft, h, events);
    remaining -= h;
    if (draft.phase === "won" || draft.phase === "lost") break;
  }
  return { state: draft, events };
}

// ── 給 UI 的摘要 ─────────────────────────────────────────

export function summarize(state) {
  const stage = STAGES[state.stageIndex];
  const ours = state.units.filter((unit) => unit.side === "player").length;
  const theirs = state.units.filter((unit) => unit.side === "enemy").length;
  return {
    phase: state.phase,
    stage: {
      id: stage.id,
      name: stage.name,
      hint: stage.hint,
      index: state.stageIndex + 1,
      of: STAGES.length,
    },
    wave: state.wave,
    waveIn: Math.max(0, state.waveTimer),
    gold: Math.floor(state.gold),
    income: state.income,
    pop: state.pop,
    popCap: state.popCap,
    enemyBase: { ...state.enemyBase },
    homeBase: { ...state.homeBase },
    towersLeft: state.towers.length,
    ours,
    theirs,
    selected: state.selected,
    score: state.score,
    stats: { ...state.stats },
    roster: UNIT_ORDER.map((type) => ({
      ...UNIT_TYPES[type],
      affordable: canDeploy(state, type).ok,
    })),
    stances: state.rally.map((_, lane) => laneStance(state, lane)),
  };
}
