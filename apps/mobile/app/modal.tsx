import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Colors from '@/constants/Colors';

export default function ModalScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Clemson RIDES</Text>
      <Text style={styles.body}>
        Mobile scaffold for airport rides. Auth via Clerk, data via Supabase. Built with Expo + EAS.
      </Text>
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.purple },
  body: { textAlign: 'center', color: '#444', lineHeight: 22 },
});
