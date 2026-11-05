import { describe, expect, it } from "vitest";
import {
  addSlide,
  createDeck,
  deleteSlide,
  duplicateSlide,
  moveSlide,
  parseDeck,
  setTheme,
  themeById,
  updateSlide,
} from "./presentation";

describe("deck model", () => {
  it("creates a deck with one slide", () => {
    const deck = createDeck();
    expect(deck.slides).toHaveLength(1);
    expect(deck.themeId).toBe("paper");
  });

  it("adds, duplicates and deletes slides", () => {
    let deck = createDeck();
    const first = deck.slides[0].id;
    deck = addSlide(deck, first);
    expect(deck.slides).toHaveLength(2);
    deck = duplicateSlide(deck, first);
    expect(deck.slides).toHaveLength(3);
    deck = deleteSlide(deck, first);
    expect(deck.slides).toHaveLength(2);
  });

  it("never deletes the last slide", () => {
    const deck = createDeck();
    expect(deleteSlide(deck, deck.slides[0].id).slides).toHaveLength(1);
  });

  it("moves slides and clamps at the edges", () => {
    let deck = createDeck();
    deck = addSlide(deck);
    const ids = deck.slides.map((s) => s.id);
    deck = moveSlide(deck, ids[1], -1);
    expect(deck.slides.map((s) => s.id)).toEqual([ids[1], ids[0]]);
    expect(moveSlide(deck, ids[1], -1).slides.map((s) => s.id)).toEqual([ids[1], ids[0]]);
  });

  it("updates slide content and theme", () => {
    let deck = createDeck();
    const id = deck.slides[0].id;
    deck = updateSlide(deck, id, { title: "Hello", body: "World" });
    expect(deck.slides[0].title).toBe("Hello");
    deck = setTheme(deck, "slate");
    expect(themeById(deck.themeId).id).toBe("slate");
  });
});

describe("parseDeck", () => {
  it("round-trips a serialized deck", () => {
    const deck = createDeck();
    const parsed = parseDeck(JSON.stringify(deck));
    expect("deck" in parsed).toBe(true);
    if ("deck" in parsed) {
      expect(parsed.deck.slides).toHaveLength(deck.slides.length);
      expect(parsed.deck.slides[0].title).toBe(deck.slides[0].title);
    }
  });

  it("rejects invalid input", () => {
    expect("error" in parseDeck("not json")).toBe(true);
    expect("error" in parseDeck(JSON.stringify({ slides: [] }))).toBe(true);
  });
});
