import { App } from '@capacitor/app';
import { Geolocation } from '@capacitor/geolocation';
import { registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';
import { api, isNative, seal, type Person, type Session, type ShareSession } from './lib';

type Position = { lat: number; lng: number; at: number };
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

export function watchSharedLocation(
  share: ShareSession,
  session: Session,
  getContact: (id: string) => Person | undefined,
  onPosition: (position: Position) => void,
  onFailure: (message: string) => void,
) {
  let active = true;
  let sending = false;
  let lastSentAt = 0;
  let retryAt = 0;
  const intervalMs = share.mode === 'continuous' ? 15_000 : share.intervalMs;
  const due = () => Date.now() >= retryAt && Date.now() - lastSentAt >= intervalMs;

  const publish = async (position: Position, force = false) => {
    if (!active || sending || (!force && !due()) || (share.mode === 'on-open' && Date.now() - lastSentAt < 5_000)) return;
    sending = true;
    try {
      await Promise.all(share.ids.map(async id => {
        const person = getContact(id);
        if (!person) throw new Error('Un contact choisi n’est plus disponible.');
        await api('/envelopes', 'POST', {
          toId: id,
          kind: 'location',
          mode: share.mode,
          intervalMs,
          ...seal({ lat: position.lat, lng: position.lng }, person.publicKey, session.secretKey),
        }, session.token);
      }));
      if (active) { lastSentAt = Date.now(); retryAt = 0; onPosition(position); }
    } catch {
      // Keep sharing enabled and retry after a temporary network failure.
      retryAt = Date.now() + 30_000;
    } finally { sending = false; }
  };

  const capture = async (force = false) => {
    if (!active || sending || (!force && !due())) return;
    try {
      const point = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12_000 });
      await publish({ lat: point.coords.latitude, lng: point.coords.longitude, at: Date.now() }, force);
    } catch (error) {
      if (active && (error as { code?: number }).code === 1) onFailure('Le partage a été arrêté : autorisez la localisation de Halo.');
    }
  };

  void capture(true);
  const appListener = App.addListener('appStateChange', ({ isActive }) => {
    if (isActive && (share.mode === 'on-open' || due())) void capture(share.mode === 'on-open');
  });

  let timer: number | undefined;
  let watcher: Promise<string> | undefined;
  if (share.mode !== 'on-open') {
    timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden' && due()) void capture();
    }, Math.min(intervalMs, 60_000));
    if (isNative) {
      watcher = BackgroundGeolocation.addWatcher({
        backgroundTitle: 'Halo · partage de position actif',
        backgroundMessage: 'Votre position est partagée avec vos contacts choisis. Ouvrez Halo pour arrêter.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 0,
      }, (location, error) => {
        if (error) { if (active) onFailure('Le partage a été arrêté : autorisez la localisation en arrière-plan.'); return; }
        if (location && (!location.time || Date.now() - location.time < 2 * 60_000)) {
          void publish({ lat: location.latitude, lng: location.longitude, at: location.time || Date.now() });
        }
      }).catch(() => { if (active) onFailure('Le suivi en arrière-plan n’a pas pu démarrer.'); return ''; });
    }
  }

  return () => {
    active = false;
    if (timer !== undefined) window.clearInterval(timer);
    void appListener.then(handle => handle.remove()).catch(() => {});
    if (watcher) void watcher.then(id => { if (id) return BackgroundGeolocation.removeWatcher({ id }); }).catch(() => {});
  };
}
