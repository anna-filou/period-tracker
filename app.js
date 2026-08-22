/* ================================================================
   CONFIG
   ================================================================ */
const CONFIG = {
  // Initial calendar window around today; more months load as you scroll.
  initialMonthsBefore: 6,
  initialMonthsAfter: 6,
  // Hard caps for on-demand scroll (10 years back; future cap = predict months ahead).
  maxMonthsBefore: 10 * 12,
  maxMonthsAfter: 12,       // max value for predict months ahead setting
  defaultCycle: 28,       // fallback until there are >= 2 logged periods
  defaultPeriodLen: 5,    // fallback period length
  averageWindow: 6,       // rolling window: last N periods / N cycles used for all averages
  lutealPhase: 14,        // ovulation = next period start - this many days
  fertileBefore: 5,       // fertile window starts this many days before ovulation
  fertileAfter: 1,        // ...and ends this many days after (so ov-5 .. ov+1 = 7 days)
  // Bleed days separated by at most this many non-bleeding days still count
  // as one period (e.g. day 1 + day 3 with a dry day 2 → one period).
  maxPeriodGapDays: 3,
};

// Allowed values for the "predict months ahead" setting (max = calendar future cap).
const PREDICT_MONTHS_OPTIONS = [3, 6, 12];
// Log list: default number of period rows shown (bar scale uses only visible rows).
const LOG_CYCLES_OPTIONS = [12, 24, "all"];

// User-adjustable settings (Settings tab).
const settings = {
  showFertility: true,    // show ovulation + fertile window (calendar and log)
  weekStartsOn: 1,        // 1 = Monday (default), 0 = Sunday
  predictMonthsAhead: 3,  // how far ahead to project period / fertility markers
  logCyclesShown: 12,     // default log rows: 12, 24, or "all"
  trackFlow: false,       // tap cycles light → medium → heavy → unlog
};

// Flow levels for logged period days (calendar fill height).
const FLOW_LEVELS = ["light", "medium", "heavy"];

// Session-only: user tapped "Show all cycles" in the log (resets when leaving Log).
let logShowAll = false;

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];

/* ================================================================
   STATE
   periodDays  = logged days (the single source of truth)
   predictedDays = DERIVED every time from periodDays; never stored
   ================================================================ */
const periodDays    = new Set();   // "YYYY-MM-DD"
const predictedDays = new Set();   // recomputed on every change
// Days belonging to periods the user has excluded from calculations.
// Kept normalised to hold exactly the days of currently-excluded periods,
// so a day is "excluded" iff its key is in here.
const excludedDays  = new Set();
// Optional flow heaviness per logged day ("light" | "medium" | "heavy").
// Missing key while the day is logged = medium (legacy / default).
const flowByDay = {};
// Fertile window + ovulation, both DERIVED (ovulation = next start - luteal).
const fertileDays   = new Set();
const ovulationDays = new Set();
// Fertile/ovulation days anchored to a *predicted* period start (not yet
// confirmed by a logged period). Styled muted, like predicted period pills.
const predictedFertileDays = new Set();

/* ---- key + date helpers (local time, no timezone drift) ---- */
const pad = (n) => String(n).padStart(2, "0");
const dateKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;   // m is 0-based
const dayKeyOf = (dt) => dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
const isPeriod    = (y, m, d) => periodDays.has(dateKey(y, m, d));
const isPredicted = (y, m, d) => predictedDays.has(dateKey(y, m, d));
const isExcluded  = (y, m, d) => excludedDays.has(dateKey(y, m, d));
const isFertile   = (y, m, d) => fertileDays.has(dateKey(y, m, d));
const isOvulation = (y, m, d) => ovulationDays.has(dateKey(y, m, d));
const isPredictedFertile = (y, m, d) => predictedFertileDays.has(dateKey(y, m, d));
// A "cycle day" is any day belonging to a period run — logged or its
// predicted continuation. Used for pill SHAPE so a logged period and
// its predicted tail form one continuous bar; colour stays per-day.
const isCycleDay  = (y, m, d) => isPeriod(y, m, d) || isPredicted(y, m, d);

function flowLevel(key) {
  const v = flowByDay[key];
  return FLOW_LEVELS.includes(v) ? v : "medium";
}

function setFlowLevel(key, level) {
  if (level === "medium") delete flowByDay[key];
  else flowByDay[key] = level;
}

function clearFlowLevel(key) {
  delete flowByDay[key];
}

const BACKUP_VERSION = 2;

/* Persisted shape: [{ date: "YYYY-MM-DD", flow?: "light"|"heavy" }] — flow omitted = medium. */
function serializePeriodDays() {
  return [...periodDays].sort().map((date) => {
    const flow = flowByDay[date];
    if (flow && flow !== "medium") return { date, flow };
    return { date };
  });
}

function loadPeriodDays(raw, legacyFlowByDay) {
  periodDays.clear();
  for (const k of Object.keys(flowByDay)) delete flowByDay[k];
  if (!Array.isArray(raw)) return 0;

  for (const item of raw) {
    if (typeof item === "string") {
      periodDays.add(item);
    } else if (item && typeof item.date === "string") {
      periodDays.add(item.date);
      if (FLOW_LEVELS.includes(item.flow) && item.flow !== "medium") {
        flowByDay[item.date] = item.flow;
      }
    }
  }

  if (legacyFlowByDay && typeof legacyFlowByDay === "object") {
    for (const [k, v] of Object.entries(legacyFlowByDay)) {
      if (periodDays.has(k) && FLOW_LEVELS.includes(v) && v !== "medium") {
        flowByDay[k] = v;
      }
    }
  }

  return periodDays.size;
}

function isValidPeriodDaysArray(raw) {
  return Array.isArray(raw) && raw.every((item) =>
    typeof item === "string" ||
    (item && typeof item === "object" && typeof item.date === "string"));
}

const FLOW_HEIGHT_RANK = { light: 1, medium: 2, heavy: 3 };

function flowRankForKey(key) {
  return FLOW_HEIGHT_RANK[flowLevel(key)];
}

function flowStepTopClasses(myRank, leftRank, rightRank, prefix) {
  let cls = "";
  if (leftRank != null && myRank > leftRank) cls += ` ${prefix}--round-top-left`;
  if (rightRank != null && myRank > rightRank) cls += ` ${prefix}--round-top-right`;
  return cls;
}

/* Relative bar height for flow step rounding (0 = not a cycle day). */
function flowHeightRank(y, m, d) {
  if (isPeriod(y, m, d)) {
    if (!settings.trackFlow) return FLOW_HEIGHT_RANK.heavy;
    return flowRankForKey(dateKey(y, m, d));
  }
  if (isPredicted(y, m, d)) return FLOW_HEIGHT_RANK.heavy;
  return 0;
}

/* When flow tracking is on, round a bar's top edge where it steps up over
   a shorter neighbour in the same period run. */
function flowStepClasses(year, month, d, lead, total) {
  if (!settings.trackFlow) return "";

  const colIndex = (lead + (d - 1)) % 7;
  const myRank = flowHeightRank(year, month, d);
  if (myRank === 0) return "";

  const connectsLeft  = d > 1     && colIndex !== 0 && isCycleDay(year, month, d - 1);
  const connectsRight = d < total && colIndex !== 6 && isCycleDay(year, month, d + 1);

  return flowStepTopClasses(
    myRank,
    connectsLeft ? flowHeightRank(year, month, d - 1) : null,
    connectsRight ? flowHeightRank(year, month, d + 1) : null,
    "pill",
  );
}

const daysInMonth  = (y, m) => new Date(y, m + 1, 0).getDate();
const firstWeekday = (y, m) => new Date(y, m, 1).getDay();
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
const addDays = (date, n) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const daysBetween = (a, b) => Math.round((b - a) / 86400000);
const startOfToday = () => {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
};

/* ================================================================
   PREDICTION  (all derived from periodDays)
   ================================================================ */

/* Group logged days into periods. Consecutive bleeding days form a run;
   bleeding days separated by at most `maxPeriodGapDays` dry days also merge
   into the same period (so day 1 + day 3 with a gap on day 2 is one period).
   A run that straddles a month boundary still counts as ONE period. */
function groupPeriods() {
  const dates = [...periodDays].sort().map((k) => {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y, m - 1, d);
  });

  const periods = [];
  let run = null;
  for (const dt of dates) {
    // Gap days between last bleed and this one (0 = consecutive).
    const gap = run ? daysBetween(run.end, dt) - 1 : Infinity;
    if (run && gap >= 0 && gap <= CONFIG.maxPeriodGapDays) {
      run.end = dt;
      run.length++;
      run.days.push(dt);
    } else {
      if (run) periods.push(run);
      run = { start: dt, end: dt, length: 1, days: [dt] };
    }
  }
  if (run) periods.push(run);

  // A period is excluded if any of its days is flagged (robust to edits).
  // `span` = calendar length from first to last bleed (includes internal gaps).
  for (const p of periods) {
    p.excluded = p.days.some((dt) => excludedDays.has(dayKeyOf(dt)));
    p.span = daysBetween(p.start, p.end) + 1;
  }
  return periods;
}

/* Average cycle length = mean gap between consecutive period starts.
   A gap counts only when BOTH its endpoints are included — an excluded
   period drops the gaps on either side of it rather than being bridged
   over (which would fuse two cycles into one bogus long one). */
function averageCycle(periods) {
  const gaps = [];
  for (let i = 1; i < periods.length; i++) {
    if (!periods[i - 1].excluded && !periods[i].excluded) {
      gaps.push(daysBetween(periods[i - 1].start, periods[i].start));
    }
  }
  if (gaps.length === 0) return CONFIG.defaultCycle;   // no reliable cycle yet
  const recent = gaps.slice(-CONFIG.averageWindow);    // last N cycles (matches the Log panel)
  return Math.max(1, Math.round(recent.reduce((a, b) => a + b, 0) / recent.length));
}

/* Average period length over the last N INCLUDED periods. Excluded
   periods contribute nothing. Falls back to the default with < 2. */
function averagePeriodLength(periods) {
  const incl = periods.filter((p) => !p.excluded);
  if (incl.length < 2) return CONFIG.defaultPeriodLen;
  const recent = incl.slice(-CONFIG.averageWindow);
  const sum = recent.reduce((acc, p) => acc + p.span, 0);
  return Math.max(1, Math.round(sum / recent.length));
}

/* Rebuild predictedDays from scratch.
   Loop starts at k = 0 (the current period) so the remaining days of
   an in-progress period are predicted too, then k = 1, 2, ... project
   future periods. Only today-or-future days are added, and a logged
   day always wins over a prediction. */
function recomputePredictions() {
  predictedDays.clear();
  fertileDays.clear();
  ovulationDays.clear();
  predictedFertileDays.clear();
  const periods = groupPeriods();

  // Normalise excludedDays so it holds exactly the days of currently-
  // excluded periods (keeps the flag consistent after run edits, and lets
  // rendering test exclusion per-day).
  excludedDays.clear();
  for (const p of periods) {
    if (p.excluded) for (const dt of p.days) excludedDays.add(dayKeyOf(dt));
  }

  if (periods.length === 0) return;

  const cycleLen  = averageCycle(periods);
  const periodLen = averagePeriodLength(periods);
  const anchor    = periods[periods.length - 1].start;

  const today = startOfToday();
  // Horizon is the user-chosen months-ahead setting, clamped to the calendar's
  // future cap so we never predict past months that can't be scrolled to.
  const monthsAhead = Math.min(settings.predictMonthsAhead, CONFIG.maxMonthsAfter);
  const horizon = new Date(
    today.getFullYear(), today.getMonth() + monthsAhead + 1, 0);

  // Every period start (logged, plus the projected future ones) anchors a
  // cycle. Collect them so we can place ovulation / fertile windows.
  const starts = periods.map((p) => p.start);

  // k = 0 is the current period (its remaining days); k = 1, 2, ... project
  // further cycles until we pass the horizon. Safety cap avoids a runaway
  // loop if cycle length is somehow tiny.
  for (let k = 0; k < 36; k++) {
    const start = addDays(anchor, k * cycleLen);
    if (start > horizon) break;
    if (k > 0) starts.push(start);                     // future predicted start
    for (let i = 0; i < periodLen; i++) {
      const dt = addDays(start, i);
      if (dt < today) continue;                         // future-only
      if (dt > horizon) break;
      const key = dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
      if (!periodDays.has(key)) predictedDays.add(key); // logged wins
    }
  }

  // Ovulation sits `lutealPhase` days before each period start; the fertile
  // window spans fertileBefore..fertileAfter around it. Shown for past cycles
  // too (retrospective estimate), so no future-only clamp here.
  //
  // Short cycles: if the estimate would fall on or before the previous period
  // ends, there isn't room for a real luteal phase — skip fertility for that
  // cycle rather than inventing an ovulation (bleeding that close together is
  // often anovulatory or otherwise unreliable).
  if (settings.showFertility) {
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      const ov = addDays(s, -CONFIG.lutealPhase);

      if (i > 0) {
        let prevEnd;
        if (i <= periods.length) {
          // Previous start is a logged period — use its real end date.
          prevEnd = periods[i - 1].end;
        } else {
          // Previous start was predicted — estimate its end from avg period length.
          prevEnd = addDays(starts[i - 1], periodLen - 1);
        }
        // No fertile window if ovulation would land during/before the previous period.
        if (ov <= prevEnd) continue;
      }

      // Also skip if ovulation would land on/after this period start.
      if (ov >= s) continue;

      // Starts beyond the logged list are projected — mute their fertility.
      const predictedAnchor = i >= periods.length;

      ovulationDays.add(dayKeyOf(ov));
      if (predictedAnchor) predictedFertileDays.add(dayKeyOf(ov));
      for (let d = -CONFIG.fertileBefore; d <= CONFIG.fertileAfter; d++) {
        const day = addDays(ov, d);
        if (day >= s) continue;
        if (i > 0) {
          // Don't paint fertile days onto the previous period either.
          let prevEnd;
          if (i <= periods.length) prevEnd = periods[i - 1].end;
          else prevEnd = addDays(starts[i - 1], periodLen - 1);
          if (day <= prevEnd) continue;
        }
        const key = dayKeyOf(day);
        fertileDays.add(key);
        if (predictedAnchor) predictedFertileDays.add(key);
      }
    }
  }
}

/* ================================================================
   RENDER
   ================================================================ */
function renderWeekdayHeader() {
  const header = document.getElementById("weekdays");
  for (let i = 0; i < 7; i++) {
    const idx = (settings.weekStartsOn + i) % 7;
    const span = document.createElement("span");
    span.textContent = WEEKDAY_LETTERS[idx];
    header.appendChild(span);
  }
}

/* Build one pill for day `d`. Each cell keeps its own inset bar; only the
   outside ends of a run are rounded (period, predicted, and fertile). */
function makePill(year, month, d, lead, total, member) {
  const colIndex = (lead + (d - 1)) % 7;            // 0 = first column, 6 = last
  const connectsLeft  = d > 1     && colIndex !== 0 && member(year, month, d - 1);
  const connectsRight = d < total && colIndex !== 6 && member(year, month, d + 1);

  const leftClass  = connectsLeft  ? "" : " pill--round-left";
  const rightClass = connectsRight ? "" : " pill--round-right";

  const pill = document.createElement("div");
  pill.className = "pill pill--segmented" + leftClass + rightClass;
  return pill;
}

function renderMonth(year, month, today) {
  const section = document.createElement("section");
  section.className = "month";
  section.dataset.year = year;
  section.dataset.month = month;

  const label = document.createElement("h2");
  label.className = "month__label";
  label.innerHTML = `${MONTH_NAMES[month]}<span class="year">${year}</span>`;
  section.appendChild(label);

  const grid = document.createElement("div");
  grid.className = "month__grid";

  const lead = (firstWeekday(year, month) - settings.weekStartsOn + 7) % 7;
  for (let i = 0; i < lead; i++) {
    const blank = document.createElement("div");
    blank.className = "cell cell--empty";
    grid.appendChild(blank);
  }

  const total = daysInMonth(year, month);
  for (let d = 1; d <= total; d++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.date = dateKey(year, month, d);

    // precedence: logged period > predicted period > fertile/ovulation
    if (isPeriod(year, month, d)) {
      const pill = makePill(year, month, d, lead, total, isCycleDay);
      if (isExcluded(year, month, d)) pill.classList.add("pill--excluded");
      if (settings.trackFlow) {
        pill.classList.add("pill--flow", "pill--flow-" + flowLevel(dateKey(year, month, d)));
        pill.className += flowStepClasses(year, month, d, lead, total);
      }
      cell.appendChild(pill);
    } else if (isPredicted(year, month, d)) {
      const pill = makePill(year, month, d, lead, total, isCycleDay);
      pill.classList.add("pill--predicted");
      if (settings.trackFlow) pill.className += flowStepClasses(year, month, d, lead, total);
      cell.appendChild(pill);
    } else if (isFertile(year, month, d)) {
      const pill = makePill(year, month, d, lead, total, isFertile);
      pill.classList.add("pill--fertile");
      if (isPredictedFertile(year, month, d)) pill.classList.add("pill--fertile-predicted");
      cell.appendChild(pill);
      if (isOvulation(year, month, d)) {
        const dot = document.createElement("div");
        dot.className = "ovu" +
          (isPredictedFertile(year, month, d) ? " ovu--predicted" : "");
        cell.appendChild(dot);
      }
    }

    const num = document.createElement("span");
    num.className = "num";
    num.textContent = d;
    cell.appendChild(num);

    if (sameDay(new Date(year, month, d), today)) {
      cell.classList.add("cell--today");
      cell.dataset.today = "true";
    }
    grid.appendChild(cell);
  }

  section.appendChild(grid);
  return section;
}

/* ---- Calendar extent (absolute month index = year * 12 + month) ---- */
const ymIndex = (y, m) => y * 12 + m;
const ymParts = (ym) => ({ year: Math.floor(ym / 12), month: ym % 12 });
function todayYM() {
  const t = new Date();
  return ymIndex(t.getFullYear(), t.getMonth());
}
function earliestYM() { return todayYM() - CONFIG.maxMonthsBefore; }
function latestYM()   { return todayYM() + settings.predictMonthsAhead; }

// Inclusive range of months currently in the DOM.
let calStartYM = 0;
let calEndYM = 0;

const LOAD_CHUNK = 3;          // months to add per edge hit
const LOAD_THRESHOLD_PX = 480; // how close to an edge before loading more

function buildCalendar() {
  const calendar = document.getElementById("calendar");
  const today = new Date();
  recomputePredictions();

  const center = todayYM();
  calStartYM = Math.max(earliestYM(), center - CONFIG.initialMonthsBefore);
  calEndYM   = Math.min(latestYM(),   center + CONFIG.initialMonthsAfter);

  for (let ym = calStartYM; ym <= calEndYM; ym++) {
    const { year, month } = ymParts(ym);
    calendar.appendChild(renderMonth(year, month, today));
  }

  scrollToToday("auto");
  ensurePredictionCoverage();
}

/* Make sure enough future months are rendered to show the prediction
   horizon (same cap as latestYM — driven by predict months ahead). */
function ensurePredictionCoverage() {
  const needEnd = latestYM();
  while (calEndYM < needEnd) {
    if (!extendFuture()) break;
  }
}

/* Drop future months beyond the current prediction horizon (e.g. 12 → 3). */
function trimFuture() {
  const calendar = document.getElementById("calendar");
  const maxYM = latestYM();
  let trimmed = false;
  while (calEndYM > maxYM) {
    const last = calendar.lastElementChild;
    if (!last) break;
    last.remove();
    calEndYM--;
    trimmed = true;
  }
  if (trimmed) {
    const maxScroll = calendar.scrollHeight - calendar.clientHeight;
    if (calendar.scrollTop > maxScroll) calendar.scrollTop = Math.max(0, maxScroll);
  }
}

/* Prepend earlier months without jumping the scroll position. */
function extendPast(count = LOAD_CHUNK) {
  const calendar = document.getElementById("calendar");
  const today = new Date();
  const minYM = earliestYM();
  const added = [];
  while (added.length < count && calStartYM > minYM) {
    calStartYM--;
    const { year, month } = ymParts(calStartYM);
    added.push(renderMonth(year, month, today));
  }
  if (added.length === 0) return false;

  // `added` is newest→oldest of the batch; reverse so we insert oldest first.
  added.reverse();
  const prevHeight = calendar.scrollHeight;
  const prevTop = calendar.scrollTop;
  const first = calendar.firstChild;
  for (const el of added) calendar.insertBefore(el, first);
  calendar.scrollTop = prevTop + (calendar.scrollHeight - prevHeight);
  return true;
}

function extendFuture(count = LOAD_CHUNK) {
  const calendar = document.getElementById("calendar");
  const today = new Date();
  const maxYM = latestYM();
  let added = 0;
  while (added < count && calEndYM < maxYM) {
    calEndYM++;
    const { year, month } = ymParts(calEndYM);
    calendar.appendChild(renderMonth(year, month, today));
    added++;
  }
  return added > 0;
}

function maybeExtendCalendar() {
  const calendar = document.getElementById("calendar");
  const { scrollTop, scrollHeight, clientHeight } = calendar;
  if (scrollTop < LOAD_THRESHOLD_PX) {
    if (extendPast()) {
      // Still near the top after prepending — keep filling until we aren't,
      // or we hit the past cap.
      requestAnimationFrame(maybeExtendCalendar);
    }
  } else if (scrollTop + clientHeight > scrollHeight - LOAD_THRESHOLD_PX) {
    if (extendFuture()) requestAnimationFrame(maybeExtendCalendar);
  }
}

/* Re-render every month in place after a change. Logging a day can
   shift all future predictions, so we can't touch just one month.
   Replacing sections one-by-one keeps scroll position (layout height
   is unchanged — pills are overlays). */
function refreshAll() {
  recomputePredictions();
  const today = new Date();
  document.querySelectorAll(".month").forEach((sec) => {
    const y = +sec.dataset.year;
    const m = +sec.dataset.month;
    sec.replaceWith(renderMonth(y, m, today));
  });
  saveState();
}

/* ================================================================
   INTERACTION
   - tap a day  -> toggle it as a logged period day
   - long-press a logged period day (or right-click) -> a menu to
     exclude / include that whole period from calculations
   ================================================================ */
const calEl = document.getElementById("calendar");
calEl.addEventListener("scroll", maybeExtendCalendar, { passive: true });

const isPeriodCell = (cell) => cell && cell.dataset.date && periodDays.has(cell.dataset.date);

/* --- tap to log/unlog or cycle flow (suppressed right after a long-press) --- */
let longPressFired = false;

function togglePeriodDay(key) {
  if (!settings.trackFlow) {
    if (periodDays.has(key)) {
      periodDays.delete(key);
      clearFlowLevel(key);
    } else {
      periodDays.add(key);
    }
    return;
  }

  if (!periodDays.has(key)) {
    periodDays.add(key);
    setFlowLevel(key, "light");
    return;
  }

  const level = flowLevel(key);
  if (level === "light") setFlowLevel(key, "medium");
  else if (level === "medium") setFlowLevel(key, "heavy");
  else {
    periodDays.delete(key);
    clearFlowLevel(key);
  }
}

calEl.addEventListener("click", (e) => {
  if (longPressFired) { longPressFired = false; return; }
  const cell = e.target.closest(".cell");
  if (!cell || cell.classList.contains("cell--empty")) return;

  togglePeriodDay(cell.dataset.date);
  refreshAll();
});

/* --- long-press detection --- */
let lpTimer = null, lpCell = null, lpX = 0, lpY = 0;
function cancelLongPress() {
  if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
  lpCell = null;
}
calEl.addEventListener("pointerdown", (e) => {
  const cell = e.target.closest(".cell");
  if (!isPeriodCell(cell)) return;          // only logged period days
  lpCell = cell; lpX = e.clientX; lpY = e.clientY;
  lpTimer = setTimeout(() => {
    lpTimer = null;
    longPressFired = true;                  // swallow the click that follows
    openPeriodMenu(cell);
  }, 500);
});
calEl.addEventListener("pointermove", (e) => {
  // a scroll/drag cancels the press
  if (lpTimer && (Math.abs(e.clientX - lpX) > 10 || Math.abs(e.clientY - lpY) > 10)) {
    cancelLongPress();
  }
});
calEl.addEventListener("pointerup", cancelLongPress);
calEl.addEventListener("pointercancel", cancelLongPress);

/* desktop: right-click opens the same menu */
calEl.addEventListener("contextmenu", (e) => {
  const cell = e.target.closest(".cell");
  if (!isPeriodCell(cell)) return;
  e.preventDefault();
  openPeriodMenu(cell);
});

/* --- the period menu --- */
function periodForKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  return groupPeriods().find((p) => p.days.some((dt) => sameDay(dt, target)));
}
function rangeLabel(p) {
  const fmt = (dt) => `${MONTH_NAMES[dt.getMonth()].slice(0, 3)} ${dt.getDate()}`;
  return p.span === 1 ? fmt(p.start) : `${fmt(p.start)} \u2013 ${fmt(p.end)}`;
}
function openPeriodMenu(cell) {
  const period = periodForKey(cell.dataset.date);
  if (!period) return;
  closePeriodMenu();

  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.id = "period-scrim";
  // pointerdown (a fresh tap), not click — so the pointer-up that ends the
  // long-press gesture doesn't immediately dismiss the menu it just opened.
  scrim.addEventListener("pointerdown", closePeriodMenu);

  const menu = document.createElement("div");
  menu.className = "menu";

  const title = document.createElement("div");
  title.className = "menu__title";
  title.textContent = `Period · ${rangeLabel(period)}`;
  menu.appendChild(title);

  const btn = document.createElement("button");
  btn.className = "menu__btn " + (period.excluded ? "menu__btn--include" : "menu__btn--exclude");
  btn.textContent = period.excluded ? "Include in calculations" : "Exclude from calculations";
  btn.addEventListener("click", () => {
    togglePeriodExclusion(period);
    closePeriodMenu();
    refreshAll();
  });
  menu.appendChild(btn);

  document.body.appendChild(scrim);
  document.body.appendChild(menu);

  // position near the cell, clamped to the viewport
  const r = cell.getBoundingClientRect();
  menu.style.visibility = "hidden";
  requestAnimationFrame(() => {
    const mw = menu.offsetWidth, mh = menu.offsetHeight, pad = 8;
    let left = r.left + r.width / 2 - mw / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - mw - pad));
    let top = r.bottom + 8;
    if (top + mh > window.innerHeight - pad) top = r.top - mh - 8;  // flip above
    top = Math.max(pad, top);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    menu.style.visibility = "visible";
  });
}
function closePeriodMenu() {
  document.getElementById("period-scrim")?.remove();
  document.querySelector(".menu")?.remove();
  longPressFired = false;
}
function togglePeriodExclusion(period) {
  const flag = !period.excluded;
  for (const dt of period.days) {
    if (flag) excludedDays.add(dayKeyOf(dt));
    else excludedDays.delete(dayKeyOf(dt));
  }
}

/* ================================================================
   LOG VIEW — logged periods as a list (newest first)
   ================================================================ */
const MONTH_ABBR = (dt) => MONTH_NAMES[dt.getMonth()].slice(0, 3);

function formatRange(p) {
  const s = p.start, e = p.end;
  if (p.span === 1) return `${MONTH_ABBR(s)} ${s.getDate()}, ${s.getFullYear()}`;
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth())
    return `${MONTH_ABBR(s)} ${s.getDate()} \u2013 ${e.getDate()}, ${e.getFullYear()}`;
  if (s.getFullYear() === e.getFullYear())
    return `${MONTH_ABBR(s)} ${s.getDate()} \u2013 ${MONTH_ABBR(e)} ${e.getDate()}, ${e.getFullYear()}`;
  return `${MONTH_ABBR(s)} ${s.getDate()}, ${s.getFullYear()} \u2013 ${MONTH_ABBR(e)} ${e.getDate()}, ${e.getFullYear()}`;
}

function logBleedIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("log__bleed-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M12,1.143c0,0-8,8.486-8,13.857c0,4.457,3.543,8,8,8s8-3.543,8-8C20,9.629,12,1.143,12,1.143z");
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);
  return svg;
}

/* Summary stats over the last 6 NON-excluded cycles (a cycle = one
   period start to the next). Returns null if there are no such cycles. */
function cycleStats() {
  const periods = groupPeriods();
  const cycles = [];
  for (let i = 1; i < periods.length; i++) {
    const a = periods[i - 1], b = periods[i];
    if (!a.excluded && !b.excluded) {
      cycles.push({ len: daysBetween(a.start, b.start), plen: a.span });
    }
  }
  const recent = cycles.slice(-CONFIG.averageWindow);   // last N cycles (same window as the forecast)
  if (recent.length === 0) return null;

  const lens  = recent.map((c) => c.len);
  const plens = recent.map((c) => c.plen);
  const mean  = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    avgCycle:  Math.round(mean(lens)),
    avgPeriod: Math.round(mean(plens)),
    variation: Math.max(...lens) - Math.min(...lens),
    n: recent.length,
  };
}

function statTile(value, label, title) {
  const tile = document.createElement("div");
  tile.className = "stat";
  if (title) tile.title = title;
  const val = document.createElement("div");
  val.className = "stat__value";
  val.textContent = value;
  const unit = document.createElement("span");
  unit.className = "stat__unit";
  unit.textContent = value === 1 ? "day" : "days";
  val.appendChild(unit);
  const lab = document.createElement("div");
  lab.className = "stat__label";
  lab.textContent = label;
  tile.append(val, lab);
  return tile;
}

/* Cycle bar for a log row. Completed cycles use logged episode span; the
   open (current) cycle extends the episode to avg period length and marks
   remaining bleed days + fertility as predicted. */
function buildCycleBar(p, cyc, maxCycle, { open, episodeLen } = {}) {
  const bleedKeys = new Set(p.days.map(dayKeyOf));
  const span = open ? episodeLen : p.span;
  const useFlow = settings.trackFlow;

  const cycle = document.createElement("div");
  cycle.className = "log__cycle";

  const bar = document.createElement("div");
  bar.className = "cyclebar" + (open ? " cyclebar--open" : "") + (useFlow ? " cyclebar--flow" : "");

  const fill = document.createElement("div");
  fill.className = "cyclebar__fill";
  fill.style.width = (cyc / maxCycle) * 100 + "%";

  /* For flow step rounding, compare with the nearest bleed or predicted day
     in the episode, skipping internal gap segments (same rule as the calendar). */
  function episodeFlowNeighborRank(offset, dir) {
    for (let i = offset + dir; i >= 0 && i < span; i += dir) {
      const day = addDays(p.start, i);
      const key = dayKeyOf(day);
      if (bleedKeys.has(key)) return flowRankForKey(key);
      if (open && (predictedDays.has(key) || day > p.end)) return FLOW_HEIGHT_RANK.heavy;
    }
    return null;
  }

  const episode = document.createElement("div");
  episode.className = "cyclebar__episode";
  episode.style.width = Math.min(1, span / cyc) * 100 + "%";
  for (let d = 0; d < span; d++) {
    const day = addDays(p.start, d);
    const key = dayKeyOf(day);
    let kind;
    if (bleedKeys.has(key)) kind = "bleed";
    else if (open && (predictedDays.has(key) || day > p.end)) kind = "predicted";
    else kind = "gap";
    const seg = document.createElement("div");
    seg.className = `cyclebar__seg cyclebar__seg--${kind}`;

    if (kind === "gap") {
      seg.classList.add("cyclebar__seg--flow-host");
      const gapFill = document.createElement("div");
      gapFill.className = "cyclebar__gap-fill";
      seg.appendChild(gapFill);
    } else if (useFlow && (kind === "bleed" || kind === "predicted")) {
      seg.classList.add("cyclebar__seg--flow-host");
      const level = kind === "bleed" ? flowLevel(key) : "heavy";
      const myRank = FLOW_HEIGHT_RANK[level];
      const fillEl = document.createElement("div");
      fillEl.className = "cyclebar__flow-fill cyclebar__flow-fill--" + level;
      fillEl.className += flowStepTopClasses(
        myRank,
        episodeFlowNeighborRank(d, -1),
        episodeFlowNeighborRank(d, 1),
        "cyclebar__flow-fill",
      );
      seg.appendChild(fillEl);
    }

    episode.appendChild(seg);
  }
  const rest = document.createElement("div");
  rest.className = "cyclebar__rest";
  fill.append(episode, rest);
  bar.appendChild(fill);

  if (settings.showFertility) {
    const ovOffset = cyc - CONFIG.lutealPhase;
    if (ovOffset >= span && ovOffset < cyc) {
      const fStart = Math.max(span, ovOffset - CONFIG.fertileBefore);
      const fEnd   = Math.min(cyc, ovOffset + CONFIG.fertileAfter + 1);
      if (fEnd > fStart) {
        const band = document.createElement("div");
        band.className = "cyclebar__fertile" + (open ? " cyclebar__fertile--predicted" : "");
        band.style.left  = (fStart / maxCycle) * 100 + "%";
        band.style.width = ((fEnd - fStart) / maxCycle) * 100 + "%";
        bar.appendChild(band);
      }
      const ov = document.createElement("div");
      ov.className = "cyclebar__ov" + (open ? " cyclebar__ov--predicted" : "");
      ov.style.left = ((ovOffset + 0.5) / maxCycle) * 100 + "%";
      bar.appendChild(ov);
    }
  }

  cycle.appendChild(bar);
  return cycle;
}

function legendItem(label, swatchClass) {
  const item = document.createElement("div");
  item.className = "legend__item";
  const swatch = document.createElement("span");
  swatch.className = "legend__swatch " + swatchClass;
  swatch.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = label;
  item.append(swatch, text);
  return item;
}

function buildLogLegend() {
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.append(
    legendItem("Period", "legend__swatch--bleed"),
    legendItem("Cycle", "legend__swatch--rest"),
  );
  if (settings.showFertility) {
    legend.append(
      legendItem("Fertile window", "legend__swatch--fertile"),
      legendItem("Ovulation", "legend__swatch--ov"),
    );
  }
  return legend;
}

/* Newest-first indices of period rows to render in the log. Bar scale uses
   only these rows so an ancient outlier doesn't shrink recent cycles. */
function logVisibleIndices(periodCount) {
  if (logShowAll || settings.logCyclesShown === "all") {
    const all = [];
    for (let i = periodCount - 1; i >= 0; i--) all.push(i);
    return all;
  }
  const limit = Math.min(settings.logCyclesShown, periodCount);
  const indices = [];
  for (let i = periodCount - 1; i >= periodCount - limit; i--) indices.push(i);
  return indices;
}

function maxCycleForLogRows(cycles, predictedCyc, indices, openIndex) {
  let max = 1;
  for (const i of indices) {
    const c = cycles[i] ?? (i === openIndex ? predictedCyc : null);
    if (c != null) max = Math.max(max, c);
  }
  return max;
}

function buildLog() {
  const log = document.getElementById("log");
  log.replaceChildren();

  recomputePredictions();
  const periods = groupPeriods();             // oldest -> newest
  if (periods.length === 0) {
    const empty = document.createElement("div");
    empty.className = "log__empty";
    empty.innerHTML = "No periods logged yet.<br>Tap days on the calendar to log one.";
    log.appendChild(empty);
    return;
  }

  // Summary panel over the last 6 cycles (only when there's at least one).
  const stats = cycleStats();
  if (stats) {
    const panel = document.createElement("div");
    panel.className = "stats";

    const note = document.createElement("div");
    note.className = "stats__note";
    const n = stats.n;
    note.textContent = n >= CONFIG.averageWindow
      ? `Based on last ${CONFIG.averageWindow} cycles`
      : `Based on last ${n} ${n === 1 ? "cycle" : "cycles"}`;
    panel.appendChild(note);

    const tiles = document.createElement("div");
    tiles.className = "stats__tiles";
    tiles.append(
      statTile(stats.avgCycle,  "Avg cycle"),
      statTile(stats.avgPeriod, "Avg period"),
      statTile(stats.variation, "Variation", "Longest \u2212 shortest cycle"),
    );
    panel.appendChild(tiles);

    log.appendChild(panel);
  }

  log.appendChild(buildLogLegend());

  // Cycle length for each period = its start -> the NEXT period's start.
  // The newest period has no next period yet — use the rolling average instead.
  const predictedCyc = averageCycle(periods);
  const predictedPeriodLen = averagePeriodLength(periods);
  const cycles = periods.map((p, i) =>
    i < periods.length - 1 ? daysBetween(p.start, periods[i + 1].start) : null);

  const openIndex = periods.length - 1;
  const visible = logVisibleIndices(periods.length);
  const maxCycle = maxCycleForLogRows(cycles, predictedCyc, visible, openIndex);

  // Render newest first, grouped by period-start year.
  let currentYear = null;
  for (const i of visible) {
    const p = periods[i];
    const cyc = cycles[i];
    const isOpen = i === openIndex;
    const barCyc = cyc ?? predictedCyc;
    const year = p.start.getFullYear();

    if (year !== currentYear) {
      currentYear = year;
      const heading = document.createElement("div");
      heading.className = "log__year";
      heading.textContent = year;
      log.appendChild(heading);
    }

    const row = document.createElement("div");
    row.className = "log__row" + (p.excluded ? " log__row--excluded" : "");

    // top line: period span • date range … cycle length
    const top = document.createElement("div");
    top.className = "log__top";

    const meta = document.createElement("div");
    meta.className = "log__meta";

    const bleed = document.createElement("span");
    bleed.className = "log__bleed";
    bleed.append(String(p.span), logBleedIcon());

    const sep = document.createElement("span");
    sep.className = "log__sep";
    sep.textContent = "\u2022";

    const range = document.createElement("span");
    range.className = "log__range";
    range.textContent = formatRange(p);

    meta.append(bleed, sep, range);
    if (p.excluded) {
      const badge = document.createElement("span");
      badge.className = "log__badge";
      badge.textContent = "Excluded";
      meta.appendChild(badge);
    }

    const cycleLen = document.createElement("span");
    cycleLen.className = "log__cycle-len" + (isOpen ? " log__cycle-len--current" : "");
    cycleLen.textContent = isOpen ? "Current" : `${cyc} days`;

    top.append(meta, cycleLen);
    row.appendChild(top);

    if (cyc != null) {
      row.appendChild(buildCycleBar(p, cyc, maxCycle));
    } else if (isOpen) {
      row.appendChild(buildCycleBar(p, barCyc, maxCycle, {
        open: true,
        episodeLen: predictedPeriodLen,
      }));
    }

    log.appendChild(row);
  }

  const hidden = periods.length - visible.length;
  if (hidden > 0) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "log__show-all";
    btn.textContent = hidden === 1
      ? "Show all cycles (1 older)"
      : `Show all cycles (${hidden} older)`;
    btn.addEventListener("click", () => {
      logShowAll = true;
      buildLog();
    });
    log.appendChild(btn);
  }
}

/* ================================================================
   TABS
   ================================================================ */
function scrollToToday(behavior = "smooth") {
  const todayCell = document.querySelector('#calendar [data-today="true"]');
  if (todayCell) todayCell.scrollIntoView({ block: "center", behavior });
}

function switchView(name) {
  if (name !== "log") logShowAll = false;
  document.getElementById("view-calendar").hidden = name !== "calendar";
  document.getElementById("view-log").hidden = name !== "log";
  document.getElementById("view-settings").hidden = name !== "settings";
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("tab--active", t.dataset.view === name));
  if (name === "log") buildLog();   // always fresh from current data
}
document.querySelector(".tabbar").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  const name = tab.dataset.view;
  // Re-tapping Calendar while already there jumps back to today.
  if (name === "calendar" && tab.classList.contains("tab--active")) {
    scrollToToday();
    return;
  }
  switchView(name);
});

/* Rebuild the calendar from scratch (used when the week start changes,
   which reshapes the weekday header and every month's leading offset). */
function rebuildCalendar() {
  document.getElementById("weekdays").replaceChildren();
  document.getElementById("calendar").replaceChildren();
  renderWeekdayHeader();
  buildCalendar();
}

/* Reflect current settings values in the controls (used on init and
   after a restore). */
function syncSettingsUI() {
  const fert = document.getElementById("set-fertility");
  if (fert) fert.checked = settings.showFertility;
  const flow = document.getElementById("set-flow");
  if (flow) flow.checked = settings.trackFlow;
  document.querySelectorAll("#set-weekstart .seg").forEach((b) =>
    b.classList.toggle("seg--active", Number(b.dataset.val) === settings.weekStartsOn));
  document.querySelectorAll("#set-predict .seg").forEach((b) =>
    b.classList.toggle("seg--active", Number(b.dataset.val) === settings.predictMonthsAhead));
  document.querySelectorAll("#set-logcycles .seg").forEach((b) => {
    const val = b.dataset.val === "all" ? "all" : Number(b.dataset.val);
    b.classList.toggle("seg--active", val === settings.logCyclesShown);
  });
}

function setStatus(msg, kind) {
  const el = document.getElementById("set-status");
  el.textContent = msg;
  el.className = "setnote" + (kind ? " setnote--" + kind : "");
  el.hidden = !msg;
}

/* Download the source-of-truth state as a JSON file. */
function exportBackup() {
  try {
    const data = {
      app: "cycle", v: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      periodDays:   serializePeriodDays(),
      excludedDays: [...excludedDays],
      settings: {
        showFertility: settings.showFertility,
        weekStartsOn:  settings.weekStartsOn,
        predictMonthsAhead: settings.predictMonthsAhead,
        logCyclesShown: settings.logCyclesShown,
        trackFlow: settings.trackFlow,
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hema-backup-${dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("Backup downloaded.", "ok");
  } catch (e) {
    setStatus("Couldn't create the backup here (try the downloaded app).", "err");
  }
}

/* Read a backup file and OVERRIDE all current state with it. Rejects a
   file that doesn't look like a backup, so a wrong pick can't wipe data. */
function restoreBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch (e) { setStatus("That file isn't valid JSON.", "err"); return; }

    if (!data || !isValidPeriodDaysArray(data.periodDays)) {
      setStatus("That doesn't look like a Hema backup.", "err");
      return;
    }

    const dayCount = data.periodDays.filter((item) =>
      typeof item === "string" || (item && typeof item.date === "string")).length;
    const daysLabel = `${dayCount} logged day${dayCount === 1 ? "" : "s"}`;
    if (!confirm(`Restore this backup (${daysLabel})? All current data on this device will be replaced.`)) {
      return;
    }

    loadPeriodDays(data.periodDays, data.flowByDay);
    excludedDays.clear();
    (Array.isArray(data.excludedDays) ? data.excludedDays : []).forEach((k) => excludedDays.add(k));
    if (data.settings) {
      if (typeof data.settings.showFertility === "boolean") settings.showFertility = data.settings.showFertility;
      if (data.settings.weekStartsOn === 0 || data.settings.weekStartsOn === 1) settings.weekStartsOn = data.settings.weekStartsOn;
      if (PREDICT_MONTHS_OPTIONS.includes(data.settings.predictMonthsAhead)) {
        settings.predictMonthsAhead = data.settings.predictMonthsAhead;
      }
      if (LOG_CYCLES_OPTIONS.includes(data.settings.logCyclesShown)) {
        settings.logCyclesShown = data.settings.logCyclesShown;
      }
      if (typeof data.settings.trackFlow === "boolean") settings.trackFlow = data.settings.trackFlow;
    }

    logShowAll = false;
    rebuildCalendar();     // recompute + re-render with the restored week start
    syncSettingsUI();
    saveState();
    const n = groupPeriods().length;
    setStatus(`Restored ${n} period${n === 1 ? "" : "s"}.`, "ok");
  };
  reader.onerror = () => setStatus("Couldn't read that file.", "err");
  reader.readAsText(file);
}

/* ================================================================
   SETTINGS WIRING
   ================================================================ */
function initSettings() {
  syncSettingsUI();

  document.getElementById("set-fertility").addEventListener("change", (e) => {
    settings.showFertility = e.target.checked;
    refreshAll();                 // recompute (gates the sets) + re-render calendar
  });

  document.getElementById("set-flow").addEventListener("change", (e) => {
    settings.trackFlow = e.target.checked;
    saveState();
    refreshAll();
  });

  document.getElementById("set-weekstart").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg");
    if (!btn) return;
    const val = Number(btn.dataset.val);
    if (val === settings.weekStartsOn) return;
    settings.weekStartsOn = val;
    syncSettingsUI();
    rebuildCalendar();
    saveState();
  });

  document.getElementById("set-predict").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg");
    if (!btn) return;
    const val = Number(btn.dataset.val);
    if (!PREDICT_MONTHS_OPTIONS.includes(val) || val === settings.predictMonthsAhead) return;
    settings.predictMonthsAhead = val;
    syncSettingsUI();
    refreshAll();
    trimFuture();
    ensurePredictionCoverage();
    saveState();
  });

  document.getElementById("set-logcycles").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg");
    if (!btn) return;
    const val = btn.dataset.val === "all" ? "all" : Number(btn.dataset.val);
    if (!LOG_CYCLES_OPTIONS.includes(val) || val === settings.logCyclesShown) return;
    settings.logCyclesShown = val;
    logShowAll = false;
    syncSettingsUI();
    if (!document.getElementById("view-log").hidden) buildLog();
    saveState();
  });

  // backup & restore
  document.getElementById("set-export").addEventListener("click", exportBackup);
  const fileInput = document.getElementById("set-file");
  document.getElementById("set-restore").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) restoreBackup(file);
    e.target.value = "";          // allow re-selecting the same file
  });
}

/* ================================================================
   PERSISTENCE (localStorage)
   Only the source-of-truth state is stored: logged days (date + optional flow),
   excluded days, and settings. Everything else (predictions, fertile/ovulation) is
   re-derived on load. All access is wrapped so a sandboxed preview that
   blocks storage simply runs in-memory instead of breaking.
   ================================================================ */
const STORAGE_KEY = "cycle.v1";

function saveState() {
  try {
    for (const k of Object.keys(flowByDay)) {
      if (!periodDays.has(k)) delete flowByDay[k];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: BACKUP_VERSION,
      periodDays:   serializePeriodDays(),
      excludedDays: [...excludedDays],
      settings: {
        showFertility: settings.showFertility,
        weekStartsOn:  settings.weekStartsOn,
        predictMonthsAhead: settings.predictMonthsAhead,
        logCyclesShown: settings.logCyclesShown,
        trackFlow: settings.trackFlow,
      },
    }));
  } catch (e) {
    /* storage unavailable (sandboxed preview) — in-memory only */
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    const hadLegacyShape = Array.isArray(data.periodDays) &&
      (data.periodDays.some((item) => typeof item === "string") || data.flowByDay);

    loadPeriodDays(data.periodDays, data.flowByDay);

    if (Array.isArray(data.excludedDays)) {
      excludedDays.clear();
      data.excludedDays.forEach((k) => excludedDays.add(k));
    }
    if (data.settings) {
      if (typeof data.settings.showFertility === "boolean") {
        settings.showFertility = data.settings.showFertility;
      }
      if (data.settings.weekStartsOn === 0 || data.settings.weekStartsOn === 1) {
        settings.weekStartsOn = data.settings.weekStartsOn;
      }
      if (PREDICT_MONTHS_OPTIONS.includes(data.settings.predictMonthsAhead)) {
        settings.predictMonthsAhead = data.settings.predictMonthsAhead;
      }
      if (LOG_CYCLES_OPTIONS.includes(data.settings.logCyclesShown)) {
        settings.logCyclesShown = data.settings.logCyclesShown;
      }
      if (typeof data.settings.trackFlow === "boolean") {
        settings.trackFlow = data.settings.trackFlow;
      }
    }

    if (hadLegacyShape) saveState();
  } catch (e) {
    /* storage unavailable or corrupt — start fresh in-memory */
  }
}

loadState();
renderWeekdayHeader();
buildCalendar();
initSettings();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* registration can fail on file:// or unsupported hosts — app still works online */
    });
  });
}
