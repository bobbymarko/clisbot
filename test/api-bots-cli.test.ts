import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tryAddApiBot } from "../src/control/commands/api-bots-cli.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";

test("API add validates before writing and refuses replacement", async () => {
  const dir = mkdtempSync(join(tmpdir(), "api-add-"));
  const previous = process.env.CLISBOT_CONFIG_PATH;
  process.env.CLISBOT_CONFIG_PATH = join(dir, "config.json");
  try {
    const doc = JSON.parse(renderDefaultConfigTemplate());
    doc.agents.list = [{ id: "nova" }];
    writeFileSync(process.env.CLISBOT_CONFIG_PATH, JSON.stringify(doc));
    const file = join(dir, "contract.json");
    const args = ["--channel", "api", "--bot", "voice", "--agent", "nova", "--config-file", file];
    writeFileSync(file, JSON.stringify({ ingress: { auth: { mode: "invalid" } } }));
    await expect(tryAddApiBot(args)).rejects.toThrow();
    expect(JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH, "utf8")).bots.api.voice).toBeUndefined();
    writeFileSync(file, JSON.stringify({ enabled: true, ingress: { auth: { mode: "none" }, map: { text: "$.text" } } }));
    expect(await tryAddApiBot(args)).toBe(true);
    expect(JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH, "utf8")).bots.api.voice.agentId).toBe("nova");
    await expect(tryAddApiBot(args)).rejects.toThrow("already exists");
  } finally {
    if (previous === undefined) delete process.env.CLISBOT_CONFIG_PATH;
    else process.env.CLISBOT_CONFIG_PATH = previous;
    rmSync(dir, { recursive: true });
  }
});
