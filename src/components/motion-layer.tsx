"use client";

import { useEffect } from "react";

const REVEAL_SELECTORS = [
  "[data-reveal]",
  ".studio-card",
  ".tool-card",
  ".studio-row",
  ".feature-card",
  ".tool-section",
  ".welcome-row",
  ".hero-card",
  ".footer",
  ".route-hero",
  ".tool-panel",
  ".how-step",
  ".planned-panel",
  ".merge-panel",
];

export default function MotionLayer() {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    root.dataset.motion = "on";
    const cleanup: (() => void)[] = [];

    const targets = Array.from(new Set(REVEAL_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))));
    targets.forEach((element, index) => {
      if (!element.classList.contains("reveal")) element.classList.add("reveal");
      element.style.setProperty("--reveal-delay", `${(index % 6) * 70}ms`);
    });

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.06 },
    );
    const trackables = Array.from(document.querySelectorAll<HTMLElement>(".reveal:not(.is-in)"));
    trackables.forEach((element) => observer.observe(element));
    cleanup.push(() => observer.disconnect());

    const hero = document.querySelector<HTMLElement>(".hero-card");
    if (hero) {
      const move = (event: PointerEvent) => {
        const rect = hero.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        hero.style.setProperty("--mx", x.toFixed(3));
        hero.style.setProperty("--my", y.toFixed(3));
      };
      const leave = () => {
        hero.style.setProperty("--mx", "0");
        hero.style.setProperty("--my", "0");
      };
      hero.addEventListener("pointermove", move);
      hero.addEventListener("pointerleave", leave);
      cleanup.push(() => {
        hero.removeEventListener("pointermove", move);
        hero.removeEventListener("pointerleave", leave);
      });
    }

    const glowTargets = Array.from(document.querySelectorAll<HTMLElement>(".route-hero, .tool-panel"));
    const glow = (event: PointerEvent) => {
      const surface = (event.target as HTMLElement | null)?.closest<HTMLElement>(".route-hero, .tool-panel");
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      surface.style.setProperty("--gx", `${(((event.clientX - rect.left) / rect.width) * 100).toFixed(1)}%`);
      surface.style.setProperty("--gy", `${(((event.clientY - rect.top) / rect.height) * 100).toFixed(1)}%`);
    };
    if (glowTargets.length) {
      document.addEventListener("pointermove", glow, { passive: true });
      cleanup.push(() => document.removeEventListener("pointermove", glow));
    }

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const doc = document.documentElement;
        const max = doc.scrollHeight - window.innerHeight;
        const ratio = max > 0 ? Math.min(1, window.scrollY / max) : 0;
        root.style.setProperty("--scroll-progress", ratio.toFixed(4));
        root.dataset.scrolled = window.scrollY > 8 ? "true" : "false";
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    cleanup.push(() => window.removeEventListener("scroll", onScroll));

    const onReducedChange = () => {
      if (reduced.matches) {
        delete root.dataset.motion;
        root.style.removeProperty("--scroll-progress");
      } else {
        root.dataset.motion = "on";
      }
    };
    reduced.addEventListener("change", onReducedChange);
    cleanup.push(() => reduced.removeEventListener("change", onReducedChange));

    return () => {
      cleanup.forEach((dispose) => dispose());
      delete root.dataset.motion;
    };
  }, []);

  return <div className="scroll-progress" aria-hidden="true"><i /></div>;
}
