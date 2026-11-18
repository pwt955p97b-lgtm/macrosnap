"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronRight,
  Flame,
  ImagePlus,
  Leaf,
  LogOut,
  Plus,
  ScanLine,
  Sparkles,
  Target,
  Utensils,
  X,
} from "lucide-react";

type Meal = { id: string; name: string; calories: number; protein: number; carbs: number; fat: number; loggedAt: string };
const STORAGE_KEY = "macrosnap-meals-v1";
const goals = { calories: 2400, protein: 165, carbs: 270, fat: 72 };
const MAX_CLIENT_IMAGE_BYTES = 6 * 1024 * 1024;
const CLIENT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

type AnalysisResponse = {
  nutrition: {
    foodName: string;
    calories: number;
    protein: number;
    carbohydrates: number;
    fat: number;
    confidence: "low" | "medium" | "high";
    uncertain: boolean;
    uncertaintyNote: string | null;
    assumptions: string[];
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
    pricingConfigured: boolean;
  };
  meta: {
    model: string;
    requestId: string;
    cached: boolean;
    generatedAt: string;
  };
};

type Macro = {
  label: string;
  value: number;
  unit: string;
  color: string;
};

type BetaSessionState = {
  checked: boolean;
  enabled: boolean;
  authenticated: boolean;
  testerId: string | null;
  analysesPerDay: number;
  error: string;
};

type BetaSessionResponse = {
  enabled?: boolean;
  authenticated?: boolean;
  testerId?: string | null;
  analysesPerDay?: number;
  error?: string | { message?: string };
};

declare global {
  interface Window {
    __macroSnapInvitationToken?: string;
  }
}



function ProgressRing({ value, max }: { value: number; max: number }) {
  const radius = 47;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(value / max, 1) * circumference;

  return (
    <div className="ring-wrap" aria-label={`${value} of ${max} calories consumed`}>
      <svg className="ring" viewBox="0 0 112 112" aria-hidden="true">
        <circle className="ring-track" cx="56" cy="56" r={radius} />
        <circle
          className="ring-progress"
          cx="56"
          cy="56"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
        />
      </svg>
      <div className="ring-label">
        <strong>{Math.max(0, max - value)}</strong>
        <span>kcal left</span>
      </div>
    </div>
  );
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastAnalysisRef = useRef<{ fileKey: string; value: AnalysisResponse } | null>(null);
  const betaBootstrapRef = useRef<Promise<{ response: Response; value: BetaSessionResponse; invitationRedemption: boolean }> | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mealName, setMealName] = useState("");
  const [calories, setCalories] = useState("0");
  const [protein, setProtein] = useState("0");
  const [carbs, setCarbs] = useState("0");
  const [fat, setFat] = useState("0");
  const [notice, setNotice] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [betaSession, setBetaSession] = useState<BetaSessionState>({
    checked: false,
    enabled: false,
    authenticated: false,
    testerId: null,
    analysesPerDay: 10,
    error: "",
  });

  const diaryStorageKey = betaSession.checked && (!betaSession.enabled || betaSession.authenticated)
    ? betaSession.enabled && betaSession.testerId ? `${STORAGE_KEY}:${betaSession.testerId}` : STORAGE_KEY
    : null;

  const today = new Date().toLocaleDateString("en-CA");
  const todaysMeals = meals.filter((meal) => new Date(meal.loggedAt).toLocaleDateString("en-CA") === today);
  const totals = todaysMeals.reduce((a, m) => ({
    calories: a.calories + m.calories, protein: a.protein + m.protein,
    carbs: a.carbs + m.carbs, fat: a.fat + m.fat
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const dayMacros = [
    { label: "Protein", current: totals.protein, goal: goals.protein, unit: "g", color: "#9d79ef" },
    { label: "Carbs", current: totals.carbs, goal: goals.carbs, unit: "g", color: "#e9a23b" },
    { label: "Fat", current: totals.fat, goal: goals.fat, unit: "g", color: "#ee7291" }
  ];
  const mealMacros: Macro[] = [
    { label: "Protein", value: Number(protein) || 0, unit: "g", color: "#9d79ef" },
    { label: "Carbs", value: Number(carbs) || 0, unit: "g", color: "#e9a23b" },
    { label: "Fat", value: Number(fat) || 0, unit: "g", color: "#ee7291" }
  ];

  useEffect(() => {
    let active = true;
    if (!betaBootstrapRef.current) {
      const invitationToken = window.__macroSnapInvitationToken;
      delete window.__macroSnapInvitationToken;
      const sessionRequest = invitationToken
        ? fetch("/api/beta/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: invitationToken }),
          })
        : fetch("/api/beta/session", { cache: "no-store" });
      betaBootstrapRef.current = sessionRequest.then(async (response) => ({
        response,
        value: await response.json() as BetaSessionResponse,
        invitationRedemption: Boolean(invitationToken),
      }));
    }

    betaBootstrapRef.current
      .then(({ response, value, invitationRedemption }) => {
        if (!active) return;
        setBetaSession({
          checked: true,
          enabled: invitationRedemption || Boolean(value.enabled),
          authenticated: Boolean(value.authenticated),
          testerId: typeof value.testerId === "string" ? value.testerId : null,
          analysesPerDay: typeof value.analysesPerDay === "number" ? value.analysesPerDay : 10,
          error: response.ok ? "" : typeof value.error === "string" ? value.error : value.error?.message || "Private beta access is temporarily unavailable.",
        });
      })
      .catch(() => {
        if (active) setBetaSession(previous => ({ ...previous, checked: true, error: "Private beta access is temporarily unavailable." }));
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function redeemFragmentInvitation() {
      const fragment = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      const invitationToken = new URLSearchParams(fragment).get("invite");
      if (!invitationToken) return;
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);

      try {
        const response = await fetch("/api/beta/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: invitationToken }),
        });
        const value = await response.json() as BetaSessionResponse;
        if (!active) return;
        if (!response.ok) {
          setBetaSession(previous => previous.authenticated ? previous : {
            ...previous,
            checked: true,
            enabled: true,
            error: typeof value.error === "string" ? value.error : value.error?.message || "That invitation link is not valid.",
          });
          return;
        }
        setBetaSession({
          checked: true,
          enabled: true,
          authenticated: true,
          testerId: typeof value.testerId === "string" ? value.testerId : null,
          analysesPerDay: typeof value.analysesPerDay === "number" ? value.analysesPerDay : 10,
          error: "",
        });
      } catch {
        if (active) setBetaSession(previous => previous.authenticated ? previous : {
          ...previous,
          checked: true,
          enabled: true,
          error: "Private beta access is temporarily unavailable.",
        });
      }
    }

    window.addEventListener("hashchange", redeemFragmentInvitation);
    return () => {
      active = false;
      window.removeEventListener("hashchange", redeemFragmentInvitation);
    };
  }, []);

  useEffect(() => {
    if (!diaryStorageKey) return;
    let active = true;

    queueMicrotask(() => {
      if (!active) return;
      setLoaded(false);
      setMeals([]);

      try {
        const raw = window.localStorage.getItem(diaryStorageKey);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) setMeals(parsed.filter((m): m is Meal =>
            m !== null && typeof m === "object" && typeof m.id === "string" &&
            typeof m.name === "string" && typeof m.loggedAt === "string" &&
            ["calories","protein","carbs","fat"].every(k => typeof (m as Record<string, unknown>)[k] === "number" && Number.isFinite((m as Record<string, number>)[k]) && (m as Record<string, number>)[k] >= 0)
          ));
        }
      } catch { setNotice("Saved meals couldn't be loaded on this device."); }
      setLoaded(true);
    });

    return () => { active = false; };
  }, [diaryStorageKey]);

  useEffect(() => {
    if (loaded && diaryStorageKey) {
      try { window.localStorage.setItem(diaryStorageKey, JSON.stringify(meals)); }
      catch { /* Storage may be disabled or full. */ }
    }
  }, [diaryStorageKey, loaded, meals]);

  async function leaveBeta() {
    await fetch("/api/beta/session", { method: "DELETE" }).catch(() => undefined);
    setBetaSession(previous => ({ ...previous, authenticated: false, testerId: null, error: "Session ended. Ask for a new invitation link to return." }));
    setMeals([]);
    setLoaded(false);
  }

  function logMeal() {
    const values = [calories, protein, carbs, fat].map(Number);
    if (!mealName.trim() || values.some(v => !Number.isFinite(v) || v < 0)) {
      setNotice("Add a meal name and valid, nonnegative nutrition values.");
      return;
    }
    setMeals(prev => [{ id: crypto.randomUUID(), name: mealName.trim(), calories: values[0], protein: values[1], carbs: values[2], fat: values[3], loggedAt: new Date().toISOString() }, ...prev]);
    setNotice("Meal added to today's diary.");
  }
  function removeMeal(id: string) {
    setMeals(prev => prev.filter(m => m.id !== id));
    setNotice("Meal removed.");
  }

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function selectFile(file?: File) {
    if (!file) return;

    if (!CLIENT_IMAGE_TYPES.includes(file.type)) {
      setNotice("Choose a JPEG, PNG, or WebP image.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    if (file.size > MAX_CLIENT_IMAGE_BYTES) {
      setNotice("Choose an image smaller than 6 MB.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setSelectedFile(file);
    setFileName(file.name);
    setAnalyzed(false);
    setAnalysis(null);
    setNotice("");
  }

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files?.[0]);
  }

  function clearPhoto() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setSelectedFile(null);
    setFileName("");
    setAnalyzed(false);
    setAnalysis(null);
    setNotice("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function applyAnalysis(value: AnalysisResponse) {
    setMealName(value.nutrition.foodName);
    setCalories(String(value.nutrition.calories));
    setProtein(String(value.nutrition.protein));
    setCarbs(String(value.nutrition.carbohydrates));
    setFat(String(value.nutrition.fat));
    setAnalysis(value);
    setAnalyzed(true);
  }

  async function analyzePhoto() {
    if (!selectedFile) {
      setNotice("Choose a food photo first.");
      return;
    }

    const fileKey = `${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}:${selectedFile.type}`;
    if (lastAnalysisRef.current?.fileKey === fileKey) {
      applyAnalysis(lastAnalysisRef.current.value);
      setNotice("Reused the previous result for this photo. Review it before logging.");
      return;
    }

    setAnalyzing(true);
    setNotice("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 35_000);

    try {
      const formData = new FormData();
      formData.append("image", selectedFile);
      const response = await fetch("/api/analyze-food", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const value = await response.json();

      if (!response.ok) {
        if (response.status === 401 && value?.error?.code === "BETA_SESSION_REQUIRED") {
          setBetaSession(previous => ({ ...previous, authenticated: false, testerId: null, error: value.error.message }));
        }
        throw new Error(value?.error?.message || "We couldn't analyze this photo.");
      }

      const result = value as AnalysisResponse;
      lastAnalysisRef.current = { fileKey, value: result };
      applyAnalysis(result);
      setNotice(result.nutrition.uncertain
        ? "This estimate is uncertain. Check the assumptions and edit anything that looks wrong."
        : "Estimate ready. Review and edit it before adding the meal.");
    } catch (error) {
      setNotice(error instanceof DOMException && error.name === "AbortError"
        ? "Analysis took too long. Please try again."
        : error instanceof Error ? error.message : "We couldn't analyze this photo.");
    } finally {
      window.clearTimeout(timeout);
      setAnalyzing(false);
    }
  }

  if (!betaSession.checked) {
    return <main className="access-shell"><div className="access-card"><span className="brand"><span className="brand-mark"><Leaf size={20} /></span>MacroSnap</span><p>Checking private beta access…</p></div></main>;
  }

  if (betaSession.enabled && !betaSession.authenticated) {
    return (
      <main className="access-shell">
        <section className="access-card" aria-labelledby="beta-access-title">
          <span className="brand"><span className="brand-mark"><Leaf size={20} /></span>MacroSnap</span>
          <p className="eyebrow"><Sparkles size={15} /> Private beta</p>
          <h1 id="beta-access-title">Invitation required.</h1>
          <p>Open the individual invitation link you received. Invitation links can be redeemed once and establish a private session on this device.</p>
          <small>Each tester may run up to {betaSession.analysesPerDay} AI analyses per day.</small>
          {betaSession.error && <p className="access-error" role="alert">{betaSession.error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main>
      <header className="site-header">
        <div className="container nav-inner">
          <a className="brand" href="#top" aria-label="MacroSnap home">
            <span className="brand-mark"><Leaf size={20} strokeWidth={2.6} /></span>
            <span>MacroSnap</span>
          </a>
          <div className="streak"><Flame size={17} fill="currentColor" /> My food diary</div>
          {betaSession.enabled ? <button className="beta-exit" onClick={leaveBeta} title="End private beta session"><LogOut size={15} /> Leave beta</button> : <span className="avatar" aria-label="Profile placeholder">MS</span>}
        </div>
      </header>

      <div className="container page" id="top">
        <section className="hero">
          <div>
            <p className="eyebrow"><Sparkles size={15} /> Smart food tracking</p>
            <h1>See what&apos;s on your plate.</h1>
            <p className="hero-copy">Upload a meal photo and get an instant nutrition estimate—no tedious searching or measuring.</p>
          </div>
          <div className="date-chip">
            <span>Today</span>
            <strong suppressHydrationWarning>{new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })}</strong>
          </div>
        </section>

        <div className="dashboard-grid">
          <section className="card upload-card" aria-labelledby="upload-title">
            <div className="card-heading">
              <div>
                <p className="step">STEP 1</p>
                <h2 id="upload-title">Snap your meal</h2>
              </div>
              <Camera className="heading-icon" size={24} />
            </div>

            <input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={onInput} />

            {preview ? (
              <div className="preview-area">
                {/* A local object URL is required for immediate browser-only photo preview. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Your selected meal" />
                <button className="remove-photo" onClick={clearPhoto} aria-label="Remove selected photo"><X size={18} /></button>
                <div className="photo-name"><Check size={15} /> {fileName}</div>
              </div>
            ) : (
              <div
                className={`drop-zone ${dragging ? "is-dragging" : ""}`}
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <span className="upload-icon"><ImagePlus size={31} /></span>
                <h3>Add a food photo</h3>
                <p>Drag and drop an image here, or choose from your device.</p>
                <button className="primary-button" onClick={() => inputRef.current?.click()}>
                  <Camera size={18} /> Choose photo
                </button>
                <span className="file-hint">JPG, PNG, or WebP · up to 6 MB</span>
              </div>
            )}

            {preview && (
              <button className="analyze-button" onClick={analyzePhoto} disabled={analyzing}>
                <ScanLine size={19} /> {analyzing ? "Analyzing securely…" : analyzed ? "Analyze again" : "Analyze meal"}
              </button>
            )}
          </section>

          <section className="card result-card" aria-labelledby="result-title">
            <div className="card-heading">
              <div>
                <p className="step">STEP 2</p>
                <h2 id="result-title">Nutrition estimate</h2>
              </div>
              <Sparkles className="heading-icon purple" size={24} />
            </div>

            <div className={`result-content ${analyzed ? "fresh-result" : ""}`}>
              <div className="meal-title">
                <span className="meal-icon"><Utensils size={21} /></span>
                <div><strong>{analyzed ? "Review your meal" : "No meal selected yet"}</strong><span>{analyzed ? "Edit any estimate before logging" : "Choose a photo or add a meal manually"}</span></div>
              </div>
              {analyzed && <div className="entry-fields">
                <label>Meal name<input value={mealName} maxLength={100} onChange={e => setMealName(e.target.value)} placeholder="e.g. Grilled chicken and rice" /></label>
                <div className="entry-numbers">
                  <label>Calories<input type="number" min="0" step="1" value={calories} onChange={e => setCalories(e.target.value)} /></label>
                  <label>Protein (g)<input type="number" min="0" step="0.1" value={protein} onChange={e => setProtein(e.target.value)} /></label>
                  <label>Carbs (g)<input type="number" min="0" step="0.1" value={carbs} onChange={e => setCarbs(e.target.value)} /></label>
                  <label>Fat (g)<input type="number" min="0" step="0.1" value={fat} onChange={e => setFat(e.target.value)} /></label>
                </div>
              </div>}
              <div className="calorie-total">
                <span><Flame size={20} fill="currentColor" /> Calories</span>
                <strong>{analyzed ? (Number(calories) || 0) : "—"} <small>kcal</small></strong>
              </div>
              <div className="macro-row">
                {mealMacros.map((macro) => (
                  <div className="macro-stat" key={macro.label}>
                    <span className="macro-dot" style={{ background: macro.color }} />
                    <div><strong>{macro.value}{macro.unit}</strong><span>{macro.label}</span></div>
                  </div>
                ))}
              </div>
              {analysis && <div className={`analysis-review ${analysis.nutrition.uncertain ? "is-uncertain" : ""}`}>
                <div className="analysis-summary">
                  <span className={`confidence-badge confidence-${analysis.nutrition.confidence}`}>{analysis.nutrition.confidence} confidence</span>
                  <span>{analysis.meta.cached ? "Reused result · no new tokens" : `${analysis.usage.totalTokens.toLocaleString()} tokens`}</span>
                </div>
                {analysis.nutrition.uncertaintyNote && <p>{analysis.nutrition.uncertaintyNote}</p>}
                {analysis.nutrition.assumptions.length > 0 && <div className="assumptions">
                  <strong>Check these assumptions</strong>
                  <ul>{analysis.nutrition.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
                </div>}
                <small>
                  {analysis.usage.estimatedCostUsd === null
                    ? "Cost estimate unavailable until current model pricing is configured."
                    : `Estimated API cost: $${analysis.usage.estimatedCostUsd.toFixed(6)}`}
                </small>
              </div>}
              <button className="log-button" onClick={logMeal} disabled={!analyzed || !loaded}><Plus size={18} /> Add to today&apos;s log</button>
              <p className="mock-note"><Sparkles size={13} /> Estimates can be wrong. Review before logging.</p>
              {notice && <p className="entry-notice" role="status">{notice}</p>}
            </div>
          </section>
        </div>

        <section className="daily-section" aria-labelledby="daily-title">
          <div className="section-title">
            <div><p className="eyebrow"><Target size={15} /> Daily progress</p><h2 id="daily-title">Your macros today</h2></div>
            <a className="text-button" href="#diary">View diary <ChevronRight size={17} /></a>
          </div>

          <div className="daily-card">
            <div className="calorie-summary">
              <ProgressRing value={totals.calories} max={goals.calories} />
              <div className="calorie-copy"><span>Calories eaten</span><strong>{Math.round(totals.calories).toLocaleString()} <small>/ {goals.calories.toLocaleString()} kcal</small></strong><p>Based on meals logged today.</p></div>
            </div>
            <div className="macro-progress-list">
              {dayMacros.map((macro) => {
                const percent = Math.min(100, Math.round((macro.current / macro.goal) * 100));
                return (
                  <div className="progress-item" key={macro.label}>
                    <div className="progress-label"><span><i style={{ background: macro.color }} />{macro.label}</span><strong>{macro.current}<small> / {macro.goal}{macro.unit}</small></strong></div>
                    <div className="progress-track"><span style={{ width: `${percent}%`, background: macro.color }} /></div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="recent-section" id="diary">
          <div className="section-title compact"><div><p className="eyebrow">Today&apos;s log</p><h2>Recent meals</h2></div><button className="add-meal" onClick={() => { setAnalyzed(true); setAnalysis(null); setMealName(""); setCalories("0"); setProtein("0"); setCarbs("0"); setFat("0"); setNotice("Enter nutrition manually, then review it before logging."); document.getElementById("result-title")?.scrollIntoView({ behavior: "smooth" }); }}><Plus size={17} /> Add meal</button></div>
          <div className="meal-list">
            {!loaded ? <p>Loading your diary…</p> : todaysMeals.length === 0 ? <p className="empty-diary">Nothing logged today. Add your first meal above.</p> : todaysMeals.map(meal => (
              <article key={meal.id}><span className="meal-emoji lunch">🍽️</span><div className="meal-info"><strong>{meal.name}</strong><span>{new Date(meal.loggedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · P {meal.protein}g · C {meal.carbs}g · F {meal.fat}g</span></div><div className="meal-kcal"><strong>{meal.calories}</strong><span>kcal</span></div><button className="delete-meal" onClick={() => removeMeal(meal.id)} aria-label={`Remove ${meal.name}`}><X size={18} /></button></article>
            ))}
          </div>
        </section>
      </div>

      <footer><div className="container"><span className="brand small"><span className="brand-mark"><Leaf size={16} /></span>MacroSnap</span><p>Small choices, clearer progress.</p></div></footer>
    </main>
  );
}
