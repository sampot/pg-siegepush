/**
 * 攻城推波 — DOM、Canvas 與輸入層。
 * 規則、行軍與戰鬥全部留在 game.js；這裡只轉送輸入、畫 state、
 * 把事件轉成音效與特效，並在分出勝負時保存戰績。
 */
import {
  DEPLOY_Y,
  ENEMY_BASE_Y,
  FIELD_H,
  FIELD_W,
  HOME_BASE_Y,
  LANES,
  LANE_MARGIN,
  LANE_NAMES,
  LANE_W,
  RALLY_GRIP_H,
  RALLY_GRIP_W,
  STAGES,
  TOWER_TYPES,
  UNIT_ORDER,
  UNIT_TYPES,
  createGame,
  deploy,
  hitRallyLane,
  laneAt,
  laneStance,
  laneX,
  selectUnit,
  setRally,
  startGame,
  step,
  summarize,
  toggleLaneStance,
} from "./game.js";
import { SiegeAudio } from "./audio.js";
import { EMPTY_PROGRESS, loadProgress, mergeProgress, saveProgress } from "./persist.js";

const $ = (id) => document.getElementById(id);
const els = {
  canvas: $("board"),
  stage: $("stage"),
  overlay: $("overlay"),
  panelTitle: $("panel-title"),
  panelBody: $("panel-body"),
  panelStats: $("panel-stats"),
  guide: $("panel-guide"),
  credits: $("credits"),
  primary: $("btn-primary"),
  secondary: $("btn-secondary"),
  sound: $("btn-sound"),
  reset: $("btn-reset"),
  gold: $("stat-gold"),
  income: $("stat-income"),
  pop: $("stat-pop"),
  popCap: $("stat-popcap"),
  wave: $("stat-wave"),
  waveNo: $("stat-wave-no"),
  stageNo: $("stat-stage"),
  stageOf: $("stat-stage-of"),
  lanes: $("lanes"),
  roster: $("roster"),
  toast: $("toast"),
  hint: $("hint"),
  bestScore: $("best-score"),
  bestStage: $("best-stage"),
  ghost: $("drag-ghost"),
};

const ctx = els.canvas.getContext("2d");
const audio = new SiegeAudio();

let progress = { ...EMPTY_PROGRESS };
let game = createGame();
let rafId = 0;
let lastFrame = 0;
let particles = [];
let floaters = [];
let toastTimer = 0;
let savedOutcome = false;
let confirming = false;
/** 目前的手勢：拖兵牌部署，或拖某一路的集結線。 */
let gesture = null;
let hoverLane = null;
let shake = 0;

const DEFAULT_HINT = els.hint.textContent;

// ── 圖片 ────────────────────────────────────────────────

function image(src) {
  const img = new Image();
  img.src = src;
  return img;
}

const icons = Object.fromEntries(
  [
    "sword",
    "bow",
    "shield",
    "structure_gate",
    "structure_tower",
    "structure_watchtower",
    "crown_a",
    "flag_triangle",
    "token",
    "pawns",
    "skull",
  ].map((name) => [name, image(`assets/icons/${name}.png`)]),
);

const particleImages = Object.fromEntries(
  ["fire_01", "smoke_04", "spark_02", "star_01", "slash_01", "light_01", "muzzle_02", "circle_01"].map(
    (name) => [name, image(`assets/particles/${name}.png`)],
  ),
);

function drawImage(img, x, y, size, alpha = 1) {
  if (!img?.complete || !img.naturalWidth) return false;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  ctx.restore();
  return true;
}

// ── 尺寸與座標 ───────────────────────────────────────────

function resizeCanvas() {
  const rect = els.stage.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.min(rect.width, (rect.height * FIELD_W) / FIELD_H));
  const cssHeight = (cssWidth * FIELD_H) / FIELD_W;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  els.canvas.style.width = `${cssWidth}px`;
  els.canvas.style.height = `${cssHeight}px`;
  els.canvas.width = Math.round(cssWidth * dpr);
  els.canvas.height = Math.round(cssHeight * dpr);
  draw();
}

function toField(event) {
  const rect = els.canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * FIELD_W,
    y: ((event.clientY - rect.top) / rect.height) * FIELD_H,
  };
}

function overCanvas(event) {
  const rect = els.canvas.getBoundingClientRect();
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

// ── 特效 ────────────────────────────────────────────────

function showToast(text, tone = "good") {
  window.clearTimeout(toastTimer);
  els.toast.textContent = text;
  els.toast.dataset.tone = tone;
  els.toast.classList.add("show");
  toastTimer = window.setTimeout(() => els.toast.classList.remove("show"), 1200);
}

function burst(x, y, key, amount = 5, spread = 70, size = 14) {
  for (let i = 0; i < amount; i += 1) {
    const angle = (Math.PI * 2 * i) / amount + Math.random() * 0.7;
    const speed = spread * (0.35 + Math.random() * 0.9);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.8 - 18,
      life: 0.35 + Math.random() * 0.4,
      maxLife: 0.75,
      size: size * (0.7 + Math.random() * 0.7),
      image: particleImages[key],
    });
  }
}

function floater(x, y, text, tone) {
  floaters.push({ x, y, text, tone, life: 0.9, maxLife: 0.9 });
}

function updateEffects(dt) {
  particles = particles
    .map((particle) => ({
      ...particle,
      x: particle.x + particle.vx * dt,
      y: particle.y + particle.vy * dt,
      vx: particle.vx * (1 - 2.4 * dt),
      vy: particle.vy * (1 - 2.4 * dt) + 120 * dt,
      life: particle.life - dt,
    }))
    .filter((particle) => particle.life > 0)
    .slice(-160);
  floaters = floaters
    .map((item) => ({ ...item, y: item.y - 26 * dt, life: item.life - dt }))
    .filter((item) => item.life > 0);
  shake = Math.max(0, shake - dt * 3.2);
}

function handleEvents(events) {
  for (const event of events) {
    switch (event.type) {
      case "deploy":
        audio.deploySfx();
        burst(event.x, event.y, "smoke_04", 4, 42, 16);
        break;
      case "denied":
        audio.denySfx();
        showToast(
          event.reason === "gold" ? "軍資不足" : event.reason === "pop" ? "人口已滿" : "現在不能部署",
          "bad",
        );
        break;
      case "melee":
        audio.meleeSfx();
        burst(event.x, event.y - 6, "slash_01", 1, 26, 15);
        break;
      case "shoot":
        if (event.from !== "tower") audio.bowSfx();
        break;
      case "hit":
        if (event.kind === "base") {
          audio.ramSfx(event.amount);
          burst(event.x, event.y, "smoke_04", 3, 54, 18);
          if (event.side === "player") shake = Math.min(1, shake + 0.25);
        } else if (event.ranged) {
          audio.arrowHitSfx();
          burst(event.x, event.y, "spark_02", 2, 40, 10);
        } else if (event.kind === "tower") {
          audio.ramSfx(event.amount);
          burst(event.x, event.y, "smoke_04", 3, 46, 16);
        }
        break;
      case "baseHit":
        if (event.side === "home") audio.alarmSfx();
        break;
      case "unitDie":
        audio.dieSfx();
        burst(event.x, event.y, event.side === "player" ? "smoke_04" : "spark_02", 4, 60, 13);
        break;
      case "loot":
        audio.coinSfx();
        floater(event.x, event.y - 10, `＋${event.amount}`, "gold");
        break;
      case "towerDestroy":
        audio.collapseSfx();
        burst(event.x, event.y, "fire_01", 10, 130, 26);
        burst(event.x, event.y, "smoke_04", 8, 90, 30);
        shake = 1;
        showToast("箭塔倒了！收入增加", "hot");
        break;
      case "waveIncoming":
        audio.hornSfx();
        showToast(`第 ${event.wave} 波守軍出城（${event.size} 兵）`, "bad");
        break;
      case "stageClear":
        audio.stageClearSfx();
        audio.breachSfx();
        burst(FIELD_W / 2, ENEMY_BASE_Y, "fire_01", 18, 200, 34);
        shake = 1;
        showToast(`第 ${event.stage} 道防線攻破！`, "hot");
        break;
      case "stageStart":
        showToast(`第 ${event.stage} 道防線：${event.name}`, "good");
        break;
      case "win":
        audio.winSfx();
        break;
      case "lose":
        audio.loseSfx();
        break;
      default:
        break;
    }
  }
}

// ── HUD ─────────────────────────────────────────────────

function buildRoster() {
  els.roster.innerHTML = UNIT_ORDER.map((type) => {
    const spec = UNIT_TYPES[type];
    return (
      `<button type="button" class="card" role="radio" aria-checked="false" data-unit="${type}" id="card-${type}">` +
      `<img class="card-icon" src="assets/icons/${spec.icon}.png" alt="" />` +
      `<b class="card-name">${spec.name}</b>` +
      `<span class="card-cost"><i class="dot dot-gold"></i>${spec.cost}<i class="dot dot-pop"></i>${spec.pop}</span>` +
      `</button>`
    );
  }).join("");

  els.lanes.innerHTML = LANE_NAMES.map(
    (name, lane) =>
      `<button type="button" class="lane-chip" data-lane="${lane}" id="lane-${lane}">` +
      `<b>${name}</b><span class="lane-stance">壓上</span></button>`,
  ).join("");
}

function renderHud() {
  const view = summarize(game);
  els.gold.textContent = String(view.gold);
  els.income.textContent = `＋${view.income.toFixed(1)}／秒`;
  els.pop.textContent = String(view.pop);
  els.popCap.textContent = `／${view.popCap}`;
  els.wave.textContent = String(Math.ceil(view.waveIn));
  els.waveNo.textContent = `第 ${view.wave} 波`;
  els.stageNo.textContent = String(view.stage.index);
  els.stageOf.textContent = `／${view.stage.of}`;

  for (const card of view.roster) {
    const el = $(`card-${card.id}`);
    el.classList.toggle("is-poor", !card.affordable);
    el.setAttribute("aria-checked", String(card.id === view.selected));
  }
  for (let lane = 0; lane < LANES; lane += 1) {
    const chip = $(`lane-${lane}`);
    const stance = view.stances[lane];
    chip.dataset.stance = stance;
    chip.querySelector(".lane-stance").textContent = stance === "push" ? "壓上" : "守營";
  }

  els.reset.disabled = !["battle", "stageClear"].includes(game.phase);
  els.hint.textContent =
    game.phase === "battle" ? `${view.stage.name}：${view.stage.hint}` : DEFAULT_HINT;
}

function renderRecords() {
  els.bestScore.textContent = progress.bestScore ? String(progress.bestScore) : "—";
  els.bestStage.textContent = progress.bestStage ? `第 ${progress.bestStage} 道` : "—";
}

// ── 面板 ────────────────────────────────────────────────

function showReadyPanel() {
  confirming = false;
  els.overlay.hidden = false;
  els.panelTitle.textContent = "攻城推波";
  els.panelTitle.dataset.tone = "";
  els.panelBody.textContent =
    "三道防線，一道比一道硬。軍資每秒進帳，組出你的波次把城牆砸開——守軍也在往你的大營推。";
  els.panelStats.hidden = true;
  els.guide.hidden = false;
  els.credits.hidden = false;
  els.primary.textContent = "開始攻城";
  els.secondary.hidden = true;
}

function showConfirmPanel() {
  confirming = true;
  els.overlay.hidden = false;
  els.panelTitle.textContent = "重新開戰？";
  els.panelTitle.dataset.tone = "";
  els.panelBody.textContent = "目前的戰功與推進進度會全部歸零。";
  els.panelStats.hidden = true;
  els.guide.hidden = true;
  els.credits.hidden = true;
  els.credits.open = false;
  els.primary.textContent = "重新開戰";
  els.secondary.textContent = "繼續打";
  els.secondary.hidden = false;
}

function showOutcomePanel() {
  confirming = false;
  const view = summarize(game);
  const won = game.phase === "won";
  els.overlay.hidden = false;
  els.panelTitle.textContent = won ? "城破了！" : "大營失守";
  els.panelTitle.dataset.tone = won ? "win" : "lose";
  els.panelBody.textContent = won
    ? `三道防線全部拿下，總戰功 ${view.score}。`
    : `守軍推平了你的大營，倒在第 ${view.stage.index} 道防線（${view.stage.name}）。`;
  els.panelStats.innerHTML = [
    ["戰功", view.score],
    ["推進到", `第 ${view.stage.index} 道`],
    ["斬敵", view.stats.kills],
    ["拆塔", view.stats.towers],
    ["出兵／折損", `${view.stats.deployed}／${view.stats.lost}`],
    ["擋下波次", view.stats.waves],
  ]
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
  els.panelStats.hidden = false;
  els.guide.hidden = true;
  els.credits.hidden = false;
  els.primary.textContent = "再打一次";
  els.secondary.textContent = "回到序幕";
  els.secondary.hidden = false;
}

async function recordOutcome() {
  if (savedOutcome) return;
  savedOutcome = true;
  progress = mergeProgress(progress, {
    score: game.score,
    stage: game.phase === "won" ? STAGES.length : game.stageIndex + 1,
    kills: game.stats.kills,
    towers: game.stats.towers,
    outcome: game.phase,
  });
  renderRecords();
  await saveProgress(progress);
}

// ── 迴圈 ────────────────────────────────────────────────

function beginGame() {
  audio.unlock();
  game = startGame();
  savedOutcome = false;
  confirming = false;
  particles = [];
  floaters = [];
  gesture = null;
  hoverLane = null;
  els.overlay.hidden = true;
  renderHud();
  lastFrame = performance.now();
  if (!rafId) rafId = requestAnimationFrame(frame);
}

function frame(now) {
  rafId = 0;
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;

  audio.frame();
  if (!confirming) {
    const result = step(game, dt);
    game = result.state;
    handleEvents(result.events);
  }
  updateEffects(dt);
  draw();
  renderHud();

  if (game.phase === "won" || game.phase === "lost") {
    showOutcomePanel();
    void recordOutcome();
    return;
  }
  rafId = requestAnimationFrame(frame);
}

// ── 繪圖 ────────────────────────────────────────────────

function drawGround() {
  const soil = ctx.createLinearGradient(0, 0, 0, FIELD_H);
  soil.addColorStop(0, "#241b2c");
  soil.addColorStop(0.45, "#33283a");
  soil.addColorStop(1, "#3d3040");
  ctx.fillStyle = soil;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);

  // 三條被踏出來的行軍道。
  for (let lane = 0; lane < LANES; lane += 1) {
    const x = LANE_MARGIN + lane * LANE_W;
    const road = ctx.createLinearGradient(0, ENEMY_BASE_Y, 0, HOME_BASE_Y);
    road.addColorStop(0, "rgba(214,178,124,.10)");
    road.addColorStop(1, "rgba(214,178,124,.20)");
    ctx.fillStyle = road;
    ctx.fillRect(x + 10, ENEMY_BASE_Y, LANE_W - 20, HOME_BASE_Y - ENEMY_BASE_Y);
    if (lane > 0) {
      ctx.fillStyle = "rgba(0,0,0,.24)";
      ctx.fillRect(x - 1, 0, 2, FIELD_H);
    }
  }
  if (hoverLane != null) {
    ctx.fillStyle = "rgba(240,178,74,.13)";
    ctx.fillRect(LANE_MARGIN + hoverLane * LANE_W, ENEMY_BASE_Y, LANE_W, FIELD_H - ENEMY_BASE_Y);
  }
}

function hpBar(x, y, w, h, ratio, color) {
  ctx.fillStyle = "rgba(8,6,12,.75)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * ratio), h - 2);
}

function drawEnemyCastle() {
  const wallTop = 8;
  const wallBottom = ENEMY_BASE_Y;
  const stone = ctx.createLinearGradient(0, wallTop, 0, wallBottom);
  stone.addColorStop(0, "#4b4358");
  stone.addColorStop(1, "#2e2839");
  ctx.fillStyle = stone;
  ctx.fillRect(0, wallTop, FIELD_W, wallBottom - wallTop);

  // 城垛。
  ctx.fillStyle = "#564d64";
  for (let x = 4; x < FIELD_W; x += 26) ctx.fillRect(x, wallTop - 8, 15, 10);
  // 石縫。
  ctx.strokeStyle = "rgba(0,0,0,.25)";
  ctx.lineWidth = 1;
  for (let y = wallTop + 14; y < wallBottom; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(FIELD_W, y);
    ctx.stroke();
  }
  // 城門。
  const gateW = 54;
  ctx.fillStyle = "#1d1826";
  ctx.beginPath();
  ctx.moveTo(FIELD_W / 2 - gateW / 2, wallBottom);
  ctx.lineTo(FIELD_W / 2 - gateW / 2, wallTop + 26);
  ctx.arc(FIELD_W / 2, wallTop + 26, gateW / 2, Math.PI, 0);
  ctx.lineTo(FIELD_W / 2 + gateW / 2, wallBottom);
  ctx.closePath();
  ctx.fill();
  drawImage(icons.crown_a, FIELD_W / 2, wallTop + 26, 24, 0.85);

  // 城牆血條畫在牆體裡面，才不會壓到牆前的集結線把手。
  const ratio = game.enemyBase.hp / game.enemyBase.maxHp;
  const barY = wallBottom - 15;
  hpBar(8, barY, FIELD_W - 16, 11, ratio, ratio > 0.35 ? "#e0574f" : "#f0a63c");
  ctx.fillStyle = "rgba(20,14,22,.9)";
  ctx.font = "700 9px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(
    `${STAGES[game.stageIndex].name}　城牆 ${Math.ceil(game.enemyBase.hp)}`,
    13,
    barY + 8,
  );
}

function drawHomeCamp() {
  const top = HOME_BASE_Y;
  const camp = ctx.createLinearGradient(0, top, 0, FIELD_H);
  camp.addColorStop(0, "#3b5140");
  camp.addColorStop(1, "#243627");
  ctx.fillStyle = camp;
  ctx.fillRect(0, top, FIELD_W, FIELD_H - top);
  // 木柵。
  ctx.fillStyle = "#6b5233";
  for (let x = 3; x < FIELD_W; x += 13) {
    ctx.beginPath();
    ctx.moveTo(x, top + 2);
    ctx.lineTo(x + 5, top - 6);
    ctx.lineTo(x + 10, top + 2);
    ctx.closePath();
    ctx.fill();
  }
  drawImage(icons.flag_triangle, 24, top + 26, 22, 0.9);

  const ratio = game.homeBase.hp / game.homeBase.maxHp;
  hpBar(44, top + 20, FIELD_W - 56, 12, ratio, ratio > 0.4 ? "#5fc08a" : "#f0605f");
  ctx.fillStyle = "rgba(14,22,16,.9)";
  ctx.font = "700 9px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`我方大營 ${Math.ceil(game.homeBase.hp)}`, 49, top + 29);
}

function drawTower(tower) {
  const type = TOWER_TYPES[tower.kind];
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath();
  ctx.ellipse(tower.x, tower.y + 15, 19, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // 射程圈：淡淡一環，讓玩家看得出來哪裡會被打。
  ctx.strokeStyle = "rgba(224,87,79,.14)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 6]);
  ctx.beginPath();
  ctx.arc(tower.x, tower.y, type.range, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!drawImage(icons[type.icon], tower.x, tower.y, 40)) {
    ctx.fillStyle = "#7d7490";
    ctx.fillRect(tower.x - 12, tower.y - 16, 24, 32);
  }
  hpBar(tower.x - 16, tower.y + 20, 32, 4, tower.hp / tower.maxHp, "#e0574f");
}

/** 部隊是程序繪製的小人：盾／弓／槌用不同的剪影，看一眼就知道是誰。 */
function drawUnit(unit) {
  const player = unit.side === "player";
  const spec = player ? UNIT_TYPES[unit.type] : null;
  const scale = unit.type === "ram" ? 1.35 : unit.type === "shield" || unit.type === "knight" ? 1.15 : 1;
  const body = 9 * scale;
  const lean = unit.swing > 0 ? Math.sin((unit.swing / 0.18) * Math.PI) * 3 : 0;

  ctx.save();
  ctx.translate(unit.x, unit.y);
  ctx.fillStyle = "rgba(0,0,0,.34)";
  ctx.beginPath();
  ctx.ellipse(0, body * 0.62, body * 0.75, body * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  if (unit.type === "ram") {
    // 攻城槌畫成一台有輪子的撞車。
    ctx.fillStyle = "#8a6134";
    ctx.fillRect(-body, -body * 0.5, body * 2, body);
    ctx.fillStyle = "#5b3f22";
    ctx.fillRect(-body * 0.45, -body * 1.15 - lean, body * 0.9, body * 0.7);
    ctx.fillStyle = "#2a2130";
    for (const wx of [-body * 0.6, body * 0.6]) {
      ctx.beginPath();
      ctx.arc(wx, body * 0.55, body * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const coat = player ? "#4f8fd8" : "#c4553f";
    const trim = player ? "#8fc0f2" : "#eb8a63";
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.roundRect(-body * 0.55, -body * 0.6, body * 1.1, body * 1.2, body * 0.3);
    ctx.fill();
    ctx.fillStyle = "#e8d6bd";
    ctx.beginPath();
    ctx.arc(0, -body * 0.95, body * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = trim;
    if (unit.type === "shield" || unit.type === "knight") {
      ctx.fillRect(player ? -body * 1.05 : body * 0.35, -body * 0.75, body * 0.7, body * 1.35);
    } else if (unit.type === "archer" || unit.type === "crossbow") {
      ctx.fillRect(-body * 0.15, -body * 1.5 - lean, body * 0.3, body * 1.1);
    } else {
      ctx.fillRect(body * 0.35, -body * 1.3 - lean, body * 0.22, body * 1.2);
    }
  }

  ctx.restore();

  const maxHp = spec ? spec.hp : unit.maxHp;
  if (unit.hp < maxHp) {
    hpBar(unit.x - 10, unit.y - body * 1.9, 20, 3, unit.hp / maxHp, player ? "#5fc08a" : "#e0574f");
  }
  if (unit.engaged) {
    ctx.fillStyle = player ? "rgba(143,192,242,.5)" : "rgba(235,138,99,.5)";
    ctx.beginPath();
    ctx.arc(unit.x, unit.y + body * 0.62, body * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawProjectiles() {
  for (const shot of game.projectiles) {
    const angle = Math.atan2(shot.ty - shot.y, shot.tx - shot.x);
    ctx.save();
    ctx.translate(shot.x, shot.y);
    ctx.rotate(angle);
    ctx.strokeStyle = shot.side === "player" ? "#d8e8ff" : "#ffcf9a";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(5, 0);
    ctx.stroke();
    ctx.restore();
  }
}

function drawDeployLine() {
  ctx.strokeStyle = "rgba(143,192,242,.32)";
  ctx.setLineDash([5, 6]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(4, DEPLOY_Y);
  ctx.lineTo(FIELD_W - 4, DEPLOY_Y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** 集結線畫在部隊之上：把手要拖得到，就不能被擠到前線的兵蓋住。 */
function drawRallyLines() {
  for (let lane = 0; lane < LANES; lane += 1) {
    const y = game.rally[lane];
    const cx = laneX(lane);
    const left = LANE_MARGIN + lane * LANE_W + 6;
    const right = left + LANE_W - 12;
    const pushing = laneStance(game, lane) === "push";
    const active = gesture?.kind === "rally" && gesture.lane === lane;
    ctx.strokeStyle = active
      ? "rgba(240,178,74,.95)"
      : pushing
        ? "rgba(95,192,138,.55)"
        : "rgba(240,178,74,.6)";
    ctx.lineWidth = active ? 2.5 : 1.8;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = active ? "rgba(240,178,74,.95)" : "rgba(24,18,30,.85)";
    ctx.beginPath();
    ctx.roundRect(cx - RALLY_GRIP_W / 2, y - RALLY_GRIP_H / 2, RALLY_GRIP_W, RALLY_GRIP_H, 8);
    ctx.fill();
    ctx.strokeStyle = pushing ? "rgba(95,192,138,.8)" : "rgba(240,178,74,.8)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = active ? "#241a08" : "rgba(255,240,224,.9)";
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pushing ? "▲ 壓上" : "▲ 集結線", cx, y + 0.5);
    ctx.textBaseline = "alphabetic";
  }
}

function drawEffects() {
  for (const particle of particles) {
    const alpha = Math.min(1, particle.life / particle.maxLife);
    if (!drawImage(particle.image, particle.x, particle.y, particle.size, alpha)) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#f0a63c";
      ctx.fillRect(particle.x - 2, particle.y - 2, 4, 4);
      ctx.restore();
    }
  }
  ctx.textAlign = "center";
  for (const item of floaters) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, item.life / item.maxLife);
    ctx.fillStyle = item.tone === "gold" ? "#f0c65c" : "#f0605f";
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.fillText(item.text, item.x, item.y);
    ctx.restore();
  }
}

function draw() {
  if (!ctx || !els.canvas.width) return;
  const sx = els.canvas.width / FIELD_W;
  const sy = els.canvas.height / FIELD_H;
  const jolt = shake > 0 ? (Math.random() - 0.5) * shake * 7 : 0;
  ctx.setTransform(sx, 0, 0, sy, jolt * sx, 0);

  drawGround();
  drawDeployLine();
  for (const tower of game.towers) drawTower(tower);
  const ordered = [...game.units].sort((a, b) => a.y - b.y);
  for (const unit of ordered) drawUnit(unit);
  drawProjectiles();
  drawEnemyCastle();
  drawHomeCamp();
  drawRallyLines();
  drawEffects();
}

// ── 輸入 ────────────────────────────────────────────────

function tryDeploy(type, lane) {
  const result = deploy(game, type, lane);
  game = result.state;
  handleEvents(result.events);
}

function moveGhost(event) {
  els.ghost.style.left = `${event.clientX}px`;
  els.ghost.style.top = `${event.clientY}px`;
}

function endGesture() {
  gesture = null;
  hoverLane = null;
  els.ghost.hidden = true;
}

function bindEvents() {
  window.addEventListener("resize", resizeCanvas);
  new ResizeObserver(resizeCanvas).observe(els.stage);

  // 兵牌：按住拖到戰場放手就是部署；沒拖出兵牌就只是選取。
  els.roster.addEventListener("pointerdown", (event) => {
    const card = event.target.closest(".card");
    if (!card) return;
    event.preventDefault();
    audio.unlock();
    const type = card.dataset.unit;
    game = selectUnit(game, type);
    audio.uiSfx();
    renderHud();
    if (game.phase !== "battle") return;
    gesture = { kind: "deploy", pointerId: event.pointerId, type };
    els.ghost.textContent = UNIT_TYPES[type].name;
    els.ghost.hidden = false;
    moveGhost(event);
    try {
      card.setPointerCapture(event.pointerId);
      gesture.capture = card;
    } catch {
      // 沒有實體指標（例如自動化測試）時抓不到，照樣可以玩。
    }
  });

  const pointerMove = (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.kind === "deploy") {
      moveGhost(event);
      hoverLane = overCanvas(event) ? laneAt(toField(event)) : null;
      return;
    }
    game = setRally(game, gesture.lane, toField(event).y);
  };

  const pointerUp = (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.kind === "deploy" && overCanvas(event)) {
      const lane = laneAt(toField(event));
      if (lane != null) tryDeploy(gesture.type, lane);
    }
    if (gesture.kind === "rally") audio.uiSfx();
    try {
      gesture.capture?.releasePointerCapture(event.pointerId);
    } catch {
      // 指標已經放開了。
    }
    endGesture();
    renderHud();
  };

  window.addEventListener("pointermove", pointerMove, { passive: true });
  window.addEventListener("pointerup", pointerUp);
  window.addEventListener("pointercancel", endGesture);

  // 戰場：抓到集結線就拖，否則就是把選好的兵放到這一路。
  els.canvas.addEventListener("pointerdown", (event) => {
    if (game.phase !== "battle") return;
    event.preventDefault();
    audio.unlock();
    const point = toField(event);
    const rallyLane = hitRallyLane(game, point);
    if (rallyLane != null) {
      gesture = { kind: "rally", pointerId: event.pointerId, lane: rallyLane };
      try {
        els.canvas.setPointerCapture(event.pointerId);
        gesture.capture = els.canvas;
      } catch {
        // 同上。
      }
      return;
    }
    const lane = laneAt(point);
    if (lane != null) tryDeploy(game.selected, lane);
    renderHud();
  });

  els.lanes.addEventListener("click", (event) => {
    const chip = event.target.closest(".lane-chip");
    if (!chip || game.phase !== "battle") return;
    game = toggleLaneStance(game, Number(chip.dataset.lane));
    audio.uiSfx();
    renderHud();
  });

  els.primary.addEventListener("click", () => {
    audio.uiSfx();
    beginGame();
  });

  els.secondary.addEventListener("click", () => {
    audio.uiSfx();
    if (confirming) {
      confirming = false;
      els.overlay.hidden = true;
      lastFrame = performance.now();
      if (!rafId) rafId = requestAnimationFrame(frame);
      return;
    }
    game = createGame();
    renderHud();
    showReadyPanel();
    draw();
  });

  els.reset.addEventListener("click", () => {
    audio.uiSfx();
    showConfirmPanel();
  });

  els.sound.addEventListener("click", () => {
    const enabled = !audio.enabled;
    audio.setEnabled(enabled);
    if (enabled) audio.uiSfx();
    progress = { ...progress, sound: enabled, updatedAt: new Date().toISOString() };
    els.sound.setAttribute("aria-pressed", String(enabled));
    els.sound.firstElementChild.textContent = enabled ? "🔊" : "🔇";
    void saveProgress(progress);
  });

  // 桌機鍵盤：1–4 選兵，A／S／D 直接放進左中右，Q／W／E 切換該路壓上或守營。
  window.addEventListener("keydown", (event) => {
    if (game.phase !== "battle" || event.metaKey || event.ctrlKey) return;
    const pick = "1234".indexOf(event.key);
    if (pick >= 0) {
      game = selectUnit(game, UNIT_ORDER[pick]);
      audio.uiSfx();
      renderHud();
      return;
    }
    const deployLane = "asd".indexOf(event.key.toLowerCase());
    if (deployLane >= 0) {
      tryDeploy(game.selected, deployLane);
      renderHud();
      return;
    }
    const stanceLane = "qwe".indexOf(event.key.toLowerCase());
    if (stanceLane >= 0) {
      game = toggleLaneStance(game, stanceLane);
      audio.uiSfx();
      renderHud();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) lastFrame = performance.now();
  });
}

async function init() {
  buildRoster();
  bindEvents();
  progress = await loadProgress();
  audio.setEnabled(progress.sound);
  els.sound.setAttribute("aria-pressed", String(progress.sound));
  els.sound.firstElementChild.textContent = progress.sound ? "🔊" : "🔇";
  renderRecords();
  renderHud();
  showReadyPanel();
  resizeCanvas();
}

void init();
