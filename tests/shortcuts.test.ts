import { describe, expect, it } from "vitest";
import { comboFromEvent, parseShortcuts } from "../src/lib/shortcuts";

const ev = (key: string, code: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as KeyboardEvent;

describe("comboFromEvent", () => {
  it("names plain keys, digits and modifier combos", () => {
    expect(comboFromEvent(ev("a", "KeyA"))).toBe("A");
    expect(comboFromEvent(ev("!", "Digit1", { shiftKey: true }))).toBe("Shift+1");
    expect(comboFromEvent(ev("Tab", "Tab", { ctrlKey: true }))).toBe("Ctrl+Tab");
    expect(comboFromEvent(ev("Tab", "Tab", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Tab");
    expect(comboFromEvent(ev(" ", "Space", { ctrlKey: true }))).toBe("Ctrl+Space");
    expect(comboFromEvent(ev("Control", "ControlLeft", { ctrlKey: true }))).toBeNull();
  });
  it("keeps the letter the keyboard layout produces", () => {
    // German layout: the key labelled Z sits where US has Y.
    expect(comboFromEvent(ev("z", "KeyY"))).toBe("Z");
  });
});

describe("parseShortcuts", () => {
  it("fills in defaults and survives bad data", () => {
    expect(parseShortcuts('{"calWeek":"Ctrl+W"}')).toMatchObject({ calWeek: "Ctrl+W", calMonth: "M", switchLayer: "Ctrl+Tab" });
    expect(parseShortcuts("{nope").addTask).toBe("A");
  });
});
