import { describe, expect, it } from "vitest";
import { blockLine, escapeText, firstLineOf, locationLink, locationMarkdown, locationOf, notesToHtml, parseBlocks, parseInline, plainMarkdown, safeLink } from "../src/lib/markdown";

describe("descriptions as markdown", () => {
  it("reads one block per line, and writes each back as it was", () => {
    const md = "# Head\n## Sub\n### Small\n- a\n* b\n3. Mai\n> quote\nplain\n";
    const blocks = parseBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual(["h1", "h2", "h3", "ul", "ul", "ol", "quote", "p", "p"]);
    expect(blocks[5]).toEqual({ type: "ol", text: "Mai", n: 3 });
    expect(blocks.filter((b) => b.type !== "ul").map(blockLine)).toEqual(["# Head", "## Sub", "### Small", "3. Mai", "> quote", "plain", ""]);
    // Not headings or items: no space after the mark.
    expect(parseBlocks("#tag\n-dash\n1.5 kg").map((b) => b.type)).toEqual(["p", "p", "p"]);
  });

  it("keeps a plain line that looks like markup as typed", () => {
    expect(blockLine({ type: "p", text: "# not a heading" })).toBe("\\# not a heading");
    expect(parseInline("\\# not a heading")).toEqual([{ t: "text", text: "# not a heading" }]);
    expect(blockLine({ type: "p", text: "- not an item" })).toBe("\\- not an item");
  });

  it("reads bold, italic, struck, underlined, links and places, nested too", () => {
    expect(parseInline("**b** *i* _j_ ~~s~~ <u>u</u>")).toEqual([
      { t: "b", kids: [{ t: "text", text: "b" }] },
      { t: "text", text: " " },
      { t: "i", kids: [{ t: "text", text: "i" }] },
      { t: "text", text: " " },
      { t: "i", kids: [{ t: "text", text: "j" }] },
      { t: "text", text: " " },
      { t: "s", kids: [{ t: "text", text: "s" }] },
      { t: "text", text: " " },
      { t: "u", kids: [{ t: "text", text: "u" }] },
    ]);
    expect(parseInline("**bold *and italic***")[0]).toEqual({ t: "b", kids: [{ t: "text", text: "bold " }, { t: "i", kids: [{ t: "text", text: "and italic" }] }] });
    expect(parseInline("[paper](zotero://select/items/ABC)")).toEqual([{ t: "link", href: "zotero://select/items/ABC", text: "paper" }]);
    expect(parseInline("see https://example.com/x.")).toEqual([{ t: "text", text: "see " }, { t: "link", href: "https://example.com/x", text: "https://example.com/x" }, { t: "text", text: "." }]);
    expect(parseInline(locationMarkdown("Café Central"))).toEqual([{ t: "loc", place: "Café Central", text: "Café Central" }]);
  });

  it("leaves what is no markup alone", () => {
    for (const s of ["5 * 3 = 15", "snake_case_name", "C:\\Users\\me", "a ** b", "under_score_", "1 < 2 > 0", "[not a link]", "[x](javascript:alert(1))"]) {
      expect(parseInline(s).map((n) => (n.t === "text" ? n.text : "?")).join("")).toBe(s);
      expect(escapeText(s)).toBe(s);
    }
  });

  it("escapes text that would turn into markup, and reads it back as typed", () => {
    for (const s of ["**not bold**", "*stars*", "~~x~~", "[a](mailto:x@y.z)", "<u>u</u>", "back\\*slash"]) {
      const e = escapeText(s);
      expect(parseInline(e)).toEqual([{ t: "text", text: s }]);
    }
  });

  it("opens web, mail and app links, nothing else", () => {
    expect(["https://a.b", "http://a.b", "mailto:x@y.z", "zotero://select/x", "obsidian://open?x", "tel:+43123"].every(safeLink)).toBe(true);
    expect(["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "vbscript:x"].some(safeLink)).toBe(false);
  });

  it("finds the place in a location link", () => {
    expect(locationLink("Café Central, Wien")).toBe("https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20Central%2C%20Wien");
    expect(locationOf(locationLink("Café Central, Wien"))).toBe("Café Central, Wien");
    expect(locationOf("https://example.com")).toBeNull();
  });

  it("shows descriptions without markup where there is no room for it", () => {
    expect(plainMarkdown("# Plan\n- **buy** milk\nmeet at [Café](https://www.google.com/maps/search/?api=1&query=Caf%C3%A9)")).toBe("Plan\nbuy milk\nmeet at Café");
    expect(firstLineOf("\n\n## Agenda\nmore")).toBe("Agenda");
  });

  it("draws one element per line for the editor, lists and quotes grouped", () => {
    expect(notesToHtml("a\n\n- x\n- y\n3. z\n> q\n# H")).toBe("<div>a</div><div><br></div><ul><li>x</li><li>y</li></ul><ol start=\"3\"><li>z</li></ol><blockquote><div>q</div></blockquote><h1>H</h1>");
    expect(notesToHtml("<b>&")).toBe("<div>&lt;b&gt;&amp;</div>");
  });
});
