/**
 * 配置管理 — 从环境变量读取，提供默认值
 */
export interface Config {
  port: number;
  token: string;
}

export function loadConfig(): Config {
  return {
    port: Number(Deno.env.get("RELAY_PORT")) || 23002,
    token: Deno.env.get("RELAY_TOKEN") ||
      "9da60dff5bbf8da3c7000463f6320677a86a22e8c69a0a19070bda899029bd40",
  };
}
