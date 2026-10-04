/**
 * Importing from a spreadsheet.
 *
 * The same functions run twice: in the browser to preview every row before
 * anything is saved, and on the server to check the rows again against the
 * real data before importing them. The server never trusts the preview.
 */

import { iso } from "./format";

export type ImportType = "tasks" | "clients" | "team" | "ledger" | "leave" | "ads";

/** [key, label, required, synonyms for auto-matching] */
export type FieldSpec = [key: string, label: string, required: 0 | 1, synonyms: string];

export const IMP: Record<ImportType, { label: string; go: string; hint: string; fields: FieldSpec[] }> = {
  tasks: {
    label: "Tasks",
    go: "tasks",
    hint: "Title, assignee, client or brand, status, due date, notes",
    fields: [
      ["title", "Task title", 1, "task,title,taskname,description"],
      ["who", "Assignee", 0, "assignee,assignedto,employee,owner,member"],
      ["client", "Client", 0, "client,clientname,customer"],
      ["brand", "Brand", 0, "brand"],
      ["status", "Status", 0, "status,state"],
      ["pri", "Priority", 0, "priority,pri"],
      ["due", "Due date", 0, "due,duedate,deadline"],
      ["created", "Date created", 0, "date,created,createdon,timestamp"],
      ["est", "Estimate (hours)", 0, "estimate,est,hours"],
      ["note", "Notes or doc link", 0, "note,notes,doc,doclink,link,remarks,comments"],
    ],
  },
  clients: {
    label: "Clients",
    go: "clients",
    hint: "Name, company, monthly rate, sales person, onboarder, login, phone, notes",
    fields: [
      ["name", "Client name", 1, "client,clientname,name"],
      ["company", "Company", 0, "company,business"],
      ["brand", "Brand", 0, "brand"],
      ["retainer", "Monthly rate (₹)", 0, "rate,retainer,monthly,fee,monthlyrate"],
      ["services", "Services", 0, "services,service"],
      ["contact", "Main contact", 0, "contact,poc,maincontact"],
      ["since", "Client since", 0, "since,startdate,start,clientsince"],
      ["cur", "Paid in currency", 0, "currency,cur"],
      ["seller", "Sales person", 0, "sales,salesperson,seller,soldby,salesby,broughtby,salesexecutive"],
      ["onboarder", "Onboarder", 0, "onboarder,onboardedby,onboarding"],
      ["login", "Login ID", 0, "login,loginid,username,userid,loginemail"],
      ["phone", "Phone", 0, "phone,mobile,whatsapp,phoneno,number"],
      ["details", "Notes", 0, "notes,note,details,remarks,comments"],
    ],
  },
  team: {
    label: "Team members",
    go: "team",
    hint: "Name, email, role, department, salary, bank or UPI",
    fields: [
      ["name", "Full name", 1, "name,fullname,employee"],
      ["email", "Email", 0, "email,mail,workemail"],
      ["role", "Role", 0, "role,designation,position"],
      ["dept", "Department", 0, "department,dept"],
      ["type", "Employment type", 0, "type,employmenttype"],
      ["start", "Start date", 0, "start,startdate,joined,joining,doj"],
      ["salary", "Monthly salary (₹)", 0, "salary,monthlysalary,pay,ctc"],
      ["phone", "Phone", 0, "phone,mobile"],
      ["upi", "UPI ID", 0, "upi,upiid,vpa"],
      ["bank", "Bank name", 0, "bank,bankname"],
      ["acct", "Account number", 0, "account,accountnumber,accno,acno"],
      ["ifsc", "IFSC", 0, "ifsc,ifsccode"],
    ],
  },
  ledger: {
    label: "Income and expenses",
    go: "expenses",
    hint: "Date, description, amount, income or expense, category, client, team member",
    fields: [
      ["date", "Date", 1, "date,paidon,txndate,transactiondate"],
      ["type", "Income or expense", 0, "type,inout,kind,direction"],
      ["desc", "Description", 1, "description,desc,details,particulars,narration,item"],
      ["amount", "Amount (₹)", 1, "amount,inr,amountinr,value,total"],
      ["cat", "Category", 0, "category,cat,head"],
      ["client", "Client", 0, "client,clientname,customer"],
      ["status", "Status", 0, "status"],
      ["cur", "Currency received", 0, "currency,cur"],
      ["orig", "Amount in that currency", 0, "foreignamount,receivedamount,originalamount,usdamount"],
      ["member", "Team member", 0, "member,teammember,employee,person,staff,salesperson"],
    ],
  },
  leave: {
    label: "Leave requests",
    go: "team",
    hint: "Team member, leave type, from, to, note, status",
    fields: [
      ["who", "Team member", 1, "name,employee,member,teammember"],
      ["type", "Leave type", 0, "type,leavetype"],
      ["from", "From", 1, "from,start,startdate"],
      ["to", "To", 1, "to,end,enddate"],
      ["note", "Note", 0, "note,reason,remarks"],
      ["status", "Status", 0, "status"],
    ],
  },
  ads: {
    label: "Ad spend and leads",
    go: "ads",
    hint: "Person, month, spent, leads, campaign - past months too",
    fields: [
      ["who", "Person", 1, "person,name,member,salesperson,employee,for"],
      ["month", "Month", 1, "month,period,date"],
      ["amount", "Spent (₹)", 0, "spent,spend,amount,cost,budget,adspend"],
      ["leads", "Leads", 0, "leads,lead,enquiries,inquiries"],
      ["note", "Campaign or note", 0, "campaign,note,notes,remarks"],
    ],
  },
};

export const IMPORT_TYPES = Object.keys(IMP) as ImportType[];
export const MAX_IMPORT_ROWS = 5000;

// ─────────────────────────────────────────────────────────────── parsing ───

/** CSV, TSV or semicolon-separated — whichever the header row uses most. */
export function parseCSV(input: string): string[][] {
  const txt = String(input || "").replace(/^﻿/, "");
  const first = txt.split(/\r?\n/)[0] || "";
  const cnt = (c: string) => first.split(c).length;
  const d = cnt("\t") > cnt(",") && cnt("\t") > 1 ? "\t" : cnt(";") > cnt(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i]!;
    if (q) {
      if (ch === '"') {
        if (txt[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && txt[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

/** A date in any of the common spreadsheet shapes. "" when empty, null when unreadable. */
export function toISO(v: unknown): string | null {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s) return "";
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1]!, +m[2]!, +m[3]!);
  if ((m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/))) {
    let y = +m[3]!;
    if (y < 100) y += 2000;
    let d = +m[1]!;
    let mo = +m[2]!;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return iso(y, mo, d);
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}

/** A month as yyyy-MM: "2026-09", "09/2026", "Sep 2026", "September 2026", or any date in it. "" when empty, null when unreadable. */
export function toYM(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return "";
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})$/))) return +m[2]! >= 1 && +m[2]! <= 12 ? `${m[1]}-${m[2]!.padStart(2, "0")}` : null;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{4})$/))) return +m[1]! >= 1 && +m[1]! <= 12 ? `${m[2]}-${m[1]!.padStart(2, "0")}` : null;
  if ((m = s.match(/^([a-z]{3,9})[\s\-',]*(\d{2}|\d{4})$/i))) {
    const i = MONTHS.findIndex((x) => m![1]!.toLowerCase().startsWith(x));
    if (i < 0) return null;
    const y = m[2]!.length === 2 ? 2000 + +m[2]! : +m[2]!;
    return `${y}-${String(i + 1).padStart(2, "0")}`;
  }
  const d = toISO(s);
  return d ? d.slice(0, 7) : null;
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * What identifies a ledger row for spotting one imported twice: the same kind,
 * day, amount, client and description. Two genuinely separate payments that
 * match on all five are rare; a sheet imported a second time matches on every row.
 */
export const ledgerKey = (e: { type: string; date: string; paise: number; clientId: string | null; desc: string }) =>
  [e.type, e.date, e.paise, e.clientId ?? "", nrm(e.desc)].join("|");

/** The same for ad spend: person, month, amount and leads. */
export const adKey = (a: { memberId: string; month: string; paise: number; leads: number }) => [a.memberId, a.month, a.paise, a.leads].join("|");

/** A number, ignoring currency marks and grouping. null when empty, NaN when unreadable. */
export function toNum(v: unknown): number | null {
  if (v == null || String(v).trim() === "") return null;
  let s = String(v).replace(/[₹$€£,\s]|INR|USDT|USDC|USD/gi, "");
  if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
  const n = Number(s);
  return Number.isNaN(n) ? NaN : n;
}

export const nrm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Matches spreadsheet columns to fields by name. Returns field key -> column index. */
export function autoMap(type: ImportType, headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const used = new Set<number>();
  const hn = headers.map(nrm);
  for (const [k, , , syn] of IMP[type].fields) {
    const ss = syn.split(",");
    let i = hn.findIndex((x, j) => !used.has(j) && ss.includes(x));
    if (i < 0) i = hn.findIndex((x, j) => !used.has(j) && !!x && ss.some((y) => y.length > 3 && x.includes(y)));
    if (i >= 0) {
      map[k] = String(i);
      used.add(i);
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────── checking ───

export type ImportData = {
  meId: string;
  today: string;
  team: { id: string; name: string; email: string | null }[];
  clients: { id: string; name: string; company: string; brandId: string }[];
  brands: { id: string; name: string }[];
  /** ledgerKey of every entry already recorded, to refuse importing one twice. */
  ledgerKeys?: Set<string>;
  /** adKey of every ad spend already recorded. */
  adKeys?: Set<string>;
};

export type ImportOptions = { mkClients: boolean; mkMembers: boolean };

export type TaskRec = {
  title: string;
  who: string;
  newWho: string | null;
  client: string | null;
  newClient: string | null;
  brand: string | null;
  newBrand: string | null;
  status: "todo" | "doing" | "review" | "done";
  pri: "high" | "medium" | "low";
  due: string;
  created: string;
  est: number | null;
  note: string;
};
export type ClientRec = {
  name: string;
  company: string;
  brand: string | null;
  newBrand: string | null;
  retainer: number;
  services: string;
  contact: string;
  since: string;
  cur: string | null;
  /** Credited with the sale: an existing member, or a name to add. */
  seller: string | null;
  newSeller: string | null;
  onboarder: string | null;
  newOnboarder: string | null;
  loginId: string;
  phone: string;
  details: string;
};
export type TeamRec = {
  name: string;
  email: string;
  role: string;
  dept: string;
  type: "Full-time" | "Part-time" | "Contract" | "Intern";
  start: string;
  salary: number | null;
  phone: string;
  pay: { method: "upi"; upi: string } | { method: "bank"; holder: string; bank: string; acct: string; ifsc: string } | null;
};
export type LedgerRec = {
  date: string;
  type: "in" | "out";
  desc: string;
  amount: number;
  cat: string;
  client: string | null;
  newClient: string | null;
  status: "paid" | "pending";
  cur: string | null;
  orig: number | null;
  /** Whose it is - a salary, a commission, a sale. */
  member: string | null;
};
export type LeaveRec = {
  who: string;
  type: "Annual" | "Sick" | "Personal" | "Parental" | "Unpaid";
  from: string;
  to: string;
  note: string;
  status: "pending" | "approved" | "declined";
};
export type AdRec = {
  who: string;
  /** yyyy-MM */
  month: string;
  amount: number;
  leads: number;
  note: string;
};
export type Rec = TaskRec | ClientRec | TeamRec | LedgerRec | LeaveRec | AdRec;

export type CheckedRow = {
  /** Spreadsheet row number, counting the header as row 1. */
  n: number;
  ok: boolean;
  msg: string;
  cells: string[];
  rec: Rec | null;
  info: boolean;
};

const CURS = ["INR", "USD", "USDT", "USDC"];

export function checkRows(
  type: ImportType,
  rows: string[][],
  map: Record<string, string>,
  opts: ImportOptions,
  data: ImportData,
): CheckedRow[] {
  const spec = IMP[type].fields;
  const col = (r: string[], k: string) => (map[k] != null && map[k] !== "" ? (r[+map[k]] || "").trim() : "");
  const findPerson = (v: string) => {
    const l = v.toLowerCase();
    return (
      data.team.find((p) => p.name.toLowerCase() === l || (p.email ?? "").toLowerCase() === l) ??
      data.team.find((p) => p.name.split(" ")[0]!.toLowerCase() === l)
    );
  };
  const findClient = (v: string) => {
    const l = v.toLowerCase();
    return data.clients.find((c) => c.name.toLowerCase() === l || (c.company || "").toLowerCase() === l);
  };
  const findBrand = (v: string) => {
    const l = v.toLowerCase();
    return data.brands.find((b) => b.name.toLowerCase() === l || b.id === v);
  };
  const seen = new Set<string>();

  return rows.map((r, i) => {
    const v: Record<string, string> = {};
    for (const [k] of spec) v[k] = col(r, k);
    const errs: string[] = [];
    const info: string[] = [];
    let rec: Rec | null = null;

    if (type === "tasks") {
      if (!v.title) errs.push("No task title");
      let who = data.meId;
      let newWho: string | null = null;
      if (v.who) {
        const p = findPerson(v.who);
        if (p) who = p.id;
        else if (opts.mkMembers) newWho = v.who;
        else errs.push(`Assignee “${v.who}” not found`);
      }
      let b = v.brand ? findBrand(v.brand) : undefined;
      const newBrand = v.brand && !b ? v.brand : null;
      let client: string | null = null;
      let newClient: string | null = null;
      if (v.client) {
        const c = findClient(v.client);
        if (c) {
          client = c.id;
          if (!b && !newBrand) b = data.brands.find((x) => x.id === c.brandId);
        } else if (findBrand(v.client)) {
          if (!b) b = findBrand(v.client);
        } else if (opts.mkClients) newClient = v.client;
        else errs.push(`Client “${v.client}” not found`);
      }
      const due = toISO(v.due);
      const created = toISO(v.created);
      if (due === null) errs.push("Due date not readable");
      if (created === null) errs.push("Created date not readable");
      const est = toNum(v.est);
      if (Number.isNaN(est)) errs.push("Estimate is not a number");
      const sl = (v.status ?? "").toLowerCase();
      const status = /progress|doing|ongoing|started/.test(sl)
        ? "doing"
        : /review|check/.test(sl)
          ? "review"
          : /done|complete|submit|finish|closed/.test(sl)
            ? "done"
            : "todo";
      const pl = (v.pri ?? "").toLowerCase();
      const pri = /high|urgent|p1|critical/.test(pl) ? "high" : /low|p3/.test(pl) ? "low" : "medium";
      if (newWho) info.push(`new member ${newWho}`);
      if (newClient) info.push(`new client ${newClient}`);
      if (newBrand) info.push(`new brand ${newBrand}`);
      rec = {
        title: v.title ?? "",
        who,
        newWho,
        client,
        newClient,
        brand: b ? b.id : null,
        newBrand,
        status,
        pri,
        due: due || "",
        created: created || data.today,
        est: est && !Number.isNaN(est) ? est : null,
        note: v.note ?? "",
      } satisfies TaskRec;
    }

    if (type === "clients") {
      const name = v.name ?? "";
      if (!name) errs.push("No client name");
      else if (findClient(name)) errs.push("Already in the platform");
      else if (seen.has(name.toLowerCase())) errs.push("Duplicate in this file");
      seen.add(name.toLowerCase());
      const ret = toNum(v.retainer);
      if (Number.isNaN(ret)) errs.push("Rate is not a number");
      const since = toISO(v.since);
      if (since === null) errs.push("Start date not readable");
      const b = v.brand ? findBrand(v.brand) : undefined;
      if (v.brand && !b) info.push(`new brand ${v.brand}`);
      const cur = (v.cur ?? "").toUpperCase();
      if (cur && !CURS.includes(cur)) errs.push("Currency must be INR, USD, USDT or USDC");
      const person = (label: string, val: string | undefined): [string | null, string | null] => {
        if (!val) return [null, null];
        const p = findPerson(val);
        if (p) return [p.id, null];
        if (opts.mkMembers) {
          info.push(`new member ${val}`);
          return [null, val];
        }
        errs.push(`${label} “${val}” is not on the team`);
        return [null, null];
      };
      const [seller, newSeller] = person("Sales person", v.seller);
      const [onboarder, newOnboarder] = person("Onboarder", v.onboarder);
      rec = {
        name,
        company: v.company || name,
        brand: b ? b.id : null,
        newBrand: v.brand && !b ? v.brand : null,
        retainer: ret && !Number.isNaN(ret) ? ret : 0,
        services: v.services ?? "",
        contact: v.contact || "Not set",
        since: since || data.today,
        cur: cur && cur !== "INR" && CURS.includes(cur) ? cur : null,
        seller,
        newSeller,
        onboarder,
        newOnboarder,
        loginId: v.login ?? "",
        phone: v.phone ?? "",
        details: v.details ?? "",
      } satisfies ClientRec;
    }

    if (type === "team") {
      const name = v.name ?? "";
      const em = (v.email ?? "").toLowerCase();
      if (!name) errs.push("No name");
      else if (data.team.some((p) => p.name.toLowerCase() === name.toLowerCase() || (em && (p.email ?? "").toLowerCase() === em))) {
        errs.push("Already on the team");
      } else if (seen.has(name.toLowerCase())) errs.push("Duplicate in this file");
      seen.add(name.toLowerCase());
      if (em && !/^\S+@\S+\.\S+$/.test(em)) errs.push("Email not valid");
      const sal = toNum(v.salary);
      if (Number.isNaN(sal)) errs.push("Salary is not a number");
      const st = toISO(v.start);
      if (st === null) errs.push("Start date not readable");
      const ty = (["Full-time", "Part-time", "Contract", "Intern"] as const).find((x) => nrm(x) === nrm(v.type)) ?? "Full-time";
      rec = {
        name,
        email: em,
        role: v.role || "Team member",
        dept: v.dept || "Operations",
        type: ty,
        start: st || data.today,
        salary: sal && !Number.isNaN(sal) ? sal : null,
        phone: v.phone ?? "",
        pay: v.upi
          ? { method: "upi", upi: v.upi }
          : v.acct
            ? { method: "bank", holder: name, bank: v.bank ?? "", acct: v.acct.replace(/\s/g, ""), ifsc: (v.ifsc ?? "").toUpperCase() }
            : null,
      } satisfies TeamRec;
    }

    if (type === "ledger") {
      const d = toISO(v.date);
      if (!d) errs.push(d === null ? "Date not readable" : "No date");
      if (!v.desc) errs.push("No description");
      let amt = toNum(v.amount);
      if (amt == null) errs.push("No amount");
      else if (Number.isNaN(amt)) errs.push("Amount is not a number");
      const tl = (v.type ?? "").toLowerCase();
      let t: "in" | "out" | null = /inc|^in$|credit|receiv|revenue/.test(tl) ? "in" : /exp|^out$|debit|paid|spend|cost/.test(tl) ? "out" : null;
      if (!t && amt != null && !Number.isNaN(amt)) t = amt < 0 ? "out" : v.type ? null : "out";
      if (!t) errs.push("Say Income or Expense");
      if (amt) amt = Math.abs(amt);
      let client: string | null = null;
      let newClient: string | null = null;
      if (v.client) {
        const c = findClient(v.client);
        if (c) client = c.id;
        else if (opts.mkClients) {
          newClient = v.client;
          info.push(`new client ${v.client}`);
        } else errs.push(`Client “${v.client}” not found`);
      }
      const cur = (v.cur ?? "").toUpperCase();
      const orig = toNum(v.orig);
      if (cur && !CURS.includes(cur)) errs.push("Currency must be INR, USD, USDT or USDC");
      if (Number.isNaN(orig)) errs.push("Currency amount is not a number");
      let member: string | null = null;
      if (v.member) {
        const p = findPerson(v.member);
        if (p) member = p.id;
        else errs.push(`“${v.member}” is not on the team`);
      }
      if (d && t && amt && !Number.isNaN(amt) && !newClient && data.ledgerKeys) {
        const key = ledgerKey({ type: t, date: d, paise: Math.round(amt * 100), clientId: client, desc: v.desc ?? "" });
        if (data.ledgerKeys.has(key)) errs.push("Already in the ledger");
      }
      const sl = (v.status ?? "").toLowerCase();
      const fx = t === "in" && cur && cur !== "INR" && CURS.includes(cur) && orig && !Number.isNaN(orig);
      rec = {
        date: d || "",
        type: t ?? "out",
        desc: v.desc ?? "",
        amount: amt && !Number.isNaN(amt) ? amt : 0,
        cat: v.cat || (t === "in" ? "Retainer" : "Other"),
        client,
        newClient,
        status: /pend|due|unpaid|await/.test(sl) ? "pending" : "paid",
        cur: fx ? cur : null,
        orig: fx ? orig : null,
        member,
      } satisfies LedgerRec;
    }

    if (type === "leave") {
      const p = v.who ? findPerson(v.who) : undefined;
      if (!v.who) errs.push("No team member");
      else if (!p) errs.push(`“${v.who}” is not on the team`);
      const f = toISO(v.from);
      const t = toISO(v.to);
      if (!f) errs.push("Start date missing or not readable");
      if (!t) errs.push("End date missing or not readable");
      if (f && t && t < f) errs.push("Ends before it starts");
      const sl = (v.status ?? "").toLowerCase();
      rec = {
        who: p?.id ?? "",
        type: (["Annual", "Sick", "Personal", "Parental", "Unpaid"] as const).find((x) => (v.type ?? "").toLowerCase().startsWith(x.toLowerCase())) ?? "Annual",
        from: f || "",
        to: t || "",
        note: v.note || "No note",
        status: /approv|yes|granted/.test(sl) ? "approved" : /declin|reject|no$/.test(sl) ? "declined" : "pending",
      } satisfies LeaveRec;
    }

    if (type === "ads") {
      const p = v.who ? findPerson(v.who) : undefined;
      if (!v.who) errs.push("No person");
      else if (!p) errs.push(`“${v.who}” is not on the team`);
      const month = toYM(v.month);
      if (!month) errs.push(month === null ? "Month not readable" : "No month");
      const amt = toNum(v.amount);
      const leads = toNum(v.leads);
      if (Number.isNaN(amt) || (amt !== null && amt < 0)) errs.push("Spent is not an amount");
      if (Number.isNaN(leads) || (leads !== null && (leads < 0 || !Number.isInteger(leads)))) errs.push("Leads is not a whole number");
      const amount = amt && !Number.isNaN(amt) && amt > 0 ? amt : 0;
      const n = leads && !Number.isNaN(leads) && leads > 0 ? leads : 0;
      if (!amount && !n && !Number.isNaN(amt) && !Number.isNaN(leads)) errs.push("Neither spend nor leads");
      if (p && month && data.adKeys?.has(adKey({ memberId: p.id, month, paise: Math.round(amount * 100), leads: n }))) {
        errs.push("Already recorded");
      }
      const key = `${p?.id}|${month}|${amount}|${n}`;
      if (p && month && seen.has(key)) errs.push("Duplicate in this file");
      seen.add(key);
      rec = { who: p?.id ?? "", month: month || "", amount, leads: n, note: v.note ?? "" } satisfies AdRec;
    }

    return {
      n: i + 2,
      ok: !errs.length,
      msg: errs.length ? errs.join(" · ") : info.length ? `Ready · ${info.join(", ")}` : "Ready",
      cells: spec.filter(([k]) => map[k] != null && map[k] !== "").map(([k]) => v[k] || "—"),
      rec,
      info: info.length > 0,
    };
  });
}
