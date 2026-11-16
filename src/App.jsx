import { useEffect, useRef, useState } from 'react';
import {
  CONDITION_KEYS,
  CONDITION_LABELS,
  getWhatsAppLink,
  getWhatsAppNumber,
  STUDY_CONFIG,
} from './config.js';
import {
  AGREEMENT_OPTIONS,
  FINAL_CHOICE_FIELDS,
  OVERALL_RATING_OPTIONS,
  PERCEIVED_DURATION_OPTIONS,
  REUSE_OPTIONS,
  TRIAL_LIKERT_FIELDS,
  buildWhatsAppMessage,
  countFinalAnswers,
  countTrialAnswers,
  emptyFinalAnswers,
  emptyTrialAnswers,
  getFinalQuestionnaireErrors,
  getTrialQuestionnaireErrors,
  normaliseFinalAnswers,
  normaliseTrialAnswers,
} from './questionnaire.js';

const QUERY_PARAMS = new URLSearchParams(window.location.search);
const PREVIEW_MODE = QUERY_PARAMS.get('preview') === '1';
const RESEARCHER_MODE = QUERY_PARAMS.get('researcher') === '1';
const KEY_PREFIX = PREVIEW_MODE
  ? 'loading-indicator-study:preview:'
  : 'loading-indicator-study:';
const STATE_KEY = `${KEY_PREFIX}state:v1`;
const TIMING_PREFIX = `${KEY_PREFIX}timing:`;
const ARCHIVE_PREFIX = `${KEY_PREFIX}archive:`;
const SCHEMA_VERSION = 2;
const DURATION = STUDY_CONFIG.loadingDurationMs;
const STAGES = [
  'consent',
  'instructions',
  'ready',
  'loading',
  'loaded',
  'questionnaire',
  'final',
  'whatsapp',
  'done',
  'interrupted',
];

function nowIso() {
  return new Date().toISOString();
}

function safeGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in locked-down browsers. The current
    // session still works, but refresh recovery cannot be guaranteed.
  }
}

function safeRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore unavailable storage.
  }
}

function readJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function readTiming(participantId) {
  const parsed = readJson(safeGet(TIMING_PREFIX + participantId), []);
  return Array.isArray(parsed) ? parsed : [];
}

function appendTiming(participantId, type, details = {}) {
  const events = readTiming(participantId);
  events.push({ type, at: nowIso(), ...details });
  safeSet(TIMING_PREFIX + participantId, JSON.stringify(events));
  return events;
}

function createParticipantId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let random = '';

  if (window.crypto?.getRandomValues) {
    const values = new Uint32Array(8);
    window.crypto.getRandomValues(values);
    values.forEach((value) => {
      random += alphabet[value % alphabet.length];
    });
  } else {
    for (let index = 0; index < 8; index += 1) {
      random += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  }

  return `LDI-${random}`;
}

function randomUnit() {
  if (window.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    window.crypto.getRandomValues(value);
    return value[0] / 4294967296;
  }
  return Math.random();
}

function shuffleConditions() {
  const order = [...CONDITION_KEYS];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(randomUnit() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  return order;
}

function createFreshState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    participantId: createParticipantId(),
    conditionOrder: shuffleConditions(),
    trialIndex: 0,
    stage: 'consent',
    createdAt: nowIso(),
    consentedAt: null,
    instructionsViewedAt: null,
    currentTrialStartedAt: null,
    trialResults: [],
    trialQuestionnaireDrafts: {},
    finalQuestionnaireDraft: emptyFinalAnswers(),
    finalQuestionnaire: null,
    finalQuestionnaireSubmittedAt: null,
    whatsappMessage: '',
    whatsappGeneratedAt: null,
    whatsappOpenedAt: null,
    whatsappOpenCount: 0,
    whatsappCopiedAt: null,
    whatsappSentConfirmedAt: null,
    completedAt: null,
    interruptions: [],
  };
}

function normaliseTrialQuestionnaire(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const answers = normaliseTrialAnswers(value);
  if (Object.keys(getTrialQuestionnaireErrors(answers)).length) return null;
  return {
    ...answers,
    submittedAt: typeof value.submittedAt === 'string' ? value.submittedAt : null,
  };
}

function normaliseFinalQuestionnaire(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const answers = normaliseFinalAnswers(value);
  if (Object.keys(getFinalQuestionnaireErrors(answers)).length) return null;
  return {
    ...answers,
    submittedAt: typeof value.submittedAt === 'string' ? value.submittedAt : null,
  };
}

function normaliseTrialResults(value) {
  if (!Array.isArray(value)) return [];
  const byTrialNumber = new Map();
  value.forEach((result) => {
    if (
      !result ||
      !Number.isInteger(result.trialNumber) ||
      result.trialNumber < 1 ||
      result.trialNumber > 3 ||
      !CONDITION_KEYS.includes(result.condition) ||
      typeof result.elapsedMs !== 'number'
    ) {
      return;
    }
    byTrialNumber.set(result.trialNumber, {
      ...result,
      questionnaire: normaliseTrialQuestionnaire(result.questionnaire),
    });
  });
  return [...byTrialNumber.values()].sort((a, b) => a.trialNumber - b.trialNumber);
}

function normaliseTrialDrafts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const drafts = {};
  [1, 2, 3].forEach((trialNumber) => {
    if (value[trialNumber]) {
      drafts[trialNumber] = normaliseTrialAnswers(value[trialNumber]);
    }
  });
  return drafts;
}

function normaliseState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schemaVersion !== SCHEMA_VERSION) return null;

  const orderIsValid =
    Array.isArray(value.conditionOrder) &&
    value.conditionOrder.length === 3 &&
    new Set(value.conditionOrder).size === 3 &&
    value.conditionOrder.every((condition) => CONDITION_KEYS.includes(condition));

  const participantId =
    typeof value.participantId === 'string' && /^LDI-[A-Z0-9]+$/.test(value.participantId)
      ? value.participantId
      : createParticipantId();

  const trialResults = normaliseTrialResults(value.trialResults);
  const answeredTrials = new Set(
    trialResults.filter((result) => result.questionnaire).map((result) => result.trialNumber),
  );
  const allTrialsAnswered = answeredTrials.size === 3;

  let trialIndex = Number.isInteger(value.trialIndex)
    ? Math.min(2, Math.max(0, value.trialIndex))
    : 0;
  let stage = STAGES.includes(value.stage) ? value.stage : 'consent';

  if (['final', 'whatsapp', 'done'].includes(stage) && !allTrialsAnswered) {
    const firstMissing = [1, 2, 3].find((trialNumber) => !answeredTrials.has(trialNumber));
    trialIndex = Math.max(0, (firstMissing ?? 1) - 1);
    stage = trialResults.some((result) => result.trialNumber === firstMissing)
      ? 'questionnaire'
      : 'ready';
  }

  const finalQuestionnaire = normaliseFinalQuestionnaire(value.finalQuestionnaire);

  if (['whatsapp', 'done'].includes(stage) && !finalQuestionnaire) {
    stage = 'final';
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    participantId,
    conditionOrder: orderIsValid ? [...value.conditionOrder] : shuffleConditions(),
    trialIndex,
    stage,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : nowIso(),
    consentedAt: typeof value.consentedAt === 'string' ? value.consentedAt : null,
    instructionsViewedAt:
      typeof value.instructionsViewedAt === 'string' ? value.instructionsViewedAt : null,
    currentTrialStartedAt:
      typeof value.currentTrialStartedAt === 'string' ? value.currentTrialStartedAt : null,
    trialResults,
    trialQuestionnaireDrafts: normaliseTrialDrafts(value.trialQuestionnaireDrafts),
    finalQuestionnaireDraft: normaliseFinalAnswers(value.finalQuestionnaireDraft),
    finalQuestionnaire,
    finalQuestionnaireSubmittedAt:
      typeof value.finalQuestionnaireSubmittedAt === 'string'
        ? value.finalQuestionnaireSubmittedAt
        : null,
    whatsappMessage:
      typeof value.whatsappMessage === 'string' ? value.whatsappMessage : '',
    whatsappGeneratedAt:
      typeof value.whatsappGeneratedAt === 'string' ? value.whatsappGeneratedAt : null,
    whatsappOpenedAt:
      typeof value.whatsappOpenedAt === 'string' ? value.whatsappOpenedAt : null,
    whatsappOpenCount:
      Number.isInteger(value.whatsappOpenCount) && value.whatsappOpenCount >= 0
        ? value.whatsappOpenCount
        : 0,
    whatsappCopiedAt:
      typeof value.whatsappCopiedAt === 'string' ? value.whatsappCopiedAt : null,
    whatsappSentConfirmedAt:
      typeof value.whatsappSentConfirmedAt === 'string'
        ? value.whatsappSentConfirmedAt
        : null,
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : null,
    interruptions: Array.isArray(value.interruptions)
      ? value.interruptions.filter(Boolean).map((item) => ({ ...item }))
      : [],
  };
}

function saveState(state) {
  safeSet(STATE_KEY, JSON.stringify(state));
}

function loadState() {
  const stored = readJson(safeGet(STATE_KEY), null);

  if (stored && stored.schemaVersion !== SCHEMA_VERSION) {
    const legacyParticipantId =
      typeof stored.participantId === 'string' ? stored.participantId : 'unknown';
    safeSet(
      `${ARCHIVE_PREFIX}${legacyParticipantId}:legacy-v${stored.schemaVersion ?? 1}-${Date.now()}`,
      JSON.stringify({ ...stored, archivedAt: nowIso(), legacySchema: true }),
    );
  }

  let state = normaliseState(stored);

  if (!state) {
    state = createFreshState();
    saveState(state);
    appendTiming(state.participantId, 'session_created', {
      conditionOrder: state.conditionOrder,
      createdAt: state.createdAt,
    });
    return state;
  }

  if (state.stage === 'loading') {
    const trialNumber = state.trialIndex + 1;
    const condition = state.conditionOrder[state.trialIndex];
    const interruptedAt = nowIso();
    const startedAt = state.currentTrialStartedAt;
    state = {
      ...state,
      stage: 'interrupted',
      currentTrialStartedAt: null,
      interruptions: [
        ...state.interruptions,
        { trialNumber, condition, startedAt, interruptedAt },
      ],
    };
    saveState(state);
    appendTiming(state.participantId, 'trial_interrupted_by_reload', {
      trialNumber,
      condition,
      startedAt,
      interruptedAt,
    });
  }

  return state;
}

function archiveSession(state) {
  safeSet(
    ARCHIVE_PREFIX + state.participantId,
    JSON.stringify({ ...state, archivedAt: nowIso() }),
  );
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function collectAllSessions(currentState) {
  const sessions = {};
  const timings = {};

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;

      if (key.startsWith(ARCHIVE_PREFIX)) {
        const participantId = key.slice(ARCHIVE_PREFIX.length);
        const archived = readJson(safeGet(key), null);
        if (archived) sessions[participantId] = archived;
      }

      if (key.startsWith(TIMING_PREFIX)) {
        const participantId = key.slice(TIMING_PREFIX.length);
        const events = readJson(safeGet(key), []);
        if (Array.isArray(events)) timings[participantId] = events;
      }
    }
  } catch {
    // Ignore storage enumeration errors.
  }

  sessions[currentState.participantId] = currentState;
  timings[currentState.participantId] = readTiming(currentState.participantId);

  return { exportedAt: nowIso(), sessions, timings };
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

function QuestionProgress({ answered, total }) {
  const percent = Math.round((answered / total) * 100);
  return (
    <div
      className="questionnaire-progress"
      aria-label={`${answered} of ${total} required questions answered`}
    >
      <div className="questionnaire-progress__meta">
        <span>
          {answered} of {total} required questions answered
        </span>
        <strong>{percent}%</strong>
      </div>
      <div className="questionnaire-progress__track" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function QuestionnaireErrorSummary({ errors, summaryRef }) {
  const messages = Object.values(errors);
  if (!messages.length) return null;

  return (
    <div className="form-error-summary" role="alert" tabIndex={-1} ref={summaryRef}>
      <strong>Please answer all required questions before continuing.</strong>
      <ul>
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

function RadioQuestion({
  id,
  legend,
  name,
  options,
  value,
  onChange,
  error,
  help,
}) {
  const errorId = `${id}-error`;
  return (
    <fieldset
      id={`${id}-group`}
      className={`question-block${error ? ' question-block--error' : ''}`}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="question-legend">{legend}</legend>
      {help ? <p className="question-help">{help}</p> : null}
      <div className="option-list">
        {options.map((option) => (
          <label
            key={option.value}
            className={`option${value === option.value ? ' option--selected' : ''}`}
          >
            <input
              type="radio"
              name={name}
              value={String(option.value)}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function SelectQuestion({ id, label, value, onChange, options, error, placeholder }) {
  const errorId = `${id}-error`;
  return (
    <div className={`question-block${error ? ' question-block--error' : ''}`}>
      <label className="question-legend" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ConditionInfo({ condition }) {
  return (
    <div className="question-block condition-info">
      <span className="question-legend">Q1. Which loading indicator did you experience?</span>
      <div className="condition-answer">
        <span
          className={`legend-swatch legend-swatch--${condition}`}
          aria-hidden="true"
        />
        <span>
          <strong>{CONDITION_LABELS[condition]}</strong>
          <small>Detected automatically from this trial.</small>
        </span>
      </div>
    </div>
  );
}

function TrialQuestionnaire({ trialNumber, condition, answers, onChange, onSubmit, isLastTrial }) {
  const [errors, setErrors] = useState({});
  const summaryRef = useRef(null);

  const update = (key, value) => {
    onChange({ ...answers, [key]: value });
    setErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const nextErrors = getTrialQuestionnaireErrors(answers);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      window.requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setErrors({});
    onSubmit(answers);
  };

  return (
    <form className="questionnaire-form" onSubmit={handleSubmit} noValidate>
      <QuestionProgress answered={countTrialAnswers(answers)} total={5} />
      <QuestionnaireErrorSummary errors={errors} summaryRef={summaryRef} />
      <ConditionInfo condition={condition} />
      <SelectQuestion
        id="trial-perceived-duration"
        label="Q2. How long did the loading experience feel?"
        value={answers.perceivedDuration}
        onChange={(value) => update('perceivedDuration', value)}
        options={PERCEIVED_DURATION_OPTIONS}
        placeholder="Select an estimate"
        error={errors.perceivedDuration}
      />
      {TRIAL_LIKERT_FIELDS.map((field) => (
        <RadioQuestion
          key={field.key}
          id={`trial-${field.key}`}
          legend={field.question}
          name={`trial-${trialNumber}-${field.key}`}
          options={AGREEMENT_OPTIONS}
          value={answers[field.key]}
          onChange={(value) => update(field.key, value)}
          error={errors[field.key]}
        />
      ))}
      <div className="questionnaire-actions">
        <button type="submit" className="btn btn--primary btn--large">
          {isLastTrial
            ? 'Submit and continue to final questionnaire'
            : `Submit and continue to trial ${trialNumber + 1}`}
        </button>
      </div>
      <p className="fine-print">
        Q1 is detected automatically, so five questions require your input. All required
        answers are saved on this device as you go.
      </p>
    </form>
  );
}

function FinalQuestionnaire({ answers, onChange, onSubmit }) {
  const [errors, setErrors] = useState({});
  const summaryRef = useRef(null);
  const conditionOptions = CONDITION_KEYS.map((condition) => ({
    value: condition,
    label: CONDITION_LABELS[condition],
  }));

  const update = (key, value) => {
    onChange({ ...answers, [key]: value });
    setErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const nextErrors = getFinalQuestionnaireErrors(answers);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      window.requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setErrors({});
    onSubmit(answers);
  };

  return (
    <form className="questionnaire-form" onSubmit={handleSubmit} noValidate>
      <QuestionProgress answered={countFinalAnswers(answers)} total={6} />
      <QuestionnaireErrorSummary errors={errors} summaryRef={summaryRef} />
      {FINAL_CHOICE_FIELDS.map((field) => (
        <RadioQuestion
          key={field.key}
          id={`final-${field.key}`}
          legend={field.question}
          name={`final-${field.key}`}
          options={conditionOptions}
          value={answers[field.key]}
          onChange={(value) => update(field.key, value)}
          error={errors[field.key]}
        />
      ))}
      <RadioQuestion
        id="final-overall"
        legend="Q5. Overall, how would you rate your experience with the three loading indicators?"
        name="final-overall"
        options={OVERALL_RATING_OPTIONS}
        value={answers.overall}
        onChange={(value) => update('overall', value)}
        error={errors.overall}
      />
      <RadioQuestion
        id="final-reuse"
        legend="Q6. Would you prefer to see your favourite loading indicator in other web applications?"
        name="final-reuse"
        options={REUSE_OPTIONS.map((option) => ({ value: option, label: option }))}
        value={answers.reuse}
        onChange={(value) => update('reuse', value)}
        error={errors.reuse}
      />
      <div className="question-block">
        <label className="question-legend" htmlFor="final-comments">
          Q7. Do you have any additional comments or suggestions about the loading
          indicators? <span className="optional-tag">Optional</span>
        </label>
        <textarea
          id="final-comments"
          rows={4}
          value={answers.comments}
          onChange={(event) => update('comments', event.target.value)}
          placeholder="Optional comments"
        />
      </div>
      <div className="questionnaire-actions">
        <button type="submit" className="btn btn--primary btn--large">
          Submit final answers and generate WhatsApp message
        </button>
      </div>
      <p className="fine-print">
        Your final answers are locked into the WhatsApp message after you submit. You can
        review the complete message before opening WhatsApp.
      </p>
    </form>
  );
}

function WhatsAppReview({
  study,
  previewMode,
  onOpen,
  onCopy,
  onConfirmSent,
  onEditFinal,
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [sentAck, setSentAck] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const number = getWhatsAppNumber();
  const link = number ? getWhatsAppLink(study.whatsappMessage) : '';
  const canOpen = Boolean(link) && !previewMode;

  const handleCopy = async () => {
    const copied = await copyText(study.whatsappMessage);
    setCopyStatus(
      copied
        ? 'Message copied to the clipboard.'
        : 'Copy failed. Select the message text and copy it manually.',
    );
    onCopy(copied);
  };

  return (
    <section className="card card--narrow" aria-labelledby="whatsapp-title">
      <span className="eyebrow">Final step</span>
      <h1 id="whatsapp-title">Review and send your response</h1>
      <p className="lede">
        Your answers have been combined into one WhatsApp message. Review it below, then
        open WhatsApp and press Send yourself.
      </p>

      {previewMode ? (
        <div className="notice notice--warning">
          <strong>Preview mode</strong>
          <p>
            This is a sample message. Opening WhatsApp is disabled so preview data cannot
            be sent to the researcher. Use Copy Message to inspect the sample text.
          </p>
        </div>
      ) : null}

      {!number ? (
        <div className="notice notice--warning">
          <strong>WhatsApp number not configured</strong>
          <p>
            Add a valid international WhatsApp number to <code>src/config.js</code> before
            data collection. You can still copy the message as a fallback.
          </p>
        </div>
      ) : null}

      <div className="whatsapp-message-panel">
        <div className="whatsapp-message-heading">
          <strong>Message preview</strong>
          <span>Review before sending</span>
        </div>
        <pre className="whatsapp-message" tabIndex={0}>
          {study.whatsappMessage}
        </pre>
      </div>

      <div className="btn-row">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => setReviewOpen(true)}
        >
          Review WhatsApp Message
        </button>
        {canOpen ? (
          <a
            className="btn btn--primary"
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpen}
          >
            Open WhatsApp and Send
          </a>
        ) : (
          <button type="button" className="btn btn--primary" disabled>
            Open WhatsApp and Send
          </button>
        )}
        <button type="button" className="btn btn--secondary" onClick={handleCopy}>
          Copy Message
        </button>
      </div>

      {copyStatus ? (
        <p className="status-line" role="status">
          {copyStatus}
        </p>
      ) : null}

      <div className="notice notice--soft">
        <strong>Please press Send in WhatsApp to submit your research response.</strong>
        <p>
          Opening WhatsApp does not send anything. The researcher receives the message only
          after you press Send. This app cannot confirm delivery.
        </p>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={sentAck}
          onChange={(event) => setSentAck(event.target.checked)}
        />
        <span>I have pressed Send in WhatsApp.</span>
      </label>

      <div className="btn-row">
        <button
          type="button"
          className="btn btn--primary"
          onClick={onConfirmSent}
          disabled={!sentAck}
        >
          Complete session
        </button>
        <button type="button" className="btn btn--secondary" onClick={onEditFinal}>
          Edit final answers
        </button>
      </div>

      <p className="fine-print">
        Editing your final answers will generate a new message. If you already sent the
        previous message, the researcher may already have that version.
      </p>

      {reviewOpen ? (
        <Dialog labelledBy="whatsapp-review-title" onClose={() => setReviewOpen(false)}>
          <div className="dialog-heading">
            <div>
              <span className="eyebrow">WhatsApp message</span>
              <h2 id="whatsapp-review-title">Review before sending</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setReviewOpen(false)}
              aria-label="Close dialog"
              autoFocus
            >
              ×
            </button>
          </div>
          <pre className="whatsapp-message whatsapp-message--dialog" tabIndex={0}>
            {study.whatsappMessage}
          </pre>
          <div className="btn-row">
            <button type="button" className="btn btn--secondary" onClick={handleCopy}>
              Copy Message
            </button>
          </div>
          <p className="hint">
            Please press Send in WhatsApp to submit your research response. Opening
            WhatsApp does not submit anything automatically.
          </p>
        </Dialog>
      ) : null}
    </section>
  );
}

function TrialSteps({ current, allDone = false }) {
  return (
    <ol
      className="trial-steps"
      aria-label={allDone ? 'All three trials completed' : `Trial ${current} of 3`}
    >
      {[1, 2, 3].map((number) => {
        const status =
          allDone || number < current ? 'done' : number === current ? 'active' : 'upcoming';
        return (
          <li
            key={number}
            className={`trial-step trial-step--${status}`}
            aria-current={number === current ? 'step' : undefined}
          >
            <span aria-hidden="true">{status === 'done' ? '✓' : number}</span>
            <span className="sr-only">
              Trial {number}
              {status === 'done' ? ' completed' : status === 'active' ? ' current' : ' upcoming'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function WorkspacePreview({ loading, condition, progress }) {
  return (
    <div className="workspace" aria-busy={loading ? 'true' : 'false'}>
      <div className="workspace-bar">
        <span className="workspace-brand">
          <span className="workspace-mark" aria-hidden="true" />
          Northstar
        </span>
        <div className="workspace-nav" aria-hidden="true">
          <span>Overview</span>
          <span>Reports</span>
          <span>Team</span>
        </div>
        <span className="workspace-avatar" aria-hidden="true" />
      </div>
      <div className="workspace-body">
        <div className="workspace-heading">
          <div>
            <h2>Workspace overview</h2>
            <p>Recent activity and performance insights</p>
          </div>
          <span className="workspace-chip">Last 30 days</span>
        </div>
        {loading ? (
          <LoadingRegion condition={condition} progress={progress} />
        ) : (
          <LoadedContent />
        )}
      </div>
    </div>
  );
}

function LoadingRegion({ condition, progress }) {
  if (condition === 'skeleton') {
    return (
      <div className="loading-region" aria-live="polite">
        <span className="sr-only" role="status">
          Loading workspace content. Please wait.
        </span>
        <div className="skeleton" aria-hidden="true">
          <div className="skeleton-metrics">
            {[0, 1, 2].map((item) => (
              <div className="skeleton-card" key={item}>
                <i className="skeleton-block skeleton-block--label" />
                <i className="skeleton-block skeleton-block--value" />
                <i className="skeleton-block skeleton-block--small" />
              </div>
            ))}
          </div>
          <div className="skeleton-activity">
            <i className="skeleton-block skeleton-block--title" />
            {[0, 1, 2].map((item) => (
              <div className="skeleton-row" key={item}>
                <i className="skeleton-block skeleton-block--avatar" />
                <span>
                  <i className="skeleton-block skeleton-block--line" />
                  <i className="skeleton-block skeleton-block--line skeleton-block--short" />
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (condition === 'spinner') {
    return (
      <div className="loading-region loading-region--center">
        <div className="spinner-block" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <p>Loading your workspace…</p>
          <span className="loader-hint">Preparing recent activity and insights</span>
        </div>
      </div>
    );
  }

  const roundedProgress = Math.round(progress);

  return (
    <div className="loading-region loading-region--center">
      <div className="progress-block">
        <div className="progress-labels">
          <span role="status" aria-live="polite">
            Loading your workspace…
          </span>
          <strong aria-hidden="true">{roundedProgress}%</strong>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="Loading progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={roundedProgress}
          aria-valuetext={`${roundedProgress}% loaded`}
        >
          <span style={{ width: `${roundedProgress}%` }} />
        </div>
        <span className="loader-hint">Preparing recent activity and insights</span>
      </div>
    </div>
  );
}

function LoadedContent() {
  return (
    <div className="loaded-region fade-in">
      <div className="metric-grid">
        <article className="metric">
          <p>Active projects</p>
          <strong>24</strong>
          <span className="trend trend--up">+12% this month</span>
        </article>
        <article className="metric">
          <p>Average response time</p>
          <strong>1.8s</strong>
          <span className="trend trend--down">-8% this month</span>
        </article>
        <article className="metric">
          <p>Team members</p>
          <strong>12</strong>
          <span className="trend">3 online now</span>
        </article>
      </div>
      <div className="activity">
        <div className="activity-heading">
          <h3>Recent activity</h3>
          <span>Updated just now</span>
        </div>
        <ul>
          <li>
            <span className="activity-dot activity-dot--blue" aria-hidden="true" />
            <span>
              <strong>Weekly report published</strong>
              <small>Analytics team · 12 minutes ago</small>
            </span>
          </li>
          <li>
            <span className="activity-dot activity-dot--green" aria-hidden="true" />
            <span>
              <strong>Customer survey reached 80 responses</strong>
              <small>Research team · 34 minutes ago</small>
            </span>
          </li>
          <li>
            <span className="activity-dot activity-dot--amber" aria-hidden="true" />
            <span>
              <strong>New dashboard shared with the team</strong>
              <small>Product team · 1 hour ago</small>
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function Dialog({ labelledBy, onClose, children }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}

function TechnicalProblemDialog({ open, study, supportEmail, onClose }) {
  const [description, setDescription] = useState('');
  const [saved, setSaved] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');

  if (!open) return null;

  const trialNumber = study.trialIndex + 1;
  const condition = study.conditionOrder[study.trialIndex];
  const reportText = [
    'Loading Indicator Study - technical problem report',
    `Participant ID: ${study.participantId}`,
    `Screen: ${study.stage}`,
    `Trial: ${trialNumber} of 3`,
    `Condition: ${CONDITION_LABELS[condition] ?? 'not applicable'}`,
    `Reported at: ${nowIso()}`,
    '',
    'Description:',
    description.trim() || '(not provided)',
  ].join('\n');

  const mailtoHref = supportEmail
    ? `mailto:${supportEmail}?subject=${encodeURIComponent(
        `Technical problem - ${study.participantId}`,
      )}&body=${encodeURIComponent(reportText)}`
    : '';

  const saveReport = () => {
    appendTiming(study.participantId, 'technical_failure_reported', {
      stage: study.stage,
      trialNumber,
      condition,
      description: description.trim(),
    });
    setSaved(true);
  };

  const handleCopy = async () => {
    const copied = await copyText(reportText);
    setCopyStatus(copied ? 'Report copied to the clipboard.' : 'Copy failed. Select the text and copy it manually.');
  };

  return (
    <Dialog labelledBy="failure-title" onClose={onClose}>
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">Technical support</span>
          <h2 id="failure-title">Report a technical problem</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
          ×
        </button>
      </div>
      <p>
        Describe what went wrong. Do not include your name, email address or other
        identifying information. Your anonymous participant ID is included automatically.
      </p>
      <label className="field-label" htmlFor="failure-description">
        What happened?
      </label>
      <textarea
        id="failure-description"
        rows={5}
        value={description}
        onChange={(event) => {
          setDescription(event.target.value);
          setSaved(false);
          setCopyStatus('');
        }}
        placeholder="For example: the page reloaded during a trial, or a questionnaire answer would not save."
        autoFocus
      />
      <div className="dialog-meta">
        <span>Participant: {study.participantId}</span>
        <span>Trial: {trialNumber} of 3</span>
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--primary"
          onClick={saveReport}
          disabled={!description.trim()}
        >
          Save report on this device
        </button>
        <button type="button" className="btn btn--secondary" onClick={handleCopy}>
          Copy report
        </button>
        {saved && mailtoHref ? (
          <a className="btn btn--secondary" href={mailtoHref}>
            Email the researcher
          </a>
        ) : null}
      </div>
      {saved ? (
        <p className="status-line status-line--success" role="status">
          Report saved locally. Download the session data or contact the researcher so it
          can be collected.
        </p>
      ) : null}
      {copyStatus ? (
        <p className="status-line" role="status">
          {copyStatus}
        </p>
      ) : null}
      {saved && !mailtoHref ? (
        <p className="hint">
          No researcher email address is configured. Copy the report above and send it to
          the researcher, or download the session data from the researcher tools.
        </p>
      ) : null}
    </Dialog>
  );
}

function ResearcherDialog({
  open,
  study,
  onClose,
  onDownloadSession,
  onDownloadAll,
  onNewSession,
}) {
  if (!open) return null;

  const answeredTrials = study.trialResults.filter((result) => result.questionnaire).length;
  const whatsappConfigured = Boolean(getWhatsAppNumber());

  return (
    <Dialog labelledBy="researcher-title" onClose={onClose}>
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">Researcher tools</span>
          <h2 id="researcher-title">Session data</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
          autoFocus
        >
          ×
        </button>
      </div>
      <p>
        Questionnaire answers and timing metadata are stored only in this browser. The
        WhatsApp message is generated locally; sending happens manually in WhatsApp, and
        this app cannot verify delivery. Download the session before clearing browser
        storage.
      </p>
      <dl className="researcher-summary">
        <div>
          <dt>Participant ID</dt>
          <dd>{study.participantId}</dd>
        </div>
        <div>
          <dt>Current screen</dt>
          <dd>{study.stage}</dd>
        </div>
        <div>
          <dt>Condition order</dt>
          <dd>
            {study.conditionOrder
              .map((condition, index) => `${index + 1}. ${CONDITION_LABELS[condition]}`)
              .join(' → ')}
          </dd>
        </div>
        <div>
          <dt>Completed trials</dt>
          <dd>{study.trialResults.length} of 3</dd>
        </div>
        <div>
          <dt>Completed questionnaires</dt>
          <dd>{answeredTrials} of 3</dd>
        </div>
        <div>
          <dt>Recorded durations</dt>
          <dd>
            {study.trialResults.length
              ? study.trialResults
                  .map(
                    (result) =>
                      `Trial ${result.trialNumber}: ${Math.round(result.elapsedMs)} ms`,
                  )
                  .join(' · ')
              : 'None yet'}
          </dd>
        </div>
        <div>
          <dt>Final questionnaire</dt>
          <dd>{study.finalQuestionnaire ? 'Completed' : 'Not completed'}</dd>
        </div>
        <div>
          <dt>WhatsApp message</dt>
          <dd>{study.whatsappMessage ? 'Generated' : 'Not generated'}</dd>
        </div>
        <div>
          <dt>WhatsApp opens</dt>
          <dd>{study.whatsappOpenCount}</dd>
        </div>
        <div>
          <dt>WhatsApp send confirmation</dt>
          <dd>
            {study.whatsappSentConfirmedAt
              ? 'Participant confirmed pressing Send'
              : 'Not confirmed'}
          </dd>
        </div>
        <div>
          <dt>WhatsApp number</dt>
          <dd>{whatsappConfigured ? 'Configured' : 'Missing or invalid'}</dd>
        </div>
        <div>
          <dt>Interruptions</dt>
          <dd>{study.interruptions.length}</dd>
        </div>
      </dl>
      <div className="btn-row">
        <button type="button" className="btn btn--primary" onClick={onDownloadSession}>
          Download this session
        </button>
        <button type="button" className="btn btn--secondary" onClick={onDownloadAll}>
          Download all local sessions
        </button>
        <button type="button" className="btn btn--danger" onClick={onNewSession}>
          Start new participant session
        </button>
      </div>
      <p className="hint">
        Starting a new session archives the current state locally, generates a new
        anonymous participant ID and clears the active session. It does not delete
        WhatsApp messages already sent.
      </p>
    </Dialog>
  );
}

export default function App() {
  const [study, setStudy] = useState(loadState);
  const studyRef = useRef(study);
  const [elapsed, setElapsed] = useState(0);
  const [consentChecked, setConsentChecked] = useState(false);
  const [failureOpen, setFailureOpen] = useState(false);
  const [researcherOpen, setResearcherOpen] = useState(false);
  const completedRef = useRef(false);
  const activeTrialRef = useRef(null);
  const hiddenStartRef = useRef(null);
  const hiddenAccumRef = useRef(0);

  const researcherMode = RESEARCHER_MODE;
  const previewMode = PREVIEW_MODE;

  const commit = (update) => {
    const previous = studyRef.current;
    const next =
      typeof update === 'function' ? update(previous) : { ...previous, ...update };
    studyRef.current = next;
    saveState(next);
    setStudy(next);
    return next;
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [study.stage, study.trialIndex]);

  useEffect(() => {
    if (study.stage !== 'whatsapp' || study.whatsappMessage || !study.finalQuestionnaire) {
      return;
    }
    const generatedAt = nowIso();
    const message = buildWhatsAppMessage(
      { ...study, whatsappGeneratedAt: generatedAt },
      { preview: previewMode },
    );
    commit((previous) => ({
      ...previous,
      whatsappMessage: message,
      whatsappGeneratedAt: previous.whatsappGeneratedAt ?? generatedAt,
    }));
  }, [study.stage, study.whatsappMessage, study.finalQuestionnaire, previewMode]);

  useEffect(() => {
    if (study.stage !== 'loading') return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [study.stage]);

  useEffect(() => {
    if (study.stage !== 'loading') return undefined;

    const trial = activeTrialRef.current;
    if (!trial) {
      const condition = study.conditionOrder[study.trialIndex];
      activeTrialRef.current = {
        trialNumber: study.trialIndex + 1,
        condition,
        startedAtIso: study.currentTrialStartedAt ?? nowIso(),
        startedPerf: performance.now(),
      };
    }

    hiddenAccumRef.current = 0;
    hiddenStartRef.current = document.hidden ? performance.now() : null;

    const finish = (measuredElapsed) => {
      if (completedRef.current) return;
      const currentTrial = activeTrialRef.current;
      if (!currentTrial) return;
      completedRef.current = true;

      let hiddenMs = hiddenAccumRef.current;
      if (hiddenStartRef.current !== null) {
        hiddenMs += performance.now() - hiddenStartRef.current;
      }
      hiddenStartRef.current = null;

      const completedAt = nowIso();
      const elapsedMs = Math.round(measuredElapsed);
      const result = {
        trialNumber: currentTrial.trialNumber,
        condition: currentTrial.condition,
        startedAt: currentTrial.startedAtIso,
        completedAt,
        elapsedMs,
        targetMs: DURATION,
        timerOvershootMs: Math.max(0, elapsedMs - DURATION),
        hiddenMs: Math.round(hiddenMs),
      };

      setElapsed(DURATION);
      appendTiming(studyRef.current.participantId, 'trial_completed', {
        ...result,
      });
      commit((previous) => ({
        ...previous,
        stage: 'loaded',
        currentTrialStartedAt: null,
        trialResults: [
          ...previous.trialResults.filter(
            (item) => item.trialNumber !== currentTrial.trialNumber,
          ),
          result,
        ],
      }));
    };

    const tick = () => {
      const currentTrial = activeTrialRef.current;
      if (!currentTrial || completedRef.current) return;
      const measured = performance.now() - currentTrial.startedPerf;
      setElapsed(Math.min(measured, DURATION));
      if (measured >= DURATION) finish(measured);
    };

    const interval = window.setInterval(tick, 50);
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenStartRef.current = performance.now();
        return;
      }
      if (hiddenStartRef.current !== null) {
        hiddenAccumRef.current += performance.now() - hiddenStartRef.current;
        hiddenStartRef.current = null;
      }
      tick();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    tick();

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [study.stage]);

  const currentTrialNumber = study.trialIndex + 1;
  const currentCondition = study.conditionOrder[study.trialIndex];
  const isLastTrial = study.trialIndex >= 2;
  const trialDraft =
    study.trialQuestionnaireDrafts[currentTrialNumber] ?? emptyTrialAnswers();
  const finalDraft = study.finalQuestionnaireDraft ?? emptyFinalAnswers();
  const progress = Math.min(100, (elapsed / DURATION) * 100);

  const handleConsent = () => {
    const state = studyRef.current;
    if (state.stage !== 'consent' || !consentChecked) return;
    const consentedAt = nowIso();
    appendTiming(state.participantId, 'consent_given', { consentedAt });
    commit({ stage: 'instructions', consentedAt });
  };

  const handleInstructionsContinue = () => {
    const state = studyRef.current;
    if (state.stage !== 'instructions') return;
    const reviewedAt = nowIso();
    appendTiming(state.participantId, 'instructions_acknowledged', { reviewedAt });
    commit({ stage: 'ready', instructionsViewedAt: reviewedAt });
  };

  const handleStart = () => {
    const state = studyRef.current;
    if (state.stage !== 'ready' && state.stage !== 'interrupted') return;
    if (!CONDITION_KEYS.includes(state.conditionOrder[state.trialIndex])) return;

    const trialNumber = state.trialIndex + 1;
    if (state.trialResults.some((result) => result.trialNumber === trialNumber)) {
      return;
    }

    const condition = state.conditionOrder[state.trialIndex];
    const startedAt = nowIso();
    completedRef.current = false;
    activeTrialRef.current = {
      trialNumber,
      condition,
      startedAtIso: startedAt,
      startedPerf: performance.now(),
    };
    hiddenAccumRef.current = 0;
    hiddenStartRef.current = null;
    setElapsed(0);

    appendTiming(
      state.participantId,
      state.stage === 'interrupted' ? 'trial_restarted' : 'trial_started',
      {
        trialNumber,
        condition,
        startedAt,
        conditionOrder: state.conditionOrder,
      },
    );

    commit({
      stage: 'loading',
      currentTrialStartedAt: startedAt,
    });
  };

  const handleContinueToQuestionnaire = () => {
    const state = studyRef.current;
    if (state.stage !== 'loaded') return;
    appendTiming(state.participantId, 'loaded_content_continued', {
      trialNumber: currentTrialNumber,
      condition: currentCondition,
    });
    commit({ stage: 'questionnaire' });
  };

  const updateTrialDraft = (answers) => {
    const state = studyRef.current;
    if (state.stage !== 'questionnaire') return;
    const trialNumber = state.trialIndex + 1;
    commit((previous) => ({
      ...previous,
      trialQuestionnaireDrafts: {
        ...previous.trialQuestionnaireDrafts,
        [trialNumber]: answers,
      },
    }));
  };

  const updateFinalDraft = (answers) => {
    if (studyRef.current.stage !== 'final') return;
    commit({ finalQuestionnaireDraft: answers });
  };

  const handleTrialQuestionnaireSubmit = (answers) => {
    const state = studyRef.current;
    if (state.stage !== 'questionnaire') return;
    const trialNumber = state.trialIndex + 1;
    const result = state.trialResults.find((item) => item.trialNumber === trialNumber);
    if (!result || result.questionnaire) return;

    const normalised = normaliseTrialAnswers(answers);
    if (Object.keys(getTrialQuestionnaireErrors(normalised)).length) return;

    const submittedAt = nowIso();
    const last = state.trialIndex >= 2;
    appendTiming(state.participantId, 'trial_questionnaire_submitted', {
      trialNumber,
      condition: state.conditionOrder[state.trialIndex],
      answers: normalised,
      submittedAt,
    });

    commit((previous) => {
      const drafts = { ...previous.trialQuestionnaireDrafts };
      delete drafts[trialNumber];
      return {
        ...previous,
        stage: last ? 'final' : 'ready',
        trialIndex: last ? previous.trialIndex : Math.min(2, previous.trialIndex + 1),
        trialResults: previous.trialResults.map((item) =>
          item.trialNumber === trialNumber
            ? { ...item, questionnaire: { ...normalised, submittedAt } }
            : item,
        ),
        trialQuestionnaireDrafts: drafts,
      };
    });
  };

  const handleFinalQuestionnaireSubmit = (answers) => {
    const state = studyRef.current;
    if (state.stage !== 'final') return;
    if (state.trialResults.filter((item) => item.questionnaire).length < 3) return;

    const normalised = normaliseFinalAnswers(answers);
    if (Object.keys(getFinalQuestionnaireErrors(normalised)).length) return;

    const submittedAt = nowIso();
    const nextState = {
      ...state,
      stage: 'whatsapp',
      finalQuestionnaire: { ...normalised, submittedAt },
      finalQuestionnaireDraft: normalised,
      finalQuestionnaireSubmittedAt: submittedAt,
      whatsappGeneratedAt: submittedAt,
      whatsappOpenedAt: null,
      whatsappOpenCount: 0,
      whatsappCopiedAt: null,
      whatsappSentConfirmedAt: null,
      completedAt: null,
    };
    nextState.whatsappMessage = buildWhatsAppMessage(nextState, {
      preview: previewMode,
    });

    appendTiming(state.participantId, 'final_questionnaire_submitted', {
      answers: normalised,
      submittedAt,
    });
    appendTiming(state.participantId, 'whatsapp_message_generated', {
      submittedAt,
      preview: previewMode,
    });
    commit(nextState);
  };

  const handleOpenWhatsApp = (event) => {
    const state = studyRef.current;
    if (state.stage !== 'whatsapp' || previewMode || event.detail > 1) {
      event.preventDefault();
      return;
    }
    appendTiming(state.participantId, 'whatsapp_link_opened', {
      openCount: state.whatsappOpenCount + 1,
    });
    commit((previous) => ({
      ...previous,
      whatsappOpenedAt: previous.whatsappOpenedAt ?? nowIso(),
      whatsappOpenCount: previous.whatsappOpenCount + 1,
    }));
  };

  const handleCopyWhatsApp = (copied) => {
    if (!copied) return;
    const state = studyRef.current;
    appendTiming(state.participantId, 'whatsapp_message_copied', {});
    commit((previous) => ({
      ...previous,
      whatsappCopiedAt: previous.whatsappCopiedAt ?? nowIso(),
    }));
  };

  const handleConfirmWhatsAppSent = () => {
    const state = studyRef.current;
    if (state.stage !== 'whatsapp') return;
    const completedAt = nowIso();
    appendTiming(state.participantId, 'whatsapp_sent_confirmed', {
      completedAt,
      whatsappOpenCount: state.whatsappOpenCount,
      messageGeneratedAt: state.whatsappGeneratedAt,
    });
    commit({
      stage: 'done',
      whatsappSentConfirmedAt: completedAt,
      completedAt,
    });
  };

  const handleEditFinal = () => {
    const state = studyRef.current;
    if (state.stage !== 'whatsapp') return;
    const confirmed = window.confirm(
      'Edit your final answers? This will clear the current WhatsApp message and generate a new one. If you already sent the previous message, the researcher may already have that version.',
    );
    if (!confirmed) return;

    appendTiming(state.participantId, 'final_answers_edit_requested', {});
    commit({
      stage: 'final',
      finalQuestionnaireDraft: state.finalQuestionnaire
        ? normaliseFinalAnswers(state.finalQuestionnaire)
        : state.finalQuestionnaireDraft,
      finalQuestionnaire: null,
      finalQuestionnaireSubmittedAt: null,
      whatsappMessage: '',
      whatsappGeneratedAt: null,
      whatsappOpenedAt: null,
      whatsappOpenCount: 0,
      whatsappCopiedAt: null,
      whatsappSentConfirmedAt: null,
      completedAt: null,
    });
  };

  const handleDownloadSession = () => {
    const state = studyRef.current;
    downloadJson(`loading-study_${state.participantId}.json`, {
      exportedAt: nowIso(),
      participantId: state.participantId,
      state,
      timing: readTiming(state.participantId),
    });
  };

  const handleDownloadAll = () => {
    const state = studyRef.current;
    const stamp = nowIso().slice(0, 10);
    downloadJson(
      `loading-study_all-sessions_${stamp}.json`,
      collectAllSessions(state),
    );
  };

  const handleNewSession = () => {
    if (!researcherMode && !previewMode) return;
    const confirmed = window.confirm(
      'Archive this session and start a new anonymous participant? Download any data you need first. This does not delete WhatsApp messages already sent.',
    );
    if (!confirmed) return;

    archiveSession(studyRef.current);
    safeRemove(STATE_KEY);
    const fresh = createFreshState();
    studyRef.current = fresh;
    saveState(fresh);
    appendTiming(fresh.participantId, 'session_created', {
      conditionOrder: fresh.conditionOrder,
      createdAt: fresh.createdAt,
    });
    setStudy(fresh);
    setElapsed(0);
    setConsentChecked(false);
    setResearcherOpen(false);
    setFailureOpen(false);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            LX
          </span>
          <span className="brand-copy">
            <strong>Loading Experience Study</strong>
            <small>Anonymous usability research</small>
          </span>
        </div>
        <div className="participant-badge" title="Your anonymous participant ID">
          <span>Participant</span>
          <strong>{study.participantId}</strong>
        </div>
      </header>

      {previewMode ? (
        <div className="preview-banner" role="status">
          Preview mode — this session is stored separately and is not research data.
        </div>
      ) : null}

      <main id="main-content" className="main-content">
        {study.stage === 'consent' ? (
          <section className="card card--narrow" aria-labelledby="consent-title">
            <span className="eyebrow">Participant information</span>
            <h1 id="consent-title">Help us understand loading experiences</h1>
            <p className="lede">
              This study compares three common ways of showing that a web page is
              loading. You will try all three and answer short questionnaires about
              your impressions.
            </p>
            <div className="fact-grid">
              <div className="fact">
                <strong>3 short trials</strong>
                <span>Each loading experience has a fixed, brief duration.</span>
              </div>
              <div className="fact">
                <strong>About 10 minutes</strong>
                <span>Includes three short questionnaires and a final comparison.</span>
              </div>
              <div className="fact">
                <strong>Anonymous in the app</strong>
                <span>
                  No names, email addresses or phone numbers are stored by this app.
                </span>
              </div>
            </div>
            <div className="section-block">
              <h2>What happens in the session</h2>
              <ol className="instruction-list">
                <li>
                  You will complete three loading trials. The order is randomized for
                  each participant.
                </li>
                <li>
                  After each trial, you will answer a short questionnaire on this page.
                </li>
                <li>
                  When all three trials are complete, you will answer one final comparison
                  questionnaire and review a WhatsApp message.
                </li>
              </ol>
            </div>
            <div className="notice">
              <strong>Voluntary participation</strong>
              <p>
                Taking part is voluntary. You may stop at any time by closing this tab.
                The app records anonymized interaction timing and questionnaire answers on
                this device. At the end, one WhatsApp message containing your answers is
                prepared for you to send manually. The app does not store your phone
                number, but WhatsApp will show your WhatsApp number to the researcher when
                you send the message.
              </p>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(event) => setConsentChecked(event.target.checked)}
              />
              <span>
                I have read the information above and I agree to take part in this
                study voluntarily.
              </span>
            </label>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleConsent}
                disabled={!consentChecked}
              >
                I consent — continue to instructions
              </button>
            </div>
            <p className="fine-print">
              If something goes wrong, use “Report a technical problem” at the bottom of
              the page.
            </p>
          </section>
        ) : null}

        {study.stage === 'instructions' ? (
          <section className="card card--narrow" aria-labelledby="instructions-title">
            <span className="eyebrow">Instructions</span>
            <h1 id="instructions-title">How the session works</h1>
            <p className="lede">
              You will see the same web interface three times with a different loading
              indicator each time. Please treat each trial as a first impression.
            </p>
            <ol className="instruction-list instruction-list--spaced">
              <li>
                <strong>Start each trial when you are ready.</strong>
                <span>
                  Watch the interface until the completed content appears. Please do not
                  refresh, close the tab or navigate away during a loading trial.
                </span>
              </li>
              <li>
                <strong>Answer the questionnaire after each trial.</strong>
                <span>
                  Every required question must be answered on this page before you can
                  continue to the next loading trial.
                </span>
              </li>
              <li>
                <strong>Complete the final comparison and send your response.</strong>
                <span>
                  After all three trials, compare the three designs, review the generated
                  WhatsApp message, and press Send in WhatsApp. You will need WhatsApp on
                  this device to send the message.
                </span>
              </li>
            </ol>
            <div className="notice notice--soft">
              <strong>Good to know</strong>
              <p>
                The order of loading designs is randomized. There are no right or wrong
                answers. When estimating waiting time in the questionnaire, rely on your
                own impression rather than timing the screen.
              </p>
            </div>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleInstructionsContinue}
              >
                I understand — begin trial 1
              </button>
            </div>
          </section>
        ) : null}

        {study.stage === 'ready' ? (
          <section className="card card--narrow card--centered" aria-labelledby="ready-title">
            <TrialSteps current={currentTrialNumber} />
            <span className="eyebrow">Trial {currentTrialNumber} of 3</span>
            <h1 id="ready-title">Ready to begin?</h1>
            <p className="lede">
              Press start when you are ready. Keep this tab visible and watch the
              interface until the content appears.
            </p>
            <div className="btn-row btn-row--center">
              <button type="button" className="btn btn--primary btn--large" onClick={handleStart}>
                Start loading experience
              </button>
            </div>
            <p className="fine-print">
              The order of loading designs was randomized for your session.
            </p>
          </section>
        ) : null}

        {study.stage === 'interrupted' ? (
          <section
            className="card card--narrow card--centered"
            aria-labelledby="interrupted-title"
          >
            <TrialSteps current={currentTrialNumber} />
            <span className="eyebrow">Trial {currentTrialNumber} of 3</span>
            <h1 id="interrupted-title">The loading experience was interrupted</h1>
            <p className="lede">
              The page was reloaded before this trial finished. Your participant ID,
              randomized condition order and completed trials have been preserved.
            </p>
            <div className="notice notice--warning">
              <strong>Restart this trial</strong>
              <p>
                This will restart the same trial in the same randomized order. Trials
                you already completed will not be repeated.
              </p>
            </div>
            <div className="btn-row btn-row--center">
              <button type="button" className="btn btn--primary btn--large" onClick={handleStart}>
                Restart this trial
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setFailureOpen(true)}
              >
                Report a problem
              </button>
            </div>
          </section>
        ) : null}

        {study.stage === 'loading' ? (
          <section className="card card--wide" aria-labelledby="loading-title">
            <div className="screen-topline">
              <TrialSteps current={currentTrialNumber} />
              <span className="eyebrow">Trial {currentTrialNumber} of 3</span>
            </div>
            <h1 id="loading-title" className="visually-hidden">
              Trial {currentTrialNumber} loading experience
            </h1>
            <WorkspacePreview loading condition={currentCondition} progress={progress} />
            <p className="loading-caption">
              Please wait while the content loads. It will appear automatically when it
              is ready.
            </p>
          </section>
        ) : null}

        {study.stage === 'loaded' ? (
          <section className="card card--wide" aria-labelledby="loaded-title">
            <div className="screen-topline">
              <TrialSteps current={currentTrialNumber} />
              <span className="status-pill status-pill--success">Content loaded</span>
            </div>
            <h1 id="loaded-title" className="visually-hidden">
              Trial {currentTrialNumber} content loaded
            </h1>
            <WorkspacePreview loading={false} condition={currentCondition} progress={100} />
            <div className="loaded-actions">
              <div>
                <strong>The content has loaded.</strong>
                <p>Continue when you are ready to answer the questionnaire.</p>
              </div>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleContinueToQuestionnaire}
              >
                Continue to questionnaire
              </button>
            </div>
          </section>
        ) : null}

        {study.stage === 'questionnaire' ? (
          <section className="card card--narrow" aria-labelledby="questionnaire-title">
            <TrialSteps current={currentTrialNumber} />
            <span className="eyebrow">Trial {currentTrialNumber} complete</span>
            <h1 id="questionnaire-title">Questionnaire for this trial</h1>
            <p className="lede">
              Answer the questions below about the loading experience you just completed.
              All required questions must be answered before you continue.
            </p>
            <TrialQuestionnaire
              trialNumber={currentTrialNumber}
              condition={currentCondition}
              answers={trialDraft}
              onChange={updateTrialDraft}
              onSubmit={handleTrialQuestionnaireSubmit}
              isLastTrial={isLastTrial}
            />
          </section>
        ) : null}

        {study.stage === 'final' ? (
          <section className="card card--narrow" aria-labelledby="final-title">
            <TrialSteps current={3} allDone />
            <span className="eyebrow">Final comparison</span>
            <h1 id="final-title">Compare the three loading designs</h1>
            <p className="lede">
              All three trials are complete. Answer the final comparison questions. After
              you submit, your complete response will be generated as one WhatsApp message.
            </p>
            <ul className="design-legend" aria-label="The three loading designs">
              <li>
                <span className="legend-swatch legend-swatch--skeleton" aria-hidden="true" />
                <span>
                  <strong>{CONDITION_LABELS.skeleton}</strong>
                  Placeholder shapes that preview the layout.
                </span>
              </li>
              <li>
                <span className="legend-swatch legend-swatch--spinner" aria-hidden="true" />
                <span>
                  <strong>{CONDITION_LABELS.spinner}</strong>
                  A circular animation showing ongoing activity.
                </span>
              </li>
              <li>
                <span className="legend-swatch legend-swatch--progress" aria-hidden="true" />
                <span>
                  <strong>{CONDITION_LABELS.progress}</strong>
                  A bar that fills from 0% to 100%.
                </span>
              </li>
            </ul>
            <FinalQuestionnaire
              answers={finalDraft}
              onChange={updateFinalDraft}
              onSubmit={handleFinalQuestionnaireSubmit}
            />
          </section>
        ) : null}

        {study.stage === 'whatsapp' ? (
          <WhatsAppReview
            study={study}
            previewMode={previewMode}
            onOpen={handleOpenWhatsApp}
            onCopy={handleCopyWhatsApp}
            onConfirmSent={handleConfirmWhatsAppSent}
            onEditFinal={handleEditFinal}
          />
        ) : null}

        {study.stage === 'done' ? (
          <section className="card card--narrow card--centered" aria-labelledby="done-title">
            <span className="success-mark" aria-hidden="true">
              ✓
            </span>
            <span className="eyebrow">Session complete</span>
            <h1 id="done-title">Thank you for taking part</h1>
            <p className="lede">
              All three trials, the final questionnaire and your WhatsApp response are
              complete. Your anonymous participant ID is shown below.
            </p>
            <span className="participant-chip">{study.participantId}</span>
            <p className="fine-print">
              {previewMode
                ? 'Preview mode: no real WhatsApp message was sent and this sample is not research data. '
                : 'You confirmed that you pressed Send in WhatsApp. This app cannot verify delivery; the researcher receives your message only after you press Send. '}
              You may close this tab. Please do not restart the study in a new tab. If you
              need to report a problem, use the button below.
            </p>
          </section>
        ) : null}
      </main>

      <footer className="site-footer">
        <p>No names, email addresses or phone numbers are stored by this app.</p>
        <div className="footer-actions">
          <button
            type="button"
            className="text-button"
            onClick={() => setFailureOpen(true)}
          >
            Report a technical problem
          </button>
          {researcherMode || previewMode ? (
            <button
              type="button"
              className="text-button"
              onClick={() => setResearcherOpen(true)}
            >
              Researcher data
            </button>
          ) : null}
        </div>
      </footer>

      <TechnicalProblemDialog
        open={failureOpen}
        study={study}
        supportEmail={STUDY_CONFIG.supportEmail}
        onClose={() => setFailureOpen(false)}
      />
      <ResearcherDialog
        open={researcherOpen}
        study={study}
        onClose={() => setResearcherOpen(false)}
        onDownloadSession={handleDownloadSession}
        onDownloadAll={handleDownloadAll}
        onNewSession={handleNewSession}
      />
    </div>
  );
}
