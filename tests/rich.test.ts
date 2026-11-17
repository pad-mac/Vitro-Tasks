import { describe, expect, it } from "vitest";
import { plainText, richParts } from "../src/lib/rich";

describe("richParts", () => {
  it("finds markdown links and bare URLs", () => {
    expect(richParts("Read [the paper](https://example.org/a_b) and https://x.io/p?q=1.")).toEqual([
      { text: "Read " },
      { text: "the paper", href: "https://example.org/a_b" },
      { text: " and " },
      { text: "https://x.io/p?q=1", href: "https://x.io/p?q=1" },
      { text: "." },
    ]);
  });
  it("turns www addresses into https links", () => {
    expect(richParts("see www.hu-berlin.de")[1]).toEqual({ text: "www.hu-berlin.de", href: "https://www.hu-berlin.de" });
  });
  it("leaves unsafe schemes as text", () => {
    expect(richParts("[x](javascript:alert(1))").every((p) => !p.href)).toBe(true);
  });
  it("plain text keeps the labels", () => {
    expect(plainText("Mail [Christian](mailto:c@x.de) today")).toBe("Mail Christian today");
  });
});
