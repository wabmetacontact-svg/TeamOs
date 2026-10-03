"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { IMP, IMPORT_TYPES, MAX_IMPORT_ROWS, autoMap, checkRows, parseCSV, type ImportType } from "@/lib/importer";
import { runImport } from "@/app/(app)/actions/imports";
import { Icon } from "../icons";
import { useOps } from "../store";

type Src = "file" | "paste" | "link";

type State = {
  step: 1 | 2 | 3 | 4 | 5;
  type: ImportType | null;
  src: Src;
  text: string;
  url: string;
  fileName: string;
  headers: string[];
  rows: string[][];
  map: Record<string, string>;
  mkClients: boolean;
  mkMembers: boolean;
  onlyBad: boolean;
  busy: boolean;
  err: string;
  done: { n: number; skipped: number; extra: string[] } | null;
};

const START: State = {
  step: 1,
  type: null,
  src: "file",
  text: "",
  url: "",
  fileName: "",
  headers: [],
  rows: [],
  map: {},
  mkClients: true,
  mkMembers: false,
  onlyBad: false,
  busy: false,
  err: "",
  done: null,
};

const primary = "fw-s h-10 rounded-lg border-0 px-5 text-[13px] text-white";
const secondary = "fw-s h-10 rounded-lg border border-edge2 bg-white px-[18px] text-[13px]";

export function ImportView() {
  const ops = useOps();
  const { w, m } = ops;
  const router = useRouter();
  const [s, setS] = useState<State>(START);
  const set = (p: Partial<State>) => setS((cur) => ({ ...cur, ...p }));
  const spec = s.type ? IMP[s.type] : null;
  const canImport = m.edits("import") && !m.previewing;

  function load(txt: string, name: string) {
    const rows = parseCSV(txt);
    if (rows.length < 2) return set({ err: "No data rows found. Include the header row and at least one row of data." });
    if (rows.length - 1 > MAX_IMPORT_ROWS) return set({ err: `That is ${rows.length - 1} rows. Import at most ${MAX_IMPORT_ROWS} at a time.` });
    const headers = rows[0]!.map((x, i) => x || `Column ${i + 1}`);
    set({ headers, rows: rows.slice(1), map: autoMap(s.type!, headers), fileName: name, step: 3, err: "" });
  }

  async function fetchSheet() {
    const u = s.url.trim();
    const id = u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!id) return set({ err: "Paste a Google Sheets link, the one from your browser address bar." });
    const gid = u.match(/[#&?]gid=(\d+)/)?.[1];
    set({ busy: true, err: "" });
    try {
      const r = await fetch(`https://docs.google.com/spreadsheets/d/${id[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`);
      if (!r.ok) throw new Error();
      const t = await r.text();
      if (/^\s*</.test(t)) throw new Error();
      set({ busy: false });
      load(t, "Google Sheet");
    } catch {
      set({ busy: false, err: "Couldn't read that sheet. Share it as Anyone with the link can view, or download it as CSV and upload the file." });
    }
  }

  function readFile(file: File | undefined) {
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) return set({ err: "Excel files are not supported yet. In Google Sheets or Excel, save the tab as CSV and upload that." });
    const r = new FileReader();
    r.onload = () => load(String(r.result ?? ""), file.name);
    r.readAsText(file);
  }

  function template() {
    if (!s.type) return;
    const csv = IMP[s.type].fields.map((f) => `"${f[1].replace(/ \(.*\)/, "")}"`).join(",") + "\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${s.type}-import-template.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const checked = useMemo(
    () =>
      s.step === 4 && s.type
        ? checkRows(s.type, s.rows, s.map, s, {
            meId: m.me.id,
            today: m.today,
            team: m.team.map((p) => ({ id: p.id, name: p.name, email: p.email })),
            clients: m.vis.map((c) => ({ id: c.id, name: c.name, company: c.company, brandId: c.brandId })),
            brands: w.brands.map((b) => ({ id: b.id, name: b.name })),
          })
        : [],
    [s, m, w.brands],
  );
  const ok = checked.filter((r) => r.ok).length;
  const bad = checked.length - ok;
  const shown = s.onlyBad ? checked.filter((r) => !r.ok) : checked;
  const missingReq = !!spec && spec.fields.some(([k, , req]) => req && (s.map[k] == null || s.map[k] === ""));
  const mapped = spec ? spec.fields.filter(([k]) => s.map[k] != null && s.map[k] !== "") : [];

  async function run() {
    if (!s.type || !ok) return;
    set({ busy: true });
    const r = await ops.run(
      runImport({ type: s.type, fileName: s.fileName, rows: s.rows, map: s.map, mkClients: s.mkClients, mkMembers: s.mkMembers }),
      { quiet: true },
    );
    if (!r.ok) return set({ busy: false, err: r.error });
    set({ busy: false, step: 5, done: r.data ?? { n: ok, skipped: 0, extra: [] } });
    ops.toast(r.message ?? "Imported.");
    // Imports touch many records at once; reload the workspace rather than patching it.
    router.refresh();
  }

  if (!canImport) {
    return <p className="m-0 text-[13px] text-mute2">You can see this section, but importing needs Edit access on Import.</p>;
  }

  const steps = ["Data type", "Source", "Match columns", "Review and import"];

  return (
    <>
      <p className="m-0 mb-4 max-w-[72ch] text-[13px] leading-[1.55] text-mute2">
        Bring in data from your Google Sheets. Upload a CSV export, paste rows copied from the sheet, or read a shared sheet link. You review every row before
        anything is saved.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {steps.map((label, i) => {
          const n = i + 1;
          const cur = s.step === n;
          const done = s.step > n;
          return (
            <span
              key={label}
              className="fw-s flex h-[34px] items-center gap-2 rounded-full pl-1.5 pr-3.5 text-xs"
              style={{ background: cur ? "#EEF0FF" : "#fff", color: cur ? "#3730A3" : done ? "#15803D" : "#64748B" }}
            >
              <span
                className="flex size-[22px] items-center justify-center rounded-full text-[11px]"
                style={{ background: cur ? "#5B5BD6" : done ? "#DCFCE7" : "#F1F5F9", color: cur ? "#fff" : done ? "#15803D" : "#64748B" }}
              >
                {done ? "✓" : n}
              </span>
              {label}
            </span>
          );
        })}
      </div>

      <section className="flex flex-col gap-[18px] rounded-xl border border-line bg-white p-6">
        {s.step === 1 && (
          <>
            <h2 className="m-0 text-[17px]">What are you importing?</h2>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,220px),1fr))" }}>
              {IMPORT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set({ type: t, map: {} })}
                  className="flex flex-col gap-1.5 rounded-[10px] border-[1.5px] p-4 text-left transition-colors hover:border-accent"
                  style={{ borderColor: s.type === t ? "#5B5BD6" : "#E5E7EB", background: s.type === t ? "#F5F5FF" : "#fff" }}
                >
                  <span className="fw-s text-sm text-ink">{IMP[t].label}</span>
                  <span className="text-xs leading-[1.45] text-mute">{IMP[t].hint}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <button type="button" disabled={!s.type} onClick={() => set({ step: 2, err: "" })} className={primary} style={{ background: s.type ? "#5B5BD6" : "#94A3B8" }}>
                Continue
              </button>
            </div>
          </>
        )}

        {s.step === 2 && spec && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="m-0 text-[17px]">Where is the {spec.label.toLowerCase()} data?</h2>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  template();
                }}
                className="fw-s text-xs"
              >
                Download a CSV template
              </a>
            </div>
            <div className="grid max-w-[520px] grid-cols-3 gap-1 rounded-[10px] bg-tint2 p-1">
              {(
                [
                  ["file", "Upload CSV"],
                  ["paste", "Paste from sheet"],
                  ["link", "Google Sheet link"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => set({ src: id, err: "" })}
                  className="fw-s h-9 rounded-lg border-0 text-xs"
                  style={{
                    background: s.src === id ? "#fff" : "transparent",
                    color: s.src === id ? "#0F172A" : "#64748B",
                    boxShadow: s.src === id ? "0 1px 2px rgba(15,23,42,.1)" : "none",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {s.src === "file" && (
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  readFile(e.dataTransfer.files[0]);
                }}
                className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-accent-l bg-[#F8F8FF] p-6 text-center"
                style={{ ["--icon-stroke" as string]: "#5B5BD6" }}
              >
                <Icon name="doc" size={28} />
                <span className="fw-s text-sm">Drop a CSV file here, or click to choose</span>
                <span className="text-xs text-mute">In Google Sheets: File, Download, Comma-separated values (.csv)</span>
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    readFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {s.src === "paste" && (
              <>
                <textarea
                  value={s.text}
                  onChange={(e) => set({ text: e.target.value })}
                  rows={9}
                  placeholder="Select the rows in your sheet, including the header row, copy and paste them here."
                  className="w-full resize-y rounded-[10px] border border-edge2 px-3.5 py-3 font-mono text-xs leading-normal"
                />
                <div className="flex justify-end">
                  <button type="button" onClick={() => load(s.text, "pasted rows")} className={`${primary} bg-accent`}>
                    Read pasted rows
                  </button>
                </div>
              </>
            )}
            {s.src === "link" && (
              <>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={s.url}
                    onChange={(e) => set({ url: e.target.value })}
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                    className="h-[42px] flex-[1_1_320px] rounded-[10px] border border-edge2 px-3.5 text-[13px]"
                  />
                  <button type="button" disabled={s.busy} onClick={fetchSheet} className={`${primary} h-[42px] bg-accent`}>
                    {s.busy ? "Reading…" : "Read sheet"}
                  </button>
                </div>
                <p className="m-0 text-xs leading-normal text-mute">The sheet must be shared as &quot;Anyone with the link can view&quot;. The tab in the link is the one that gets read.</p>
              </>
            )}
            {s.err && <div className="rounded-lg bg-[#FEF2F2] px-3.5 py-2.5 text-[13px] text-bad-d">{s.err}</div>}
            <div className="flex justify-start">
              <button type="button" onClick={() => set({ step: 1, err: "" })} className={secondary}>
                Back
              </button>
            </div>
          </>
        )}

        {s.step === 3 && spec && (
          <>
            <div>
              <h2 className="m-0 text-[17px]">Match your columns</h2>
              <p className="m-0 mt-1.5 text-[13px] text-mute">
                {s.rows.length} {s.rows.length === 1 ? "row" : "rows"} and {s.headers.length} columns from {s.fileName || "your data"}. Columns with matching names
                were matched for you.
              </p>
            </div>
            <div className="overflow-hidden rounded-[10px] border border-edge">
              {spec.fields.map(([k, label, req]) => {
                const v = s.map[k] ?? "";
                return (
                  <div key={k} className="grid items-center gap-3 border-b border-tint2 px-3.5 py-2.5 text-[13px]" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr) minmax(0,1fr)" }}>
                    <span className="fw-s">
                      {label}
                      {req ? <span className="text-bad"> *</span> : null}
                    </span>
                    <select
                      value={v}
                      onChange={(e) => set({ map: { ...s.map, [k]: e.target.value } })}
                      className="h-[38px] min-w-0 rounded-lg border bg-white px-2.5 text-[13px]"
                      style={{ borderColor: req && v === "" ? "#FCA5A5" : "#E2E8F0" }}
                    >
                      <option value="">Don&apos;t import</option>
                      {s.headers.map((h, i) => (
                        <option key={i} value={String(i)}>
                          {h}
                        </option>
                      ))}
                    </select>
                    <span className="ellipsis text-xs text-mute">{v !== "" && s.rows[0] ? s.rows[0][+v] || "(empty in first row)" : ""}</span>
                  </div>
                );
              })}
            </div>
            {(s.type === "tasks" || s.type === "ledger") && (
              <div className="flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-ink3">
                  <input type="checkbox" checked={s.mkClients} onChange={() => set({ mkClients: !s.mkClients })} className="m-0 size-[18px] accent-accent" />
                  Create clients that are not in the platform yet
                </label>
                {s.type === "tasks" && (
                  <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-ink3">
                    <input type="checkbox" checked={s.mkMembers} onChange={() => set({ mkMembers: !s.mkMembers })} className="m-0 size-[18px] accent-accent" />
                    Add assignees who are not on the team yet
                  </label>
                )}
              </div>
            )}
            {missingReq && <div className="rounded-lg bg-[#FFFBEB] px-3.5 py-2.5 text-[13px] text-warn-d">Match every field marked * to continue.</div>}
            <div className="flex justify-between gap-2">
              <button type="button" onClick={() => set({ step: 2, err: "" })} className={secondary}>
                Back
              </button>
              <button
                type="button"
                disabled={missingReq}
                onClick={() => set({ step: 4, onlyBad: false })}
                className={primary}
                style={{ background: missingReq ? "#94A3B8" : "#5B5BD6" }}
              >
                Review rows
              </button>
            </div>
          </>
        )}

        {s.step === 4 && spec && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="m-0 text-[17px]">Review before importing</h2>
                <p className="m-0 mt-1.5 text-[13px] text-mute">Rows with problems are skipped. Fix them in the sheet and import again, or go back and change the matches.</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="fw-s rounded-full bg-good-s px-3 py-[5px] text-xs text-good-d">
                  {ok} {ok === 1 ? "row ready" : "rows ready"}
                </span>
                {bad > 0 && (
                  <button
                    type="button"
                    onClick={() => set({ onlyBad: !s.onlyBad })}
                    className="fw-s rounded-full border bg-bad-s px-3 py-[5px] text-xs text-bad-d"
                    style={{ borderColor: s.onlyBad ? "#B91C1C" : "transparent" }}
                  >
                    {s.onlyBad ? "Show all rows" : `${bad} with problems`}
                  </button>
                )}
              </div>
            </div>
            <div className="max-h-[460px] overflow-auto rounded-[10px] border border-edge">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {["Row", "Result", ...mapped.map((f) => f[1])].map((h) => (
                      <th key={h} className="sticky top-0 whitespace-nowrap border-b border-edge bg-tint px-3 py-[9px] text-left text-[10px] uppercase tracking-[.06em] text-mute">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 200).map((r) => (
                    <tr key={r.n} style={{ background: r.ok ? (r.info ? "#F8F8FF" : "#fff") : "#FEF2F2" }}>
                      <td className="border-b border-tint2 px-3 py-2 text-faint">{r.n}</td>
                      <td className="fw-s min-w-[170px] border-b border-tint2 px-3 py-2" style={{ color: r.ok ? (r.info ? "#4338CA" : "#15803D") : "#B91C1C" }}>
                        {r.msg}
                      </td>
                      {r.cells.map((c, i) => (
                        <td key={i} className="ellipsis max-w-[220px] border-b border-tint2 px-3 py-2 text-ink3">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown.length > 200 && <p className="m-0 -mt-2 text-xs text-mute">Showing the first 200 of {shown.length} rows. All ready rows will be imported.</p>}
            {s.err && <div className="rounded-lg bg-[#FEF2F2] px-3.5 py-2.5 text-[13px] text-bad-d">{s.err}</div>}
            <div className="flex justify-between gap-2">
              <button type="button" onClick={() => set({ step: 3, err: "" })} className={secondary}>
                Back
              </button>
              <button type="button" disabled={!ok || s.busy} onClick={run} className={primary} style={{ background: ok && !s.busy ? "#5B5BD6" : "#94A3B8" }}>
                {s.busy ? "Importing…" : `Import ${ok} ${ok === 1 ? "row" : "rows"}`}
              </button>
            </div>
          </>
        )}

        {s.step === 5 && spec && s.done && (
          <>
            <div className="flex items-start gap-3.5" style={{ ["--icon-stroke" as string]: "#16A34A" }}>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-good-s">
                <Icon name="check" size={20} />
              </span>
              <div>
                <h2 className="m-0 text-[17px]">
                  Imported {s.done.n} {spec.label.toLowerCase()}
                </h2>
                <p className="m-0 mt-1.5 text-[13px] leading-[1.55] text-mute">
                  {[
                    s.done.skipped ? `${s.done.skipped} row${s.done.skipped > 1 ? "s were" : " was"} skipped because of problems or access.` : "Every row was imported.",
                    s.done.extra.length ? `Also created ${s.done.extra.join(", ")}.` : "",
                    "The import is recorded in the audit trail.",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => router.push(`/${spec.go}`)} className={`${primary} bg-accent`}>
                Go to {spec.label}
              </button>
              <button type="button" onClick={() => setS(START)} className={secondary}>
                Import more data
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
