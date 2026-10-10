# Speak focus mode + Practice Room + Calendar + Remix: Plan for approval

Status: **plan only. Code starts after your answers.** Everything stays free.

Fitting the brief to the real app:
- The app is a **Windows desktop app**, not a Claude artifact.
- History is saved in the app's own database on your laptop. That survives restarts and is more reliable than artifact storage. If a save ever fails, the app warns you.
- The AI parts (Remix, "Your turn" corrections) use **your free Gemini key**.
- Part 5 (Weekly Story, Role-play, Weak-sound tracker) is a **later phase**, not built now.

---

## 1. User flows

### Shadowing a line (Movie or YouTube)
1. Click a subtitle line → **🎤 Speak**. The focus panel shows **only the line, in large text**.
2. Pick reps with the stepper (1–14; the app remembers your choice).
3. The **Shadow Ladder** splits your reps into stages. For 14: Listen ×2 → Mumble with text ×3 → Shadow aloud with text ×4 → Shadow without text ×3 → Say from memory ×2. The stage name and counter show at the top (e.g. "Shadow aloud · 2/4").
   - **Listen** reps play the original clip automatically.
   - Other reps: you say the line, then tap **✓** (or the mic checks you; see question 2).
4. **Quiet mode**: mumbled or whispered reps count fully.
5. **"?"** opens meaning, IPA and the Bangla hint. Hidden by default; nothing is deleted.
6. After the last rep: **Next line** (loads the next subtitle and plays it) or **Back to video**. Optional auto-advance.
7. The line is saved as **"shadowed today"** (text, video name, start/end time, date, reps) and enters the Practice Room schedule: first review in 3 days.

### First Practice Room visit
1. Nothing is due yet, so the card says: "Day 1 · You shadowed 10 lines today · First review in 3 days 🌱".
2. A short 3-step explainer: shadow lines → they come back in 3, 7, 14, 30 days → 1 sentence a day keeps your streak.
3. The calendar shows today with a "shadowed" dot and "10".

### A day with a backlog
1. The card shows only **today's share**: "Day 12 · 15 lines for today · Practice time". It never shows "87 overdue".
2. **Review flow per line:**
   1. ▶ Play: the original clip if that movie or video is open, otherwise "AI voice".
   2. Say it **before** seeing the text.
   3. **Reveal**.
   4. 1–2 shadow reps.
   5. Rate **Easy / OK / Hard**.
3. After the **first** line: "✅ Streak kept! Continue (14 left today) or stop any time."
4. Lines beyond today's cap wait for the next days, oldest first.

### Returning after missing 5 days
1. On opening, the app checks the missed days. Up to **2 Streak Shields** per month cover missed days (e.g. 2 shields cover 2 days). If more days were missed than shields remain, the streak restarts gently: "Welcome back! Your streak restarts today; your lines are waiting for you."
2. The due lines from those 5 days are **not** dumped on you: today still shows at most 15 (oldest first), and the rest spread over the next days.

---

## 2. Screens (phone-friendly, big buttons; the same layout widens on the laptop)

**Speak focus panel**
```
┌──────────────────────────────┐
│ Shadow aloud · 2/4     ? ✕   │  stage + counter, "?" help, close
│ ●●●○○ ○○○○ ○○○ ○○            │  ladder progress by stage
│                              │
│   You should have told me    │  the line, large
│   earlier.                   │  (hidden in "no text" stages)
│                              │
│ [▶ Listen]   [Quiet mode ☐]  │
│ [        ✓  I said it      ] │  big button (or 🎤 mic)
│ Reps: [ − ] 14 [ + ]         │
└──────────────────────────────┘
After the last rep: [ Next line ▶ ]  [ Back to video ]  ☐ Auto-advance
```

**Practice Room** (new menu item right after YouTube)
```
Day 12 · 🔥 9-day streak · 🛡 2 shields
┌──────────────────────────────┐
│ 15 lines for today           │
│ [ Practice time ]            │
└──────────────────────────────┘
Tabs:  Today | Calendar
```

**Review card**
```
Line 3 of today
[ ▶ Play ]  (Original clip / AI voice label)
Say it before you see it…        [ Reveal ]
"You should have told me earlier."
Shadow ×2: [✓] [✓]
[ Easy ] [ OK ] [ Hard ]
```

**Calendar**
```
◀ October 2026 ▶
Mo Tu We Th Fr Sa Su
          1  2  3  4
          ·  ●  ◐  ✓     ● shadowed  ◐ reviews due  ✓ all done
          3  10 5  8     (small number = lines learned that day)
Tap a day → list of lines: New / Learning / Mastered
           [Re-shadow] [Remix]
```

**Remix**
```
Phrases from Oct 3: "figure out", "used to", "no way"   ?
1. I finally figured out the bus route.   [🎤 Say ×3]
2. …
Your turn: [ type or say a sentence with one phrase ]
→ AI (Bangla): corrected sentence + one tip
```

---

## 3. Scheduling logic (pseudocode)

```
RUNGS = [3, 7, 14, 30]          # days
DAILY_CAP = settings.dailyCap   # default 15, adjustable
SHIELDS_PER_MONTH = 2

on line shadowed (final rep reached):
    rec = find(line.id) or new record(text, source, start, end)
    rec.dateShadowed ??= today; rec.reps += reps; rec.shadowLog.push(today)
    if rec.status == 'new' or rec.status == 'mastered' (re-shadow):
        rec.rung = 0; rec.nextDue = today + RUNGS[0]; rec.status = 'learning'
    markActive(today)

on review rated (rating):
    rec.ratings.push({date: today, rating})
    if rating == 'Hard':
        rec.rung = 0; rec.nextDue = today + RUNGS[0]
    else:                                 # Easy or OK → next rung
        rec.rung += 1
        if rec.rung >= len(RUNGS): rec.status = 'mastered'; rec.nextDue = null
        else: rec.nextDue = today + RUNGS[rec.rung]
    markActive(today)

todayQueue():
    due = records where status == 'learning' and nextDue <= today
    sort due by nextDue ascending (oldest first), then by dateShadowed
    return first DAILY_CAP of due     # the rest roll over silently; no total shown

markActive(day): activity.add(day)    # 1 line shadowed or reviewed = day kept

updateStreak() on app open:
    for each day d from lastCheckedDay+1 to yesterday:
        if d in activity: streak += 1
        elif shieldsUsed[month(d)] < SHIELDS_PER_MONTH: shieldsUsed[month(d)] += 1   # protected, streak kept
        else: streak = 0
    lastCheckedDay = yesterday
    (today counts once today has activity)

dayNumber = (today - firstShadowDate) + 1          # "Day N"

calendarDot(day):
    if no shadow and no review due/done that day: none
    elif reviews due that day and not all done:    'reviews due'
    elif all due done (or none due) and activity:  'all done'
    elif lines shadowed that day:                  'shadowed'
    count = lines first shadowed that day

lineStatus(rec): 'New' (never reviewed) | 'Learning' | 'Mastered' (passed the 30-day review)
```

**Shadow Ladder split** (reps n = 1…14, stages in order Listen, Mumble+text, Shadow+text, Shadow no text, Memory):
- n = 1: Shadow+text ×1. n = 2: Listen ×1, Shadow+text ×1.
- n ≥ 3: always at least 1 no-text rep at the end (Memory). Remaining reps are spread across stages in proportion 2 : 3 : 4 : 3 : 2, filling Listen and Shadow+text first.
- Example n = 14: 2 · 3 · 4 · 3 · 2. Example n = 5: Listen 1 · Shadow+text 2 · Shadow no text 1 · Memory 1.
