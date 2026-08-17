// 這個 SAM 是純前端遊戲，沒有自己的後端 route。
// 戰績走宿主內建的 `/api/kv/*`（PG-UI-SDK-SPEC §4），由殼在委派到這支
// functions.js 之前就先接走，所以這裡不需要（也不該）自己實作 KV。
export default {
  async fetch(request) {
    return Response.json(
      { code: "not_found", message: new URL(request.url).pathname },
      { status: 404 },
    );
  },
};
