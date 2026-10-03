"use client";

import { useRouter } from "next/navigation";
import { FORM_FEATURE } from "@/lib/access";
import { CURRENCIES, DOWL, MNF, dLabel, fmtCur, inr, readAmount, weekday } from "@/lib/format";
import { EMPLOYMENT_TYPES, LEAVE_TYPES, STATUS } from "@/lib/labels";
import type { EntryW, MemberW, Result } from "@/lib/types";
import { createClient, editClient, removeClient } from "@/app/(app)/actions/clients";
import { createEntry, deleteDraw, deleteEntry, editEntry, recordDraw, saveSalary } from "@/app/(app)/actions/ledger";
import { createTask } from "@/app/(app)/actions/tasks";
import { createMember, editMember, requestLeave } from "@/app/(app)/actions/team";
import { FieldError } from "@/app/(auth)/auth-screen";
import { type Form, type ModalType, type QuickKind, useOps } from "./store";

/** The "+ Add new …" option at the end of a select. */
export const ADD = "__add";

type Ops = ReturnType<typeof useOps>;

const PAYDAYS = [
  { id: "", name: "Not set" },
  ...Array.from({ length: 31 }, (_, i) => {
    const n = i + 1;
    const o = n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
    return { id: String(n), name: `${o} of the month` };
  }),
];

const str = (v: unknown) => (v == null ? "" : String(v));

/** Opens a form with the defaults the prototype gives it. */
export function openModal(ops: Ops, type: ModalType, data: Record<string, unknown> = {}) {
  const { m, w } = ops;
  const today = m.today;
  let form: Form = {};
  const ctxClient = typeof data.client === "string" ? data.client : "";

  if (type === "entry") {
    const t = data.type === "in" ? "in" : "out";
    const client = ctxClient && m.can(ctxClient, "finance") ? ctxClient : "";
    form = {
      type: t,
      desc: "",
      client,
      cat: (t === "in" ? w.tenant.incomeCategories[0] : w.tenant.expenseCategories[0]) ?? "",
      amount: "",
      date: str(data.date) || today,
      status: "paid",
      cur: (t === "in" && client && m.C(client)?.currency) || "INR",
      orig: "",
      emp: "",
      partner: "",
    };
  }
  if (type === "editEntry") {
    const e = data as unknown as EntryW;
    form = {
      id: e.id,
      type: e.type,
      desc: e.desc,
      client: e.clientId ?? "",
      cat: e.category,
      amount: String(e.amount),
      date: e.date,
      status: e.status,
      cur: e.currency ?? "INR",
      orig: e.orig != null ? String(e.orig) : "",
      emp: e.memberId ?? "",
      partner: e.partnerId ?? "",
    };
  }
  if (type === "task") {
    const tc = ctxClient && m.can(ctxClient, "edit") ? ctxClient : "";
    const due = str(data.due);
    form = {
      by: m.viewer.id,
      dept: m.deptsForMe[0]?.id ?? "",
      title: "",
      brand: tc ? (m.C(tc)?.brandId ?? "") : (m.viewer.brandId && m.B(m.viewer.brandId) ? m.viewer.brandId : (w.brands[0]?.id ?? "")),
      client: tc,
      who: str(data.who) || m.viewer.id,
      due,
      status: str(data.status) || "todo",
      pri: "medium",
      est: "",
      note: "",
      repeat: "none",
      rday: String(weekday(due || today)),
      every: "2",
      time: "",
      until: "",
    };
  }
  if (type === "client") {
    form = { name: "", company: "", brand: w.brands[0]?.id ?? "", retainer: "", services: "", contact: "", sinceDate: today, payDay: "" };
  }
  if (type === "editClient") {
    const c = m.C(str(data.id));
    if (!c) return;
    form = {
      id: c.id,
      name: c.name,
      company: c.company,
      brand: c.brandId,
      retainer: c.retainer != null ? String(c.retainer) : "",
      services: c.services,
      contact: c.contact,
      sinceDate: c.sinceDate ?? "",
      payDay: c.payDay ? String(c.payDay) : "",
    };
  }
  if (type === "removeClient") form = { id: str(data.id), name: str(data.name) };
  if (type === "member") {
    form = {
      name: "",
      role: "",
      dept: w.tenant.hrDepartments[1] ?? w.tenant.hrDepartments[0] ?? "",
      brand: w.brands[0]?.id ?? "",
      type: "Full-time",
      start: today,
      salary: "",
      email: "",
    };
  }
  if (type === "editMember") {
    const p = data as unknown as MemberW;
    form = {
      id: p.id,
      name: p.name,
      role: p.title,
      dept: p.dept,
      brand: p.brandId ?? "",
      type: p.type || "Full-time",
      start: p.start ?? "",
      salary: p.salary != null ? String(p.salary) : "",
      email: p.email ?? "",
      phone: p.phone,
      manager: p.managerId ?? "",
    };
  }
  if (type === "leave") form = { who: (m.teamAdmin && str(data.who)) || m.me.id, type: "Annual", from: "", to: "", note: "" };
  if (type === "draw") form = { partner: m.owners[0]?.id ?? "", amount: "", date: today, src: str(data.src), note: "" };
  if (type === "deleteDraw" || type === "confirmDelete") form = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, str(v)]));
  if (type === "salary") {
    const p = m.P(str(data.pid));
    form = {
      pid: p.id,
      salary: p.salary != null ? String(p.salary) : "",
      from: today,
      payMethod: p.pay?.method ?? "bank",
      holder: p.pay?.holder || p.name,
      bank: p.pay?.bank ?? "",
      acct: p.pay?.account ?? "",
      ifsc: p.pay?.ifsc ?? "",
      upi: p.pay?.upi ?? "",
    };
  }

  ops.setModal({ type, form, errors: {}, busy: false });
  if (type !== "confirmDelete") ops.setDrawer(null);
  ops.setMenuOpen(false);
}

// ───────────────────────────────────────────────────────────── the specs ───

type Option = { id: string; name: string };
type Field = {
  name: string;
  label: string;
  type?: string;
  ph?: string;
  full?: boolean;
  options?: Option[];
  /** Adds "+ Add new <add>" which opens a quick-add of `kind`. */
  add?: { label: string; kind: QuickKind };
};
type Spec = {
  title: string;
  submit: string;
  fields: Field[];
  toggle?: boolean;
  text?: string;
  note?: string;
  danger?: boolean;
};

function specFor(ops: Ops, type: ModalType, f: Form): Spec {
  const { m, w } = ops;
  const brandOpts = w.brands.map((b) => ({ id: b.id, name: b.name }));
  const teamOpts = m.active.map((p) => ({ id: p.id, name: p.name }));
  const opt = (a: readonly string[]) => a.map((x) => ({ id: x, name: x }));

  if (type === "entry" || type === "editEntry") {
    const isIn = f.type === "in";
    const fx = isIn && !!f.cur && f.cur !== "INR";
    const oN = readAmount(f.orig);
    const aN = readAmount(f.amount);
    const cOpts = [{ id: "", name: m.overhead ? "No client (overhead)" : "Select a client" }, ...m.fin.map((c) => ({ id: c.id, name: c.name }))];
    return {
      title: type === "entry" ? (isIn ? "New income" : "New expense") : "Edit entry",
      submit: type === "entry" ? `Add ${isIn ? "income" : "expense"}` : "Save changes",
      toggle: type === "entry",
      fields: [
        { name: "desc", label: "Description", ph: isIn ? "e.g. Retainer, October" : "e.g. Cloud hosting, October", full: true },
        ...(isIn ? [{ name: "cur", label: "Received in", options: opt(CURRENCIES) }] : []),
        ...(fx
          ? [
              { name: "orig", label: `Amount received (${f.cur})`, ph: "e.g. 5000" },
              { name: "amount", label: "Received after conversion (₹)", ph: "e.g. 415000" },
            ]
          : [{ name: "amount", label: "Amount (₹)", ph: "e.g. 42000" }]),
        { name: "date", label: "Date", type: "date" },
        { name: "client", label: "Client", options: cOpts, ...(m.edits("clients") ? { add: { label: "client", kind: "client" as const } } : {}) },
        { name: "cat", label: "Category", options: opt(isIn ? w.tenant.incomeCategories : w.tenant.expenseCategories), add: { label: "category", kind: "cat" } },
        ...(!isIn && f.cat === "Salaries" ? [{ name: "emp", label: "Team member", options: [{ id: "", name: "Select a team member" }, ...teamOpts] }] : []),
        ...(!isIn && f.cat === "Partner draw"
          ? [{ name: "partner", label: "Partner", options: [{ id: "", name: "Select a partner" }, ...m.owners.map((p) => ({ id: p.id, name: p.name }))] }]
          : []),
        {
          name: "status",
          label: "Status",
          options: [
            { id: "paid", name: isIn ? "Received" : "Paid" },
            { id: "pending", name: "Pending" },
          ],
        },
      ],
      note:
        fx && oN && aN
          ? `Effective rate: 1 ${f.cur} = ₹${(aN / oN).toFixed(2)}. Reports use the rupee amount received.`
          : fx
            ? "Enter both amounts to see the effective conversion rate."
            : type === "editEntry"
              ? "The previous value is kept in the audit trail with your name and the time."
              : "Only clients where you hold Finance access are listed.",
    };
  }

  if (type === "task") {
    const brand = m.B(f.brand);
    const agency = brand?.kind !== "startup";
    const repeating = !!f.repeat && f.repeat !== "none";
    return {
      title: "New task",
      submit: "Create task",
      fields: [
        { name: "title", label: "Title", ph: "e.g. October content calendar", full: true },
        { name: "brand", label: "Brand", options: brandOpts, add: { label: "brand", kind: "brand" } },
        agency
          ? {
              name: "client",
              label: "Working for",
              options: [
                { id: "", name: `${brand?.name ?? "Brand"} operations (no client)` },
                ...m.vis.filter((c) => c.brandId === f.brand && m.can(c.id, "edit")).map((c) => ({ id: c.id, name: c.name })),
              ],
              ...(m.edits("clients") ? { add: { label: "client", kind: "client" as const } } : {}),
            }
          : {
              name: "client",
              label: "Working for",
              options: [{ id: "", name: brand?.name ?? "Brand" }, ...(brand?.areas ?? []).map((a) => ({ id: `@${a}`, name: a }))],
              add: { label: "area", kind: "area" },
            },
        { name: "who", label: "Assignee", options: teamOpts, ...(m.edits("team") ? { add: { label: "team member", kind: "member" as const } } : {}) },
        { name: "by", label: "Assigned by", options: teamOpts },
        {
          name: "repeat",
          label: "Repeat",
          options: [
            { id: "none", name: "Does not repeat" },
            { id: "daily", name: "Every day" },
            { id: "weekdays", name: "Every weekday (Mon to Fri)" },
            { id: "weekly", name: "Every week" },
            { id: "every", name: "Every few days" },
          ],
        },
        { name: "due", label: repeating ? "Starts on" : "Due date", type: "date" },
        ...(f.repeat === "weekly" ? [{ name: "rday", label: "On", options: DOWL.map((d, i) => ({ id: String(i), name: d })) }] : []),
        ...(f.repeat === "every" ? [{ name: "every", label: "Every how many days", type: "number", ph: "e.g. 3" }] : []),
        ...(repeating
          ? [
              { name: "time", label: "Time", type: "time" },
              { name: "until", label: "Ends on (optional)", type: "date" },
            ]
          : []),
        { name: "status", label: "Status", options: STATUS.map((x) => ({ id: x.id, name: x.label })) },
        { name: "dept", label: "Department", options: m.deptsForMe.map((d) => ({ id: d.id, name: d.name })), add: { label: "department", kind: "tdept" } },
        {
          name: "pri",
          label: "Priority",
          options: [
            { id: "high", name: "High" },
            { id: "medium", name: "Medium" },
            { id: "low", name: "Low" },
          ],
        },
        { name: "est", label: "Estimate (hours)", type: "number", ph: "e.g. 4" },
        ...(repeating ? [] : [{ name: "note", label: "Note", ph: "Optional. Paste a doc link to attach it.", full: true }]),
      ],
      note: "Pick operations for internal work on the brand, or a client when the work is for them.",
    };
  }

  if (type === "client" || type === "editClient") {
    const fin = type === "client" || (f.id ? m.can(f.id, "finance") : false);
    return {
      title: type === "client" ? "New client" : "Edit client profile",
      submit: type === "client" ? "Add client" : "Save changes",
      fields: [
        { name: "name", label: "Client name", ph: "e.g. Northwind Foods", full: type === "client" },
        ...(type === "editClient" ? [{ name: "company", label: "Company" }] : []),
        { name: "brand", label: "Brand", options: brandOpts, add: { label: "brand", kind: "brand" } },
        ...(type === "client" ? [{ name: "company", label: "Company", ph: "Legal or trading name" }] : []),
        ...(fin ? [{ name: "retainer", label: "Monthly retainer (₹)", ph: "e.g. 150000" }] : []),
        { name: "sinceDate", label: "Onboard date", type: "date" },
        { name: "payDay", label: "Paid date", options: PAYDAYS },
        { name: "services", label: "Services provided", ph: "e.g. LinkedIn and X management", full: true },
        { name: "contact", label: "Main contact", ph: "Name", full: true },
      ],
      note:
        type === "client"
          ? "Team members start with no access to a new client. Whoever runs the books keeps Finance access."
          : "Changes are recorded in the audit trail.",
    };
  }

  if (type === "member" || type === "editMember") {
    const edit = type === "editMember";
    return {
      title: edit ? "Edit team member" : "New team member",
      submit: edit ? "Save changes" : "Add to team",
      fields: [
        { name: "name", label: "Full name", ph: "e.g. Kavya Reddy" },
        { name: "role", label: "Role", ph: "e.g. Account manager" },
        { name: "dept", label: "Department", options: opt(w.tenant.hrDepartments), add: { label: "department", kind: "dept" } },
        { name: "brand", label: "Primary brand", options: [{ id: "", name: "None" }, ...brandOpts], add: { label: "brand", kind: "brand" } },
        { name: "type", label: "Employment type", options: opt(edit ? EMPLOYMENT_TYPES : EMPLOYMENT_TYPES.filter((t) => t !== "Founder")) },
        { name: "start", label: "Start date", type: "date" },
        ...(m.payV ? [{ name: "salary", label: "Monthly salary (₹)", ph: "e.g. 60000" }] : []),
        ...(edit ? [{ name: "manager", label: "Reports to", options: [{ id: "", name: "No one" }, ...teamOpts.filter((o) => o.id !== f.id)] }] : []),
        { name: "email", label: "Work email", type: "email", ph: "name@company.com" },
        ...(edit ? [{ name: "phone", label: "Phone", ph: "Optional" }] : []),
      ],
      note: edit
        ? "Changes are recorded in the audit trail."
        : "New members get no client access until you grant it. With an email, you get a link to send them so they can set a password.",
    };
  }

  if (type === "leave") {
    return {
      title: "New leave request",
      submit: "Submit request",
      fields: [
        {
          name: "who",
          label: "Team member",
          options: m.teamAdmin ? teamOpts : teamOpts.filter((o) => o.id === m.me.id),
          ...(m.teamAdmin && m.edits("team") ? { add: { label: "team member", kind: "member" as const } } : {}),
        },
        { name: "type", label: "Leave type", options: opt(LEAVE_TYPES) },
        { name: "from", label: "From", type: "date" },
        { name: "to", label: "To", type: "date" },
        { name: "note", label: "Note", ph: "Optional", full: true },
      ],
    };
  }

  if (type === "draw") {
    const inc = w.ledger
      .filter((e) => e.type === "in" && e.status === "paid")
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 15);
    return {
      title: "Record partner draw",
      submit: "Record draw",
      fields: [
        { name: "partner", label: "Partner", options: m.owners.map((p) => ({ id: p.id, name: p.name })) },
        { name: "amount", label: "Amount (₹)", ph: "e.g. 50000" },
        { name: "date", label: "Date", type: "date" },
        {
          name: "src",
          label: "From client payment",
          options: [{ id: "", name: "Not linked" }, ...inc.map((e) => ({ id: e.id, name: `${dLabel(e.date)} · ${e.desc} · ${inr(e.amount)}` }))],
        },
        { name: "note", label: "Note", ph: "Optional", full: true },
      ],
      note: "The draw is recorded as money out under Partner draw in Income and expenses.",
    };
  }

  if (type === "deleteDraw") {
    return {
      title: "Delete draw",
      submit: "Delete",
      danger: true,
      text: `Delete the ${inr(Number(f.amount) || 0)} draw for ${f.partner}? The deletion is recorded in the audit trail.`,
      fields: [],
    };
  }

  if (type === "salary") {
    const p = m.P(f.pid);
    return {
      title: `Salary and payment, ${p.name}`,
      submit: "Save",
      fields: [
        { name: "salary", label: "Monthly salary (₹)", ph: "e.g. 60000" },
        { name: "from", label: "Effective from", type: "date" },
        {
          name: "payMethod",
          label: "Paid via",
          options: [
            { id: "bank", name: "Bank transfer" },
            { id: "upi", name: "UPI" },
          ],
        },
        ...(f.payMethod === "upi"
          ? [{ name: "upi", label: "UPI ID", ph: "e.g. name@okhdfc" }]
          : [
              { name: "holder", label: "Account holder name", ph: "As on the bank account" },
              { name: "bank", label: "Bank name", ph: "e.g. HDFC Bank" },
              { name: "acct", label: "Account number", ph: "e.g. 50100248194821" },
              { name: "ifsc", label: "IFSC", ph: "e.g. HDFC0001234" },
            ]),
      ],
      note: `Current salary ${p.salary ? inr(p.salary) : "not set"}. The change is kept in salary history and the audit trail.`,
    };
  }

  if (type === "confirmDelete") {
    return {
      title: "Delete entry",
      submit: "Delete",
      danger: true,
      text: `Delete “${f.desc}” for ${inr(Number(f.amount) || 0)}? It will leave the ledger, and the deletion is recorded in the audit trail.`,
      fields: [],
    };
  }

  // removeClient
  return {
    title: "Remove client",
    submit: "Remove client",
    danger: true,
    text: `Remove ${f.name}? The client leaves every list and report. The removal is recorded in the audit trail.`,
    fields: [],
  };
}

// ────────────────────────────────────────────────────────── the modal ───

export function FormModal() {
  const ops = useOps();
  const router = useRouter();
  const { modal, setModal, m } = ops;
  if (!modal) return null;
  const { type, form: f, errors } = modal;
  const spec = specFor(ops, type, f);

  const close = () => setModal(null);

  function onField(name: string, value: string) {
    if (value === ADD) {
      const field = spec.fields.find((x) => x.name === name);
      if (field?.add) {
        ops.setQuick({
          kind: field.add.kind,
          target: "form",
          field: name,
          form: { name: "", brand: f.brand ?? ops.w.brands.find((b) => b.kind !== "startup")?.id ?? "", role: "", kind: "agency" },
          error: "",
          busy: false,
        });
      }
      return;
    }
    setModal((cur) => {
      if (!cur) return cur;
      const ex: Form = {};
      const month = MNF[Number((cur.form.date || m.today).slice(5, 7)) - 1];
      if (name === "brand" && cur.form.client && !cur.form.client.startsWith("@") && m.C(cur.form.client)?.brandId !== value) ex.client = "";
      if (name === "brand" && cur.form.client?.startsWith("@")) ex.client = "";
      if (name === "emp" && value) {
        const p = m.P(value);
        if (!cur.form.amount && p.salary) ex.amount = String(p.salary);
        if (!cur.form.desc) ex.desc = `Salary, ${p.name}, ${month}`;
      }
      if (name === "partner" && value && !cur.form.desc && cur.type === "entry") ex.desc = `Partner draw, ${m.P(value).name}`;
      if (name === "client" && cur.type === "entry" && cur.form.type === "in" && value) ex.cur = m.C(value)?.currency || cur.form.cur;
      return { ...cur, form: { ...cur.form, [name]: value, ...ex }, errors: { ...cur.errors, [name]: "" } };
    });
  }

  function setType(t: "in" | "out") {
    setModal((cur) =>
      cur
        ? {
            ...cur,
            form: {
              ...cur.form,
              type: t,
              cur: "INR",
              cat: (t === "in" ? ops.w.tenant.incomeCategories[0] : ops.w.tenant.expenseCategories[0]) ?? "",
            },
          }
        : cur,
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (modal!.busy) return;
    const feature = FORM_FEATURE[type];
    if (feature && type !== "leave" && !m.edits(feature)) {
      setModal(null);
      return ops.toast("You have view-only access here. Nothing was saved.");
    }
    setModal((cur) => (cur ? { ...cur, busy: true } : cur));
    const result = await ops.run(dispatch(type, f), { quiet: true });
    if (!result.ok) {
      setModal((cur) => (cur ? { ...cur, busy: false, errors: result.fields ?? {} } : cur));
      if (!result.fields || !Object.keys(result.fields).some((k) => spec.fields.some((x) => x.name === k))) ops.toast(result.error);
      return;
    }
    setModal(null);
    if (result.message) ops.toast(result.message);
    const data = (result as { data?: { id?: string; link?: string | null } }).data;
    if (type === "client" && data?.id) router.push(`/clients/${data.id}`);
    if (type === "editClient") ops.setDrawer({ type: "client", id: f.id! });
    if (type === "editMember") ops.setDrawer({ type: "person", id: f.id! });
    if (type === "member" && data?.link) {
      ops.setNotice({
        title: `Send ${f.name} their login link`,
        text: `They open it to set a password, then log in with ${f.email}. It works once and expires in 7 days. There is no email server, so copy it and send it yourself.`,
        link: data.link,
      });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-[rgba(15,23,42,.45)] max-wide:items-end max-wide:p-0 wide:items-center wide:p-6"
      onClick={close}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        noValidate
        className="flex max-h-full w-full max-w-[500px] animate-rise flex-col gap-3.5 overflow-auto bg-white p-6 max-wide:rounded-t-[14px] wide:rounded-[14px]"
      >
        <div className="flex items-center justify-between">
          <h2 className="m-0 text-lg">{spec.title}</h2>
          <button type="button" onClick={close} aria-label="Close" className="size-10 border-0 bg-transparent text-xl">
            ×
          </button>
        </div>

        {spec.toggle && (
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-[rgba(100,116,139,.1)] p-1">
            {(
              [
                ["out", "Expense"],
                ["in", "Income"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setType(id)}
                className="fw-s h-9 rounded-md border-0 text-[13px]"
                style={{ background: f.type === id ? "#fff" : "transparent", color: f.type === id ? "#111827" : "#64748B" }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {spec.text && <p className="m-0 text-sm leading-[1.55]">{spec.text}</p>}

        {spec.fields.length > 0 && (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
            {spec.fields.map((field) => {
              const err = errors[field.name];
              const border = err ? "#DC2626" : "rgba(100,116,139,.35)";
              const value = f[field.name] ?? "";
              return (
                <label key={field.name} className="fw-s flex flex-col gap-1.5 text-xs" style={{ gridColumn: field.full ? "1 / -1" : "auto" }}>
                  {field.label}
                  {field.options ? (
                    <select
                      name={field.name}
                      value={value}
                      onChange={(e) => onField(field.name, e.target.value)}
                      className="fw-b h-11 rounded-lg border bg-white px-3 text-sm"
                      style={{ borderColor: border }}
                    >
                      {field.options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                      {field.add && <option value={ADD}>+ Add new {field.add.label}</option>}
                    </select>
                  ) : (
                    <input
                      name={field.name}
                      type={field.type ?? "text"}
                      value={value}
                      onChange={(e) => onField(field.name, e.target.value)}
                      placeholder={field.ph}
                      className="fw-b h-11 rounded-lg border px-3 text-sm"
                      style={{ borderColor: border }}
                    />
                  )}
                  <FieldError text={err} />
                </label>
              );
            })}
          </div>
        )}

        {spec.note && <div className="rounded-md bg-[rgba(91,91,214,.07)] px-3 py-2.5 text-xs text-mute">{spec.note}</div>}

        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={close} className="fw-s h-11 rounded-full border border-[rgba(100,116,139,.35)] bg-white px-[18px] text-[13px]">
            Cancel
          </button>
          <button
            type="submit"
            disabled={modal.busy}
            className="fw-s h-11 rounded-full border-0 px-[22px] text-[13px] text-white"
            style={{ background: modal.busy ? "#94A3B8" : spec.danger ? "#DC2626" : "#5B5BD6" }}
          >
            {modal.busy ? "Saving…" : spec.submit}
          </button>
        </div>
      </form>
    </div>
  );
}

function dispatch(type: ModalType, f: Form): Promise<Result<unknown>> {
  switch (type) {
    case "entry":
      return createEntry(f as never);
    case "editEntry":
      return editEntry(f as never);
    case "confirmDelete":
      return deleteEntry(f.id!);
    case "task":
      return createTask(f as never);
    case "client":
      return createClient(f as never);
    case "editClient":
      return editClient(f as never);
    case "removeClient":
      return removeClient(f.id!);
    case "member":
      return createMember(f as never);
    case "editMember":
      return editMember(f as never);
    case "leave":
      return requestLeave(f as never);
    case "draw":
      return recordDraw(f as never);
    case "deleteDraw":
      return deleteDraw(f.id!);
    case "salary":
      return saveSalary(f as never);
  }
}

/** For screens that show the conversion line on an entry. */
export const fxLine = (e: EntryW) =>
  e.currency && e.orig ? `${fmtCur(e.orig, e.currency)} received, converted to ${inr(e.amount)} · 1 ${e.currency} = ₹${(e.amount / e.orig).toFixed(2)}` : "";
