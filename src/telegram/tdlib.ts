import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

export type TdObject = { '@type': string; [key: string]: unknown };
export type AuthorizationState = TdObject;

type NativeTdlib = {
  status(): Promise<{ available: boolean; ready: boolean; databaseDirectory: string }>;
  start(): Promise<{ ready: boolean }>;
  send(options: { request: TdObject }): Promise<{ result: TdObject }>;
  addListener(event: 'update', listener: (update: TdObject) => void): Promise<PluginListenerHandle>;
};

const nativeTdlib = registerPlugin<NativeTdlib>('HaloTdlib');
const encryptionKeyName = 'halo.telegram.databaseKey';
const apiCredentialsName = 'halo.telegram.apiCredentials';

function randomBase64(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return btoa(String.fromCharCode(...bytes));
}

export class TdlibClient {
  private listener: PluginListenerHandle | null = null;
  private observers = new Set<(update: TdObject) => void>();

  async status() {
    if (!Capacitor.isNativePlatform()) return { available: false, ready: false, databaseDirectory: '' };
    return nativeTdlib.status();
  }

  async start(): Promise<AuthorizationState> {
    const status = await this.status();
    if (!status.available) throw new Error('TDLib native binaries are unavailable on this device.');
    this.listener ??= await nativeTdlib.addListener('update', update => {
      for (const observer of this.observers) observer(update);
    });
    const started = await nativeTdlib.start();
    if (!started.ready) throw new Error('TDLib could not start on this device.');
    return this.authorizationState();
  }

  subscribe(observer: (update: TdObject) => void): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  async send<T extends TdObject = TdObject>(request: TdObject): Promise<T> {
    const response = await nativeTdlib.send({ request });
    return response.result as T;
  }

  authorizationState(): Promise<AuthorizationState> {
    return this.send({ '@type': 'getAuthorizationState' });
  }

  async configure(apiId: number, apiHash: string): Promise<AuthorizationState> {
    if (!Number.isSafeInteger(apiId) || apiId <= 0 || !/^[a-fA-F0-9]{32}$/.test(apiHash)) {
      throw new Error('A valid Telegram API ID and API hash are required.');
    }
    const status = await this.status();
    if (!status.ready || !status.databaseDirectory) throw new Error('TDLib must be started first.');
    const state = await this.authorizationState();
    if (state['@type'] !== 'authorizationStateWaitTdlibParameters') return state;
    let databaseKey: string | null;
    try { databaseKey = await SecureStorage.get(encryptionKeyName) as string | null; }
    catch { databaseKey = null; }
    if (!databaseKey) {
      databaseKey = randomBase64(32);
      await SecureStorage.set(encryptionKeyName, databaseKey);
    }
    await this.send({
      '@type': 'setTdlibParameters',
      use_test_dc: false,
      database_directory: status.databaseDirectory,
      files_directory: status.databaseDirectory,
      database_encryption_key: databaseKey,
      use_file_database: true,
      use_chat_info_database: true,
      use_message_database: true,
      use_secret_chats: true,
      api_id: apiId,
      api_hash: apiHash,
      system_language_code: 'fr',
      device_model: 'Halo mobile',
      system_version: Capacitor.getPlatform(),
      application_version: '0.1.0',
    });
    await SecureStorage.set(apiCredentialsName, { apiId, apiHash });
    return this.authorizationState();
  }

  async savedCredentials(): Promise<{ apiId: number; apiHash: string } | null> {
    try {
      return await SecureStorage.get(apiCredentialsName) as { apiId: number; apiHash: string } | null;
    } catch {
      return null;
    }
  }

  setPhoneNumber(phoneNumber: string): Promise<TdObject> {
    return this.send({ '@type': 'setAuthenticationPhoneNumber', phone_number: phoneNumber, settings: null });
  }

  checkCode(code: string): Promise<TdObject> {
    return this.send({ '@type': 'checkAuthenticationCode', code });
  }

  checkPassword(password: string): Promise<TdObject> {
    return this.send({ '@type': 'checkAuthenticationPassword', password });
  }

  setEmailAddress(emailAddress: string): Promise<TdObject> {
    return this.send({ '@type': 'setAuthenticationEmailAddress', email_address: emailAddress });
  }

  checkEmailCode(code: string): Promise<TdObject> {
    return this.send({ '@type': 'checkAuthenticationEmailCode', code: { '@type': 'emailAddressAuthenticationCode', code } });
  }

  getMe(): Promise<TdObject> {
    return this.send({ '@type': 'getMe' });
  }
}

export const tdlib = new TdlibClient();
