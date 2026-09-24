import { useRouter } from 'expo-router'
import { Text } from 'react-native'
import { Card } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useTheme } from '@/lib/theme'

const LESSONS = [
  {
    title: 'Go online',
    body: 'The orange GO button publishes your name, vehicle, and live pin. END takes you offline. Approval is required first.',
  },
  {
    title: 'Your 80%',
    body: 'You net 80% of the fare. Clemson RIDES keeps 20%. Airport trips can collect a 25% deposit before the ride and the rest on complete.',
  },
  {
    title: 'Game day',
    body: 'If a game day is live, Discover and the home map show the pickup zone and the rider fare multiplier from the server.',
  },
  {
    title: 'Queue',
    body: 'Student, game day, and weekend filters live on the queue. Declining an open match releases it. Declining a scheduled ride only hides that card on this phone.',
  },
]

export default function LearningScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  return (
    <StackPage title="Learning Center" onBack={() => router.back()}>
      <Text style={{ color: colors.inkSecondary }}>Short notes for this driver app. A full course catalog is not connected.</Text>
      {LESSONS.map((lesson) => (
        <Card key={lesson.title}>
          <Text style={{ color: colors.title, fontWeight: '800', fontSize: 18 }}>{lesson.title}</Text>
          <Text style={{ color: colors.ink, lineHeight: 20 }}>{lesson.body}</Text>
        </Card>
      ))}
    </StackPage>
  )
}
