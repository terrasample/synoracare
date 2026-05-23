import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

const WEB_URL = 'https://www.synoracare.com';
const API_HEALTH_URL = 'https://synoracare-backend.onrender.com/health';

type HealthState = 'checking' | 'online' | 'offline';

export default function App() {
  const [showConsole, setShowConsole] = useState(false);
  const [healthState, setHealthState] = useState<HealthState>('checking');

  useEffect(() => {
    let canceled = false;

    const checkHealth = async () => {
      try {
        const response = await fetch(API_HEALTH_URL);
        const payload = await response.json();
        if (!canceled) {
          setHealthState(response.ok && payload?.ok ? 'online' : 'offline');
        }
      } catch {
        if (!canceled) {
          setHealthState('offline');
        }
      }
    };

    checkHealth();
    return () => {
      canceled = true;
    };
  }, []);

  const healthColor = useMemo(() => {
    if (healthState === 'online') return '#22C55E';
    if (healthState === 'offline') return '#EF4444';
    return '#F59E0B';
  }, [healthState]);

  if (showConsole) {
    return (
      <SafeAreaView style={styles.webShell}>
        <StatusBar style="light" />
        <View style={styles.webTopBar}>
          <Pressable style={styles.backButton} onPress={() => setShowConsole(false)}>
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
          <Text style={styles.webTitle}>SynoraCare AI Console</Text>
          <View style={styles.webStatusWrap}>
            <View style={[styles.dot, { backgroundColor: healthColor }]} />
            <Text style={styles.webStatusText}>{healthState.toUpperCase()}</Text>
          </View>
        </View>

        <WebView source={{ uri: WEB_URL }} startInLoadingState renderLoading={() => (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color="#22C55E" />
            <Text style={styles.loaderText}>Loading SynoraCare AI...</Text>
          </View>
        )} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.bgOrbOne} />
      <View style={styles.bgOrbTwo} />

      <View style={styles.card}>
        <Image source={require('./assets/synoracare-logo.png')} style={styles.logo} resizeMode="contain" />

        <Text style={styles.title}>SynoraCare AI</Text>
        <Text style={styles.subtitle}>Secure Care Intelligence in your pocket.</Text>

        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: healthColor }]} />
          <Text style={styles.statusText}>Backend: {healthState}</Text>
        </View>

        <Pressable style={styles.primaryButton} onPress={() => setShowConsole(true)}>
          <Text style={styles.primaryButtonText}>Open Live Console</Text>
        </Pressable>

        <Text style={styles.caption}>Production URL: {WEB_URL}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1D1A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  bgOrbOne: {
    position: 'absolute',
    top: -120,
    left: -100,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(35, 197, 94, 0.24)',
  },
  bgOrbTwo: {
    position: 'absolute',
    bottom: -120,
    right: -100,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(20, 184, 166, 0.2)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 28,
    backgroundColor: '#102A26',
    borderWidth: 1,
    borderColor: 'rgba(163, 230, 53, 0.22)',
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.34,
    shadowRadius: 20,
    elevation: 8,
  },
  logo: {
    width: 220,
    height: 76,
    marginBottom: 14,
  },
  title: {
    color: '#ECFDF5',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  subtitle: {
    color: '#A7F3D0',
    textAlign: 'center',
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
  },
  statusRow: {
    marginTop: 18,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(167, 243, 208, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(167, 243, 208, 0.25)',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 99,
  },
  statusText: {
    color: '#D1FAE5',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#22C55E',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#062013',
    fontSize: 16,
    fontWeight: '800',
  },
  caption: {
    marginTop: 14,
    color: '#86EFAC',
    fontSize: 12,
  },
  webShell: {
    flex: 1,
    backgroundColor: '#0B1D1A',
  },
  webTopBar: {
    height: 52,
    backgroundColor: '#102A26',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(163, 230, 53, 0.18)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(167, 243, 208, 0.14)',
  },
  backButtonText: {
    color: '#D1FAE5',
    fontWeight: '700',
  },
  webTitle: {
    color: '#ECFDF5',
    fontSize: 14,
    fontWeight: '700',
  },
  webStatusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  webStatusText: {
    color: '#A7F3D0',
    fontSize: 11,
    fontWeight: '700',
  },
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B1D1A',
  },
  loaderText: {
    marginTop: 10,
    color: '#D1FAE5',
    fontSize: 14,
  },
});
