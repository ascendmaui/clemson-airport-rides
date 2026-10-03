/**
 * Driver-application emails. Copy is built here so tests can assert it
 * without calling Resend. Delivery goes through sendApplicantNotice.
 */
import { IC_AGREEMENT_HTML, IC_AGREEMENT_TITLE, IC_AGREEMENT_VERSION } from '../shared/icAgreement.js'
import {
  REQUIRED_DOCUMENTS,
  WORK_ELIGIBILITY_CATEGORIES,
  blockerLabel,
  displayTinLast4,
  submissionBlockers,
} from '../shared/driverOnboarding.js'
import { sendApplicantNotice } from './applicantMail.js'

export const ONBOARDING_MAIL_STAGES = ['license', 'insurance', 'registration', 'car', 'employment', 'w9']

const STAGE_LABELS = {
  license: 'Driver license',
  insurance: 'Insurance card',
  registration: 'Car registration',
  car: 'Car photos',
  employment: 'Employment verification',
  w9: 'W-9',
}

const STAGE_DOCS = {
  license: ['license_front', 'license_back'],
  insurance: ['insurance_front', 'insurance_back'],
  registration: ['registration'],
  car: ['car_front', 'car_back', 'car_left', 'car_right'],
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function stageReady(stage, ctx = {}) {
  switch (stage) {
    case 'license':
    case 'insurance':
    case 'registration':
    case 'car':
      return STAGE_DOCS[stage].every((id) => (ctx.uploaded || []).includes(id))
    case 'employment':
      return Boolean(ctx.backgroundAuthorized && ctx.workEligibilityAttested && ctx.workEligibilityCategory)
    case 'w9':
      return Boolean(ctx.taxSaved)
    default: {
      const unknown = stage
      void unknown
      return false
    }
  }
}

export function remainingLabels(ctx = {}) {
  return submissionBlockers(ctx).map(blockerLabel)
}

function agreementPlainText(html) {
  return String(html || IC_AGREEMENT_HTML)
    .replace(/<h1>/gi, '')
    .replace(/<h2>/gi, '\n')
    .replace(/<\/h[12]>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function greeting(name) {
  const clean = String(name || '').trim()
  return clean ? `Hi ${clean},` : 'Hi,'
}

function reminderLines(ctx) {
  const left = remainingLabels(ctx)
  if (!left.length) {
    return [
      'Everything required for this application is on file, including the signed independent contractor agreement.',
      'Submit it when you are ready. An admin still has to approve you before you can receive rides.',
    ]
  }
  return [
    `Still to finish before admin review: ${left.join('; ')}.`,
    'The independent contractor agreement is signed during this application, before the application is ready for an admin to approve.',
  ]
}

export function accountSavedNotice({ name, ctx }) {
  const text = [
    greeting(name),
    '',
    'Your Clemson RIDES driver application has your account and vehicle on file.',
    '',
    ...reminderLines(ctx),
    '',
    'Open the driver application to continue.',
  ].join('\n')
  return {
    subject: 'Clemson RIDES application — account saved',
    text,
    appNote: 'Account and vehicle saved. Finish the remaining application steps, including the independent contractor agreement, before admin review.',
  }
}

export function stageNotice({ stage, name, ctx }) {
  const label = STAGE_LABELS[stage] || 'Application step'
  const text = [
    greeting(name),
    '',
    `${label} is saved on your Clemson RIDES driver application.`,
    '',
    ...reminderLines(ctx),
    '',
    'Open the driver application to continue.',
  ].join('\n')
  return {
    subject: `Clemson RIDES application — ${label} saved`,
    text,
    appNote: `${label} saved on your driver application.`,
  }
}

export function submittedNotice({ name }) {
  const text = [
    greeting(name),
    '',
    'Your Clemson RIDES driver application is submitted and waiting for admin review.',
    'Your signed independent contractor agreement is part of that application.',
    'You will not receive rides until an admin approves you.',
    '',
    'Open the driver application to follow the review.',
  ].join('\n')
  return {
    subject: 'Clemson RIDES application submitted for review',
    text,
    appNote: 'Application submitted. Waiting for admin review. You cannot receive rides until you are approved.',
  }
}

export function decisionNotice({ name, decision, reason }) {
  if (decision === 'approve') {
    const text = [
      greeting(name),
      '',
      'An admin approved your Clemson RIDES driver application.',
      'You can go online and accept rides.',
    ].join('\n')
    return {
      subject: 'Clemson RIDES — you are approved to drive',
      text,
      appNote: 'An admin approved your driver application. You can go online and accept rides.',
    }
  }
  const why = String(reason || '').trim()
  const text = [
    greeting(name),
    '',
    'An admin needs changes on your Clemson RIDES driver application before you can drive.',
    why ? '' : null,
    why ? why : null,
    '',
    'Open the driver application, update what was asked, and submit again.',
  ].filter((line) => line != null).join('\n')
  return {
    subject: 'Clemson RIDES — application needs changes',
    text,
    appNote: why
      ? `An admin needs changes before you can drive. ${why}`.slice(0, 4000)
      : 'An admin needs changes on your driver application before you can drive.',
  }
}

export function applicationInfoLines({ profile, vehicle, tax, documents, employment }) {
  const vehicleLabel = [vehicle?.color, vehicle?.make, vehicle?.model, vehicle?.plate].filter(Boolean).join(' ')
  const category = WORK_ELIGIBILITY_CATEGORIES.find((item) => item.id === employment?.work_eligibility_category)
  const docLabels = (documents || []).map((id) => REQUIRED_DOCUMENTS.find((doc) => doc.id === id)?.label || id)
  const tin = displayTinLast4(tax?.tin_last4)
  return [
    `Name: ${profile?.full_name || 'Not on file'}`,
    `Email: ${profile?.email || 'Not on file'}`,
    `Phone: ${profile?.phone || 'Not on file'}`,
    `Vehicle: ${vehicleLabel || 'Not on file'}`,
    `Work eligibility: ${category ? category.label : 'Not on file'}`,
    `W-9 legal name: ${tax?.legal_name || 'Not on file'}`,
    `TIN on file: ${tin || 'Not on file'}`,
    `Documents on file: ${docLabels.length ? docLabels.join(', ') : 'None yet'}`,
  ]
}

export function signedAgreementNotice({ name, profile, vehicle, tax, documents, employment, agreement }) {
  const signedAt = agreement?.signed_at ? new Date(agreement.signed_at).toISOString() : 'Not recorded'
  const info = applicationInfoLines({ profile, vehicle, tax, documents, employment })
  const signature = [
    `Signed name: ${agreement?.signature_name || name || 'Not recorded'}`,
    `Signed at: ${signedAt}`,
    `Version: ${agreement?.agreement_version || IC_AGREEMENT_VERSION}`,
    `SHA-256: ${agreement?.agreement_sha256 || 'Not recorded'}`,
  ]
  const plain = [
    greeting(name || profile?.full_name),
    '',
    `You signed the ${IC_AGREEMENT_TITLE} during your Clemson RIDES driver application.`,
    'A copy is below, with the application information on file when you signed.',
    'This signature is part of the application, before an admin reviews it.',
    '',
    'Application',
    ...info,
    '',
    'Signature',
    ...signature,
    '',
    'Agreement',
    agreement?.plain_text || agreementPlainText(agreement?.html_snapshot || IC_AGREEMENT_HTML),
  ].join('\n')
  const html = [
    `<p>${escapeHtml(greeting(name || profile?.full_name))}</p>`,
    `<p>You signed the ${escapeHtml(IC_AGREEMENT_TITLE)} during your Clemson RIDES driver application. A copy is below, with the application information on file when you signed.</p>`,
    '<h2>Application</h2>',
    info.map((line) => `<p>${escapeHtml(line)}</p>`).join(''),
    '<h2>Signature</h2>',
    signature.map((line) => `<p>${escapeHtml(line)}</p>`).join(''),
    '<h2>Agreement</h2>',
    agreement?.html_snapshot || IC_AGREEMENT_HTML,
  ].join('')
  return {
    subject: 'Your signed Clemson RIDES independent contractor agreement',
    text: plain,
    html,
    appNote: `You signed the independent contractor agreement${agreement?.signature_name ? ` as ${agreement.signature_name}` : ''}. A copy was emailed to you.`,
  }
}

export async function sendDriverNotice({ to, notice }) {
  if (!notice) return { emailed: false, todo: 'Nothing to send.' }
  return sendApplicantNotice({
    to,
    subject: notice.subject,
    text: notice.text,
    html: notice.html,
  })
}

/** Email when Resend is configured, and always try the in-app thread. One of the two is enough. */
export async function deliverDriverMail(sb, userId, email, notice) {
  let noticeResult = { emailed: false, todo: 'Nothing to send.' }
  try {
    noticeResult = await sendDriverNotice({ to: email, notice })
  } catch (err) {
    noticeResult = { emailed: false, todo: err.message || 'Email failed.' }
  }
  let appNote = { stored: false }
  try {
    appNote = await recordDriverAppNote(sb, {
      profileId: userId,
      body: notice?.appNote,
      emailTodo: noticeResult.emailed ? null : noticeResult.todo,
    })
  } catch (err) {
    appNote = { stored: false, error: err.message || 'In-app note failed.' }
  }
  return {
    emailed: Boolean(noticeResult.emailed),
    email_todo: noticeResult.emailed ? null : (noticeResult.todo || null),
    in_app: Boolean(appNote.stored),
    delivered: Boolean(noticeResult.emailed || appNote.stored),
  }
}

/** In-app thread note. Email failure still leaves this for the driver to read. */
export async function recordDriverAppNote(sb, { profileId, body, emailTodo }) {
  const text = String(body || '').trim()
  if (!sb || !profileId || !text) return { stored: false }
  const { error } = await sb.from('driver_application_messages').insert({
    profile_id: profileId,
    author_id: null,
    author_role: 'system',
    kind: 'message',
    body: text.slice(0, 4000),
    email_stub: emailTodo || null,
  })
  return { stored: !error, error: error?.message || null }
}
