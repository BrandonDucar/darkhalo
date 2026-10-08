<script>
  import { inspect, exportCapsule } from './lib/inspect.mjs';
  import { Activity, ArrowRight, Check, ChevronDown, Download, Eclipse, FileJson, FileText, FlaskConical, Inbox, Layers, Link, ListFilter, LockKeyhole, Menu, Plus, RotateCcw, Search, ShieldCheck, ShieldOff, Terminal, TriangleAlert, Upload, X } from '@lucide/svelte';

  const MAX_BYTES = 2 * 1024 * 1024;
  const tabs = [{ id: 'intake', label: 'Intake', icon: Inbox }, { id: 'findings', label: 'Findings', icon: ListFilter }, { id: 'context', label: 'Context', icon: Layers }, { id: 'capsule', label: 'Capsule', icon: FileJson }];
  let activeTab = 'intake';
  let mobileNav = false;
  let editor = '';
  let revocations = '';
  let editorRevocations = '';
  let result = null;
  let lastInput = null;
  let selectedId = null;
  let query = '';
  let gateFilter = 'all';
  let routeFilter = false;
  let error = '';
  let notice = '';
  let filename = '';
  let synthetic = false;
  let inspectedSynthetic = false;
  let dragging = false;
  let fileInput;
  let importSequence = 0;
  let downloadUrl;

  $: records = result?.records ?? [];
  $: filtered = records.filter((record) => (gateFilter === 'all' || record.gate.status === gateFilter) && (!routeFilter || record.routeCandidates.length > 0) && `${record.id} ${record.text} ${record.author ?? ''} ${record.sourceUrl ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  $: selected = records.find((record) => record.id === selectedId) ?? null;
  $: metrics = result?.metrics;
  $: dirty = !!result && (editor !== JSON.stringify(lastInput, null, 2) || revocations.trim() !== (lastInput?.revokedAuthorities ?? []).join('\n'));
  $: allowed = records.filter((record) => record.gate.status === 'ALLOWED');
  $: ratio = metrics && metrics.originalCharacters > 0 ? Math.min(100, Math.max(0, metrics.outputCharacters / metrics.originalCharacters * 100)) : 0;
  $: capsulePreview = result ? makeCapsulePreview() : '';

  const fmt = (value) => typeof value === 'number' ? new Intl.NumberFormat('en-US').format(value) : '--';
  const bytes = (value) => new TextEncoder().encode(value).length;
  const shortDigest = (value) => value ? `${value.slice(0, 12)}...${value.slice(-8)}` : '--';

  function switchTab(tab) { activeTab = tab; mobileNav = false; }
  function editInput(event) {
    ++importSequence;
    filename = '';
    try {
      const input = JSON.parse(event.currentTarget.value);
      let next;
      if (Array.isArray(input.revokedAuthorities) && input.revokedAuthorities.every((id) => typeof id === 'string')) next = input.revokedAuthorities.join('\n');
      else if (!('revokedAuthorities' in input)) next = '';
      if (next !== undefined && next !== editorRevocations) {
        revocations = next;
        editorRevocations = next;
      }
    } catch { /* Keep staged revocations while JSON is incomplete. */ }
  }
  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be a JSON object.');
    if (input.version !== 1) throw new Error('Use input version 1.');
    if (!Array.isArray(input.records)) throw new Error('Input must include a records array.');
    const ids = new Set();
    input.records.forEach((record, index) => {
      if (!record || typeof record.id !== 'string' || !record.id.trim() || typeof record.text !== 'string') throw new Error(`Record ${index + 1} needs a non-empty string id and a string text.`);
      if (ids.has(record.id)) throw new Error(`Duplicate record id: ${record.id}. IDs must be unique.`);
      ids.add(record.id);
      for (const field of ['author', 'sourceUrl', 'observedAt', 'status']) if (record[field] !== undefined && typeof record[field] !== 'string') throw new Error(`Record ${index + 1}: ${field} must be a string.`);
      if (record.upstreamAuthorities !== undefined && (!Array.isArray(record.upstreamAuthorities) || record.upstreamAuthorities.some((id) => typeof id !== 'string'))) throw new Error(`Record ${index + 1}: upstreamAuthorities must be an array of strings.`);
    });
    if (input.revokedAuthorities !== undefined && (!Array.isArray(input.revokedAuthorities) || input.revokedAuthorities.some((id) => typeof id !== 'string'))) throw new Error('revokedAuthorities must be an array of strings.');
    if (input.cells !== undefined && (!Array.isArray(input.cells) || input.cells.some((cell) => !cell || typeof cell.id !== 'string' || typeof cell.label !== 'string' || !Array.isArray(cell.terms) || cell.terms.some((term) => typeof term !== 'string')))) throw new Error('Each cell needs a string id, string label, and a terms array of strings.');
    return input;
  }

  function runInspection() {
    ++importSequence;
    error = ''; notice = '';
    try {
      if (!editor.trim()) throw new Error('Add a JSON file or paste input before inspecting.');
      if (bytes(editor) > MAX_BYTES) throw new Error('Input exceeds the 2 MiB limit. Choose a smaller file or reduce the pasted input.');
      let parsed;
      try { parsed = JSON.parse(editor); } catch { throw new Error('Invalid JSON. Check the input syntax and try again.'); }
      const input = validate(parsed);
      input.revokedAuthorities = [...new Set(revocations.split(/\r?\n/).map((id) => id.trim()).filter(Boolean))];
      const next = inspect(input);
      if (!next || next.version !== 1 || next.evidenceClass !== 'LOCAL_ANALYSIS' || !Array.isArray(next.records) || !next.metrics) throw new Error('The inspection engine returned an unsupported result.');
      result = next;
      lastInput = input;
      editor = JSON.stringify(input, null, 2);
      revocations = input.revokedAuthorities.join('\n');
      editorRevocations = revocations;
      inspectedSynthetic = synthetic;
      selectedId = next.records[0]?.id ?? null;
      notice = `Inspected ${next.records.length} local records${synthetic ? ' (SYNTHETIC)' : ''}.`;
      query = ''; gateFilter = 'all'; routeFilter = false;
      activeTab = 'findings';
    } catch (cause) {
      result = null; lastInput = null; selectedId = null;
      error = cause instanceof Error ? cause.message : 'Inspection failed. No result was retained.';
    }
  }

  async function loadFile(file) {
    if (!file) return;
    if (fileInput) fileInput.value = '';
    const sequence = ++importSequence;
    error = ''; notice = '';
    if (file.size > MAX_BYTES) { error = 'File exceeds the 2 MiB limit. Choose a smaller JSON file.'; return; }
    try {
      const text = await file.text();
      if (sequence !== importSequence) return;
      if (bytes(text) > MAX_BYTES) throw new Error('File exceeds the 2 MiB limit.');
      const parsed = validate(JSON.parse(text));
      editor = text;
      revocations = (parsed.revokedAuthorities ?? []).join('\n');
      editorRevocations = revocations;
      filename = file.name; synthetic = false;
      result = null; lastInput = null; selectedId = null;
      notice = `${file.name} loaded. Ready to inspect.`;
      activeTab = 'intake';
    } catch (cause) {
      if (sequence !== importSequence) return;
      error = cause instanceof SyntaxError ? 'This file is not valid JSON.' : (cause.message ?? 'Could not read this file.');
    }
  }

  function dropFile(event) {
    event.preventDefault(); dragging = false;
    if (event.dataTransfer.files.length !== 1) { error = 'Choose one JSON file at a time.'; return; }
    loadFile(event.dataTransfer.files[0]);
  }

  function loadSynthetic() {
    ++importSequence;
    const sample = {
      version: 1,
      records: [
        { id: 'synthetic-01', text: 'The fictional Lumen workshop checks its green lantern twice. The fictional Lumen workshop checks its green lantern twice.', author: 'Fabricated Observer A', sourceUrl: 'https://example.invalid/synthetic/01', observedAt: '2026-01-01T00:00:00Z', status: 'active', upstreamAuthorities: ['synthetic-authority-a'] },
        { id: 'synthetic-02', text: 'A fabricated maintenance note: the imaginary lantern requires a lens check.', author: 'Fabricated Observer B', sourceUrl: 'https://example.invalid/synthetic/02', observedAt: '2026-01-01T00:00:00Z', status: 'active', upstreamAuthorities: ['synthetic-revoked-authority'] },
        { id: 'synthetic-03', text: 'The fictional Lumen workshop checks its green lantern twice. The fictional Lumen workshop checks its green lantern twice.', author: 'Fabricated Observer C', sourceUrl: 'https://example.invalid/synthetic/03', observedAt: '2026-01-01T00:00:00Z', status: 'active', upstreamAuthorities: ['synthetic-authority-a'] },
        { id: 'synthetic-04', text: 'Imaginary inventory: a teal lens is stored beside a fictional lantern.', author: 'Fabricated Observer D', sourceUrl: 'https://example.invalid/synthetic/04', observedAt: '2026-01-01T00:00:00Z', status: 'active', upstreamAuthorities: [] }
      ],
      revokedAuthorities: ['synthetic-revoked-authority'],
      cells: [{ id: 'synthetic-workshop', label: 'Fictional workshop', terms: ['lantern', 'lens'] }]
    };
    editor = JSON.stringify(sample, null, 2); revocations = sample.revokedAuthorities.join('\n');
    editorRevocations = revocations;
    synthetic = true; filename = 'SYNTHETIC sample'; result = null; lastInput = null; selectedId = null;
    error = ''; notice = 'SYNTHETIC input loaded: 4 entirely fabricated records. Not yet inspected.';
    activeTab = 'intake';
  }

  function reset() {
    ++importSequence;
    editor = ''; revocations = ''; result = null; lastInput = null; selectedId = null;
    editorRevocations = '';
    query = ''; gateFilter = 'all'; routeFilter = false; filename = ''; synthetic = false; inspectedSynthetic = false;
    error = ''; notice = 'Local workspace cleared.'; activeTab = 'intake';
    if (fileInput) fileInput.value = '';
    if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = undefined; }
  }

  function makeCapsulePreview() {
    try { const capsule = exportCapsule(result); return typeof capsule === 'string' ? capsule : JSON.stringify(capsule, null, 2); }
    catch { return ''; }
  }

  function downloadCapsule() {
    error = ''; notice = '';
    try {
      if (!result || dirty) throw new Error('Inspect the current input before exporting.');
      const payload = exportCapsule(result);
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
      if (!text) throw new Error('The engine did not produce a capsule.');
      JSON.parse(text);
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = downloadUrl; link.download = `darkhalo-${inspectedSynthetic ? 'synthetic-' : ''}capsule.json`;
      link.click();
      notice = 'Capsule download created locally. No publication or authority granted.';
    } catch (cause) { error = cause.message ?? 'Capsule export failed.'; }
  }

  function sourceHref(value) {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
  }
</script>

<svelte:head><title>Darkhalo | Local analysis workspace</title><meta name="description" content="Darkhalo local evidence inspection workspace." /></svelte:head>

<div class="workspace">
  <header class="app-header">
    <div class="brand"><span class="brand-mark" aria-hidden="true"><Eclipse size={26} strokeWidth={1.8} /></span><span class="brand-name">DARKHALO</span><span class="brand-divider"></span><span class="workspace-label">Workspace</span></div>
    <div class="header-actions"><span class="local-label"><span class="status-dot"></span>LOCAL ANALYSIS</span><a class="icon-button docs-link" href="https://github.com/BrandonDucar/darkhalo" target="_blank" rel="noreferrer" aria-label="Repository documentation" title="Repository documentation"><FileText size={17} /></a><button class="icon-button mobile-menu" aria-label="Toggle navigation" aria-expanded={mobileNav} on:click={() => mobileNav = !mobileNav} title="Navigation" aria-controls="sidebar-context"><Menu size={19} /></button></div>
  </header>

  <aside class:mobile-open={mobileNav} class="sidebar">
    <div class="sidebar-heading">ANALYSIS</div>
    <nav aria-label="Workspace navigation">{#each tabs as tab, index}<button class:active={activeTab === tab.id} on:click={() => switchTab(tab.id)} aria-current={activeTab === tab.id ? 'page' : undefined} aria-label={tab.label} title={tab.label}><span class="nav-step" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><svelte:component this={tab.icon} size={18} /><span class="nav-label">{tab.label}</span>{#if tab.id === 'findings' && result}<span class="nav-count">{records.length}</span>{/if}{#if activeTab === tab.id}<ArrowRight class="active-arrow" size={14} aria-hidden="true" />{/if}</button>{/each}</nav>
    <div class="sidebar-bottom" id="sidebar-context"><div class="boundary-icon"><LockKeyhole size={18} /></div><strong>Local by design</strong><p>Browser memory only.<br />No uploads. No persistence.</p><div class="authority-label"><ShieldOff size={13} />NO AUTHORITY</div></div>
  </aside>

  <main>
    <div class="page-heading"><div><div class="eyebrow"><span class="stage-index" aria-hidden="true">{String(tabs.findIndex((tab) => tab.id === activeTab) + 1).padStart(2, '0')}</span> LOCAL WORKSPACE <span>/</span> {activeTab.toUpperCase()}</div><h1>{activeTab === 'intake' ? 'Evidence intake' : activeTab === 'findings' ? 'Inspection findings' : activeTab === 'context' ? 'Context comparison' : 'Export capsule'}</h1><p>{activeTab === 'intake' ? 'Inspect an evidence set. Keep its provenance in view.' : activeTab === 'findings' ? 'Local gates, content flags, and candidate routes.' : activeTab === 'context' ? 'Untouched evidence alongside engine-compressed context.' : 'A portable local analysis artifact. Not an authorization.'}</p></div><button class="secondary small" on:click={reset} disabled={!editor && !result && !revocations} title="Clear all local data"><RotateCcw size={14} />Reset</button></div>

    <div class="boundary-bar"><span><LockKeyhole size={14} />LOCAL ANALYSIS</span><span class="boundary-separator"></span><span>NO AUTHORITY</span><span class="boundary-note">Nothing is published or sent.</span>{#if (result ? inspectedSynthetic : synthetic)}<span class="synthetic-label">SYNTHETIC</span>{/if}</div>
    {#if error}<div class="message error" role="alert"><TriangleAlert size={17} /><span>{error}</span><button class="icon-button" on:click={() => error = ''} aria-label="Dismiss error" title="Dismiss"><X size={16} /></button></div>{/if}
    {#if notice}<div class="message notice" role="status"><Check size={16} /><span>{notice}</span></div>{/if}
    {#if dirty}<div class="message warning" role="status"><TriangleAlert size={16} /><span>Input changed. Findings reflect the last inspection; export is paused.</span><button class="text-button" on:click={runInspection}>Re-inspect<ArrowRight size={14} /></button></div>{/if}

    {#if activeTab === 'intake'}
      <div class="intake-layout">
        <section class="editor-section" aria-labelledby="input-heading">
          <div class="section-title"><h2 id="input-heading"><Terminal size={16} />Input document</h2><span class="muted mono">JSON / v1</span></div>
          <div class="editor-frame"><div class="editor-toolbar"><span><FileJson size={14} />{filename || 'Untitled input'}</span><span>{fmt(bytes(editor))} B <span class="dim">/ 2 MiB</span></span></div><label class="sr-only" for="input-editor">Evidence input JSON</label><textarea id="input-editor" class="code-editor" bind:value={editor} on:input={editInput} spellcheck="false" placeholder={'{\n  "version": 1,\n  "records": [\n    { "id": "record-id", "text": "Evidence text" }\n  ],\n  "revokedAuthorities": [],\n  "cells": []\n}'}></textarea><div class="editor-status"><span><span class="status-dot"></span>{editor.trim() ? 'Input staged' : 'Awaiting input'}</span><span>UTF-8</span></div></div>
          <div class="editor-footer"><span class="muted">{result ? 'Current inspection available' : 'No analysis has been run'}</span><button class="primary" disabled={!editor.trim()} on:click={runInspection}><Activity size={16} />Import + inspect<ArrowRight size={16} /></button></div>
        </section>
        <aside class="intake-rail">
          <section class="upload-section"><div class="section-title"><h2><Upload size={16} />Local file</h2></div><input class="sr-only" type="file" accept=".json,application/json" bind:this={fileInput} on:change={(event) => loadFile(event.currentTarget.files[0])} aria-label="Choose local JSON file" /><button class:dragging class="dropzone" on:click={() => fileInput.click()} on:dragover={(event) => { event.preventDefault(); dragging = true; }} on:dragleave={() => dragging = false} on:drop={dropFile}><span class="upload-icon"><Upload size={22} /></span><strong>Choose a JSON file</strong><span>or drop it here</span><small>One file, up to 2 MiB</small></button></section>
          <section class="revocation-section"><div class="section-title"><h2><ShieldOff size={16} />Revoked authorities</h2></div><label for="revocations" class="field-label">Authority IDs, one per line</label><textarea id="revocations" class="plain-editor mono" bind:value={revocations} placeholder="No authority IDs added" spellcheck="false"></textarea><span class="field-note">Applied on the next inspection.</span></section>
          <section class="sample-section"><div><FlaskConical size={16} /><h2>Test input</h2><span class="tag">SYNTHETIC</span></div><p>4 fabricated records. No real audit data.</p><button class="secondary full" on:click={loadSynthetic}><Plus size={15} />Load synthetic sample</button></section>
        </aside>
      </div>
      <div class="intake-bottom"><span><ShieldCheck size={16} />Evidence stays on this device</span><span>Gates and routes are local classifications, not truth or permission.</span></div>
    {:else if !result}
      <section class="empty-view"><span class="empty-symbol"><svelte:component this={tabs.find((tab) => tab.id === activeTab).icon} size={30} strokeWidth={1.4} /></span><div class="eyebrow">NO INSPECTED INPUT</div><h2>{activeTab === 'findings' ? 'Your evidence starts here.' : activeTab === 'context' ? 'No context to compare yet.' : 'No capsule to export yet.'}</h2><p>Import a local JSON document to begin an inspection.</p><button class="primary" on:click={() => switchTab('intake')}>Go to intake<ArrowRight size={16} /></button></section>
    {:else}
      <div class="metrics-strip" aria-label="Inspection metrics"><div><span>Records</span><strong>{fmt(metrics.records)}</strong></div><div><span><i class="dot green"></i>Local allowed</span><strong>{fmt(metrics.allowed)}</strong></div><div><span><i class="dot red"></i>Local blocked</span><strong>{fmt(metrics.blocked)}</strong></div><div><span>Duplicates</span><strong>{fmt(metrics.duplicates)}</strong></div><div><span><i class="dot teal"></i>Candidate routes</span><strong>{fmt(metrics.candidateRoutes)}</strong></div></div>
      {#if result.warnings?.length}<details class="engine-warnings"><summary><TriangleAlert size={15} /><span>{result.warnings.length} engine warnings</span><ChevronDown size={14} /></summary><ul>{#each result.warnings as warning}<li>{warning}</li>{/each}</ul></details>{/if}

      {#if activeTab === 'findings'}
        <div class="findings-toolbar"><label class="search-field"><Search size={16} /><input bind:value={query} placeholder="Search evidence" aria-label="Search records by text, ID, author, or source" /></label><div class="segmented" role="group" aria-label="Filter by local gate status"><button class:chosen={gateFilter === 'all'} aria-pressed={gateFilter === 'all'} on:click={() => gateFilter = 'all'}>All</button><button class:chosen={gateFilter === 'ALLOWED'} aria-pressed={gateFilter === 'ALLOWED'} on:click={() => gateFilter = 'ALLOWED'}>Local allowed</button><button class:chosen={gateFilter === 'BLOCKED'} aria-pressed={gateFilter === 'BLOCKED'} on:click={() => gateFilter = 'BLOCKED'}>Local blocked</button></div><label class="route-toggle"><input type="checkbox" bind:checked={routeFilter} />Candidate routes</label></div>
        <div class="findings-layout"><section class="record-list" aria-label="Inspection records"><div class="list-heading"><span>EVIDENCE RECORD</span><span>{filtered.length} of {records.length}</span></div>{#each filtered as record}<button class="record-row" class:selected={record.id === selectedId} on:click={() => selectedId = record.id} aria-pressed={record.id === selectedId}><div class="record-top"><span class="mono record-id">{record.id}</span><span class="gate-badge" class:blocked={record.gate.status === 'BLOCKED'}>{#if record.gate.status === 'BLOCKED'}<ShieldOff size={12} />{:else}<ShieldCheck size={12} />{/if}LOCAL GATE: {record.gate.status}</span></div><p>{record.text || '(Empty text)'}</p><div class="record-bottom"><span>{record.author ?? 'No author supplied'}</span><span>{record.routeCandidates.length} routes<ArrowRight size={13} /></span></div></button>{/each}{#if !filtered.length}<div class="list-empty"><Search size={22} /><strong>No matching records</strong><span>Adjust your search or filters.</span></div>{/if}</section>
          <aside class="detail-panel" aria-label="Selected record detail">{#if selected}<div class="section-title"><h2>Record detail</h2><span class="muted mono">LOCAL</span></div><div class="detail-id"><span class="mono">{selected.id}</span><span class="gate-badge" class:blocked={selected.gate.status === 'BLOCKED'}>LOCAL GATE: {selected.gate.status}</span></div><dl class="metadata"><dt>Author</dt><dd>{selected.author ?? 'Not supplied'}</dd><dt>Source</dt><dd>{#if sourceHref(selected.sourceUrl)}<a href={sourceHref(selected.sourceUrl)} target="_blank" rel="noreferrer" title="Open source externally (leaves local workspace)">{selected.sourceUrl}<Link size={12} /></a>{:else}{selected.sourceUrl ?? 'Not supplied'}{/if}</dd><dt>Observed at</dt><dd>{selected.observedAt ?? 'Not supplied'}</dd><dt>Input status</dt><dd>{selected.status ?? 'Not supplied'}</dd><dt>Authorities</dt><dd>{selected.upstreamAuthorities?.join(', ') || 'None supplied'}</dd><dt>Content digest</dt><dd class="mono break-all">{selected.contentDigest}</dd></dl><section class="detail-section"><h3>Local gate reason</h3><p class:blocked-reason={selected.gate.status === 'BLOCKED'}>{selected.gate.reason}</p></section><section class="detail-section"><h3>Data flags</h3><div class="flag-list">{#each selected.flags as flag}<span class="flag">{flag}</span>{/each}{#if !selected.flags.length}<span class="muted">No flags reported</span>{/if}</div></section><section class="detail-section"><h3>Candidate routes <span class="muted">/ not assignments</span></h3>{#each selected.routeCandidates as route}<div class="route-item"><div><strong>{route.label}</strong><span class="mono">{route.cellId}</span></div><span class="route-score" title="Engine candidate score">{route.score}</span><p>Matched: {route.matchedTerms.join(', ') || 'No terms reported'}</p></div>{/each}{#if !selected.routeCandidates.length}<p class="muted">No candidate routes</p>{/if}</section>{:else}<div class="list-empty">Select a record to inspect its provenance.</div>{/if}</aside>
        </div>
      {:else if activeTab === 'context'}
        <section class="context-summary"><div><h2>Character footprint</h2><p>Original input and gated output, from this inspection.</p><div class="chart-legend"><span><i class="dot graphite"></i>Original {fmt(metrics.originalCharacters)}</span><span><i class="dot teal"></i>Output {fmt(metrics.outputCharacters)}</span></div><svg class="footprint-chart" viewBox="0 0 500 46" role="img" aria-label={`Original ${metrics.originalCharacters} characters; output ${metrics.outputCharacters} characters`}><rect x="0" y="1" width={metrics.originalCharacters > 0 ? 500 : 0} height="14" rx="2" fill="#3e4446" /><rect x="0" y="29" width={ratio * 5} height="14" rx="2" fill="#267d78" /></svg></div><div class="token-summary"><span>ESTIMATED TOKENS</span><div><strong>{fmt(metrics.estimatedOriginalTokens)}</strong><ArrowRight size={18} /><strong>{fmt(metrics.estimatedOutputTokens)}</strong></div><p>Approximate counts, not measured savings, cost, or truth.</p></div></section>
        <div class="comparison-toolbar"><h2>Record comparison</h2><label class="select-wrap"><span class="sr-only">Choose record to compare</span><select bind:value={selectedId}>{#each records as record}<option value={record.id}>{record.id} / local {record.gate.status}</option>{/each}</select><ChevronDown size={14} /></label></div>
        {#if selected}<div class="comparison-grid"><section><div class="comparison-heading"><span>Original evidence</span><span class="tag">ORIGINAL</span></div><p class="comparison-text">{selected.text}</p><div class="comparison-count">{fmt(selected.text.length)} characters / secrets redacted if flagged</div></section><section class:withheld={selected.gate.status === 'BLOCKED'}><div class="comparison-heading"><span>Compressed context</span><span class="gate-badge" class:blocked={selected.gate.status === 'BLOCKED'}>LOCAL GATE: {selected.gate.status}</span></div>{#if selected.gate.status === 'BLOCKED'}<div class="blocked-context"><ShieldOff size={25} /><strong>Context withheld</strong><p>{selected.gate.reason}</p></div>{:else}<p class="comparison-text">{selected.compressedText || '(No output text)'}</p><div class="comparison-count">{fmt(selected.compressedText.length)} characters / engine output</div>{/if}</section></div>{:else}<div class="list-empty">No records in this inspection.</div>{/if}
      {:else if activeTab === 'capsule'}
        <div class="capsule-layout"><section><div class="section-title"><h2><FileJson size={16} />Capsule preview</h2><span class="tag">JSON</span></div><textarea class="capsule-preview" readonly value={capsulePreview || 'Capsule preview unavailable. Export will report the engine error.'} aria-label="Export capsule JSON preview" spellcheck="false"></textarea></section><aside class="capsule-summary"><span class="capsule-symbol"><FileJson size={28} strokeWidth={1.5} /></span><h2>Local analysis capsule</h2><p class="muted">Ready for an explicit, local download.</p><dl class="metadata"><dt>Evidence class</dt><dd class="mono">LOCAL_ANALYSIS</dd><dt>Authority</dt><dd>None granted</dd><dt>Locally allowed</dt><dd>{fmt(allowed.length)}</dd><dt>Locally blocked</dt><dd>{fmt(metrics.blocked)}</dd><dt>Input digest</dt><dd class="mono break-all" title={result.inputDigest}>{shortDigest(result.inputDigest)}</dd></dl><div class="export-boundary"><ShieldOff size={16} /><span>Blocked compressed context is excluded. Supplied original text may remain.</span></div><button class="primary full" on:click={downloadCapsule} disabled={dirty}><Download size={16} />Download JSON</button><p class="export-note">Private review only. No publication. No remote API.</p></aside></div>
      {/if}
    {/if}
    <footer class="workspace-footer"><span>Darkhalo <span class="footer-slash">/</span> Evidence workspace</span><span><span class="status-dot"></span>{result ? 'Inspection in memory' : 'Local session'}<span class="footer-slash">/</span>NO AUTHORITY</span></footer>
  </main>
</div>
