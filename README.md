# Loading Indicator Experiment

A React + Vite research experiment comparing three loading indicators:

1. **Skeleton Screen** — realistic content placeholders.
2. **Loading Spinner** — a circular indeterminate animation.
3. **Progress Bar** — a determinate bar that advances from 0% to 100%.

Each participant completes all three conditions exactly once in a randomized order, answers a short questionnaire inside the app after each trial, completes a final comparison questionnaire, and sends one combined WhatsApp message to the researcher.

The experiment always uses an 8-second loading duration. The duration is **not shown to participants**, and there is no countdown or elapsed-time display.

---

## Quick start

Requirements: Node.js 18 or newer (tested with Node 24), npm, and a current browser.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To test the production build:

```bash
npm run build
npm run preview
```

Use `?preview=1` for a full walkthrough without touching real participant data. Preview sessions use a separate storage namespace, show a preview banner, and disable opening WhatsApp so sample data cannot be sent.

For researcher data access, use `?researcher=1`. Researcher mode can inspect and export the active participant session. Do not share either URL with participants.

---

## Project structure

```text
.
├── index.html
├── vite.config.js
├── src/
│   ├── App.jsx          Experiment flow, persistence, timing and UI
│   ├── config.js        Study and WhatsApp configuration (edit this)
│   ├── questionnaire.js Question definitions, validation and message builder
│   ├── main.jsx
│   └── styles.css
└── README.md
```

---

## Experiment flow

1. **Participant information and consent** — an anonymous participant ID is generated automatically.
2. **Instructions** — explains the three randomized trials, in-app questionnaires and WhatsApp submission.
3. **Three loading trials** — one skeleton, one spinner and one progress bar, each exactly once, in a newly shuffled order for each participant.
4. **Questionnaire after every trial** — completed directly on the page. The current condition is detected automatically and shown as Q1.
5. **Final comparison** — six required questions plus one optional comments question.
6. **WhatsApp review** — one complete message is generated locally. The participant reviews it, opens WhatsApp, presses Send manually, and confirms that they sent it.
7. **Completion** — shows the same participant ID and thanks the participant.

### Controls implemented

- **Automatic anonymous ID**: generated with `crypto.getRandomValues` and stored throughout the session. No names or email addresses are requested. Example: `LDI-8XK2P9Q4`.
- **Per-participant randomization**: each fresh participant session shuffles the three conditions independently and stores the order.
- **Exactly once per condition**: the state machine advances only through the stored order, and completed trial results block a repeat start.
- **8-second loading**: measured from the start click with `performance.now()`. The visible progress indicator and completion are driven by measured elapsed time.
- **Timer-delay handling**: timer ticks compare against `performance.now()` rather than counting ticks. If the browser throttles or backgrounds the tab, the actual elapsed duration is recorded for quality checks.
- **Duplicate-start protection**: the start handler updates the persisted stage synchronously, so rapid double-clicks cannot start two trials.
- **In-app questionnaire gating**: all required questions must be answered before the participant can continue. Answers are saved as a draft on the device as the participant works.
- **Refresh recovery**: state is persisted in `localStorage`. Refreshing during a loading trial shows an explicit interrupted screen and restarts **the same trial with the same order**; it does not silently rerandomize or skip a condition. Questionnaire drafts, the final comparison and the generated WhatsApp message also survive refresh.
- **Separate timing metadata**: trial timing and interaction events are stored under their own storage key. Questionnaire answers are stored in the participant state because they are now collected by the app.
- **Preview isolation**: `?preview=1` uses a separate `loading-indicator-study:preview:` storage namespace and a visible preview banner, so prototype walkthroughs cannot overwrite or mix with real participant state on the same browser.
- **Technical failure reporting**: a footer dialog records a local, anonymized problem report, supports copying it, and can open an email to an optional researcher address.
- **Researcher tools**: open the app with `?researcher=1` to see a footer action for session summaries, JSON exports and a new-participant reset. The same tools are available in preview mode.

---

## Integrated questionnaires

### After each trial

| # | Question | Input | Required |
|---|----------|-------|----------|
| 1 | Which loading indicator did you experience? | Detected automatically | Yes |
| 2 | How long did the loading experience feel? | Dropdown, 1–15 seconds or “More than 15 seconds” | Yes |
| 3 | The loading indicator clearly communicated the loading state. | 5-point agreement scale | Yes |
| 4 | I understood what the application was doing while loading. | 5-point agreement scale | Yes |
| 5 | The application felt responsive during the loading process. | 5-point agreement scale | Yes |
| 6 | I was satisfied with the loading experience. | 5-point agreement scale | Yes |

Agreement scale: `Strongly Disagree`, `Disagree`, `Neither Agree nor Disagree`, `Agree`, `Strongly Agree`.

The questionnaire shows how many required questions have been answered and displays an error summary if the participant tries to continue too early.

### Final comparison

| # | Question | Input | Required |
|---|----------|-------|----------|
| 1 | Which loading indicator did you prefer overall? | Skeleton Screen / Loading Spinner / Progress Bar | Yes |
| 2 | Which loading indicator communicated the loading state most clearly? | Skeleton Screen / Loading Spinner / Progress Bar | Yes |
| 3 | Which loading indicator made the waiting time feel shortest? | Skeleton Screen / Loading Spinner / Progress Bar | Yes |
| 4 | Which loading indicator made the application feel most responsive? | Skeleton Screen / Loading Spinner / Progress Bar | Yes |
| 5 | Overall, how would you rate your experience with the three loading indicators? | 1–5 rating | Yes |
| 6 | Would you prefer to see your favourite loading indicator in other web applications? | Yes / No / Not Sure | Yes |
| 7 | Do you have any additional comments or suggestions about the loading indicators? | Paragraph | No |

Question 7 is the only optional question and the only free-text question.

---

## WhatsApp submission

After the final questionnaire is submitted, the app builds one plain-text message containing:

- the anonymous participant ID and submission date;
- for each trial: condition, measured loading duration in milliseconds, perceived waiting time, and the four agreement ratings;
- the final comparison answers;
- optional comments.

The participant can review the complete message in the app, copy it, open WhatsApp with a pre-filled click-to-chat link, press Send manually, and then confirm that they sent it.

Important behavior:

- **Nothing is sent automatically.** Opening WhatsApp does not submit anything and does not complete the session.
- **The app cannot verify delivery.** The completion screen explicitly states this. The researcher receives the message only after the participant presses Send.
- **Opening the link is recorded** as an interaction event and an open count, but it never counts as a submission.
- **The participant must confirm sending** before the session can be completed.
- **The WhatsApp number is configuration only.** It is not stored in participant state or exported as participant data.
- **WhatsApp reveals the sender’s number to the researcher** when the participant sends the message. The app itself does not collect or store phone numbers.
- **Copy Message is a fallback** if the participant cannot use the click-to-chat link.

### Configure the WhatsApp number

Edit `src/config.js`:

```js
export const STUDY_CONFIG = {
  loadingDurationMs: 8000,
  supportEmail: '',
  whatsappNumber: '917892448620',
};
```

The provided local number was `7892448620`. It is currently configured as `917892448620`, assuming the India country code `91`. WhatsApp click-to-chat links require the full international number, digits only, without `+`, spaces or hyphens. **Confirm the country code before recruiting.** If the number is not Indian, replace `whatsappNumber` with the correct full international number.

Leave `whatsappNumber` empty to disable the WhatsApp button while still allowing participants to copy the message. Optionally set `supportEmail` to a researcher address so the technical-problem dialog can offer a `mailto:` link.

---

## Data and quality checks

### Where data lives

Participant state and timing metadata are stored in browser `localStorage`:

- `loading-indicator-study:state:v1` — active participant state, including questionnaire answers and the generated WhatsApp message.
- `loading-indicator-study:timing:<participantId>` — chronological timing and interaction events.
- `loading-indicator-study:archive:<participantId>` — archived state after a researcher reset.
- `loading-indicator-study:preview:*` — the same record types for `?preview=1` sessions, kept separate from participant data.

Each trial record contains:

- trial number and condition;
- start and completion timestamps;
- actual measured duration in milliseconds;
- target duration;
- timer overshoot;
- total time spent hidden if the tab was backgrounded;
- the questionnaire answers for that trial.

Timing events record consent, instructions acknowledgement, trial starts/restarts, reload interruptions, loaded-content continuation, questionnaire submissions, final submission, WhatsApp message generation/opening/copying/send confirmation, technical reports and study completion.

### Researcher access

Open the deployed app with `?researcher=1`, then choose **Researcher data** in the footer. From there you can:

- inspect the current session, randomized order, interruptions, questionnaire answers, generated message and WhatsApp open/send status;
- download the current session as JSON;
- download all locally archived sessions and timing events;
- start a new participant session after archiving the current one.

For a full workflow preview without touching participant data, open `?preview=1`. Preview sessions use the separate `loading-indicator-study:preview:` namespace and show a visible preview banner. Preview mode cannot see or modify the real participant session in the same browser, and it cannot open the real WhatsApp link.

Timing and questionnaire data are local to the browser/device. For a lab, download it at the end of each session. Use **Start new participant session** before the next participant, or use a fresh private/incognito window for each participant. Clearing site data also clears records that have not been exported.

---

## Testing report

Tested on 16 November 2026 against the production build.

- **Build**: `npm run build` succeeded with Vite 6.4.6. Output: `dist/index.html` (0.76 kB), `dist/assets/index-CsYfO6oF.css` (24.93 kB), `dist/assets/index-DPdux21t.js` (196.58 kB).
- **Integrated production suite**: **154 passing assertions in 5 suites**, run against `dist/` in headless Chrome. The WhatsApp click-to-chat destination was mocked; no real WhatsApp message was sent.
- **Full three-trial flow**: randomized order `skeleton → progress → spinner`; measured durations **8011 ms, 8018 ms and 8012 ms** against the 8000 ms target. Exactly three trial records were created, one per condition.
- **Questionnaire validation**: each trial questionnaire and the final questionnaire blocked submission while required answers were missing. All required answers were stored correctly.
- **Refresh persistence**: trial questionnaire drafts, final questionnaire choices, comments, the generated WhatsApp message and WhatsApp open count survived refresh.
- **WhatsApp message**: one complete message was generated with the participant ID, submission date, all three trials, measured durations, questionnaire answers, final preferences and optional comments. Special characters were encoded correctly in the click-to-chat URL.
- **Manual-send behavior**: the link opened a mocked `wa.me` URL in a new tab. Opening it recorded one open event but did not complete the session or set a send confirmation. The completion button stayed locked until the participant ticked the send confirmation.
- **Copy Message**: copied the complete message to the clipboard. The test normalized Windows clipboard CRLF line endings before comparison.
- **Preview isolation**: a complete preview flow used a different participant ID, showed the preview marker, disabled the real WhatsApp link, and did not modify the completed normal session.
- **Mobile layout**: at 390 × 844 CSS pixels, the consent, ready, loading, questionnaire and WhatsApp review screens had no horizontal overflow.
- **Browser health**: 0 page errors, 0 app-origin console errors and 0 same-origin failed requests across the normal, preview and mobile contexts.
- **No external survey service**: the app contains no external questionnaire links or submission URLs.

Not covered automatically: sending a real WhatsApp message from a real phone and confirming the researcher receives it. Run a pilot with the final number before recruitment.

---

## Manual pre-recruitment checklist

- [ ] Confirm the WhatsApp number’s country code and update `whatsappNumber` in `src/config.js` if needed.
- [ ] Optionally set `supportEmail`.
- [ ] Run `npm run build`.
- [ ] Preview the complete flow with `?preview=1`, including all three trials, all questionnaires and the WhatsApp review.
- [ ] Confirm that preview mode does not open WhatsApp and that the sample message is marked as preview data.
- [ ] Pilot the full flow in a fresh browser: consent → three trials → three questionnaires → final comparison → WhatsApp → completion.
- [ ] Send a real pilot message and confirm the researcher receives it with the correct participant ID and answers.
- [ ] Confirm that opening WhatsApp without pressing Send does not complete the session.
- [ ] Test the technical-problem dialog and confirm where reports are stored.
- [ ] Test a refresh during loading and confirm the interrupted screen appears.
- [ ] Test on a phone-sized viewport and on the devices you will recruit with.
- [ ] Download and verify the session JSON after the pilot.
- [ ] Do not share the `?researcher=1` or `?preview=1` links with participants.

---

## Deployment

The app is a static Vite site. No backend is required; the WhatsApp message is generated in the browser and sent manually by the participant.

### Netlify

1. Run `npm run build`.
2. Drag the `dist` folder into Netlify, or connect the repository with:
   - Build command: `npm run build`
   - Publish directory: `dist`
3. Open the deployed URL, add `?researcher=1` for your own checks, and test one complete WhatsApp flow. Use `?preview=1` for a walkthrough that stays separate from participant data.

### Vercel

1. Import the repository.
2. Framework preset: Vite.
3. Build command: `npm run build`; output directory: `dist`.
4. Deploy and verify the WhatsApp flow in a fresh browser.

### Cloudflare Pages

- Framework preset: Vite.
- Build command: `npm run build`.
- Build output directory: `dist`.

### GitHub Pages

GitHub Pages under a repository subpath needs a Vite base path. Set:

```js
export default defineConfig({
  base: '/your-repository-name/',
  plugins: [react()],
});
```

Then rebuild and publish `dist`. Netlify/Vercel/Cloudflare avoid this extra configuration. Any static HTTPS host works.

### Deployment notes

- There is no client-side routing, so no SPA fallback rules are required.
- Test the deployed URL in a fresh private window before recruiting.
- Keep the participant URL stable for the whole data collection period.
- Use HTTPS (all recommended hosts provide it).
- Do not put the researcher query string in recruitment messages.
- If using a shared lab computer, export session data and click **Start new participant session** (or use a fresh private window) between participants.

---

## Method notes and limitations

- **Participants are not told the exact 8-second duration**, and no visible timer or elapsed-time label is displayed. This protects the perceived-waiting-time estimate. Do not add a countdown later.
- The app cannot verify that a participant actually pressed Send in WhatsApp. It records the participant’s own confirmation and cannot verify delivery.
- WhatsApp shows the sender’s WhatsApp number to the researcher. Participants are told this during consent. The app itself does not collect or store phone numbers.
- The progress-bar condition necessarily shows its percentage as part of the manipulation. No separate timer is present.
- Browser timers can be throttled when a tab is backgrounded. The app measures with `performance.now()` and records actual durations, timer overshoot and hidden time for exclusion/quality decisions. Ask participants to keep the tab visible.
- Questionnaire answers and timing metadata are local to the participant’s browser until the WhatsApp message is sent. Export the local session data at the end of each lab session.
- The conditions use the same layout, copy, colors, typography and loaded content. Only the loading indicator differs.
- This project is a research prototype. Obtain ethics/supervisor approval as required by your institution and use an appropriate consent process.
