"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, ArrowUpRight, Check, ChevronLeft, ChevronRight,
  Clock3, Combine, Command, FilePenLine, FileText, FileType, Image, ImagePlus, LayoutGrid, ListChecks,
  Menu, Minimize2, Moon, PanelsTopLeft, PenLine, PenTool, Presentation, Repeat2, ScanLine, ScanSearch,
  ScanText, Search, Sheet, ShieldCheck, Sparkles, Sun, Table2, WandSparkles, Workflow, Wrench,
  Code2, FileOutput, X
} from "lucide-react";
import { navigation, searchTools, studioDefinitions, studioById, toolDefinitions } from "@/lib/registry";

const icons = { FileText, Repeat2, PenLine, PanelsTopLeft, ShieldCheck, Sparkles, Image, ScanText, FileType, Table2, Presentation, WandSparkles, Workflow, Wrench, Code2, Combine, FilePenLine, LayoutGrid, PenTool, Minimize2, ImagePlus, ScanLine, FileOutput, Sheet, ListChecks, ScanSearch };
const studioIcons = Object.fromEntries(studioDefinitions.map((s) => [s.id, icons[s.icon as keyof typeof icons] ?? FileText]));
const toolIcons = Object.fromEntries(toolDefinitions.map((t) => [t.id, icons[t.icon as keyof typeof icons] ?? FileText]));

export default function Home() {
  const [query, setQuery] = useState("");
  const [activeStudio, setActiveStudio] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [showDirectory, setShowDirectory] = useState(false);
  const [today, setToday] = useState("");
  const results = useMemo(() => searchTools(query).filter((tool) => !activeStudio || tool.studioId === activeStudio), [query, activeStudio]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setDark(localStorage.getItem("apos-theme") === "dark");
      setCollapsed(localStorage.getItem("apos-sidebar") === "collapsed");
      setToday(new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date()));
      setPreferencesLoaded(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => { if (!preferencesLoaded) return; document.documentElement.dataset.theme = dark ? "dark" : "light"; localStorage.setItem("apos-theme", dark ? "dark" : "light"); }, [dark, preferencesLoaded]);
  useEffect(() => { if (preferencesLoaded) localStorage.setItem("apos-sidebar", collapsed ? "collapsed" : "expanded"); }, [collapsed, preferencesLoaded]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); document.getElementById("tool-search")?.focus(); }
      if (event.key === "Escape") { setMobileOpen(false); setShowDirectory(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const sidebar = <>
    <a className="brand" href="#top" aria-label="APOS home"><span className="brand-mark"><span/><span/><span/><span/></span>{!collapsed && <span className="brand-word">apos<span className="brand-dot">.</span></span>}</a>
    <div className="nav-label">WORKSPACE</div>
    <Link title={collapsed ? "Overview" : undefined} className={`nav-item ${!activeStudio ? "selected" : ""}`} href="/" onClick={() => setMobileOpen(false)}><LayoutGrid size={18}/>{!collapsed && <><span>Overview</span><span className="nav-count">15</span></>}</Link>
    <div className="nav-label studios-label">STUDIOS</div>
    <nav aria-label="Product studios" className="studio-nav">{navigation.map((entry) => {
      const Icon = studioIcons[entry.id as keyof typeof studioIcons];
      return <Link key={entry.id} title={collapsed ? entry.label : undefined} aria-current={activeStudio === entry.id ? "page" : undefined} className="nav-item" href={`/studios/${entry.id}`} onClick={() => setMobileOpen(false)}><Icon size={18}/>{!collapsed && <span>{entry.label}</span>}</Link>;
    })}</nav>
    <div className="sidebar-bottom"><div className="privacy-card"><div className="privacy-icon"><ShieldCheck size={16}/></div>{!collapsed && <div><strong>Your files, your space</strong><span>Private by design</span></div>}</div><div className="profile"><div className="avatar">A</div>{!collapsed && <div><strong>Welcome to APOS</strong><span>Personal workspace</span></div>}</div></div>
  </>;

  return <main id="top" className="app-shell">
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>{sidebar}<button aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="collapse-button" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={16}/> : <ChevronLeft size={16}/>}</button></aside>
    {mobileOpen && <div className="mobile-scrim" onClick={() => setMobileOpen(false)}><aside id="mobile-navigation" aria-label="Mobile navigation" className="sidebar mobile-sidebar" onClick={(e) => e.stopPropagation()}><button className="mobile-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X size={19}/></button>{sidebar}</aside></div>}
    <section className="main-area">
      <header className="topbar"><button className="mobile-menu" aria-label="Open menu" aria-controls="mobile-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={20}/></button><div className="crumb"><span>Workspace</span><ChevronRight size={14}/><strong>{activeStudio ? studioById[activeStudio as keyof typeof studioById].name : "Overview"}</strong></div><div className="top-actions"><span className="top-divider"/><button className="theme-toggle" disabled={!preferencesLoaded} onClick={() => setDark(!dark)} aria-label={`Switch to ${dark ? "light" : "dark"} theme`}>{dark ? <Sun size={17}/> : <Moon size={17}/>}</button></div></header>
      <div className="content-wrap">
        <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot"/> YOUR WORKSPACE, IN GOOD ORDER</div><h1>Good morning<span className="period">.</span></h1><p className="welcome-copy">A clear space to make your next piece of work.</p></div><div className="date-chip"><Clock3 size={15}/><span>{today}</span></div></section>

        <section className="hero-card"><div className="hero-copy"><div className="hero-kicker"><span className="kicker-spark"><Sparkles size={13}/></span> A MORE THOUGHTFUL WORKSPACE</div><h2>Make room for<br/>your best work.</h2><p>Everything you need for documents, gathered in one calm, capable place.</p><button className="hero-cta" onClick={() => { setActiveStudio(null); setShowDirectory(true); }}>Browse tools <ArrowRight size={16}/></button></div><div className="hero-art" aria-hidden="true"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-glow"/><div className="art-sheet back-sheet"><div/><div/><div/></div><div className="art-sheet front-sheet"><div className="sheet-top"><span/><span/><span/></div><div className="sheet-title"/><div className="sheet-line wide"/><div className="sheet-line"/><div className="sheet-chart"><i/><i/><i/><i/><i/><i/></div><div className="sheet-line short"/></div><div className="floating-check"><Check size={15}/></div><div className="floating-spark"><Sparkles size={17}/></div></div><div className="hero-index"><span>01</span><i/> <span>15 STUDIOS</span></div></section>

        <section className="ticker" aria-label="What APOS can do">
          <div className="ticker-track">
          {[0, 1].map((copy) => <div className="ticker-group" key={copy} aria-hidden={copy === 1 ? "true" : undefined}>
            {[
              ["38", "tools, one workspace"],
              ["No uploads", "everything runs in your browser"],
              ["PDF ↔ Word ↔ Excel", "real files, not screenshots"],
              ["Sarvam 105B", "summaries and document drafting"],
              ["OCR", "scans become text"],
              ["Automations", "chain the steps you repeat"],
              ["Honest badges", "we say when a tool is not ready"],
            ].map(([title, copyText]) => <span className="ticker-item" key={title}><i/><strong>{title}</strong> {copyText}</span>)}
          </div>)}
          </div>
        </section>

        <section className="section-heading"><div><div className="section-eyebrow">BUILT AROUND YOUR WORK</div><h2>Explore the studios</h2></div><Link className="text-link" href="/studios">View all studios <ArrowRight size={15}/></Link></section>
        <section className="studio-grid" aria-label="Product studios">{studioDefinitions.slice(0, 6).map((studio, index) => { const Icon = studioIcons[studio.id as keyof typeof studioIcons]; return <Link className={`studio-card accent-${studio.accent}`} key={studio.id} href={`/studios/${studio.id}`}><div className="studio-card-top"><span className="studio-icon"><Icon size={19}/></span><span className="studio-number">0{index + 1}</span></div><h3>{studio.name}</h3><p>{studio.description}</p><span className="card-arrow"><ArrowUpRight size={16}/></span></Link>; })}</section>

        <section className="tools-section" id="tools"><div className="section-heading tool-heading"><div><div className="section-eyebrow">YOUR TOOLKIT</div><h2>{activeStudio ? studioById[activeStudio as keyof typeof studioById].name : "Tools, when you need them"}</h2></div><div className="tool-controls"><label className="search-box"><Search size={17}/><input id="tool-search" value={query} onChange={(e) => { setQuery(e.target.value); setShowDirectory(true); }} placeholder="Find a tool..." aria-label="Search tools"/><kbd><Command size={10}/> K</kbd></label></div></div>
          <div className="tool-grid">{results.slice(0, showDirectory || query || activeStudio ? 15 : 4).map((tool) => { const Icon = toolIcons[tool.id as keyof typeof toolIcons]; return <Link className="tool-card" key={tool.id} href={`/tools/${tool.id}`}><div className="tool-card-main"><span className="tool-icon"><Icon size={18}/></span><div><h3>{tool.name}</h3><p>{studioById[tool.studioId].name}</p></div></div><div className="tool-card-foot"><span className="status-pill"><i/> {tool.status === "in-development" ? "In Development" : tool.status[0].toUpperCase() + tool.status.slice(1)}</span><span className="tool-description">{tool.description}</span></div></Link>; })}</div>
          {results.length === 0 && <div className="empty-state"><div className="empty-icon"><Search size={21}/></div><h3>No tools found</h3><p>Try another search or browse all studios.</p><button onClick={() => { setQuery(""); setActiveStudio(null); }}>Clear search</button></div>}
          {!showDirectory && !query && !activeStudio && <Link className="show-more" href="/studios">Browse the full directory <ArrowRight size={15}/></Link>}
        </section>
        <footer className="footer"><a className="footer-brand" href="#top"><span className="brand-mark small"><span/><span/><span/><span/></span> apos<span className="brand-dot">.</span></a><span>Thoughtfully made for the way you work.</span><span className="footer-right">Â© 2026 APOS <i/> Privacy-first by design</span></footer>
      </div>
    </section>
  </main>;
}
