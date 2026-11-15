"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronRight,
  Flame,
  ImagePlus,
  Leaf,
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

type Macro = {
  label: string;
  value: number;
  unit: string;
  color: string;
};



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
  const [preview, setPreview] = useState<string | null>(null);
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
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
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
  }, []);

  useEffect(() => {
    if (loaded) {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(meals)); }
      catch { /* Storage may be disabled or full. */ }
    }
  }, [loaded, meals]);

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
    if (!file || !file.type.startsWith("image/")) return;
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setFileName(file.name);
    setAnalyzed(false);
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
    setFileName("");
    setAnalyzed(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function analyzePhoto() {
    setAnalyzing(true);
    // AI analysis is not connected yet: show an editable manual entry instead.
    setMealName("");
    setCalories("0"); setProtein("0"); setCarbs("0"); setFat("0");
    setAnalyzed(true);
    setAnalyzing(false);
    setNotice("AI photo analysis is coming next. Enter your meal estimates to save it.");
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
          <span className="avatar" aria-label="Profile placeholder">MS</span>
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

            <input ref={inputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={onInput} />

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
                <span className="file-hint">JPG, PNG, or HEIC · up to 10 MB</span>
              </div>
            )}

            {preview && (
              <button className="analyze-button" onClick={analyzePhoto} disabled={analyzing}>
                <ScanLine size={19} /> {analyzing ? "Preparing…" : analyzed ? "Reset estimate" : "Enter nutrition"}
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
                <div><strong>{analyzed ? "Log your meal" : "No meal selected yet"}</strong><span>{analyzed ? "Enter nutrition manually · AI coming soon" : "Choose a photo to get started"}</span></div>
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
              <button className="log-button" onClick={logMeal} disabled={!analyzed || !loaded}><Plus size={18} /> Add to today&apos;s log</button>
              <p className="mock-note"><Sparkles size={13} /> Manual nutrition entry · no AI estimate yet</p>
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
          <div className="section-title compact"><div><p className="eyebrow">Today&apos;s log</p><h2>Recent meals</h2></div><button className="add-meal" onClick={() => { setAnalyzed(true); setMealName(""); setCalories("0"); setProtein("0"); setCarbs("0"); setFat("0"); document.getElementById("result-title")?.scrollIntoView({ behavior: "smooth" }); }}><Plus size={17} /> Add meal</button></div>
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
