import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, ErrorText, Primary, Tag } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import {
  KNOWLEDGE_QUIZ,
  QUIZ_MAX_MISSES,
  QUIZ_PASS_PERCENT,
  STUDY_NOTES,
  gradeKnowledgeQuiz,
  knowledgeQuizStatus,
  knowledgeQuizStatusLabel,
  loadKnowledgeQuiz,
  saveKnowledgeQuiz,
  type KnowledgeGrade,
  type KnowledgeQuizRow,
  type KnowledgeQuizStatus,
} from 'rides-native/driverKnowledgeQuiz'

type Phase = 'study' | 'question' | 'result'

function statusTone(status: KnowledgeQuizStatus): 'orange' | 'purple' {
  switch (status) {
    case 'passed':
      return 'orange'
    case 'failed':
    case 'not_started':
      return 'purple'
    default: {
      const unknown: never = status
      return unknown
    }
  }
}

export default function LearningScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const { colors } = useTheme()
  const fade = useRef(new Animated.Value(1)).current
  const [phase, setPhase] = useState<Phase>('study')
  const [index, setIndex] = useState(0)
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [grade, setGrade] = useState<KnowledgeGrade | null>(null)
  const [row, setRow] = useState<KnowledgeQuizRow | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!user || !supabase) {
      setRow(null)
      return
    }
    const result = await loadKnowledgeQuiz(supabase, user.id)
    setRow(result.row)
    setLoadError(result.error)
  }, [user])

  useFocusEffect(useCallback(() => {
    refresh().catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not load quiz status'))
  }, [refresh]))

  const savedStatus = knowledgeQuizStatus(row)
  const question = KNOWLEDGE_QUIZ[index]
  const selected = question ? picks[question.id] : undefined

  function fadeTo(next: () => void) {
    Animated.timing(fade, { toValue: 0, duration: 140, useNativeDriver: true }).start(() => {
      next()
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start()
    })
  }

  function startQuiz() {
    setPicks({})
    setGrade(null)
    setSaveError(null)
    setIndex(0)
    fadeTo(() => setPhase('question'))
  }

  async function finish(nextPicks: Record<string, string>) {
    const nextGrade = gradeKnowledgeQuiz(nextPicks)
    setGrade(nextGrade)
    setPhase('result')
    if (!user || !supabase) {
      setSaveError(user ? 'Supabase is not configured.' : null)
      return
    }
    setBusy(true)
    try {
      const saved = await saveKnowledgeQuiz(supabase, user.id, nextGrade)
      if (saved.row) setRow(saved.row)
      setSaveError(saved.error)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the quiz')
    } finally {
      setBusy(false)
    }
  }

  function onNext() {
    if (!question || !selected) return
    const nextPicks = { ...picks, [question.id]: selected }
    setPicks(nextPicks)
    if (index >= KNOWLEDGE_QUIZ.length - 1) {
      fadeTo(() => {
        finish(nextPicks).catch(() => {})
      })
      return
    }
    fadeTo(() => setIndex(index + 1))
  }

  const progress = phase === 'result' && grade
    ? grade.score / 100
    : phase === 'question'
      ? (index + (selected ? 1 : 0)) / KNOWLEDGE_QUIZ.length
      : savedStatus === 'passed'
        ? 1
        : 0

  return (
    <StackPage
      title="Learning Center"
      onBack={() => {
        if (phase === 'study') router.back()
        else fadeTo(() => setPhase('study'))
      }}
      footer={phase === 'question' ? (
        <View style={styles.footerAction}>
          <Primary label={index === KNOWLEDGE_QUIZ.length - 1 ? 'See results' : 'Next'} onPress={onNext} disabled={!selected || busy} />
        </View>
      ) : undefined}
    >
      <View style={styles.statusRow}>
        <Tag label={knowledgeQuizStatusLabel(savedStatus)} tone={statusTone(savedStatus)} />
        <Text style={{ color: colors.inkSecondary, flex: 1 }}>
          Pass with {QUIZ_PASS_PERCENT}% or better. Miss at most {QUIZ_MAX_MISSES}.
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.track }]}>
        <View style={[styles.fill, { backgroundColor: colors.orange, width: `${Math.round(progress * 100)}%` }]} />
      </View>
      {loadError ? <ErrorText>{loadError}</ErrorText> : null}

      {phase === 'study' ? (
        <StudyPhase status={savedStatus} onStart={startQuiz} />
      ) : null}

      {phase === 'question' && question ? (
        <Animated.View style={{ opacity: fade, gap: 12 }}>
          <Text style={{ color: colors.inkSecondary, fontWeight: '800' }}>
            Question {index + 1} of {KNOWLEDGE_QUIZ.length}
          </Text>
          <Card>
            <Text style={[styles.prompt, { color: colors.title }]}>{question.prompt}</Text>
            {question.choices.map((choice) => {
              const on = selected === choice.id
              return (
                <Pressable
                  key={choice.id}
                  onPress={() => setPicks((current) => ({ ...current, [question.id]: choice.id }))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.choice,
                    {
                      backgroundColor: on ? colors.fill : colors.background,
                      borderColor: on ? colors.fill : colors.border,
                    },
                  ]}
                >
                  <Text style={{ color: on ? colors.onAccent : colors.ink, fontWeight: '700', lineHeight: 20 }}>
                    {choice.label}
                  </Text>
                </Pressable>
              )
            })}
          </Card>
        </Animated.View>
      ) : null}

      {phase === 'result' && grade ? (
        <Animated.View style={{ opacity: fade, gap: 12 }}>
          <ResultPhase
            grade={grade}
            savedStatus={knowledgeQuizStatus(row)}
            busy={busy}
            saveError={saveError}
            signedIn={Boolean(user)}
            onRetry={startQuiz}
            onStudy={() => fadeTo(() => setPhase('study'))}
            onSignIn={() => router.push('/sign-in')}
          />
        </Animated.View>
      ) : null}
    </StackPage>
  )
}

function StudyPhase({
  status,
  onStart,
}: {
  status: KnowledgeQuizStatus
  onStart: () => void
}) {
  const { colors } = useTheme()
  const action = actionLabel(status)
  return (
    <>
      <Text style={{ color: colors.ink, lineHeight: 20 }}>
        Read the notes, then take the quiz. A pass is saved on your driver application. It does not approve you. Accepting rides stays locked until an admin approves you.
      </Text>
      {STUDY_NOTES.map((note) => (
        <Card key={note.id}>
          <Text style={{ color: colors.title, fontWeight: '800', fontSize: 18 }}>{note.title}</Text>
          <Text style={{ color: colors.ink, lineHeight: 20 }}>{note.body}</Text>
        </Card>
      ))}
      <Primary label={action} onPress={onStart} />
    </>
  )
}

function actionLabel(status: KnowledgeQuizStatus): string {
  switch (status) {
    case 'not_started':
      return 'Start quiz'
    case 'failed':
      return 'Retry quiz'
    case 'passed':
      return 'Review quiz'
    default: {
      const unknown: never = status
      return unknown
    }
  }
}

function ResultPhase({
  grade,
  savedStatus,
  busy,
  saveError,
  signedIn,
  onRetry,
  onStudy,
  onSignIn,
}: {
  grade: KnowledgeGrade
  savedStatus: KnowledgeQuizStatus
  busy: boolean
  saveError: string | null
  signedIn: boolean
  onRetry: () => void
  onStudy: () => void
  onSignIn: () => void
}) {
  const { colors } = useTheme()
  const keptPass = savedStatus === 'passed' && !grade.passed
  const headline = resultHeadline(grade.passed, savedStatus)
  return (
    <>
      <Card>
        <Text style={{ color: colors.orange, fontWeight: '800', letterSpacing: 1 }}>THIS ATTEMPT</Text>
        <Text style={[styles.score, { color: colors.title }]}>{grade.score}%</Text>
        <Text style={{ color: grade.passed ? colors.online : colors.danger, fontWeight: '800', fontSize: 18 }}>
          {headline}
        </Text>
        <Text style={{ color: colors.ink, lineHeight: 20 }}>
          {grade.correct} of {grade.total} correct.
          {grade.passed ? ' A pass does not approve you. Accepting rides stays locked until an admin approves you.' : ' Retry when you are ready. Accepting rides stays locked until an admin approves you.'}
          {keptPass ? ' Your saved pass stays on the application.' : ''}
          {!signedIn ? ' Sign in to save this score on your driver application.' : ''}
        </Text>
        {busy ? <Text style={{ color: colors.inkSecondary }}>Saving…</Text> : null}
        {saveError ? <ErrorText>{saveError}</ErrorText> : null}
      </Card>
      {grade.missed.length ? (
        <Card>
          <Text style={{ color: colors.title, fontWeight: '800' }}>Review the misses</Text>
          {grade.missed.map((id) => {
            const question = KNOWLEDGE_QUIZ.find((item) => item.id === id)
            const answer = question?.choices.find((choice) => choice.id === question.answerId)
            if (!question || !answer) return null
            return (
              <View key={id} style={styles.miss}>
                <Text style={{ color: colors.ink, fontWeight: '800' }}>{question.prompt}</Text>
                <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{answer.label}</Text>
              </View>
            )
          })}
        </Card>
      ) : null}
      {signedIn ? null : <Primary label="Sign in to save" onPress={onSignIn} />}
      <Primary label={savedStatus === 'passed' ? 'Take it again' : 'Retry quiz'} onPress={onRetry} tone={signedIn ? 'orange' : 'ghost'} />
      <Primary label="Back to notes" onPress={onStudy} tone="ghost" />
    </>
  )
}

function resultHeadline(attemptPassed: boolean, savedStatus: KnowledgeQuizStatus): string {
  if (attemptPassed) return 'Passed'
  switch (savedStatus) {
    case 'passed':
      return 'Saved pass kept'
    case 'failed':
    case 'not_started':
      return 'Not yet'
    default: {
      const unknown: never = savedStatus
      return unknown
    }
  }
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { height: 8, borderRadius: 999, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 999 },
  prompt: { fontSize: 20, fontWeight: '800', lineHeight: 26 },
  choice: { borderRadius: 16, borderWidth: 1, padding: 14 },
  score: { fontSize: 48, fontWeight: '800', letterSpacing: -1 },
  miss: { gap: 4 },
  footerAction: { flex: 1 },
})
