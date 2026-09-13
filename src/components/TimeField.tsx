import { useEffect, useRef, useState } from "preact/hooks";
import { clockHourText, composeClock, parseClock } from "../lib/dates";
import { usesHour12 } from "../lib/locale";

/**
 * A segmented HH:MM entry field.
 *
 * Deliberately not `<input type="time">`: under WebKitGTK that control is
 * unthemeable and only surfaces its value on commit, so a typed time could be
 * dropped. Every keystroke forming a valid time commits immediately, and Enter
 * is swallowed rather than submitting the surrounding form.
 */

const pad = (n: number) => String(n).padStart(2, "0");

interface Props {
  /** Stored 24-hour "HH:mm", or null when unset. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Enter — commit and dismiss the surrounding popover. */
  onDone?: () => void;
  /** Prefix for the segment labels, so paired fields stay distinguishable. */
  label?: string;
  invalid?: boolean;
}

export function TimeField({
  value,
  onChange,
  onDone,
  label,
  invalid = false,
}: Props) {
  const hour12 = usesHour12();
  const initial = parseClock(value);
  const [hourText, setHourText] = useState(() => clockHourText(initial, hour12));
  const [minuteText, setMinuteText] = useState(() =>
    initial ? pad(initial.m) : "",
  );
  const [pm, setPm] = useState(() => (initial ? initial.h >= 12 : false));
  const minuteRef = useRef<HTMLInputElement>(null);

  // Re-sync when the value is changed from outside (a quick-pick chip, or
  // Clear). Skipped when the incoming value is the one we just composed, so
  // this never fights the user mid-keystroke.
  useEffect(() => {
    if (value === composeClock(hourText, minuteText, pm, hour12)) return;
    const next = parseClock(value);
    setHourText(clockHourText(next, hour12));
    setMinuteText(next ? pad(next.m) : "");
    if (next) setPm(next.h >= 12);
  }, [value]);

  /** Push a segment edit upward, but only once it forms a whole time. */
  const commit = (h: string, m: string, afternoon: boolean) => {
    const composed = composeClock(h, m, afternoon, hour12);
    if (composed !== null && composed !== value) onChange(composed);
  };

  const maxHour = hour12 ? 12 : 23;

  const onHourInput = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    setHourText(digits);
    commit(digits, minuteText, pm);
    // Jump to minutes once the hour can't take another digit.
    if (digits.length === 2 || Number(digits) * 10 > maxHour) {
      minuteRef.current?.focus();
      minuteRef.current?.select();
    }
  };

  const onMinuteInput = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    setMinuteText(digits);
    commit(hourText, digits, pm);
  };

  /** Arrow keys nudge a segment; hours by 1, minutes by 5. */
  const step = (segment: "hour" | "minute", delta: number) => {
    if (segment === "hour") {
      const span = hour12 ? 12 : 24;
      const base = hourText === "" ? 0 : Number(hourText) - (hour12 ? 1 : 0);
      const next = (((base + delta) % span) + span) % span;
      const text = hour12 ? String(next + 1) : pad(next);
      setHourText(text);
      commit(text, minuteText, pm);
      return;
    }
    const base = minuteText === "" ? 0 : Number(minuteText);
    const next = (((base + delta) % 60) + 60) % 60;
    const text = pad(next);
    setMinuteText(text);
    commit(hourText, text, pm);
  };

  const onKeyDown = (
    event: KeyboardEvent,
    segment: "hour" | "minute",
  ) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      step(segment, event.key === "ArrowUp" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      // Never let Enter reach the task form — saving the whole task on Enter
      // is exactly the surprise this field exists to remove.
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget as HTMLInputElement).blur();
      onDone?.();
      return;
    }
    if (segment === "hour" && (event.key === ":" || event.key === ".")) {
      event.preventDefault();
      minuteRef.current?.focus();
      minuteRef.current?.select();
    }
  };

  // Leaving the field tidies up partial input: pad a lone digit, and treat a
  // fully cleared hour as "no time".
  const onBlur = () => {
    if (hourText === "") {
      setMinuteText("");
      // Truthiness, not a null check: callers may pass "" for "no time".
      if (value) onChange(null);
      return;
    }
    const composed = composeClock(hourText, minuteText, pm, hour12);
    if (composed === null) {
      // Out-of-range leftovers snap back to the last good value.
      const current = parseClock(value);
      setHourText(clockHourText(current, hour12));
      setMinuteText(current ? pad(current.m) : "");
      return;
    }
    const parsed = parseClock(composed)!;
    setHourText(clockHourText(parsed, hour12));
    setMinuteText(pad(parsed.m));
  };

  const setMeridiem = (afternoon: boolean) => {
    if (afternoon === pm) return;
    setPm(afternoon);
    commit(hourText, minuteText, afternoon);
  };

  // 3ch, not 2: `ch` is the width of a zero and the "HH"/"MM" placeholders are
  // wider than the digits they stand in for.
  const segment =
    "w-[3ch] bg-transparent text-center text-sm tabular-nums text-[var(--color-text)] outline-none placeholder:text-[var(--color-faint)]";
  const name = (part: string) => (label ? `${label} ${part.toLowerCase()}` : part);

  return (
    <div
      class={`flex flex-1 items-center justify-center gap-1 rounded-lg border bg-[var(--color-bg)] px-3 py-2 focus-within:ring-1 ${
        invalid
          ? "border-[var(--color-danger)] ring-1 ring-[var(--color-danger)] focus-within:ring-[var(--color-danger)]"
          : "border-[var(--color-border)] focus-within:ring-[var(--color-accent)]"
      }`}
    >
      <input
        type="text"
        inputMode="numeric"
        aria-label={name("Hour")}
        placeholder="HH"
        value={hourText}
        onInput={(event) => onHourInput(event.currentTarget.value)}
        onKeyDown={(event) => onKeyDown(event, "hour")}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={onBlur}
        class={segment}
      />
      <span class="text-sm text-[var(--color-faint)]">:</span>
      <input
        ref={minuteRef}
        type="text"
        inputMode="numeric"
        aria-label={name("Minute")}
        placeholder="MM"
        value={minuteText}
        onInput={(event) => onMinuteInput(event.currentTarget.value)}
        onKeyDown={(event) => onKeyDown(event, "minute")}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={onBlur}
        class={segment}
      />
      {hour12 && (
        // Two explicit options, not a toggle: a lone "AM" reads as a label and
        // leaves the user guessing whether it's the state or the action.
        <div class="ml-1.5 flex items-center gap-0.5 rounded-md bg-[var(--color-surface-2)] p-0.5">
          {[false, true].map((afternoon) => (
            <button
              key={afternoon ? "PM" : "AM"}
              type="button"
              aria-pressed={afternoon === pm}
              onClick={() => setMeridiem(afternoon)}
              class={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                afternoon === pm
                  ? "bg-[var(--color-accent)] text-white"
                  : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {afternoon ? "PM" : "AM"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
