// The repeat picker: TickTick's quick choices (daily, weekly on the date's
// weekday, monthly on its day, yearly, every weekday) and a custom editor
// (from the due date or from completion, every N days / weeks / months /
// years, weekdays, days of the month or the nth weekday, and how it ends).
import { useState } from "react";
import { MONTHS_LONG, addDays, todayKey } from "../lib/dates";
import {
  DAY_LONG,
  DAY_SHORT,
  dateParts,
  describeRule,
  firstDate,
  formatRule,
  newRule,
  ordinalWord,
  parseRule,
  repeatPresets,
  sameRule,
  type Freq,
  type Rule,
} from "../lib/repeat";
import { Icon } from "./ui";

/**
 * Where a task's date goes when it gets a rule: a task without a date starts
 * on the first day the rule allows from today; one whose date the rule's own
 * days skip moves to the first day they allow.
 */
export function dateForRule(repeat: string | null, date: string | null): string | null {
  const rule = parseRule(repeat);
  if (!rule) return date;
  const own = rule.days.length || rule.monthDays.length || rule.nth !== null || rule.month !== null;
  if (!date) return firstDate(rule, todayKey());
  return own && !rule.fromDone ? firstDate(rule, date) : date;
}

/** Quick choices, then Custom; a set rule that is not one of them shows as a checked custom row. */
export function RepeatMenu({
  value,
  base,
  onPick,
  onCustom,
}: {
  value: string | null;
  base: string;
  onPick: (repeat: string | null) => void;
  onCustom: () => void;
}) {
  const presets = repeatPresets(base);
  const preset = presets.find((p) => sameRule(p.repeat, value, base) && !parseRule(value)?.until && !parseRule(value)?.count);
  const custom = !!value && !preset;
  return (
    <div className="rp-menu">
      {presets.map((p) => (
        <button type="button" key={p.label} className={`menu-item ${preset === p ? "is-active" : ""}`} onClick={() => onPick(p.repeat)}>
          <span className="menu-label">
            {p.label}
            {p.detail && <em className="rp-detail">{p.detail}</em>}
          </span>
          {preset === p && <Icon name="check" size={14} />}
        </button>
      ))}
      <button type="button" className={`menu-item ${custom ? "is-active" : ""}`} onClick={onCustom}>
        <span className="menu-label">
          Custom
          {custom && <em className="rp-detail">{describeRule(parseRule(value)!, base, true)}</em>}
        </span>
        <Icon name="chevron" size={13} />
      </button>
      {value && (
        <>
          <div className="cm-sep" />
          <button type="button" className="menu-item" onClick={() => onPick(null)}>
            <span className="menu-label">Don't repeat</span>
          </button>
        </>
      )}
    </div>
  );
}

const UNITS: [Freq, string, string][] = [
  ["DAILY", "Day", "Days"],
  ["WEEKLY", "Week", "Weeks"],
  ["MONTHLY", "Month", "Months"],
  ["YEARLY", "Year", "Years"],
];
const NTHS = [1, 2, 3, 4, 5, -1];

/** A number with − and + beside it. */
function Stepper({ value, min = 1, max = 99, onChange, label }: { value: number; min?: number; max?: number; onChange: (n: number) => void; label: string }) {
  return (
    <span className="rp-stepper">
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <input
        inputMode="numeric"
        aria-label={label}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
          if (n >= min && n <= max) onChange(n);
        }}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  );
}

/** A native select that looks like the app's controls. */
function Select<T extends string | number>({ value, options, onChange, label, className = "" }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <span className={`rp-select ${className}`}>
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => {
          const hit = options.find(([v]) => String(v) === e.target.value);
          if (hit) onChange(hit[0]);
        }}
      >
        {options.map(([v, text]) => (
          <option key={String(v)} value={String(v)}>
            {text}
          </option>
        ))}
      </select>
      <Icon name="chevron" size={11} />
    </span>
  );
}

/** The custom editor. `base` is the task's date (or today), which bare rules take their days from. */
export function RepeatCustom({ value, base, onDone, onCancel }: { value: string | null; base: string; onDone: (repeat: string) => void; onCancel: () => void }) {
  const at = dateParts(base);
  const [rule, setRule] = useState<Rule>(() => {
    const r = parseRule(value);
    if (r) return { ...r, days: r.freq === "WEEKLY" && !r.days.length ? [at.weekday] : r.days };
    return { ...newRule("WEEKLY"), days: [at.weekday] };
  });
  const [ends, setEnds] = useState<"never" | "date" | "count">(rule.until ? "date" : rule.count ? "count" : "never");
  const put = (patch: Partial<Rule>) => setRule((r) => ({ ...r, ...patch }));
  const untilDefault = addDays(base, 30);
  const monthMode = rule.nth !== null ? "nth" : "day";
  const setFreq = (freq: Freq) =>
    setRule((r) => ({
      ...r,
      freq,
      days: freq === "WEEKLY" ? [at.weekday] : [],
      nth: null,
      monthDays: [],
      month: null,
    }));
  const toggleDay = (d: number) => {
    const days = rule.days.includes(d) ? rule.days.filter((x) => x !== d) : [...rule.days, d].sort((a, b) => a - b);
    if (days.length) put({ days });
  };
  const toggleMonthDay = (d: number) => {
    const cur = rule.monthDays.length ? rule.monthDays : [at.day];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => (a === -1 ? 1 : b === -1 ? -1 : a - b));
    if (next.length) put({ monthDays: next });
  };
  // What is stored: a weekly rule on the date's own weekday stays bare, so moving the task moves the series.
  const final = (): Rule => {
    const r: Rule = { ...rule, until: ends === "date" ? (rule.until ?? untilDefault) : null, count: ends === "count" ? (rule.count ?? 5) : null };
    if (r.fromDone) return { ...r, days: [], nth: null, monthDays: [], month: null };
    if (r.freq === "WEEKLY" && r.days.length === 1 && r.days[0] === at.weekday) r.days = [];
    if (r.freq === "MONTHLY" && r.nth === null && r.monthDays.length === 1 && r.monthDays[0] === at.day) r.monthDays = [];
    if (r.freq === "YEARLY" && r.nth === null && r.month === at.month && r.monthDays.length === 1 && r.monthDays[0] === at.day) {
      r.month = null;
      r.monthDays = [];
    }
    return r;
  };
  const unit = UNITS.find((u) => u[0] === rule.freq)!;
  const monthDays = rule.monthDays.length ? rule.monthDays : [at.day];
  return (
    <div className="rp-custom">
      <div className="seg rp-from">
        <button type="button" className={!rule.fromDone ? "is-active" : ""} onClick={() => put({ fromDone: false })}>
          By due date
        </button>
        <button type="button" className={rule.fromDone ? "is-active" : ""} onClick={() => put({ fromDone: true })}>
          By completion
        </button>
      </div>

      <div className="rp-row">
        <span className="rp-label">Every</span>
        <Stepper value={rule.interval} max={365} label={unit[2].toLowerCase()} onChange={(interval) => put({ interval })} />
        <Select
          label="Unit"
          className="rp-unit"
          value={rule.freq}
          options={UNITS.map(([f, one, many]) => [f, rule.interval === 1 ? one : many] as [Freq, string])}
          onChange={setFreq}
        />
      </div>

      {!rule.fromDone && rule.freq === "WEEKLY" && (
        <div className="rp-days" role="group" aria-label="Weekdays">
          {DAY_SHORT.map((d, i) => (
            <button type="button" key={d} title={DAY_LONG[i]} className={rule.days.includes(i) ? "is-on" : ""} onClick={() => toggleDay(i)}>
              {d[0]}
            </button>
          ))}
        </div>
      )}

      {!rule.fromDone && (rule.freq === "MONTHLY" || rule.freq === "YEARLY") && (
        <>
          {rule.freq === "YEARLY" && (
            <div className="rp-row">
              <span className="rp-label">In</span>
              <Select
                label="Month"
                className="rp-grow"
                value={rule.month ?? at.month}
                options={MONTHS_LONG.map((m, i) => [i + 1, m] as [number, string])}
                onChange={(month) => put({ month })}
              />
            </div>
          )}
          <div className="seg rp-mode">
            <button type="button" className={monthMode === "day" ? "is-active" : ""} onClick={() => put({ nth: null, days: [] })}>
              {rule.freq === "YEARLY" ? "On day" : "Each"}
            </button>
            <button type="button" className={monthMode === "nth" ? "is-active" : ""} onClick={() => put({ nth: at.nth, days: [at.weekday], monthDays: [] })}>
              On the
            </button>
          </div>
          {monthMode === "day" && rule.freq === "MONTHLY" && (
            <div className="rp-grid" role="group" aria-label="Days of the month">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <button type="button" key={d} className={monthDays.includes(d) ? "is-on" : ""} onClick={() => toggleMonthDay(d)}>
                  {d}
                </button>
              ))}
              <button type="button" className={`rp-last ${monthDays.includes(-1) ? "is-on" : ""}`} onClick={() => toggleMonthDay(-1)}>
                Last
              </button>
            </div>
          )}
          {monthMode === "day" && rule.freq === "YEARLY" && (
            <div className="rp-row">
              <span className="rp-label">Day</span>
              <Select
                label="Day of the month"
                className="rp-grow"
                value={rule.monthDays[0] ?? at.day}
                options={[...Array.from({ length: 31 }, (_, i) => [i + 1, String(i + 1)] as [number, string]), [-1, "Last day"]]}
                onChange={(d) => put({ monthDays: [d], month: rule.month ?? at.month })}
              />
            </div>
          )}
          {monthMode === "nth" && (
            <div className="rp-row">
              <Select label="Which" className="rp-grow" value={rule.nth ?? at.nth} options={NTHS.map((n) => [n, ordinalWord(n)] as [number, string])} onChange={(nth) => put({ nth })} />
              <Select
                label="Weekday"
                className="rp-grow"
                value={rule.days[0] ?? at.weekday}
                options={DAY_LONG.map((d, i) => [i, d] as [number, string])}
                onChange={(d) => put({ days: [d] })}
              />
            </div>
          )}
        </>
      )}

      <div className="rp-row rp-ends">
        <span className="rp-label">Ends</span>
        <Select
          label="Ends"
          value={ends}
          options={[
            ["never", "Never"],
            ["date", "On date"],
            ["count", "After"],
          ]}
          onChange={setEnds}
        />
        {ends === "date" && (
          <input type="date" className="rp-date" aria-label="Last date" min={base} value={rule.until ?? untilDefault} onChange={(e) => e.target.value && put({ until: e.target.value })} />
        )}
        {ends === "count" && (
          <>
            <Stepper value={rule.count ?? 5} max={999} label="times" onChange={(count) => put({ count })} />
            <span className="rp-unit-text">times</span>
          </>
        )}
      </div>

      <p className="rp-summary">{describeRule(final(), base, true)}</p>

      <div className="rp-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn is-primary" onClick={() => onDone(formatRule(final()))}>
          OK
        </button>
      </div>
    </div>
  );
}

/** Quick choices with the custom editor one step in. */
export function RepeatPanel({
  value,
  base,
  onChange,
  onClose,
  side,
}: {
  value: string | null;
  base: string;
  onChange: (repeat: string | null) => void;
  onClose: () => void;
  /** Floating beside the date picker (desktop), or in its flow ("below", phones and narrow windows). */
  side: "right" | "left" | "below";
}) {
  const [custom, setCustom] = useState(false);
  return (
    <div className={`rp-pop is-${side} ${custom ? "is-custom" : ""}`}>
      {custom ? (
        <RepeatCustom
          value={value}
          base={base}
          onCancel={() => setCustom(false)}
          onDone={(r) => {
            onChange(r);
            onClose();
          }}
        />
      ) : (
        <RepeatMenu
          value={value}
          base={base}
          onCustom={() => setCustom(true)}
          onPick={(r) => {
            onChange(r);
            onClose();
          }}
        />
      )}
    </div>
  );
}
