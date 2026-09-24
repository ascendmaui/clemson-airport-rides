import assert from 'node:assert/strict'
import test from 'node:test'
import {
  KNOWLEDGE_QUIZ,
  QUIZ_PASS_PERCENT,
  STUDY_NOTES,
  gradeKnowledgeQuiz,
  knowledgeQuizPassed,
  knowledgeQuizStatus,
  knowledgeQuizStatusLabel,
  saveKnowledgeQuiz,
} from './driverKnowledgeQuiz.js'

function picks(correctCount) {
  const selections = {}
  KNOWLEDGE_QUIZ.forEach((question, index) => {
    selections[question.id] = index < correctCount ? question.answerId : 'wrong'
  })
  return selections
}

test('five questions cover the in-app driver notes', () => {
  assert.equal(KNOWLEDGE_QUIZ.length, 5)
  assert.equal(STUDY_NOTES.length, 5)
  const noteIds = STUDY_NOTES.map((note) => note.id)
  for (const question of KNOWLEDGE_QUIZ) {
    assert.ok(noteIds.includes(question.id))
    assert.equal(question.choices.length, 4)
    assert.ok(question.choices.some((choice) => choice.id === question.answerId))
  }
  const firstChoiceAnswers = KNOWLEDGE_QUIZ.filter((question) => question.choices[0].id === question.answerId)
  assert.ok(firstChoiceAnswers.length < KNOWLEDGE_QUIZ.length)
})

test('pass is 80 percent and at most one miss', () => {
  const perfect = gradeKnowledgeQuiz(picks(5))
  const oneMiss = gradeKnowledgeQuiz(picks(4))
  const twoMiss = gradeKnowledgeQuiz(picks(3))
  const blank = gradeKnowledgeQuiz({})

  assert.equal(perfect.score, 100)
  assert.equal(perfect.passed, true)
  assert.equal(oneMiss.correct, 4)
  assert.equal(oneMiss.score, QUIZ_PASS_PERCENT)
  assert.equal(oneMiss.passed, true)
  assert.equal(oneMiss.missed.length, 1)
  assert.equal(twoMiss.score, 60)
  assert.equal(twoMiss.passed, false)
  assert.equal(blank.score, 0)
  assert.equal(blank.passed, false)
  assert.equal(knowledgeQuizPassed(4, 5), true)
  assert.equal(knowledgeQuizPassed(3, 5), false)
  assert.equal(knowledgeQuizPassed(3, 4), false)
})

test('saved status is not started, failed, or passed', () => {
  assert.equal(knowledgeQuizStatus(null), 'not_started')
  assert.equal(knowledgeQuizStatus({ quiz_score: null, quiz_passed_at: null, quiz_attempted_at: null }), 'not_started')
  assert.equal(knowledgeQuizStatus({ quiz_score: 60, quiz_passed_at: null, quiz_attempted_at: '2026-09-24T00:00:00Z' }), 'failed')
  assert.equal(knowledgeQuizStatus({ quiz_score: 80, quiz_passed_at: '2026-09-24T00:00:00Z', quiz_attempted_at: '2026-09-24T00:00:00Z' }), 'passed')
  assert.equal(knowledgeQuizStatusLabel('not_started'), 'Not started')
  assert.equal(knowledgeQuizStatusLabel('failed'), 'Failed')
  assert.equal(knowledgeQuizStatusLabel('passed'), 'Passed')
})

test('save records the score and does not approve the driver', async () => {
  const calls = []
  const supabase = {
    rpc(name, args) {
      calls.push({ name, args })
      return Promise.resolve({
        data: {
          quiz_score: args.score,
          quiz_passed_at: '2026-09-24T00:00:00Z',
          quiz_attempted_at: '2026-09-24T00:00:00Z',
          onboarding_status: 'pending_review',
        },
        error: null,
      })
    },
    from() {
      throw new Error('direct write should wait until the rpc is missing')
    },
  }
  const saved = await saveKnowledgeQuiz(supabase, 'driver-1', gradeKnowledgeQuiz(picks(5)))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'record_driver_knowledge_quiz')
  assert.equal(calls[0].args.score, 100)
  assert.equal(Object.hasOwn(calls[0].args, 'onboarding_status'), false)
  assert.equal(saved.row.onboarding_status, 'pending_review')
  assert.equal(saved.row.quiz_score, 100)
  assert.ok(saved.row.quiz_passed_at)
  assert.equal(saved.error, null)
})

test('a missing rpc updates quiz columns and leaves approval untouched', async () => {
  let patch = null
  const supabase = {
    rpc() {
      return Promise.resolve({
        data: null,
        error: { message: 'Could not find the function public.record_driver_knowledge_quiz(score) in the schema cache' },
      })
    },
    from(table) {
      assert.equal(table, 'driver_applications')
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: {
                    quiz_score: null,
                    quiz_passed_at: null,
                    quiz_attempted_at: null,
                    onboarding_status: 'pending_review',
                  },
                  error: null,
                }),
              }
            },
          }
        },
        update(values) {
          patch = values
          return {
            eq() {
              return {
                select() {
                  return {
                    maybeSingle: async () => ({
                      data: { ...values, onboarding_status: 'pending_review' },
                      error: null,
                    }),
                  }
                },
              }
            },
          }
        },
        insert() {
          throw new Error('existing application should be updated')
        },
      }
    },
  }
  const saved = await saveKnowledgeQuiz(supabase, 'driver-1', gradeKnowledgeQuiz(picks(4)))
  assert.equal(patch.quiz_score, 80)
  assert.ok(patch.quiz_passed_at)
  assert.equal(patch.onboarding_status, undefined)
  assert.equal(patch.status, undefined)
  assert.equal(saved.row.onboarding_status, 'pending_review')
  assert.equal(knowledgeQuizStatus(saved.row), 'passed')
})

test('a saved pass is not replaced by a later miss', async () => {
  let updated = false
  const supabase = {
    rpc() {
      return Promise.resolve({
        data: null,
        error: { message: 'record_driver_knowledge_quiz missing from schema cache' },
      })
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: {
                    quiz_score: 80,
                    quiz_passed_at: '2026-09-24T00:00:00Z',
                    quiz_attempted_at: '2026-09-24T00:00:00Z',
                    onboarding_status: 'pending_info',
                  },
                  error: null,
                }),
              }
            },
          }
        },
        update() {
          updated = true
          throw new Error('pass should stay')
        },
      }
    },
  }
  const saved = await saveKnowledgeQuiz(supabase, 'driver-1', gradeKnowledgeQuiz(picks(0)))
  assert.equal(updated, false)
  assert.equal(saved.row.quiz_score, 80)
  assert.equal(knowledgeQuizStatus(saved.row), 'passed')
})
