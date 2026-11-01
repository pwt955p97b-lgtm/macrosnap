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

type Macro = {
  label: string;
  value: number;
  unit: string;
  color: string;
};

const mealMacros: Macro[] = [
  { label: "Protein", value: 42, unit: "g", color: "#9d79ef" },
  { label: "Carbs", value: 58, unit: "g", color: "#e9a23b" },
  { label: "Fat", value: 18, unit: "g", color: "#ee7291" },
];

const dayMacros = [
  { label: "Protein", current: 96, goal: 140, unit: "g", color: "#9d79ef" },
  { label: "Carbs", current: 164, goal: 230, unit: "g", color: "#e9a23b" },
  { label: "Fat", current: 49, goal: 70, unit: "g", color: "#ee7291" },
];

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
        <strong>{max - value}</strong>
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
    window.setTimeout(() => {
      setAnalyzing(false);
      setAnalyzed(true);
    }, 900);
  }

  return (
    <main>
      <header className="site-header">
        <div className="container nav-inner">
          <a className="brand" href="#top" aria-label="MacroSnap home">
            <span className="brand-mark"><Leaf size={20} strokeWidth={2.6} /></span>
            <span>MacroSnap</span>
          </a>
          <div className="streak"><Flame size={17} fill="currentColor" /> 6 day streak</div>
          <button className="avatar" aria-label="Open profile">AM</button>
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
            <strong>November 1</strong>
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
                <ScanLine size={19} /> {analyzing ? "Analyzing your meal…" : analyzed ? "Analyze again" : "Analyze meal"}
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
                <div><strong>Grilled chicken grain bowl</strong><span>Estimated serving · 485 g</span></div>
              </div>
              <div className="calorie-total">
                <span><Flame size={20} fill="currentColor" /> Calories</span>
                <strong>562 <small>kcal</small></strong>
              </div>
              <div className="macro-row">
                {mealMacros.map((macro) => (
                  <div className="macro-stat" key={macro.label}>
                    <span className="macro-dot" style={{ background: macro.color }} />
                    <div><strong>{macro.value}{macro.unit}</strong><span>{macro.label}</span></div>
                  </div>
                ))}
              </div>
              <div className="ingredients">
                <p>What we found</p>
                <div><span>Grilled chicken</span><span>Brown rice</span><span>Avocado</span><span>Greens</span></div>
              </div>
              <button className="log-button"><Plus size={18} /> Add to today&apos;s log</button>
              <p className="mock-note"><Sparkles size={13} /> Prototype estimate using sample data</p>
            </div>
          </section>
        </div>

        <section className="daily-section" aria-labelledby="daily-title">
          <div className="section-title">
            <div><p className="eyebrow"><Target size={15} /> Daily progress</p><h2 id="daily-title">Your macros today</h2></div>
            <button className="text-button">View diary <ChevronRight size={17} /></button>
          </div>

          <div className="daily-card">
            <div className="calorie-summary">
              <ProgressRing value={1428} max={2100} />
              <div className="calorie-copy"><span>Calories eaten</span><strong>1,428 <small>/ 2,100 kcal</small></strong><p>You&apos;re right on track for today.</p></div>
            </div>
            <div className="macro-progress-list">
              {dayMacros.map((macro) => {
                const percent = Math.round((macro.current / macro.goal) * 100);
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

        <section className="recent-section">
          <div className="section-title compact"><div><p className="eyebrow">Today&apos;s log</p><h2>Recent meals</h2></div><button className="add-meal"><Plus size={17} /> Add meal</button></div>
          <div className="meal-list">
            <article><span className="meal-emoji breakfast">🥣</span><div className="meal-info"><strong>Greek yogurt & berries</strong><span>Breakfast · 8:12 AM</span></div><div className="meal-kcal"><strong>326</strong><span>kcal</span></div><ChevronRight size={18} /></article>
            <article><span className="meal-emoji lunch">🥗</span><div className="meal-info"><strong>Mediterranean salad</strong><span>Lunch · 12:36 PM</span></div><div className="meal-kcal"><strong>540</strong><span>kcal</span></div><ChevronRight size={18} /></article>
          </div>
        </section>
      </div>

      <footer><div className="container"><span className="brand small"><span className="brand-mark"><Leaf size={16} /></span>MacroSnap</span><p>Small choices, clearer progress.</p></div></footer>
    </main>
  );
}
