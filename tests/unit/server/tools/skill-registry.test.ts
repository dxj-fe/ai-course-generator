import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { SkillRegistry } from "../../../../src/server/tools/skill-registry";

const validSkill = {
  name: "doubleNumber",
  description: "Double a number.",
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.object({ value: z.number() }),
  execute: ({ value }: { value: number }) => ({ value: value * 2 }),
};

describe("SkillRegistry", () => {
  it("registers, lists and executes a skill", async () => {
    const registry = new SkillRegistry(vi.fn()).register(validSkill);

    await expect(
      registry.execute("doubleNumber", { value: 2 }, { traceId: "trace-1" }),
    ).resolves.toEqual({ value: 4 });
    expect(registry.get("doubleNumber")?.description).toBe("Double a number.");
    expect(registry.list()).toEqual([
      { name: "doubleNumber", description: "Double a number." },
    ]);
  });

  it("rejects duplicate skill names", () => {
    const registry = new SkillRegistry(vi.fn()).register(validSkill);

    expect(() => registry.register(validSkill)).toThrow("Skill 已注册");
  });

  it("rejects invalid input before execute and records a failed event", async () => {
    const eventSink = vi.fn();
    const execute = vi.fn(validSkill.execute);
    const registry = new SkillRegistry(eventSink).register({
      ...validSkill,
      execute,
    });

    await expect(
      registry.execute(
        "doubleNumber",
        { value: "2" },
        { traceId: "trace-2" },
      ),
    ).rejects.toThrow("输入校验失败");
    expect(execute).not.toHaveBeenCalled();
    expect(eventSink).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-2",
        toolName: "doubleNumber",
        success: false,
      }),
    );
  });

  it("rejects invalid output and records a failed event", async () => {
    const eventSink = vi.fn();
    const registry = new SkillRegistry(eventSink).register({
      ...validSkill,
      execute: () => ({ value: "invalid" }),
    });

    await expect(
      registry.execute("doubleNumber", { value: 2 }, { traceId: "trace-3" }),
    ).rejects.toThrow("输出校验失败");
    expect(eventSink).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });
});
