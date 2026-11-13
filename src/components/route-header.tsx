"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Menu, Moon, Search, Sun, X } from "lucide-react";
import { studioDefinitions, toolDefinitions } from "@/lib/registry";

const FEATURED_TOOLS = toolDefinitions.filter((tool) => tool.status === "available").slice(0, 8);

export default function RouteHeader({ title, section }: { title: string; section?: { name: string; path: string } }) {
  const [dark, setDark] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const preference = localStorage.getItem("apos-theme") === "dark";
      setDark(preference);
      document.documentElement.dataset.theme = preference ? "dark" : "light";
      setLoaded(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("apos-theme", dark ? "dark" : "light");
  }, [dark, loaded]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        navRef.current?.querySelectorAll("details[open]").forEach((node) => node.removeAttribute("open"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closeMenus = () => {
    setMobileOpen(false);
    navRef.current?.querySelectorAll("details[open]").forEach((node) => node.removeAttribute("open"));
  };

  return (
    <header className="topbar route-topbar">
      <Link className="route-home" href="/" aria-label="APOS workspace">apos<span className="brand-dot">.</span></Link>

      <nav className="primary-nav" aria-label="Primary" ref={navRef}>
        <details className="nav-menu">
          <summary>Studios <ChevronDown size={14} aria-hidden="true" /></summary>
          <div className="nav-panel nav-panel-wide">
            <p className="nav-panel-title">Fifteen focused studios</p>
            <div className="nav-panel-grid">
              {studioDefinitions.filter((studio) => studio.name !== section?.name).map((studio) => (
                <Link key={studio.id} href={`/studios/${studio.id}`} onClick={closeMenus}>{studio.name}</Link>
              ))}
            </div>
            <Link className="nav-panel-foot" href="/studios" onClick={closeMenus}>See the full directory →</Link>
          </div>
        </details>

        <details className="nav-menu">
          <summary>Tools <ChevronDown size={14} aria-hidden="true" /></summary>
          <div className="nav-panel">
            <p className="nav-panel-title">Ready to use now</p>
            <div className="nav-panel-grid two">
              {FEATURED_TOOLS.map((tool) => (
                <Link key={tool.id} href={`/tools/${tool.id}`} onClick={closeMenus}>{tool.name}</Link>
              ))}
            </div>
            <Link className="nav-panel-foot" href="/studios" onClick={closeMenus}>Browse every tool →</Link>
          </div>
        </details>

        <Link className="primary-link" href="/faq">Answers</Link>
        <Link className="primary-link" href="/studios">Directory</Link>
        <Link className="primary-link" href="/server-tools">Server tools</Link>
      </nav>

      <div className="top-actions">
        <Link className="route-search" href="/#tools" aria-label="Find a tool"><Search size={16} /><span>Find a tool</span></Link>
        <span className="top-divider" />
        <button className="theme-toggle" disabled={!loaded} onClick={() => setDark((value) => !value)} aria-label={`Switch to ${dark ? "light" : "dark"} theme`}>
          {dark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <button className="mobile-menu route-mobile-menu" aria-label="Open menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
          <Menu size={20} />
        </button>
      </div>

      <div className="crumb route-crumb">
        {section ? <><span className="route-section">{section.name}</span><ChevronRight size={14} aria-hidden="true" /></> : <><Link href="/">Workspace</Link><ChevronRight size={14} aria-hidden="true" /></>}
        <strong>{title}</strong>
      </div>

      {mobileOpen && (
        <div className="nav-sheet" role="dialog" aria-modal="true" aria-label="Site navigation">
          <div className="nav-sheet-head">
            <span className="route-home">apos<span className="brand-dot">.</span></span>
            <button className="mobile-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X size={19} /></button>
          </div>
          <p className="nav-panel-title">Main</p>
          <Link href="/" onClick={closeMenus}>Overview</Link>
          <Link href="/studios" onClick={closeMenus}>All studios</Link>
          <Link href="/server-tools" onClick={closeMenus}>Server tools</Link>
          <Link href="/faq" onClick={closeMenus}>Questions &amp; answers</Link>
          <p className="nav-panel-title">Studios</p>
          <div className="nav-sheet-grid">
            {studioDefinitions.filter((studio) => studio.name !== section?.name).map((studio) => (
              <Link key={studio.id} href={`/studios/${studio.id}`} onClick={closeMenus}>{studio.name}</Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
