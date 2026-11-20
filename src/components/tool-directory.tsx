"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Search, SlidersHorizontal, X } from "lucide-react";
import { processingMode, studioById, studioDefinitions, toolDefinitions, type ToolProcessing } from "@/lib/registry";
import { toolIcons } from "@/lib/tool-icons";

const processingLabels: Record<ToolProcessing, string> = {
  browser: "On this device",
  ai: "AI text service",
  "server-optional": "Server optional",
};

export default function ToolDirectory() {
  const [query, setQuery] = useState("");
  const [studio, setStudio] = useState("all");
  const [mode, setMode] = useState("all");
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const results = useMemo(() => toolDefinitions.filter((tool) => {
    if (studio !== "all" && tool.studioId !== studio) return false;
    if (mode !== "all" && processingMode(tool) !== mode) return false;
    if (!normalizedQuery) return true;
    return `${tool.name} ${tool.description} ${studioById[tool.studioId].name}`.toLocaleLowerCase().includes(normalizedQuery);
  }), [mode, normalizedQuery, studio]);

  const clear = () => {
    setQuery("");
    setStudio("all");
    setMode("all");
  };

  return (
    <section className="tool-directory" aria-label="All APOS tools">
      <div className="directory-controls">
        <label className="directory-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Search all tools</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${toolDefinitions.length} tools…`}
          />
          {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear tool search"><X size={15} /></button> : null}
        </label>
        <label className="directory-select">Studio
          <select value={studio} onChange={(event) => setStudio(event.target.value)}>
            <option value="all">All studios</option>
            {studioDefinitions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        <label className="directory-select">Processing
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="all">Any processing</option>
            <option value="browser">On this device</option>
            <option value="ai">AI text service</option>
            <option value="server-optional">Server optional</option>
          </select>
        </label>
      </div>

      <div className="directory-summary">
        <p role="status">{results.length === toolDefinitions.length ? `All ${toolDefinitions.length} tools` : `${results.length} of ${toolDefinitions.length} tools`}</p>
        {(query || studio !== "all" || mode !== "all") ? <button type="button" onClick={clear}>Clear filters</button> : <span><SlidersHorizontal size={13} aria-hidden="true" /> Filter by studio or processing</span>}
      </div>

      {results.length ? (
        <div className="directory-grid">
          {results.map((tool) => {
            const Icon = toolIcons[tool.id] ?? toolIcons["file-inspector"];
            const currentMode = processingMode(tool);
            const studioInfo = studioById[tool.studioId];
            return (
              <Link className="directory-card" key={tool.id} href={`/tools/${tool.id}`}>
                <div className="directory-card-top">
                  <span className="tool-icon"><Icon size={19} aria-hidden="true" /></span>
                  <span className={`directory-mode mode-${currentMode}`}>{processingLabels[currentMode]}</span>
                </div>
                <h2>{tool.name}</h2>
                <p className="directory-studio">{studioInfo.name}</p>
                <p className="directory-description">{tool.description}</p>
                <span className="directory-open">Open tool <ArrowRight size={14} aria-hidden="true" /></span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="directory-empty">
          <Search size={22} aria-hidden="true" />
          <h2>No tools match those filters</h2>
          <p>Try a shorter search, another studio, or show every processing mode.</p>
          <button type="button" onClick={clear}>Show all {toolDefinitions.length} tools</button>
        </div>
      )}
    </section>
  );
}
