/**
 * Loading Indicator Study - configuration
 * ========================================
 *
 * WhatsApp submission
 * -------------------
 * The provided local number is 7892448620. WhatsApp click-to-chat links require
 * the full international number without "+", spaces or hyphens. The India
 * country code (91) is included below. If this number uses a different country
 * code, replace `whatsappNumber` with the correct full international number.
 *
 * The WhatsApp number is configuration only. It is never written into the
 * participant state or exported as participant data.
 */
export const STUDY_CONFIG = {
  /**
   * Fixed loading duration in milliseconds. Keep this at 8000 for the study.
   * This value is never displayed to participants.
   */
  loadingDurationMs: 8000,

  /**
   * Optional. Add a contact address for the "Report a technical problem"
   * dialog. Leave empty to use the copy-report workflow instead. No name or
   * email address is collected from participants by this app.
   */
  supportEmail: '',

  /**
   * Full international WhatsApp number, digits only.
   * Provided local number: 7892448620 (India country code 91 added).
   * Example placeholder: 'WHATSAPP_NUMBER_NOT_CONFIGURED'.
   */
  whatsappNumber: '917892448620',
};

export const CONDITION_KEYS = ['skeleton', 'spinner', 'progress'];

export const CONDITION_LABELS = {
  skeleton: 'Skeleton Screen',
  spinner: 'Loading Spinner',
  progress: 'Progress Bar',
};

export function getWhatsAppNumber() {
  const digits = String(STUDY_CONFIG.whatsappNumber ?? '').replace(/\D/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : '';
}

export function getWhatsAppLink(message) {
  const number = getWhatsAppNumber();
  if (!number || typeof message !== 'string' || !message.trim()) return '';
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
