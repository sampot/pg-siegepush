/**
 * 戰績保存：走 Playgrounds 宿主的 `/api/kv`。
 * 這裡是唯一的權威來源；沒有宿主（直接開檔／離線）時就退回一場性的預設值，
 * 不擋玩家繼續打。
 */

export const PROGRESS_KEY = "/api/kv/pg-siegepush:progress";

export const EMPTY_PROGRESS = {
  bestScore: 0,
  bestStage: 0, // 打到第幾道防線
  campaigns: 0, // 打過幾場
  wins: 0,
  kills: 0,
  towers: 0,
  sound: true,
  updatedAt: null,
};

/** 把一場的結果折進既有戰績。純函式，方便測。 */
export function mergeProgress(previous, run = {}, now = new Date()) {
  const base = { ...EMPTY_PROGRESS, ...(previous ?? {}) };
  return {
    ...base,
    bestScore: Math.max(base.bestScore, Number(run.score) || 0),
    bestStage: Math.max(base.bestStage, Number(run.stage) || 0),
    campaigns: base.campaigns + 1,
    wins: base.wins + (run.outcome === "won" ? 1 : 0),
    kills: base.kills + (Number(run.kills) || 0),
    towers: base.towers + (Number(run.towers) || 0),
    updatedAt: now.toISOString(),
  };
}

export async function loadProgress(fetcher = fetch) {
  try {
    const response = await fetcher(PROGRESS_KEY);
    if (!response?.ok) return { ...EMPTY_PROGRESS };
    const text = await response.text();
    if (!text) return { ...EMPTY_PROGRESS };
    return { ...EMPTY_PROGRESS, ...JSON.parse(text) };
  } catch {
    return { ...EMPTY_PROGRESS };
  }
}

export async function saveProgress(progress, fetcher = fetch) {
  try {
    await fetcher(PROGRESS_KEY, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(progress),
    });
  } catch {
    // 沒有宿主或離線：不擋玩家，下次再寫。
  }
  return progress;
}
