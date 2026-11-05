export type SlideLayout = "title" | "title-body" | "section";

export type Slide = {
  id: string;
  title: string;
  body: string;
  layout: SlideLayout;
};

export type Theme = {
  id: string;
  name: string;
  background: string;
  text: string;
  accent: string;
  muted: string;
};

export type Deck = {
  title: string;
  themeId: string;
  slides: Slide[];
};

export const THEMES: Theme[] = [
  { id: "paper", name: "Paper", background: "#ffffff", text: "#20212b", accent: "#d42924", muted: "#626572" },
  { id: "slate", name: "Slate", background: "#1f2430", text: "#f5f6f8", accent: "#ff6b66", muted: "#b8bdc9" },
  { id: "sand", name: "Sand", background: "#f6f0e3", text: "#3a3428", accent: "#b5651d", muted: "#7a7160" },
  { id: "mint", name: "Mint", background: "#eaf5ef", text: "#1f3a2e", accent: "#1d7d5a", muted: "#547064" },
  { id: "sky", name: "Sky", background: "#eaf1fb", text: "#1e2f4a", accent: "#2563a8", muted: "#5b6f88" },
];

export function themeById(id: string): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

let counter = 0;

export function newSlide(overrides: Partial<Slide> = {}): Slide {
  counter += 1;
  return { id: `slide-${Date.now()}-${counter}`, title: "Untitled slide", body: "", layout: "title-body", ...overrides };
}

export function createDeck(): Deck {
  return {
    title: "Untitled presentation",
    themeId: "paper",
    slides: [
      newSlide({ title: "Your presentation", body: "A clean deck, built in your browser.", layout: "title" }),
    ],
  };
}

export function addSlide(deck: Deck, afterId?: string): Deck {
  const slide = newSlide();
  if (!afterId) return { ...deck, slides: [...deck.slides, slide] };
  const index = deck.slides.findIndex((item) => item.id === afterId);
  const slides = [...deck.slides];
  slides.splice(index < 0 ? slides.length : index + 1, 0, slide);
  return { ...deck, slides };
}

export function duplicateSlide(deck: Deck, id: string): Deck {
  const index = deck.slides.findIndex((item) => item.id === id);
  if (index < 0) return deck;
  const copy = { ...deck.slides[index], id: newSlide().id };
  const slides = [...deck.slides];
  slides.splice(index + 1, 0, copy);
  return { ...deck, slides };
}

export function deleteSlide(deck: Deck, id: string): Deck {
  if (deck.slides.length <= 1) return deck;
  return { ...deck, slides: deck.slides.filter((slide) => slide.id !== id) };
}

export function moveSlide(deck: Deck, id: string, direction: -1 | 1): Deck {
  const index = deck.slides.findIndex((slide) => slide.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= deck.slides.length) return deck;
  const slides = [...deck.slides];
  [slides[index], slides[target]] = [slides[target], slides[index]];
  return { ...deck, slides };
}

export function updateSlide(deck: Deck, id: string, patch: Partial<Slide>): Deck {
  return { ...deck, slides: deck.slides.map((slide) => (slide.id === id ? { ...slide, ...patch } : slide)) };
}

export function setTheme(deck: Deck, themeId: string): Deck {
  return { ...deck, themeId };
}

export function parseDeck(text: string): { deck: Deck } | { error: string } {
  try {
    const data = JSON.parse(text) as unknown;
    if (!data || typeof data !== "object") return { error: "Not a presentation file." };
    const raw = data as { title?: unknown; themeId?: unknown; slides?: unknown };
    if (!Array.isArray(raw.slides) || raw.slides.length === 0) return { error: "Presentation has no slides." };
    const slides: Slide[] = raw.slides.map((item, index) => {
      const slide = item as Partial<Slide>;
      if (typeof slide.title !== "string" || typeof slide.body !== "string") {
        throw new Error(`Slide ${index + 1} is malformed.`);
      }
      const layout: SlideLayout = slide.layout === "title" || slide.layout === "section" ? slide.layout : "title-body";
      return { id: newSlide().id, title: slide.title, body: slide.body, layout };
    });
    const themeId = typeof raw.themeId === "string" ? raw.themeId : "paper";
    return { deck: { title: typeof raw.title === "string" ? raw.title : "Untitled presentation", themeId, slides } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not read that file." };
  }
}
