/**
 * HTTP dashboard for the OpenFeelz.
 *
 * Serves a self-contained HTML page with glassmorphism UI showing:
 * - PAD dimensions as bars
 * - Basic emotions as bars
 * - OCEAN personality profile
 * - Recent stimuli
 * - Rumination status
 *
 * GET ?format=json returns state plus personalityAnalysis and emotionalStateDescription.
 * POST with JSON body { action, ... } performs modify, reset, set_personality, set_dimension, set_decay.
 *
 * Registered via api.registerHttpRoute().
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { DimensionName, EmotionEngineState, OCEANTrait } from "../types.js";
import { DIMENSION_NAMES, BASIC_EMOTION_NAMES, OCEAN_TRAITS } from "../types.js";
import { computePrimaryEmotion, computeOverallIntensity } from "../model/emotion-model.js";
import type { StateManager } from "../state/state-manager.js";
import { formatStatusMarkdown } from "../format/status-markdown.js";

interface PersonalityAnalysis {
  pad: { pleasure: number; arousal: number; dominance: number };
  extensions: { connection: number; curiosity: number; energy: number; trust: number };
  ocean: { openness: number; conscientiousness: number; extraversion: number; agreeableness: number; neuroticism: number };
}

function analyzePersonality(state: EmotionEngineState): PersonalityAnalysis {
  return {
    pad: { pleasure: state.dimensions.pleasure, arousal: state.dimensions.arousal, dominance: state.dimensions.dominance },
    extensions: { connection: state.dimensions.connection, curiosity: state.dimensions.curiosity, energy: state.dimensions.energy, trust: state.dimensions.trust },
    ocean: { ...state.personality },
  };
}

interface EmotionalStateDescription {
  primary: string;
  intensity: number;
  notes: string[];
}

function describeEmotionalState(state: EmotionEngineState): EmotionalStateDescription {
  const primary = computePrimaryEmotion(state.basicEmotions);
  const intensity = computeOverallIntensity(state.basicEmotions);
  const notes: string[] = [];
  if (intensity < 0.05) {
    notes.push("Neutral, calm baseline state.");
  } else {
    const dims = state.dimensions;
    if (Math.abs(dims.pleasure) > 0.2) notes.push(dims.pleasure > 0 ? "Elevated pleasure/valence." : "Reduced pleasure/valence.");
    if (Math.abs(dims.arousal) > 0.2) notes.push(dims.arousal > 0 ? "Heightened arousal." : "Lower arousal.");
    if (state.rumination.active.length > 0) notes.push(`Rumination active: ${state.rumination.active.length} item(s).`);
  }
  return { primary, intensity, notes };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function buildJsonResponse(state: EmotionEngineState): object {
  return {
    dimensions: state.dimensions,
    basicEmotions: state.basicEmotions,
    personality: state.personality,
    decayRates: state.decayRates,
    primaryEmotion: computePrimaryEmotion(state.basicEmotions),
    overallIntensity: computeOverallIntensity(state.basicEmotions),
    recentStimuli: state.recentStimuli.slice(0, 10),
    rumination: state.rumination,
    baseline: state.baseline,
    meta: state.meta,
    personalityAnalysis: analyzePersonality(state),
    emotionalStateDescription: describeEmotionalState(state),
    cachedAnalysis: state.cachedAnalysis ?? null,
    statusMarkdown: formatStatusMarkdown(state),
  };
}

/**
 * Create the HTTP route handler for the dashboard.
 * Uses ?agent= query param (default "main").
 * LLM analysis is served from cachedAnalysis (written by the background service).
 */
export function createDashboardHandler(
  getManager: (agentId: string) => StateManager,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const agentId = url.searchParams.get("agent") ?? "main";
    const manager = getManager(agentId);

    let state = await manager.getState();
    state = manager.applyDecay(state);

    if (req.method === "POST") {
      try {
        const raw = await readBody(req);
        const payload = JSON.parse(raw) as { action: string; [k: string]: unknown };
        const action = payload.action;
        if (!action || typeof action !== "string") {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Missing action" }));
          return;
        }
        switch (action) {
          case "modify": {
            const emotion = payload.emotion as string;
            const intensity = Number(payload.intensity);
            const trigger = (payload.trigger as string) ?? "Dashboard";
            if (!emotion || typeof emotion !== "string") throw new Error("modify requires emotion");
            if (Number.isNaN(intensity) || intensity < 0 || intensity > 1) throw new Error("modify requires intensity 0-1");
            state = manager.applyStimulus(state, emotion, intensity, trigger);
            break;
          }
          case "reset": {
            const dims = payload.dimensions as string[] | undefined;
            const validDims = dims?.filter((d: string) => DIMENSION_NAMES.includes(d as DimensionName)) as DimensionName[] | undefined;
            state = manager.resetToBaseline(state, validDims);
            break;
          }
          case "set_personality": {
            const trait = payload.trait as string;
            const value = Number(payload.value);
            if (!OCEAN_TRAITS.includes(trait as OCEANTrait)) throw new Error(`Unknown trait: ${trait}`);
            if (Number.isNaN(value) || value < 0 || value > 1) throw new Error("value must be 0-1");
            state = manager.setPersonalityTrait(state, trait as OCEANTrait, value);
            break;
          }
          case "set_dimension": {
            const dimension = payload.dimension as string;
            const value = Number(payload.value);
            if (!DIMENSION_NAMES.includes(dimension as DimensionName)) throw new Error(`Unknown dimension: ${dimension}`);
            if (Number.isNaN(value)) throw new Error("value must be a number");
            state = manager.setDimension(state, dimension as DimensionName, value);
            break;
          }
          case "set_decay": {
            const dimension = payload.dimension as string;
            const rate = Number(payload.rate);
            if (!DIMENSION_NAMES.includes(dimension as DimensionName)) throw new Error(`Unknown dimension: ${dimension}`);
            if (Number.isNaN(rate) || rate < 0) throw new Error("rate must be >= 0");
            state = { ...state, decayRates: { ...state.decayRates, [dimension]: rate } };
            break;
          }
          case "batch": {
            const updates = payload.updates as Record<string, unknown> | undefined;
            if (!updates || typeof updates !== "object") throw new Error("batch requires updates object");
            if (updates.dimensions && typeof updates.dimensions === "object") {
              for (const [dim, val] of Object.entries(updates.dimensions)) {
                if (DIMENSION_NAMES.includes(dim as DimensionName) && typeof val === "number" && !Number.isNaN(val))
                  state = manager.setDimension(state, dim as DimensionName, val);
              }
            }
            if (updates.personality && typeof updates.personality === "object") {
              for (const [trait, val] of Object.entries(updates.personality)) {
                if (OCEAN_TRAITS.includes(trait as OCEANTrait) && typeof val === "number" && val >= 0 && val <= 1)
                  state = manager.setPersonalityTrait(state, trait as OCEANTrait, val);
              }
            }
            if (updates.decayRates && typeof updates.decayRates === "object") {
              const rates = { ...state.decayRates };
              for (const [dim, val] of Object.entries(updates.decayRates)) {
                if (DIMENSION_NAMES.includes(dim as DimensionName) && typeof val === "number" && val >= 0)
                  rates[dim as DimensionName] = val;
              }
              state = { ...state, decayRates: rates };
            }
            if (updates.basicEmotions && typeof updates.basicEmotions === "object") {
              const emos = { ...state.basicEmotions };
              for (const [name, val] of Object.entries(updates.basicEmotions)) {
                if (BASIC_EMOTION_NAMES.includes(name as keyof typeof emos) && typeof val === "number" && val >= 0 && val <= 1)
                  emos[name as keyof typeof emos] = val;
              }
              state = { ...state, basicEmotions: emos, meta: { ...state.meta, totalUpdates: state.meta.totalUpdates + 1 } };
            }
            break;
          }
          default:
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: `Unknown action: ${action}` }));
            return;
        }
        await manager.saveState(state);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, state: buildJsonResponse(state) }, null, 2));
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: msg }));
        return;
      }
    }

    if (url.searchParams.get("format") === "json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(buildJsonResponse(state), null, 2));
      return;
    }

    const html = buildDashboardHtml(state);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  };
}

/** Slider row for bipolar (-1..1), unipolar (0..1), or decay (0..2). */
function sliderRow(
  name: string,
  val: number,
  bipolar: boolean,
  section: string,
  isDecay = false,
): string {
  const min = bipolar ? -1 : 0;
  const max = isDecay ? 2 : 1;
  const step = isDecay ? 0.05 : 0.01;
  const forId = `${section}-${name}`;
  return `<div class="slider-row">
    <label class="slider-label">${name}</label>
    <input type="range" class="slider" data-section="${escapeHtml(section)}" data-key="${escapeHtml(name)}" min="${min}" max="${max}" step="${step}" value="${val}">
    <span class="slider-value" data-for="${escapeHtml(forId)}">${val.toFixed(2)}</span>
  </div>`;
}

/**
 * Build the complete dashboard HTML.
 */
export function buildDashboardHtml(state: EmotionEngineState): string {
  const primary = computePrimaryEmotion(state.basicEmotions);
  const intensity = computeOverallIntensity(state.basicEmotions);
  const jsonState = buildJsonResponse(state) as Record<string, unknown>;

  const dimensionSliders = DIMENSION_NAMES.map((name) => {
    const bipolar = name === "pleasure" || name === "arousal" || name === "dominance";
    return sliderRow(name, state.dimensions[name], bipolar, "dimensions");
  }).join("\n");

  const emotionSliders = BASIC_EMOTION_NAMES.map((name) =>
    sliderRow(name, state.basicEmotions[name], false, "emotions"),
  ).join("\n");

  const personalitySliders = OCEAN_TRAITS.map((trait) =>
    sliderRow(trait, state.personality[trait], false, "personality"),
  ).join("\n");

  const decaySliders = DIMENSION_NAMES.map((name) =>
    sliderRow(name, state.decayRates[name], false, "decay", true),
  ).join("\n");

  const recentHtml = state.recentStimuli.slice(0, 8).map((s) => {
    const ts = new Date(s.timestamp).toLocaleString();
    return `<div class="stimulus-entry">
      <span class="stimulus-time">${ts}</span>
      <span class="stimulus-label">${s.label}</span>
      <span class="stimulus-intensity">${s.intensity.toFixed(2)}</span>
      <span class="stimulus-trigger">${escapeHtml(s.trigger)}</span>
    </div>`;
  }).join("\n");

  function formatCachedPersonality(s: EmotionEngineState): string {
    const cached = s.cachedAnalysis?.personality;
    if (!cached) return '<div class="muted">Analysis pending — will be available shortly after startup.</div>';
    const pad = Object.entries(cached.pad).map(([k, v]) => `${k}: ${Number(v).toFixed(2)}`).join(", ");
    const ext = Object.entries(cached.extensions).map(([k, v]) => `${k}: ${Number(v).toFixed(2)}`).join(", ");
    const ocean = Object.entries(cached.ocean).map(([k, v]) => `${k}: ${Number(v).toFixed(2)}`).join(", ");
    const gen = cached.generatedAt ? new Date(cached.generatedAt).toLocaleString() : "";
    return `<div class="block"><div>${escapeHtml(cached.summary)}</div></div>
      <div class="block"><div class="label">PAD</div><div class="muted">${escapeHtml(pad)}</div></div>
      <div class="block"><div class="label">Extensions</div><div class="muted">${escapeHtml(ext)}</div></div>
      <div class="block"><div class="label">OCEAN</div><div class="muted">${escapeHtml(ocean)}</div></div>
      ${gen ? `<div class="muted" style="margin-top:8px;font-size:0.75rem">Generated at ${escapeHtml(gen)}</div>` : ""}`;
  }

  function formatCachedEmotionalState(s: EmotionEngineState): string {
    const cached = s.cachedAnalysis?.emotionalState;
    if (!cached) return '<div class="muted">Analysis pending — will be available shortly after startup.</div>';
    const notes = (cached.notes ?? []).map((n) => escapeHtml(n)).join("</div><div>");
    const gen = cached.generatedAt ? new Date(cached.generatedAt).toLocaleString() : "";
    return `<div class="block"><div>${escapeHtml(cached.summary)}</div></div>
      <div class="block"><div class="label">${escapeHtml(cached.primary)}</div><div>Intensity: <strong>${(cached.intensity * 100).toFixed(0)}%</strong></div></div>
      ${notes ? `<div class="block"><div>${notes}</div></div>` : ""}
      ${gen ? `<div class="muted" style="margin-top:8px;font-size:0.75rem">Generated at ${escapeHtml(gen)}</div>` : ""}`;
  }

  const ruminationHtml = state.rumination.active.length > 0
    ? state.rumination.active.map((r) =>
        `<div class="rumination-entry">${r.label} (stage ${r.stage}, intensity ${r.intensity.toFixed(2)})</div>`,
      ).join("\n")
    : "<div class='muted'>No active rumination.</div>";

  const editableCard = (
    section: string,
    title: string,
    sliders: string,
    bipolarNote?: string,
  ) => `<div class="card section-card" data-section="${section}">
    <h2>${title}</h2>${bipolarNote ? `<p class="section-note">${bipolarNote}</p>` : ""}
    <div class="sliders">${sliders}</div>
    <div class="section-actions" data-actions-for="${section}">
      <button type="button" class="btn btn-save" data-save="${section}">Save</button>
      <button type="button" class="btn btn-cancel" data-cancel="${section}">Cancel</button>
    </div>
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenFeelz Dashboard</title>
<style>
:root {
  --bg: #0d0d12;
  --card-bg: rgba(255,255,255,0.05);
  --card-border: rgba(255,255,255,0.08);
  --card-edited-border: rgba(110,123,242,0.5);
  --card-edited-bg: rgba(110,123,242,0.08);
  --text: #e8e8f0;
  --text-muted: #999;
  --accent: #7c8aff;
  --positive: #5cda6c;
  --negative: #f05454;
}
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'DM Sans', -apple-system, sans-serif; background:var(--bg); color:var(--text); padding:24px; min-height:100vh; line-height:1.5; }
h1 { font-size:1.5rem; font-weight:600; margin-bottom:8px; }
h2 { font-size:0.85rem; font-weight:500; margin-bottom:10px; color:var(--accent); text-transform:uppercase; letter-spacing:0.08em; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px; margin-top:16px; }
.card { background:var(--card-bg); border:1px solid var(--card-border); border-radius:14px; padding:20px; backdrop-filter:blur(12px); transition: border-color 0.2s, background 0.2s; }
.card.card-edited { border-color:var(--card-edited-border); background:var(--card-edited-bg); box-shadow: 0 0 0 1px var(--card-edited-border); }
.primary-emotion { font-size:1.1rem; color:var(--accent); margin-bottom:4px; }
.muted { color:var(--text-muted); font-size:0.8rem; }
.section-note { font-size:0.75rem; color:var(--text-muted); margin-bottom:12px; }
.slider-row { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
.slider-label { width:110px; font-size:0.8rem; color:var(--text-muted); }
.slider { flex:1; height:6px; -webkit-appearance:none; appearance:none; background:rgba(255,255,255,0.1); border-radius:3px; }
.slider::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; border-radius:50%; background:var(--accent); cursor:pointer; }
.slider-value { width:44px; font-size:0.75rem; font-family:ui-monospace,monospace; }
.section-actions { display:none; gap:8px; margin-top:12px; }
.section-card.card-edited .section-actions { display:flex; }
.btn { padding:6px 14px; font-size:0.8rem; border-radius:8px; border:none; cursor:pointer; font-weight:500; }
.btn-save { background:var(--accent); color:#fff; }
.btn-cancel { background:rgba(255,255,255,0.1); color:var(--text); }
.form-row { display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap; }
.form-row label { font-size:0.8rem; color:var(--text-muted); min-width:70px; }
.form-row input[type="text"] { flex:1; min-width:120px; padding:8px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.2); color:inherit; }
.form-row input[type="range"] { flex:1; min-width:80px; max-width:120px; }
.stimulus-entry { display:flex; gap:8px; font-size:0.8rem; padding:6px 0; border-bottom:1px solid var(--card-border); }
.stimulus-time { color:var(--text-muted); width:140px; flex-shrink:0; }
.stimulus-label { color:var(--accent); width:80px; }
.stimulus-intensity { width:40px; font-family:monospace; }
.stimulus-trigger { color:var(--text-muted); flex:1; }
.rumination-entry { font-size:0.85rem; padding:4px 0; }
.meta { margin-top:16px; font-size:0.75rem; color:var(--text-muted); text-align:center; }
.analysis-output { margin-top:8px; padding:12px; background:rgba(0,0,0,0.2); border-radius:8px; font-size:0.85rem; line-height:1.6; }
.analysis-output .block { margin-bottom:10px; }
.analysis-output .block:last-child { margin-bottom:0; }
.analysis-output .label { font-weight:600; color:var(--accent); margin-bottom:4px; }
.spinner { display:inline-block; width:14px; height:14px; border:2px solid rgba(255,255,255,0.3); border-top-color:var(--accent); border-radius:50%; animation:spin 0.6s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
</style>
</head>
<body>
<h1>OpenFeelz Dashboard</h1>
<div class="primary-emotion" id="primary-display">Primary: ${primary} (intensity: ${intensity.toFixed(2)})</div>
<div class="muted">Last updated: ${new Date(state.lastUpdated).toLocaleString()} | Updates: ${state.meta.totalUpdates}</div>

<div class="grid">
  <div class="card">
    <h2>Apply Emotion</h2>
    <form id="apply-emotion" class="apply-form">
      <div class="form-row">
        <label>Emotion</label>
        <input type="text" name="emotion" placeholder="e.g. happy, sad, calm" required>
      </div>
      <div class="form-row">
        <label>Intensity</label>
        <input type="range" name="intensity" min="0" max="1" step="0.05" value="0.5">
        <span class="slider-value" data-for="intensity">0.50</span>
      </div>
      <div class="form-row">
        <label>Trigger</label>
        <input type="text" name="trigger" placeholder="What triggered this">
      </div>
      <button type="submit" class="btn btn-save">Apply</button>
    </form>
  </div>

  ${editableCard("dimensions", "Dimensions (PAD + Extensions)", dimensionSliders, "Pleasure, arousal, dominance: -1 to +1")}
  ${editableCard("emotions", "Basic Emotions (Ekman)", emotionSliders)}
  ${editableCard("personality", "Personality (OCEAN)", personalitySliders)}
  ${editableCard("decay", "Decay Rates (per hour)", decaySliders)}

  <div class="card">
    <h2>Recent Stimuli</h2>
    ${recentHtml || '<div class="muted">No recent stimuli.</div>'}
  </div>

  <div class="card">
    <h2>Rumination</h2>
    ${ruminationHtml}
  </div>

  <div class="card">
    <h2>Analysis</h2>
    <div class="analysis-block">
      <div class="label">Personality</div>
      <div id="personality-output" class="analysis-output">${formatCachedPersonality(state)}</div>
    </div>
    <div class="analysis-block" style="margin-top:12px">
      <div class="label">Emotional State</div>
      <div id="state-output" class="analysis-output">${formatCachedEmotionalState(state)}</div>
    </div>
  </div>

  <div class="card">
    <button type="button" class="btn btn-cancel" id="btn-reset">Reset to baseline</button>
  </div>
</div>

<div class="meta">
  <a href="?format=json" style="color:var(--accent)">View as JSON</a> | OpenFeelz v0.1.0
</div>

<script>
window.__EMOTION_STATE__ = ${JSON.stringify(jsonState).replace(/<\/script>/gi, "<\\/script>")};
(function(){
  const DIMENSIONS = ${JSON.stringify([...DIMENSION_NAMES])};
  const EMOTIONS = ${JSON.stringify([...BASIC_EMOTION_NAMES])};
  const PERSONALITY = ${JSON.stringify([...OCEAN_TRAITS])};
  const BIPOLAR = ["pleasure","arousal","dominance"];

  let saved = JSON.parse(JSON.stringify(window.__EMOTION_STATE__));
  let draft = JSON.parse(JSON.stringify(saved));

  function getVal(section, key) {
    if (section === "dimensions") return draft.dimensions[key];
    if (section === "emotions") return draft.basicEmotions[key];
    if (section === "personality") return draft.personality[key];
    if (section === "decay") return draft.decayRates[key];
    return 0;
  }
  function setVal(section, key, v) {
    if (section === "dimensions") draft.dimensions[key] = v;
    else if (section === "emotions") draft.basicEmotions[key] = v;
    else if (section === "personality") draft.personality[key] = v;
    else if (section === "decay") draft.decayRates[key] = v;
  }
  function isDirty(section) {
    if (section === "dimensions") return JSON.stringify(draft.dimensions) !== JSON.stringify(saved.dimensions);
    if (section === "emotions") return JSON.stringify(draft.basicEmotions) !== JSON.stringify(saved.basicEmotions);
    if (section === "personality") return JSON.stringify(draft.personality) !== JSON.stringify(saved.personality);
    if (section === "decay") return JSON.stringify(draft.decayRates) !== JSON.stringify(saved.decayRates);
    return false;
  }
  function markDirty(section) {
    const card = document.querySelector('.section-card[data-section="' + section + '"]');
    if (card) card.classList.toggle('card-edited', isDirty(section));
  }
  function getSliderDisplay(slider) {
    var row = slider.closest('.slider-row');
    return row ? row.querySelector('.slider-value') : null;
  }

  document.querySelectorAll('.slider[data-section]').forEach(function(slider){
    var section = slider.dataset.section;
    var key = slider.dataset.key;
    slider.addEventListener('input', function(){
      var v = parseFloat(slider.value);
      setVal(section, key, v);
      var disp = getSliderDisplay(slider);
      if (disp) disp.textContent = v.toFixed(2);
      markDirty(section);
    });
    slider.addEventListener('change', function(){
      var v = parseFloat(slider.value);
      var disp = getSliderDisplay(slider);
      if (disp) disp.textContent = v.toFixed(2);
    });
  });

  document.querySelectorAll('[data-save]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var section = btn.dataset.save;
      if (!isDirty(section)) return;
      var payload = { action: 'batch', updates: {} };
      if (section === 'dimensions') payload.updates.dimensions = draft.dimensions;
      else if (section === 'emotions') payload.updates.basicEmotions = draft.basicEmotions;
      else if (section === 'personality') payload.updates.personality = draft.personality;
      else if (section === 'decay') payload.updates.decayRates = draft.decayRates;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      fetch(window.location.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function(r){ if (!r.ok) throw new Error('Save failed: ' + r.status); return r.json(); })
        .then(function(res){ if(res.ok){ location.reload(); } else { throw new Error(res.error || 'Save failed'); } })
        .catch(function(e){ btn.disabled = false; btn.textContent = 'Save'; alert(e.message); });
    });
  });

  document.querySelectorAll('[data-cancel]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var section = btn.dataset.cancel;
      draft = JSON.parse(JSON.stringify(saved));
      document.querySelectorAll('.section-card[data-section="' + section + '"] .slider[data-section]').forEach(function(s){
        var k = s.dataset.key;
        s.value = getVal(section, k);
        var d = getSliderDisplay(s);
        if (d) d.textContent = parseFloat(s.value).toFixed(2);
      });
      markDirty(section);
    });
  });

  document.getElementById('apply-emotion').addEventListener('submit', function(e){
    e.preventDefault();
    const f = e.target;
    const intensity = parseFloat(f.intensity.value) || 0.5;
    fetch(window.location.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'modify', emotion: f.emotion.value.trim(), intensity: intensity, trigger: f.trigger.value || 'Dashboard' })
    })
      .then(r=>r.json())
      .then(function(res){ if(res.ok) location.reload(); else alert(res.error); })
      .catch(function(e){ alert(e.message); });
  });

  document.getElementById('btn-reset').addEventListener('click', function(){
    if (!confirm('Reset all dimensions and emotions to baseline?')) return;
    fetch(window.location.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset' }) })
      .then(r=>r.json())
      .then(function(res){ if(res.ok) location.reload(); else alert(res.error); })
      .catch(function(e){ alert(e.message); });
  });

  var intensitySlider = document.querySelector('#apply-emotion input[name="intensity"]');
  if (intensitySlider) intensitySlider.addEventListener('input', function(){
    var d = document.querySelector('#apply-emotion [data-for="intensity"]');
    if (d) d.textContent = parseFloat(intensitySlider.value).toFixed(2);
  });
})();
setTimeout(function(){ location.reload(); }, 60000);
</script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
