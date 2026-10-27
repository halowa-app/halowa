import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.halo.mobile',
  appName: 'Halo',
  webDir: 'dist',
  ios: { contentInset: 'always' },
  android: { useLegacyBridge: true },
};

export default config;
