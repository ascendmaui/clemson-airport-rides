/**
 * Driver Learning Center quiz.
 * A pass is stored on driver_applications. It does not approve the driver.
 * Going online and accepting rides stay on onboarding_status = approved.
 */

export const QUIZ_PASS_PERCENT = 80
export const QUIZ_MAX_MISSES = 1

export const STUDY_NOTES = [
  {
    id: 'online',
    title: 'Go online',
    body: 'The orange GO button publishes your name, vehicle, and live pin. END takes you offline. Going online and accepting rides stay locked until an admin approves your application.',
  },
  {
    id: 'fare',
    title: 'Your 80%',
    body: 'You net 80% of the fare. Clemson RIDES keeps 20%. Airport trips can collect a 25% deposit before the ride and the rest on complete.',
  },
  {
    id: 'gameday',
    title: 'Game day',
    body: 'If a game day is live, Discover and the home map show the pickup zone and the rider fare multiplier from the server.',
  },
  {
    id: 'queue',
    title: 'Queue',
    body: 'Student, game day, and weekend filters live on the queue. Declining an open match releases it. Declining a scheduled ride only hides that card on this phone.',
  },
  {
    id: 'safety',
    title: 'Safety and standing',
    body: 'If you are in danger, call 911. Clemson University Police are (864) 656-2222 from the shield button on home. Watch standing is a rating under 3.0 after 3 ratings, and you can still be matched. Restricted standing is under 2.5 after 5 ratings, and riders will not see you.',
  },
]

export const KNOWLEDGE_QUIZ = [
  {
    id: 'online',
    prompt: 'What does the orange GO button do, and who can accept rides?',
    choices: [
      {
        id: 'publish',
        label: 'GO publishes your name, vehicle, and live pin. END takes you offline. Going online and accepting rides stay locked until an admin approves you.',
      },
      {
        id: 'instant',
        label: 'GO approves your application so you can accept rides immediately.',
      },
      {
        id: 'quiz-only',
        label: 'Passing this quiz is enough to go online. Admin approval is not required.',
      },
      {
        id: 'end-visible',
        label: 'END keeps you visible to riders. Pending drivers can accept airport trips.',
      },
    ],
    answerId: 'publish',
  },
  {
    id: 'fare',
    prompt: 'How do fares and airport deposits work?',
    choices: [
      {
        id: 'cash',
        label: 'You keep the full fare. Airport riders pay you in cash.',
      },
      {
        id: 'split',
        label: 'You net 80% of the fare. Clemson RIDES keeps 20%. Airport trips can collect a 25% deposit before the ride and the rest when you complete.',
      },
      {
        id: 'reversed',
        label: 'You keep 20%. The 25% deposit is your payout.',
      },
      {
        id: 'half',
        label: 'The split is 50/50, and the deposit is collected only after the trip.',
      },
    ],
    answerId: 'split',
  },
  {
    id: 'gameday',
    prompt: 'When a game day is live, where do the pickup zone and rider fare multiplier come from?',
    choices: [
      {
        id: 'settings',
        label: 'You draw the zone yourself in Settings.',
      },
      {
        id: 'map',
        label: 'Discover and the home map show the pickup zone and the rider fare multiplier from the server.',
      },
      {
        id: 'earnings',
        label: 'Only Earnings shows a flat stadium fare.',
      },
      {
        id: 'monday',
        label: 'The queue hides game-day rides until Monday.',
      },
    ],
    answerId: 'map',
  },
  {
    id: 'queue',
    prompt: 'What happens when you decline a ride?',
    choices: [
      {
        id: 'cancel-all',
        label: 'Every decline cancels the trip for all drivers.',
      },
      {
        id: 'release',
        label: 'Declining an open match releases it. Declining a scheduled ride only hides that card on this phone.',
      },
      {
        id: 'fee',
        label: 'Declining a scheduled ride cancels the rider’s booking and charges you a fee.',
      },
      {
        id: 'accept',
        label: 'Decline accepts the ride for you and starts navigation.',
      },
    ],
    answerId: 'release',
  },
  {
    id: 'safety',
    prompt: 'What are the safety and standing basics?',
    choices: [
      {
        id: 'basics',
        label: 'Call 911 if you are in danger. Clemson University Police are (864) 656-2222. Restricted standing (under 2.5 after 5 ratings) hides you from riders. Watch (under 3.0 after 3 ratings) is a soft flag and you can still be matched.',
      },
      {
        id: 'text',
        label: 'Text the rider app for emergencies. Standing never changes who can see you.',
      },
      {
        id: 'go-police',
        label: 'The orange GO button calls police. One rating under 5 restricts you.',
      },
      {
        id: 'watch-blocks',
        label: 'Campus police replace 911. Watch standing blocks matching.',
      },
    ],
    answerId: 'basics',
  },
]

export function knowledgeQuizPassed(correct, total) {
  const answered = Number(correct) || 0
  const count = Number(total) || 0
  if (count <= 0 || answered < 0 || answered > count) return false
  const missed = count - answered
  const percent = (answered / count) * 100
  return percent >= QUIZ_PASS_PERCENT && missed <= QUIZ_MAX_MISSES
}

export function gradeKnowledgeQuiz(selections = {}) {
  const total = KNOWLEDGE_QUIZ.length
  const missed = []
  let correct = 0
  for (const question of KNOWLEDGE_QUIZ) {
    if (selections?.[question.id] === question.answerId) correct += 1
    else missed.push(question.id)
  }
  const score = total ? Math.round((correct / total) * 100) : 0
  return {
    correct,
    total,
    score,
    missed,
    passed: knowledgeQuizPassed(correct, total),
  }
}

export function knowledgeQuizStatus(row) {
  if (row?.quiz_passed_at) return 'passed'
  if (row?.quiz_attempted_at || row?.quiz_score != null) return 'failed'
  return 'not_started'
}

export function knowledgeQuizStatusLabel(status) {
  switch (status) {
    case 'not_started':
      return 'Not started'
    case 'failed':
      return 'Failed'
    case 'passed':
      return 'Passed'
    default: {
      const unknown = status
      throw new Error(`Unknown quiz status: ${unknown}`)
    }
  }
}

const QUIZ_COLUMNS = 'quiz_score, quiz_passed_at, quiz_attempted_at, onboarding_status'

function client(supabase) {
  if (!supabase || typeof supabase.from !== 'function' || typeof supabase.rpc !== 'function') {
    throw new Error('Supabase is not configured')
  }
  return supabase
}

function missingQuizColumn(message) {
  return /quiz_score|quiz_passed_at|quiz_attempted_at|schema cache/i.test(String(message || ''))
}

function missingQuizFunction(message) {
  return /record_driver_knowledge_quiz|schema cache|could not find the function/i.test(String(message || ''))
}

export function normalizeQuizRow(data) {
  if (!data || typeof data !== 'object') return null
  const score = data.quiz_score
  return {
    quiz_score: score == null || score === '' ? null : Number(score),
    quiz_passed_at: data.quiz_passed_at || null,
    quiz_attempted_at: data.quiz_attempted_at || null,
    onboarding_status: data.onboarding_status || null,
  }
}

export async function loadKnowledgeQuiz(supabase, userId) {
  if (!userId) return { row: null, error: null }
  const db = client(supabase)
  const { data, error } = await db
    .from('driver_applications')
    .select(QUIZ_COLUMNS)
    .eq('profile_id', userId)
    .maybeSingle()
  if (error) {
    if (missingQuizColumn(error.message)) {
      return { row: null, error: 'Knowledge quiz results are not on this database yet.' }
    }
    return { row: null, error: error.message }
  }
  return { row: normalizeQuizRow(data), error: null }
}

function passingStamp(score, now) {
  return score >= QUIZ_PASS_PERCENT ? now : null
}

async function saveKnowledgeQuizDirect(db, userId, score) {
  const now = new Date().toISOString()
  const existing = await db
    .from('driver_applications')
    .select(QUIZ_COLUMNS)
    .eq('profile_id', userId)
    .maybeSingle()
  if (existing.error) {
    if (missingQuizColumn(existing.error.message)) {
      return { row: null, error: 'Knowledge quiz results are not on this database yet.' }
    }
    return { row: null, error: existing.error.message }
  }

  const current = normalizeQuizRow(existing.data)
  if (current?.quiz_passed_at) return { row: current, error: null }

  const patch = {
    quiz_score: score,
    quiz_attempted_at: now,
    quiz_passed_at: passingStamp(score, now),
  }

  if (current) {
    const updated = await db
      .from('driver_applications')
      .update(patch)
      .eq('profile_id', userId)
      .select(QUIZ_COLUMNS)
      .maybeSingle()
    if (updated.error) return { row: null, error: updated.error.message }
    return { row: normalizeQuizRow(updated.data), error: null }
  }

  const inserted = await db
    .from('driver_applications')
    .insert({
      profile_id: userId,
      is_student: false,
      has_car: false,
      has_insurance: false,
      wants_extra_money: false,
      onboarding_status: 'pending_info',
      ...patch,
    })
    .select(QUIZ_COLUMNS)
    .maybeSingle()
  if (inserted.error) return { row: null, error: inserted.error.message }
  return { row: normalizeQuizRow(inserted.data), error: null }
}

export async function saveKnowledgeQuiz(supabase, userId, grade) {
  if (!userId) return { row: null, error: 'Sign in required' }
  const score = Number(grade?.score)
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    return { row: null, error: 'Score must be a whole number from 0 to 100.' }
  }
  const db = client(supabase)
  const rpc = await db.rpc('record_driver_knowledge_quiz', { score })
  if (!rpc.error) return { row: normalizeQuizRow(rpc.data), error: null }
  if (!missingQuizFunction(rpc.error.message)) return { row: null, error: rpc.error.message }
  return saveKnowledgeQuizDirect(db, userId, score)
}
