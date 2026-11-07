import { describe, expect, it } from "vitest";
import { autoMotionDelta } from "../../src/domain/universeAutoMotion";
import { mergeConfigJson, parseConfig } from "../../src/platform";

describe("Universe automatic movement", () => {
  it("A stays within a small angular range across a full cycle", () => {
    let time = 0,
      theta = 0,
      phi = 0;
    for (let i = 0; i < 19000; i++) {
      const d = autoMotionDelta("drift", time, 1 / 60);
      time = d.time;
      theta += d.theta;
      phi += d.phi;
      expect(Math.abs(theta)).toBeLessThanOrEqual((2.5 * Math.PI) / 180 + 1e-8);
      expect(Math.abs(phi)).toBeLessThanOrEqual((0.6 * Math.PI) / 180 + 1e-8);
    }
  });
  it("C completes a horizontal orbit in 180 seconds without changing elevation", () => {
    let time = 0,
      angle = 0;
    for (let i = 0; i < 10800; i++) {
      const d = autoMotionDelta("orbit", time, 1 / 60);
      time = d.time;
      angle += d.theta;
      expect(d.phi).toBe(0);
    }
    expect(angle).toBeCloseTo(Math.PI * 2, 8);
  });
  it("returning from an inactive window cannot replay elapsed time in one frame", () => {
    expect(autoMotionDelta("orbit", 0, 300).theta).toBeCloseTo((Math.PI / 90) * 0.05);
    expect(autoMotionDelta("drift", 0, -1).theta).toBe(0);
  });
  it("native and browser config parsing preserves OFF and style across unrelated settings writes", () => {
    const saved = mergeConfigJson(
      '{"dataDir":"/journal","universeAutoMotion":false,"universeAutoStyle":"orbit"}',
      { theme: "dark" },
    );
    expect(parseConfig(saved)).toMatchObject({
      universeAutoMotion: false,
      universeAutoStyle: "orbit",
      theme: "dark",
    });
    expect(
      parseConfig('{"dataDir":"/journal","universeAutoMotion":"yes","universeAutoStyle":"bad"}'),
    ).not.toHaveProperty("universeAutoStyle");
  });
});
