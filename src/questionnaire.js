import { CONDITION_KEYS, CONDITION_LABELS } from './config.js';

export const PERCEIVED_DURATION_OPTIONS = [
  '1 second',
  '2 seconds',
  '3 seconds',
  '4 seconds',
  '5 seconds',
  '6 seconds',
  '7 seconds',
  '8 seconds',
  '9 seconds',
  '10 seconds',
  '11 seconds',
  '12 seconds',
  '13 seconds',
  '14 seconds',
  '15 seconds',
  'More than 15 seconds',
];

export const AGREEMENT_OPTIONS = [
  { value: 1, label: 'Strongly Disagree' },
  { value: 2, label: 'Disagree' },
  { value: 3, label: 'Neither Agree nor Disagree' },
  { value: 4, label: 'Agree' },
  { value: 5, label: 'Strongly Agree' },
];

export const OVERALL_RATING_OPTIONS = [
  { value: 1, label: 'Very Poor' },
  { value: 2, label: 'Poor' },
  { value: 3, label: 'Average' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'Excellent' },
];

export const REUSE_OPTIONS = ['Yes', 'No', 'Not Sure'];

export const TRIAL_LIKERT_FIELDS = [
  {
    key: 'progressClarity',
    question: 'Q3. The loading indicator clearly communicated the loading state.',
  },
  {
    key: 'understanding',
    question: 'Q4. I understood what the application was doing while loading.',
  },
  {
    key: 'responsiveness',
    question: 'Q5. The application felt responsive during the loading process.',
  },
  {
    key: 'satisfaction',
    question: 'Q6. I was satisfied with the loading experience.',
  },
];

export const FINAL_CHOICE_FIELDS = [
  {
    key: 'preferred',
    question: 'Q1. Which loading indicator did you prefer overall?',
  },
  {
    key: 'clearest',
    question: 'Q2. Which loading indicator communicated the loading state most clearly?',
  },
  {
    key: 'shortest',
    question: 'Q3. Which loading indicator made the waiting time feel shortest?',
  },
  {
    key: 'responsive',
    question: 'Q4. Which loading indicator made the application feel most responsive?',
  },
];

export function emptyTrialAnswers() {
  return {
    perceivedDuration: '',
    progressClarity: null,
    understanding: null,
    responsiveness: null,
    satisfaction: null,
  };
}

export function emptyFinalAnswers() {
  return {
    preferred: '',
    clearest: '',
    shortest: '',
    responsive: '',
    overall: null,
    reuse: '',
    comments: '',
  };
}

function isLikert(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function isCondition(value) {
  return CONDITION_KEYS.includes(value);
}

export function normaliseTrialAnswers(value) {
  const base = emptyTrialAnswers();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;

  return {
    perceivedDuration: PERCEIVED_DURATION_OPTIONS.includes(value.perceivedDuration)
      ? value.perceivedDuration
      : '',
    progressClarity: isLikert(value.progressClarity) ? value.progressClarity : null,
    understanding: isLikert(value.understanding) ? value.understanding : null,
    responsiveness: isLikert(value.responsiveness) ? value.responsiveness : null,
    satisfaction: isLikert(value.satisfaction) ? value.satisfaction : null,
  };
}

export function normaliseFinalAnswers(value) {
  const base = emptyFinalAnswers();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;

  return {
    preferred: isCondition(value.preferred) ? value.preferred : '',
    clearest: isCondition(value.clearest) ? value.clearest : '',
    shortest: isCondition(value.shortest) ? value.shortest : '',
    responsive: isCondition(value.responsive) ? value.responsive : '',
    overall: isLikert(value.overall) ? value.overall : null,
    reuse: REUSE_OPTIONS.includes(value.reuse) ? value.reuse : '',
    comments: typeof value.comments === 'string' ? value.comments : '',
  };
}

export function getTrialQuestionnaireErrors(answers) {
  const errors = {};
  if (!PERCEIVED_DURATION_OPTIONS.includes(answers.perceivedDuration)) {
    errors.perceivedDuration = 'Please select how long the loading experience felt.';
  }
  TRIAL_LIKERT_FIELDS.forEach(({ key, question }) => {
    if (!isLikert(answers[key])) {
      errors[key] = `Please answer: ${question.replace(/^Q\d+\.\s*/, '')}`;
    }
  });
  return errors;
}

export function getFinalQuestionnaireErrors(answers) {
  const errors = {};
  FINAL_CHOICE_FIELDS.forEach(({ key, question }) => {
    if (!isCondition(answers[key])) {
      errors[key] = `Please answer: ${question.replace(/^Q\d+\.\s*/, '')}`;
    }
  });
  if (!isLikert(answers.overall)) {
    errors.overall = 'Please rate your overall experience.';
  }
  if (!REUSE_OPTIONS.includes(answers.reuse)) {
    errors.reuse = 'Please choose Yes, No or Not Sure.';
  }
  return errors;
}

export function countTrialAnswers(answers) {
  const fields = ['perceivedDuration', 'progressClarity', 'understanding', 'responsiveness', 'satisfaction'];
  return fields.filter((key) =>
    key === 'perceivedDuration'
      ? PERCEIVED_DURATION_OPTIONS.includes(answers[key])
      : isLikert(answers[key]),
  ).length;
}

export function countFinalAnswers(answers) {
  const fields = ['preferred', 'clearest', 'shortest', 'responsive', 'overall', 'reuse'];
  return fields.filter((key) =>
    key === 'overall' ? isLikert(answers[key]) : key === 'reuse' ? REUSE_OPTIONS.includes(answers[key]) : isCondition(answers[key]),
  ).length;
}

function formatAgreement(value) {
  const option = AGREEMENT_OPTIONS.find((item) => item.value === value);
  return option ? `${option.label} (${option.value})` : 'Not provided';
}

function formatOverall(value) {
  const option = OVERALL_RATING_OPTIONS.find((item) => item.value === value);
  return option ? `${option.label} (${option.value})` : 'Not provided';
}

function formatSubmissionDate(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function trialByNumber(trialResults, trialNumber) {
  return (trialResults || []).find((result) => result.trialNumber === trialNumber);
}

export function buildWhatsAppMessage(state, { preview = false } = {}) {
  const lines = [
    'LOADING INDICATOR RESEARCH — PARTICIPANT RESPONSE',
    '',
  ];

  if (preview) {
    lines.push('PREVIEW MODE — SAMPLE MESSAGE, NOT RESEARCH DATA', '');
  }

  lines.push(
    `Participant ID: ${state.participantId}`,
    `Submission Date: ${formatSubmissionDate(
      state.finalQuestionnaireSubmittedAt || state.whatsappGeneratedAt || state.completedAt,
    )}`,
  );

  for (let trialNumber = 1; trialNumber <= 3; trialNumber += 1) {
    const trial = trialByNumber(state.trialResults, trialNumber);
    const answers = trial?.questionnaire || {};
    lines.push(
      '',
      '================================',
      '',
      `TRIAL ${trialNumber}`,
      '',
      `Loading Indicator: ${CONDITION_LABELS[trial?.condition] ?? 'Not recorded'}`,
      `Actual Loading Duration: ${
        typeof trial?.elapsedMs === 'number' ? `${Math.round(trial.elapsedMs)} ms` : 'Not recorded'
      }`,
      `Perceived Waiting Time: ${answers.perceivedDuration || 'Not provided'}`,
      '',
      `Progress Clarity: ${formatAgreement(answers.progressClarity)}`,
      `Understanding of Loading State: ${formatAgreement(answers.understanding)}`,
      `Perceived Responsiveness: ${formatAgreement(answers.responsiveness)}`,
      `Satisfaction: ${formatAgreement(answers.satisfaction)}`,
    );
  }

  const finalAnswers = state.finalQuestionnaire || {};
  const comments = finalAnswers.comments?.trim();

  lines.push(
    '',
    '================================',
    '',
    'FINAL PREFERENCE',
    '',
    `Preferred Loading Indicator: ${CONDITION_LABELS[finalAnswers.preferred] ?? 'Not provided'}`,
    `Clearest Loading Indicator: ${CONDITION_LABELS[finalAnswers.clearest] ?? 'Not provided'}`,
    `Shortest Perceived Waiting Time: ${CONDITION_LABELS[finalAnswers.shortest] ?? 'Not provided'}`,
    `Most Responsive Indicator: ${CONDITION_LABELS[finalAnswers.responsive] ?? 'Not provided'}`,
    `Overall Experience Rating: ${formatOverall(finalAnswers.overall)}`,
    `Would Use Preferred Indicator Again: ${finalAnswers.reuse || 'Not provided'}`,
    '',
    `Additional Comments: ${comments || 'Not Provided'}`,
    '',
    '================================',
    '',
    'END OF PARTICIPANT RESPONSE',
  );

  return lines.join('\n');
}
