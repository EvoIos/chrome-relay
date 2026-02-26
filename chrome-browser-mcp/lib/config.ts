/**
 * 配置管理 — 从环境变量读取，提供默认值
 */
export interface Config {
  port: number;
  token: string;
}

export function loadConfig(): Config {
  return {
    port: Number(Deno.env.get("RELAY_PORT")) || 23001,
    token: Deno.env.get("RELAY_TOKEN") ||
      "bd5d4a4354c66c6dae7c2e60a8d4025a4ca64a48d6f5bb8f0fb7106b74bbf2bf",
  };
}
