"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Moon, Sun } from "lucide-react";

export default function RouteHeader({ title }: { title: string }) {
  const [dark, setDark] = useState(false);
  const [loaded, setLoaded] = useState(false);
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

  return <header className="topbar route-topbar"><Link className="route-home" href="/" aria-label="APOS workspace">apos<span className="brand-dot">.</span></Link><div className="crumb"><span>Workspace</span><ChevronRight size={14}/><strong>{title}</strong></div><div className="top-actions"><Link className="route-directory" href="/studios">All studios</Link><span className="top-divider"/><button className="theme-toggle" disabled={!loaded} onClick={() => setDark((value) => !value)} aria-label={`Switch to ${dark ? "light" : "dark"} theme`}>{dark ? <Sun size={17}/> : <Moon size={17}/>}</button></div></header>;
}
