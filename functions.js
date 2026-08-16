export default {
  async fetch(request) {
    return Response.json({
      ok: true,
      name: "pg-siegepush",
      path: new URL(request.url).pathname,
    });
  },
};
