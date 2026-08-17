import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_PROGRESS,
  PROGRESS_KEY,
  loadProgress,
  mergeProgress,
  saveProgress,
} from "./persist.js";

const at = new Date("2026-08-17T02:00:00.000Z");

describe("戰績合併", () => {
  it("第一場就把最佳成績記下來", () => {
    const merged = mergeProgress(null, { score: 1200, stage: 2, outcome: "lost", kills: 30 }, at);
    expect(merged).toMatchObject({
      bestScore: 1200,
      bestStage: 2,
      campaigns: 1,
      wins: 0,
      kills: 30,
      updatedAt: at.toISOString(),
    });
  });

  it("打得比較差不會蓋掉舊紀錄，累計數字照樣往上加", () => {
    const first = mergeProgress(EMPTY_PROGRESS, { score: 3000, stage: 3, kills: 50, towers: 6 }, at);
    const second = mergeProgress(first, { score: 400, stage: 1, kills: 5, towers: 1 }, at);
    expect(second.bestScore).toBe(3000);
    expect(second.bestStage).toBe(3);
    expect(second.kills).toBe(55);
    expect(second.towers).toBe(7);
    expect(second.campaigns).toBe(2);
  });

  it("只有真的贏才算勝場", () => {
    const lost = mergeProgress(EMPTY_PROGRESS, { outcome: "lost" }, at);
    const won = mergeProgress(lost, { outcome: "won" }, at);
    expect(lost.wins).toBe(0);
    expect(won.wins).toBe(1);
  });

  it("壞掉的數值不會污染紀錄", () => {
    const merged = mergeProgress(EMPTY_PROGRESS, { score: "abc", kills: null }, at);
    expect(merged.bestScore).toBe(0);
    expect(merged.kills).toBe(0);
  });
});

describe("讀寫", () => {
  it("讀得到宿主寫回來的紀錄", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, text: async () => '{"bestScore":880}' }));
    const progress = await loadProgress(fetcher);
    expect(fetcher).toHaveBeenCalledWith(PROGRESS_KEY);
    expect(progress.bestScore).toBe(880);
    expect(progress.sound).toBe(true);
  });

  it("沒有宿主／回應是空的就退回預設值", async () => {
    expect(await loadProgress(async () => ({ ok: false }))).toEqual(EMPTY_PROGRESS);
    expect(await loadProgress(async () => ({ ok: true, text: async () => "" }))).toEqual(EMPTY_PROGRESS);
    expect(
      await loadProgress(async () => {
        throw new Error("offline");
      }),
    ).toEqual(EMPTY_PROGRESS);
  });

  it("寫入走 PUT，而且失敗不會擋住玩家", async () => {
    const fetcher = vi.fn(async () => ({ ok: true }));
    const progress = { ...EMPTY_PROGRESS, bestScore: 12 };
    await saveProgress(progress, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      PROGRESS_KEY,
      expect.objectContaining({ method: "PUT", body: JSON.stringify(progress) }),
    );
    await expect(
      saveProgress(progress, async () => {
        throw new Error("offline");
      }),
    ).resolves.toEqual(progress);
  });
});
