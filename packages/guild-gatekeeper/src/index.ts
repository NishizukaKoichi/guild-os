export * from "./guild.js";

export default {
  async fetch(): Promise<Response> {
    return new Response("Guild Gatekeeper worker is running.", {
      headers: { "content-type": "text/plain" },
    });
  },
};
