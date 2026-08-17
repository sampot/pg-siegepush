import { describe, expect, it } from "vitest";
import {
  DEPLOY_Y,
  ENEMY_BASE_Y,
  FRONT_MAX_Y,
  FRONT_MIN_Y,
  GOLD_CAP,
  HOLD_Y,
  HOME_BASE_Y,
  HOME_STOP_Y,
  JITTER,
  KILL_GOLD,
  LANES,
  SPACING,
  STAGES,
  START_GOLD,
  TOWER_GOLD,
  TOWER_INCOME,
  TOWER_TYPES,
  UNIT_ORDER,
  UNIT_TYPES,
  canDeploy,
  createGame,
  createUnit,
  deploy,
  hitRallyLane,
  laneAt,
  laneStance,
  laneX,
  selectUnit,
  setLaneStance,
  setRally,
  startGame,
  step,
  summarize,
  toggleLaneStance,
  waveComposition,
} from "./game.js";

/** 把單位擺在指定位置：測試要控制的是局面，不是走路的過程。 */
function unitAt(id, side, type, lane, y, x = laneX(lane)) {
  return { ...createUnit(id, side, type, lane), x, y };
}

/** 跑 `seconds` 秒；回傳最後的 state 與這段時間內所有事件。 */
function run(state, seconds, dt = 1 / 30) {
  let current = state;
  const events = [];
  for (let t = 0; t < seconds; t += dt) {
    const result = step(current, dt);
    current = result.state;
    events.push(...result.events);
    if (current.phase === "won" || current.phase === "lost") break;
  }
  return { state: current, events };
}

/** 開一場只有我方部隊、沒有塔也沒有守軍波次的乾淨戰場。 */
function sandbox(overrides = {}) {
  return {
    ...startGame(),
    towers: [],
    waveTimer: 9999,
    ...overrides,
  };
}

describe("戰場座標", () => {
  it("三條路平分戰場寬度", () => {
    expect(laneX(0)).toBeLessThan(laneX(1));
    expect(laneX(1)).toBeLessThan(laneX(2));
    expect(laneAt({ x: laneX(0) })).toBe(0);
    expect(laneAt({ x: laneX(1) })).toBe(1);
    expect(laneAt({ x: laneX(2) })).toBe(2);
  });

  it("戰場外的點不屬於任何一路", () => {
    expect(laneAt({ x: -20 })).toBeNull();
    expect(laneAt({ x: 9999 })).toBeNull();
  });

  it("敵堡在上、我方大營在下，部署線在大營前面", () => {
    expect(ENEMY_BASE_Y).toBeLessThan(DEPLOY_Y);
    expect(DEPLOY_Y).toBeLessThan(HOME_BASE_Y);
    expect(HOME_STOP_Y).toBeLessThan(HOME_BASE_Y);
  });
});

describe("集結線（推進路線）", () => {
  it("開局三路都壓在城牆前", () => {
    const game = startGame();
    expect(game.rally).toEqual([FRONT_MIN_Y, FRONT_MIN_Y, FRONT_MIN_Y]);
    expect(summarize(game).stances).toEqual(["push", "push", "push"]);
  });

  it("集結線夾在城牆前與部署線之間", () => {
    const game = startGame();
    expect(setRally(game, 0, -500).rally[0]).toBe(FRONT_MIN_Y);
    expect(setRally(game, 0, 99999).rally[0]).toBe(FRONT_MAX_Y);
    expect(setRally(game, 1, 300).rally[1]).toBe(300);
  });

  it("守／壓上是同一條集結線的兩個位置", () => {
    let game = setLaneStance(startGame(), 2, "hold");
    expect(game.rally[2]).toBe(HOLD_Y);
    expect(laneStance(game, 2)).toBe("hold");
    game = toggleLaneStance(game, 2);
    expect(laneStance(game, 2)).toBe("push");
    expect(game.rally[2]).toBe(FRONT_MIN_Y);
  });

  it("只在把手範圍內才抓得到集結線", () => {
    const game = setRally(startGame(), 1, 300);
    expect(hitRallyLane(game, { x: laneX(1), y: 300 })).toBe(1);
    expect(hitRallyLane(game, { x: laneX(1), y: 300 + 60 })).toBeNull();
    expect(hitRallyLane(game, { x: laneX(1) + 90, y: 300 })).toBeNull();
  });

  it("不合法的路線編號不會動到局面", () => {
    const game = startGame();
    expect(setRally(game, 7, 200)).toBe(game);
    expect(setRally(game, -1, 200)).toBe(game);
  });
});

describe("開局", () => {
  it("createGame 給出完整可讀的初始局面", () => {
    const game = createGame();
    expect(game.phase).toBe("ready");
    expect(game.gold).toBe(START_GOLD);
    expect(game.pop).toBe(0);
    expect(game.units).toEqual([]);
    expect(game.homeBase.hp).toBe(game.homeBase.maxHp);
    expect(game.enemyBase.hp).toBe(STAGES[0].baseHp);
    expect(game.towers).toHaveLength(STAGES[0].towers.length);
    expect(game.rally).toHaveLength(LANES);
  });

  it("塔照第一關的佈防表擺，血量取自塔種", () => {
    const game = createGame();
    for (const [index, spec] of STAGES[0].towers.entries()) {
      const tower = game.towers[index];
      expect(tower.lane).toBe(spec.lane);
      expect(tower.y).toBe(spec.y);
      expect(tower.hp).toBe(TOWER_TYPES[spec.kind].hp);
    }
    const ids = game.towers.map((tower) => tower.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.max(...ids)).toBeLessThan(game.nextId);
  });

  it("還沒開打時 step 不動任何東西", () => {
    const game = createGame();
    const result = step(game, 1);
    expect(result.state).toBe(game);
    expect(result.events).toEqual([]);
  });
});

describe("部署", () => {
  it("部署扣掉軍資與人口，兵出現在指定的那一路", () => {
    const game = startGame();
    const { state, events } = deploy(game, "militia", 2);
    const spec = UNIT_TYPES.militia;
    expect(state.gold).toBe(START_GOLD - spec.cost);
    expect(state.pop).toBe(spec.pop);
    expect(state.units).toHaveLength(1);
    expect(state.units[0]).toMatchObject({ side: "player", type: "militia", lane: 2 });
    // 部署線上前後略微錯開，兩個同時放的兵才不會完全疊在一起。
    expect(Math.abs(state.units[0].y - DEPLOY_Y)).toBeLessThan(JITTER * 1.5);
    expect(events).toEqual([expect.objectContaining({ type: "deploy", unit: "militia", lane: 2 })]);
    expect(state.stats.deployed).toBe(1);
    expect(state.stats.goldSpent).toBe(spec.cost);
  });

  it("部署是不可變的：原本的局面完全沒被動到", () => {
    const game = startGame();
    const snapshot = JSON.stringify(game);
    deploy(game, "militia", 0);
    expect(JSON.stringify(game)).toBe(snapshot);
  });

  it("軍資不夠就派不出去，而且會說明原因", () => {
    const game = { ...startGame(), gold: 1 };
    expect(canDeploy(game, "ram")).toEqual({ ok: false, reason: "gold" });
    const { state, events } = deploy(game, "ram", 1);
    expect(state).toBe(game);
    expect(events).toEqual([{ type: "denied", reason: "gold" }]);
  });

  it("人口滿了就派不出去", () => {
    const game = { ...startGame(), gold: 99, pop: STAGES[0].popCap };
    expect(canDeploy(game, "militia")).toEqual({ ok: false, reason: "pop" });
    expect(deploy(game, "militia", 0).state).toBe(game);
  });

  it("攻城槌佔三個人口，剛好卡在上限時就不能派", () => {
    const spec = UNIT_TYPES.ram;
    const game = { ...startGame(), gold: 99, pop: STAGES[0].popCap - spec.pop + 1 };
    expect(canDeploy(game, "ram").reason).toBe("pop");
    expect(canDeploy(game, "militia").ok).toBe(true);
  });

  it("開打前與不存在的兵種都派不出去", () => {
    expect(canDeploy(createGame(), "militia")).toEqual({ ok: false, reason: "phase" });
    expect(canDeploy(startGame(), "dragon")).toEqual({ ok: false, reason: "type" });
    expect(deploy(startGame(), "militia", 9).events[0]).toEqual({ type: "denied", reason: "lane" });
  });

  it("選兵種只換選取狀態，亂給的兵種會被忽略", () => {
    const game = startGame();
    expect(selectUnit(game, "ram").selected).toBe("ram");
    expect(selectUnit(game, "nope")).toBe(game);
    expect(UNIT_ORDER).toContain(game.selected);
  });
});

describe("經濟", () => {
  it("軍資隨時間累積，並停在上限", () => {
    const grown = run(sandbox(), 4).state;
    expect(grown.gold).toBeGreaterThan(START_GOLD);
    expect(grown.gold).toBeCloseTo(START_GOLD + STAGES[0].income * 4, 0);

    const capped = run(sandbox({ gold: GOLD_CAP - 1 }), 10).state;
    expect(capped.gold).toBe(GOLD_CAP);
  });

  it("打死守軍會回收軍資並記在戰績上", () => {
    const base = sandbox({ gold: 0 });
    const game = {
      ...base,
      units: [
        unitAt(101, "player", "militia", 1, 300),
        { ...unitAt(102, "enemy", "guard", 1, 320), hp: 1 },
      ],
    };
    const { state, events } = run(game, 1);
    expect(state.units.some((unit) => unit.side === "enemy")).toBe(false);
    expect(state.stats.kills).toBe(1);
    expect(state.gold).toBeGreaterThanOrEqual(KILL_GOLD);
    expect(events.some((event) => event.type === "loot")).toBe(true);
  });

  it("拆掉塔有賞金，而且之後每秒多賺一點", () => {
    const game = {
      ...startGame(),
      gold: 0,
      waveTimer: 9999,
      towers: [{ ...startGame().towers[0], hp: 1 }],
      units: [unitAt(201, "player", "ram", 0, startGame().towers[0].y + 45)],
    };
    const income = game.income;
    const { state, events } = run(game, 2);
    expect(state.towers).toHaveLength(0);
    expect(state.stats.towers).toBe(1);
    expect(state.income).toBeCloseTo(income + TOWER_INCOME, 5);
    expect(state.gold).toBeGreaterThanOrEqual(TOWER_GOLD);
    expect(events.some((event) => event.type === "towerDestroy")).toBe(true);
  });

  it("我方單位陣亡後人口會放回來", () => {
    const game = sandbox({
      units: [{ ...unitAt(301, "player", "militia", 1, 300), hp: 1 }, unitAt(302, "enemy", "guard", 1, 320)],
      pop: UNIT_TYPES.militia.pop,
    });
    const { state } = run(game, 1.5);
    expect(state.units.some((unit) => unit.side === "player")).toBe(false);
    expect(state.pop).toBe(0);
    expect(state.stats.lost).toBe(1);
  });
});

describe("行軍", () => {
  it("我方部隊往敵堡推進", () => {
    const game = deploy(sandbox(), "militia", 1).state;
    const start = game.units[0].y;
    const { state } = run(game, 1);
    expect(state.units[0].y).toBeLessThan(start - UNIT_TYPES.militia.speed * 0.8);
  });

  it("守軍往我方大營推進，並停在大營前", () => {
    const game = sandbox({ units: [unitAt(401, "enemy", "guard", 1, 200)] });
    const { state } = run(game, 20);
    expect(state.units[0].y).toBeCloseTo(HOME_STOP_Y, 1);
  });

  it("部隊只推進到集結線為止", () => {
    const game = deploy(setRally(sandbox(), 1, 400), "militia", 1).state;
    const { state } = run(game, 12);
    expect(state.units[0].y).toBeCloseTo(400, 1);
  });

  it("集結線往前拉，部隊就會跟著再壓上去", () => {
    const held = run(deploy(setRally(sandbox(), 1, 400), "militia", 1).state, 12).state;
    const pushed = run(setLaneStance(held, 1, "push"), 12).state;
    expect(pushed.units[0].y).toBeLessThan(200);
  });

  it("後排不會擠進前排身上", () => {
    const game = setRally(sandbox(), 1, 200);
    const staged = {
      ...game,
      units: [unitAt(501, "player", "militia", 1, 200), unitAt(502, "player", "militia", 1, 400)],
    };
    const { state } = run(staged, 12);
    const [front, back] = state.units;
    expect(front.y).toBeCloseTo(200, 1);
    expect(back.y - front.y).toBeCloseTo(SPACING, 1);
  });
});

describe("戰鬥", () => {
  it("近戰在射程內就開打，不在射程就繼續走", () => {
    const game = sandbox({
      units: [unitAt(601, "player", "militia", 1, 300), unitAt(602, "enemy", "guard", 1, 322)],
    });
    const { state, events } = run(game, 1);
    const enemy = state.units.find((unit) => unit.side === "enemy");
    expect(enemy.hp).toBeLessThan(UNIT_TYPES.militia.hp);
    expect(enemy.hp).toBeLessThanOrEqual(72 - UNIT_TYPES.militia.dmg);
    expect(events.some((event) => event.type === "melee")).toBe(true);
    expect(state.units[0].y).toBeCloseTo(300, 1);
  });

  it("弓手放箭，箭飛到目標才結算傷害", () => {
    const game = sandbox({
      units: [unitAt(701, "player", "archer", 1, 300), unitAt(702, "enemy", "guard", 1, 395)],
    });
    const fired = step(game, 1 / 60);
    expect(fired.state.projectiles).toHaveLength(1);
    expect(fired.state.units[1].hp).toBe(72);
    expect(fired.events.some((event) => event.type === "shoot")).toBe(true);

    const { state } = run(fired.state, 1);
    const enemy = state.units.find((unit) => unit.side === "enemy");
    expect(enemy.hp).toBeLessThanOrEqual(72 - UNIT_TYPES.archer.dmg);
  });

  it("目標在箭飛到之前就死了，箭會落空而不是憑空消失", () => {
    const game = sandbox({
      units: [unitAt(711, "player", "archer", 1, 300), { ...unitAt(712, "enemy", "guard", 1, 400), hp: 72 }],
    });
    const fired = step(game, 1 / 60).state;
    const orphaned = { ...fired, units: fired.units.filter((unit) => unit.side === "player") };
    const { state, events } = run(orphaned, 1);
    expect(state.projectiles).toHaveLength(0);
    expect(events.some((event) => event.type === "miss")).toBe(true);
  });

  it("攻城槌對建築很凶、對人幾乎沒殺傷力", () => {
    const ram = UNIT_TYPES.ram;
    expect(ram.siege).toBeGreaterThan(UNIT_TYPES.militia.siege * 5);
    expect(ram.dmg).toBeLessThan(UNIT_TYPES.militia.dmg);

    const tower = { ...createGame().towers[0] };
    const game = {
      ...startGame(),
      waveTimer: 9999,
      towers: [tower],
      units: [unitAt(801, "player", "ram", 0, tower.y + 45)],
    };
    const { state } = run(game, 1.6);
    expect(state.towers[0].hp).toBeLessThanOrEqual(tower.hp - ram.siege);
  });

  it("箭塔會射擊射程內的我方部隊", () => {
    const tower = createGame().towers[0];
    const game = {
      ...startGame(),
      waveTimer: 9999,
      towers: [tower],
      units: [unitAt(901, "player", "shield", 0, tower.y + 100)],
    };
    const { state } = run(game, 2);
    expect(state.units[0].hp).toBeLessThan(UNIT_TYPES.shield.hp);
  });

  it("射程外的部隊不會被塔打到", () => {
    const tower = createGame().towers[0];
    const game = {
      ...startGame(),
      waveTimer: 9999,
      towers: [tower],
      rally: [DEPLOY_Y, DEPLOY_Y, DEPLOY_Y],
      units: [unitAt(902, "player", "shield", 0, DEPLOY_Y)],
    };
    const { state } = run(game, 2);
    expect(state.units[0].hp).toBe(UNIT_TYPES.shield.hp);
  });

  it("部隊推到城牆前就開始砸城門", () => {
    const game = sandbox({ units: [unitAt(1001, "player", "militia", 1, FRONT_MIN_Y)] });
    const { state, events } = run(game, 2);
    expect(state.enemyBase.hp).toBeLessThan(STAGES[0].baseHp);
    expect(events.some((event) => event.type === "baseHit" && event.side === "enemy")).toBe(true);
  });

  it("守軍推到大營前就開始砸我方大營", () => {
    const game = sandbox({ units: [unitAt(1002, "enemy", "guard", 0, HOME_STOP_Y)] });
    const { state, events } = run(game, 2);
    expect(state.homeBase.hp).toBeLessThan(state.homeBase.maxHp);
    expect(events.some((event) => event.type === "baseHit" && event.side === "home")).toBe(true);
  });

  it("step 不會改到傳進去的局面", () => {
    const game = sandbox({
      units: [unitAt(1101, "player", "militia", 1, 300), unitAt(1102, "enemy", "guard", 1, 320)],
    });
    const snapshot = JSON.stringify(game);
    step(game, 0.25);
    expect(JSON.stringify(game)).toBe(snapshot);
  });

  it("dt 不合法時原樣回傳", () => {
    const game = startGame();
    expect(step(game, 0).state).toBe(game);
    expect(step(game, -1).state).toBe(game);
  });
});

describe("波次", () => {
  it("同一關的第 N 波組成永遠一樣", () => {
    expect(waveComposition(0, 3)).toEqual(waveComposition(0, 3));
    expect(waveComposition(0, 1)).not.toEqual(waveComposition(0, 4));
    expect(waveComposition(0, 0)).toEqual([]);
    expect(waveComposition(9, 1)).toEqual([]);
  });

  it("波次會遞增，但有人數上限", () => {
    const first = waveComposition(0, 1).length;
    const later = waveComposition(0, 5).length;
    expect(later).toBeGreaterThan(first);
    expect(waveComposition(0, 40)).toHaveLength(STAGES[0].waveCap);
  });

  it("後段關卡才會出現重騎", () => {
    expect(waveComposition(0, 12).some((slot) => slot.type === "knight")).toBe(false);
    const late = waveComposition(2, STAGES[2].knightFrom + 3);
    expect(late.some((slot) => slot.type === "knight")).toBe(true);
  });

  it("波次會分散到不同的路", () => {
    const lanes = new Set(waveComposition(2, 6).map((slot) => slot.lane));
    expect(lanes.size).toBeGreaterThan(1);
    for (const lane of lanes) expect(lane).toBeLessThan(LANES);
  });

  it("計時歸零就放一波，並把計時器重設", () => {
    const game = { ...startGame(), waveTimer: 0.02 };
    const { state, events } = run(game, 0.2);
    expect(state.units.filter((unit) => unit.side === "enemy").length).toBeGreaterThan(0);
    expect(state.wave).toBe(2);
    expect(state.waveTimer).toBeCloseTo(STAGES[0].waveEvery, 0);
    expect(events.some((event) => event.type === "waveIncoming")).toBe(true);
  });

  it("城裡的營房有上限：前一波沒清掉，下一波就放不出來", () => {
    const garrison = STAGES[0].garrison;
    const standing = Array.from({ length: garrison }, (_, index) =>
      unitAt(2000 + index, "enemy", "guard", index % LANES, 150 + index * 20),
    );
    const game = { ...startGame(), waveTimer: 0.02, units: standing };
    const { state } = run(game, 0.2);
    expect(state.units.filter((unit) => unit.side === "enemy")).toHaveLength(garrison);
    expect(state.wave).toBe(2);
  });
});

describe("勝負", () => {
  it("打垮城牆就過關，停頓後接上下一道防線", () => {
    const game = sandbox({
      enemyBase: { hp: 1, maxHp: STAGES[0].baseHp },
      units: [unitAt(1201, "player", "militia", 1, FRONT_MIN_Y)],
    });
    const cleared = run(game, 1);
    expect(cleared.state.phase).toBe("stageClear");
    expect(cleared.events.some((event) => event.type === "stageClear")).toBe(true);

    const next = run(cleared.state, 3).state;
    expect(next.phase).toBe("battle");
    expect(next.stageIndex).toBe(1);
    expect(next.enemyBase.hp).toBe(STAGES[1].baseHp);
    expect(next.towers).toHaveLength(STAGES[1].towers.length);
    expect(next.units).toEqual([]);
    expect(next.popCap).toBe(STAGES[1].popCap);
  });

  it("過關會修補大營，但補不超過上限", () => {
    const wounded = sandbox({
      stageIndex: 0,
      enemyBase: { hp: 1, maxHp: STAGES[0].baseHp },
      homeBase: { hp: 40, maxHp: 380 },
      units: [unitAt(1211, "player", "militia", 1, FRONT_MIN_Y)],
    });
    const next = run(wounded, 5).state;
    expect(next.homeBase.hp).toBeGreaterThan(40);
    expect(next.homeBase.hp).toBeLessThanOrEqual(next.homeBase.maxHp);
  });

  it("打垮最後一道防線就贏了", () => {
    const last = STAGES.length - 1;
    const game = sandbox({
      stageIndex: last,
      enemyBase: { hp: 1, maxHp: STAGES[last].baseHp },
      units: [unitAt(1301, "player", "militia", 1, FRONT_MIN_Y)],
    });
    const { state, events } = run(game, 5);
    expect(state.phase).toBe("won");
    expect(events.some((event) => event.type === "win")).toBe(true);
    expect(state.score).toBeGreaterThan(0);
  });

  it("大營被拆掉就輸了", () => {
    const game = sandbox({
      homeBase: { hp: 1, maxHp: 380 },
      units: [unitAt(1401, "enemy", "guard", 0, HOME_STOP_Y)],
    });
    const { state, events } = run(game, 3);
    expect(state.phase).toBe("lost");
    expect(state.homeBase.hp).toBe(0);
    expect(events.some((event) => event.type === "lose")).toBe(true);
  });

  it("分出勝負之後 step 就不再推進", () => {
    const finished = { ...startGame(), phase: "won" };
    expect(step(finished, 1).state).toBe(finished);
  });

  it("完全不出兵一定會被推平", () => {
    const { state } = run(startGame(), 150, 0.2);
    expect(state.phase).toBe("lost");
  });

  it("認真組波次可以在第一關就把城牆打下來", () => {
    const order = ["militia", "militia", "archer", "shield", "archer", "ram"];
    let game = startGame();
    let index = 0;
    for (let t = 0; t < 150 && game.stageIndex === 0 && game.phase !== "lost"; t += 1 / 30) {
      const type = order[index % order.length];
      if (canDeploy(game, type).ok) {
        game = deploy(game, type, index % LANES).state;
        index += 1;
      }
      game = step(game, 1 / 30).state;
    }
    expect(game.phase).not.toBe("lost");
    expect(game.stageIndex).toBe(1);
  });
});

describe("給介面的摘要", () => {
  it("摘要帶齊 HUD 需要的每一項", () => {
    const view = summarize(deploy(startGame(), "militia", 0).state);
    expect(view).toMatchObject({
      phase: "battle",
      wave: 1,
      pop: UNIT_TYPES.militia.pop,
      popCap: STAGES[0].popCap,
      ours: 1,
      theirs: 0,
      selected: "militia",
    });
    expect(view.stage).toMatchObject({ index: 1, of: STAGES.length, name: STAGES[0].name });
    expect(view.gold).toBe(Math.floor(START_GOLD - UNIT_TYPES.militia.cost));
    expect(view.towersLeft).toBe(STAGES[0].towers.length);
    expect(view.waveIn).toBeGreaterThan(0);
  });

  it("兵牌會標出現在買不買得起", () => {
    const poor = summarize({ ...startGame(), gold: 5 });
    const byType = Object.fromEntries(poor.roster.map((card) => [card.id, card]));
    expect(poor.roster.map((card) => card.id)).toEqual(UNIT_ORDER);
    expect(byType.militia.affordable).toBe(true);
    expect(byType.ram.affordable).toBe(false);
    expect(byType.ram.name).toBe("攻城槌");
  });
});
