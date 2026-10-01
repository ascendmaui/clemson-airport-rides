import test from 'node:test'
import {
  STUDENT_DISCOUNT_LABEL,
  STUDENT_CLAIM_COPY,
  STUDENT_EMAIL_HINT,
  STUDENT_EMAIL_REQUIRED_COPY,
  STUDENT_CONFIRM_EMAIL_COPY,
} from '../packages/rides-native/riderMoney.js'
import { GAME_DAY_LIVE_COPY, GAME_DAY_OFF_COPY } from '../packages/rides-native/gameDayNotice.js'
import { MARKETING_FEATURES } from '../shared/marketingFeatures.js'

test('Critical student and game-day copy snapshot', (t) => {
  const criticalCopy = {
    STUDENT_DISCOUNT_LABEL,
    STUDENT_CLAIM_COPY,
    STUDENT_EMAIL_HINT,
    STUDENT_EMAIL_REQUIRED_COPY,
    STUDENT_CONFIRM_EMAIL_COPY,
    GAME_DAY_LIVE_COPY,
    GAME_DAY_OFF_COPY,
    MARKETING_STUDENT: MARKETING_FEATURES.find(f => f.id === 'student'),
    MARKETING_GAMEDAY: MARKETING_FEATURES.find(f => f.id === 'gameday')
  }

  t.assert.snapshot(criticalCopy)
})
