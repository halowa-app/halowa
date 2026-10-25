import { useCallback, useEffect, useRef, useState } from 'react';
import { Geolocation } from '@capacitor/geolocation';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, Compass, Copy, Heart, HeartPulse, LockKeyhole, MapPin, MessageCircle, MoreHorizontal, Navigation, Plus, Radio, Search, Send, Settings2, ShieldCheck, Sparkles, UserPlus, Users, X } from 'lucide-react';
import { api, fingerprint, getApiUrl, isNative, loadIdentity, loadSession, makeKeys, open, saveIdentity, saveSession, seal, setApiUrl, type AlertItem, type Envelope, type Person, type Safety, type Session } from './lib';

type Tab = 'map' | 'signals' | 'chats' | 'circle' | 'safety';
type Decrypted = Envelope & { body: any };
type Position = { lat: number; lng: number; at: number };
const demoPeople: Person[] = [
  { id: 'demo-1', handle: 'lea', name: 'Léa', publicKey: '' },
  { id: 'demo-2', handle: 'camille', name: 'Camille', publicKey: '' },
  { id: 'demo-3', handle: 'yanis', name: 'Yanis', publicKey: '' },
];
const demoPositions: Record<string, Position> = {
  'demo-1': { lat: 48.8599, lng: 2.3467, at: Date.now() - 4 * 60_000 },
  'demo-2': { lat: 48.8656, lng: 2.3318, at: Date.now() - 7 * 60_000 },
  'demo-3': { lat: 48.8528, lng: 2.3737, at: Date.now() - 8 * 60_000 },
};
const demoOwnPosition: Position = { lat: 48.8566, lng: 2.3522, at: Date.now() };
const phrases = [
  { text: 'Je suis bien arrivé·e.', icon: '⌂', tone: 'mint' },
  { text: 'Je pense à toi.', icon: '♡', tone: 'peach' },
  { text: 'Tu me manques.', icon: '✦', tone: 'lavender' },
  { text: 'Tout va bien.', icon: '✓', tone: 'blue' },
  { text: 'Je suis en sécurité.', icon: '◉', tone: 'yellow' },
];
const ago = (date: number) => {
  const min = Math.max(1, Math.floor((Date.now() - date) / 60000));
  return min < 60 ? `il y a ${min} min` : min < 1440 ? `il y a ${Math.floor(min / 60)} h` : `il y a ${Math.floor(min / 1440)} j`;
};
const initials = (name: string) => name.trim().slice(0, 1).toUpperCase();

function Avatar({ person, size = 'md', index = 0 }: { person: Person; size?: 'sm' | 'md' | 'lg'; index?: number }) {
  return <span className={`avatar avatar-${size} avatar-${index % 5}`}>{initials(person.name)}</span>;
}

function MapCanvas({ people, positions, own, ownName, onLocate }: { people: Person[]; positions: Record<string, Position>; own: Position | null; ownName: string; onLocate: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    let active = true;
    let instance: maplibregl.Map | null = null;
    const initialize = async () => {
      try { await document.fonts.load('16px "SF Pro Rounded"'); } catch { /* MapLibre will use the fallback font. */ }
      if (!active || !container.current) return;
      instance = new maplibregl.Map({ container: container.current, style: '/map-style.json', center: [2.3522, 48.859], zoom: 12.8, attributionControl: false });
      instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
      instance.once('load', () => { if (active) setMapReady(true); });
      map.current = instance;
    };
    void initialize();
    return () => { active = false; instance?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current || !mapReady) return;
    markers.current.forEach(marker => marker.remove());
    markers.current = [];
    people.forEach((person, index) => {
      const position = positions[person.id];
      if (!position || Date.now() - position.at > 10 * 60_000) return;
      const node = document.createElement('div');
      node.className = `map-person map-person-${index % 5}`;
      node.innerHTML = `<span>${initials(person.name)}</span>`;
      node.setAttribute('aria-label', person.name);
      markers.current.push(new maplibregl.Marker({ element: node }).setLngLat([position.lng, position.lat]).setPopup(new maplibregl.Popup({ offset: 18 }).setText(`${person.name} · position partagée ${ago(position.at)}`)).addTo(map.current!));
    });
    if (own) {
      const node = document.createElement('div');
      node.className = 'map-me';
      node.setAttribute('aria-label', `${ownName} · ma position exacte`);
      node.innerHTML = `<svg viewBox="0 0 85 56" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M3.09944e-06 24.9798C1.6402 30.3832 4.32861 35.4106 7.91174 39.775C11.4949 44.1394 15.9025 47.7553 20.8831 50.4163C25.8637 53.0773 31.3196 54.7312 36.9393 55.2836C42.5591 55.8361 48.2326 55.2762 53.636 53.636C59.0394 51.9958 64.0668 49.3074 68.4312 45.7243C72.7956 42.1412 76.4115 37.7335 79.0725 32.7529C81.7335 27.7723 83.3874 22.3164 83.9398 16.6967C84.4923 11.0769 83.9324 5.4034 82.2922 9.53674e-06L41.1461 12.4899L3.09944e-06 24.9798Z" fill="url(#halo-location-gradient)"/><defs><radialGradient id="halo-location-gradient" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(41.1461 12.4899) rotate(90) scale(43)"><stop stop-color="#579DFF"/><stop offset="1" stop-color="#57C4FF" stop-opacity="0"/></radialGradient></defs></svg>`;
      const avatar = document.createElement('span');
      avatar.className = 'avatar avatar-md avatar-0 map-me-avatar';
      avatar.textContent = initials(ownName);
      node.append(avatar);
      markers.current.push(new maplibregl.Marker({ element: node, anchor: 'top', offset: [0, -12] }).setLngLat([own.lng, own.lat]).addTo(map.current));
    }
  }, [people, positions, own, ownName, mapReady]);
  return <><div className="map-canvas" ref={container} /><button className="locate-button" onClick={() => { onLocate(); if (own && map.current) map.current.flyTo({ center: [own.lng, own.lat], zoom: 14.5 }); }} title="Me localiser"><Navigation size={19} /></button></>;
}

function HoldButton({ duration, disabled, onComplete }: { duration: number; disabled?: boolean; onComplete: () => void }) {
  const [progress, setProgress] = useState(0);
  const timer = useRef<number | null>(null);
  const startAt = useRef(0);
  const completed = useRef(false);
  const stop = () => { if (timer.current !== null) window.clearInterval(timer.current); timer.current = null; if (!completed.current) setProgress(0); };
  const start = () => {
    if (disabled) return;
    completed.current = false; startAt.current = performance.now();
    timer.current = window.setInterval(() => {
      const value = Math.min(1, (performance.now() - startAt.current) / (duration * 1000));
      setProgress(value);
      if (value >= 1) { completed.current = true; stop(); onComplete(); window.setTimeout(() => setProgress(0), 700); }
    }, 25);
  };
  useEffect(() => () => { if (timer.current !== null) window.clearInterval(timer.current); }, []);
  return <button className="hold-button" style={{ '--progress': `${progress * 100}%` } as React.CSSProperties} disabled={disabled} onPointerDown={start} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop} onContextMenu={e => e.preventDefault()} onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } }} onKeyUp={stop}>
    <span className="hold-icon"><Heart size={28} fill="currentColor" /></span>
    <span><strong>{progress > 0 ? 'Continuez à appuyer…' : 'Je vais bien'}</strong><small>Maintenir {duration} secondes pour confirmer</small></span>
    <span className="hold-arrow"><ArrowRight size={20} /></span>
  </button>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('map');
  const [contacts, setContacts] = useState<Person[]>([]);
  const [incoming, setIncoming] = useState<{ id: string; from: Person }[]>([]);
  const [outgoing, setOutgoing] = useState<{ id: string; to: Person }[]>([]);
  const [envelopes, setEnvelopes] = useState<Decrypted[]>([]);
  const [demoMessages, setDemoMessages] = useState<Decrypted[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [safety, setSafety] = useState<Safety>({ enabled: false, intervalHours: 24, contactIds: [] });
  const [checkinAt, setCheckinAt] = useState(Date.now());
  const [ownPosition, setOwnPosition] = useState<Position | null>(null);
  const [sharing, setSharing] = useState<{ ids: string[]; until: number } | null>(null);
  const [shareModal, setShareModal] = useState(false);
  const [signalModal, setSignalModal] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [inviteHandle, setInviteHandle] = useState('');
  const [toast, setToast] = useState('');
  const [holdDuration, setHoldDuration] = useState(Number(localStorage.getItem('halo.hold') || 3));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiAddress, setApiAddress] = useState(getApiUrl());
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [authForm, setAuthForm] = useState({ name: '', handle: '', password: '' });
  const [authBusy, setAuthBusy] = useState(false);

  const user = session?.user || { id: 'demo-me', name: 'Alex', handle: 'alex', publicKey: '' };
  const people = demo ? demoPeople : contacts;
  const positions: Record<string, Position> = demo ? demoPositions : Object.fromEntries(envelopes.filter(x => x.kind === 'location' && x.body?.lat && Date.now() - x.at < 10 * 60_000).map(x => [x.from, { lat: x.body.lat, lng: x.body.lng, at: x.at }]));
  const notes = demo ? [
    { id: 'n1', from: 'demo-1', to: 'demo-me', kind: 'pulse', at: Date.now() - 13 * 60_000, body: { text: 'Je suis bien arrivée.' } },
    { id: 'n2', from: 'demo-2', to: 'demo-me', kind: 'pulse', at: Date.now() - 64 * 60_000, body: { text: 'Je pense à toi.' } },
  ].concat(demoMessages as any) as Decrypted[] : envelopes;

  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 4200); };
  const refresh = useCallback(async (current: Session) => {
    try {
      const [c, r, e, a, m] = await Promise.all([
        api<{ contacts: Person[] }>('/contacts', 'GET', undefined, current.token),
        api<{ incoming: { id: string; from: Person }[]; outgoing: { id: string; to: Person }[] }>('/requests', 'GET', undefined, current.token),
        api<{ envelopes: Envelope[] }>('/envelopes', 'GET', undefined, current.token),
        api<{ alerts: AlertItem[] }>('/alerts', 'GET', undefined, current.token),
        api<{ checkinAt: number; safety: Safety }>('/me', 'GET', undefined, current.token),
      ]);
      setContacts(c.contacts); setIncoming(r.incoming); setOutgoing(r.outgoing); setAlerts(a.alerts); setSafety(m.safety); setCheckinAt(m.checkinAt);
      const lookup = new Map(c.contacts.map(person => [person.id, person]));
      setEnvelopes(e.envelopes.map(item => ({ ...item, body: open(item, lookup.get(item.from === current.user.id ? item.to : item.from)?.publicKey || '', current.secretKey) })).filter(item => item.body));
    } catch (error) { if ((error as Error).message === 'Session expirée.') { setSession(null); await saveSession(null); } }
  }, []);
  const stopSharing = useCallback(async () => {
    setSharing(null);
    if (session && !demo) {
      try { await api('/location/revoke', 'POST', {}, session.token); }
      catch { flash('Le partage a cessé sur cet appareil. Vérifiez la connexion pour effacer la dernière position.'); }
    }
  }, [session, demo]);
  useEffect(() => { loadSession().then(saved => { if (saved) { setSession(saved); refresh(saved); } setLoading(false); }); }, [refresh]);
  useEffect(() => { if (!session || demo) return; const timer = window.setInterval(() => refresh(session), 7000); return () => window.clearInterval(timer); }, [session, demo, refresh]);
  useEffect(() => {
    if (!sharing || !session || demo) return;
    let running = false;
    const tick = async () => {
      if (running) return;
      if (Date.now() >= sharing.until) { await stopSharing(); return; }
      running = true;
      try {
        const point = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 });
        const pos = { lat: point.coords.latitude, lng: point.coords.longitude, at: Date.now() };
        setOwnPosition(pos);
        await Promise.all(sharing.ids.map(async id => {
          const person = contacts.find(x => x.id === id); if (!person) return;
          await api('/envelopes', 'POST', { toId: id, kind: 'location', ...seal({ lat: pos.lat, lng: pos.lng }, person.publicKey, session.secretKey) }, session.token);
        }));
      } catch { await stopSharing(); flash('Partage arrêté : position ou connexion indisponible.'); }
      running = false;
    };
    tick(); const timer = window.setInterval(tick, 30000); return () => window.clearInterval(timer);
  }, [sharing, session, contacts, demo, stopSharing]);

  const locate = async () => {
    try { const point = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 }); setOwnPosition({ lat: point.coords.latitude, lng: point.coords.longitude, at: Date.now() }); }
    catch { flash('Autorisez la localisation pour vous voir sur la carte.'); }
  };
  const sendEncrypted = async (kind: 'chat' | 'pulse', text: string, ids: string[]) => {
    if (demo) { setDemoMessages(old => [...old, ...ids.map(id => ({ id: `demo-${Date.now()}-${id}`, from: user.id, to: id, kind, at: Date.now(), expires: Date.now() + 864e5, nonce: '', ciphertext: '', body: { text } } as Decrypted))]); flash(`Envoyé à ${ids.length} contact${ids.length > 1 ? 's' : ''} · aperçu`); return; }
    if (!session) return;
    await Promise.all(ids.map(async id => {
      const recipient = contacts.find(x => x.id === id); if (!recipient) return;
      await api('/envelopes', 'POST', { toId: id, kind, ...seal({ text }, recipient.publicKey, session.secretKey) }, session.token);
    }));
    await refresh(session);
    flash(`Envoyé à ${ids.length} contact${ids.length > 1 ? 's' : ''}`);
  };
  const holdConfirm = async () => {
    const ids = demo ? demoPeople.map(x => x.id) : safety.contactIds;
    if (!ids.length) { setTab('safety'); flash('Choisissez d’abord vos contacts de confiance.'); return; }
    try {
      if (!demo && session) { const result = await api<{ checkinAt: number }>('/checkin', 'POST', {}, session.token); setCheckinAt(result.checkinAt); }
      else setCheckinAt(Date.now());
      await sendEncrypted('pulse', 'Je vais bien.', ids);
    } catch (error) { flash((error as Error).message); }
  };
  const authSubmit = async (event: React.FormEvent) => {
    event.preventDefault(); setAuthBusy(true);
    try {
      const handle = authForm.handle.toLowerCase().trim();
      if (authMode === 'register') {
        const keys = makeKeys();
        const result = await api<{ token: string; user: Person }>('/auth/register', 'POST', { ...authForm, handle, publicKey: keys.publicKey });
        await saveIdentity(handle, keys.secretKey);
        const next = { ...result, secretKey: keys.secretKey }; await saveSession(next); setSession(next); setDemo(false); refresh(next);
      } else {
        const result = await api<{ token: string; user: Person }>('/auth/login', 'POST', { handle, password: authForm.password });
        const secretKey = await loadIdentity(handle);
        if (!secretKey) throw new Error('La clé privée de ce compte est absente de cet appareil. Connectez-vous depuis l’appareil où vous l’avez créé.');
        const next = { ...result, secretKey }; await saveSession(next); setSession(next); setDemo(false); refresh(next);
      }
    } catch (error) { flash((error as Error).message); }
    setAuthBusy(false);
  };
  const invite = async () => {
    if (!session) return;
    try { await api('/requests', 'POST', { handle: inviteHandle.replace(/^@/, '').trim() }, session.token); setInviteHandle(''); refresh(session); flash('Invitation envoyée.'); }
    catch (error) { flash((error as Error).message); }
  };
  const choose = (id: string) => setSelectedIds(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]);
  const openSignal = (text: string) => { setSelectedIds([]); setSignalModal(text); };
  const startShare = () => {
    if (!selectedIds.length) { flash('Sélectionnez au moins un contact.'); return; }
    if (demo) { setShareModal(false); flash('Le partage est simulé dans cet aperçu.'); return; }
    setSharing({ ids: selectedIds, until: Date.now() + 60 * 60_000 }); setShareModal(false); flash('Position partagée pendant 1 heure.');
  };
  const selectTab = (next: Tab) => { setTab(next); setSelectedChat(null); };

  if (loading) return <div className="loading-screen"><div className="brand-symbol">✳</div></div>;
  if (!session && !demo) return <div className="welcome">
    <div className="welcome-art"><div className="welcome-top"><span className="brand-symbol">✳</span><span>HALO</span></div><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /><div className="welcome-bubble bubble-one">Je suis bien arrivée. <span>♡</span></div><div className="welcome-bubble bubble-two">Je pense à toi. <span>✦</span></div><div className="welcome-pin pin-one">L</div><div className="welcome-pin pin-two">C</div><div className="welcome-art-caption">Toujours un petit signe.<br />Jamais trop loin.</div></div>
    <div className="welcome-content"><div className="eyebrow"><span className="eyebrow-dot" /> RESTER LIÉS, À VOTRE FAÇON</div><h1>Être là, même<br /><em>en quelques mots.</em></h1><p>Une carte pour se retrouver, des mots simples pour garder le lien, et un cercle de confiance pour veiller les uns sur les autres.</p><div className="welcome-features"><span><MapPin size={17} /> Carte privée</span><span><LockKeyhole size={17} /> Messages chiffrés</span><span><HeartPulse size={17} /> Signaux de sécurité</span></div><div className="welcome-actions"><button className="button primary" onClick={() => { setAuthMode('register'); setSettingsOpen(true); }}>Créer mon espace <ArrowRight size={18} /></button><button className="button secondary" onClick={() => { setDemo(true); setContacts(demoPeople); setSafety({ enabled: true, intervalHours: 24, contactIds: demoPeople.map(x => x.id) }); }}>Explorer la démo <ArrowRight size={18} /></button></div><small className="welcome-foot">La démo utilise des personnes et positions fictives.</small></div>
    {settingsOpen && <div className="modal-backdrop"><div className="auth-card"><button className="icon-button close" onClick={() => setSettingsOpen(false)}><X size={20} /></button><span className="mini-logo">✳ HALO</span><h2>{authMode === 'register' ? 'Votre espace commence ici.' : 'Bon retour parmi nous.'}</h2><p>Un compte privé pour partager avec les personnes que vous choisissez.</p><form onSubmit={authSubmit}>{authMode === 'register' && <label>Votre prénom<input required maxLength={40} placeholder="Alex" value={authForm.name} onChange={e => setAuthForm({ ...authForm, name: e.target.value })} /></label>}<label>Identifiant<input required minLength={3} maxLength={20} placeholder="alex" value={authForm.handle} onChange={e => setAuthForm({ ...authForm, handle: e.target.value })} /></label><label>Mot de passe<input required minLength={10} type="password" placeholder="Au moins 10 caractères" value={authForm.password} onChange={e => setAuthForm({ ...authForm, password: e.target.value })} /></label><button className="button primary full" disabled={authBusy}>{authBusy ? 'Un instant…' : authMode === 'register' ? 'Créer mon compte' : 'Me connecter'} <ArrowRight size={18} /></button></form><button className="text-button" onClick={() => setAuthMode(authMode === 'register' ? 'login' : 'register')}>{authMode === 'register' ? 'Déjà un compte ? Se connecter' : 'Nouveau ici ? Créer un compte'}</button>{isNative && <div className="server-field"><label>Adresse HTTPS du serveur<input placeholder="https://api.votre-domaine.fr" value={apiAddress} onChange={e => setApiAddress(e.target.value)} onBlur={() => setApiUrl(apiAddress)} /></label></div>}<div className="auth-disclaimer">Chiffrement sur cet appareil. Conservez cet appareil : la récupération de clé n’est pas encore disponible.</div></div></div>}
    {toast && <div className="toast"><CircleHelp size={18} />{toast}</div>}
  </div>;

  const nav = [
    { key: 'map' as Tab, label: 'Carte', icon: MapPin }, { key: 'signals' as Tab, label: 'Signaux', icon: Heart }, { key: 'chats' as Tab, label: 'Messages', icon: MessageCircle }, { key: 'circle' as Tab, label: 'Mon cercle', icon: Users }, { key: 'safety' as Tab, label: 'Sécurité', icon: ShieldCheck },
  ];
  const selectedPerson = people.find(x => x.id === selectedChat);
  const chatHistory = notes.filter(x => x.kind === 'chat' && (x.from === selectedChat || x.to === selectedChat)).sort((a, b) => a.at - b.at);

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-symbol">✳</span><span>halo<span className="brand-period">.</span></span></div><div className="workspace-title">VOTRE ESPACE</div><nav>{nav.map(item => <button key={item.key} className={`nav-item ${tab === item.key ? 'active' : ''}`} onClick={() => selectTab(item.key)}><item.icon size={20} strokeWidth={2.1} />{item.label}{item.key === 'chats' && notes.filter(x => x.kind === 'chat' && x.to === user.id).length > 0 && <span className="nav-dot" />}</button>)}</nav><div className="sidebar-bottom"><div className="trust-note"><ShieldCheck size={19} /><span>Votre espace.<br /><strong>Vos règles.</strong></span></div><button className="profile" onClick={() => setSettingsOpen(true)}><Avatar person={user} /><span><strong>{user.name}</strong><small>@{user.handle}</small></span><MoreHorizontal size={19} /></button></div></aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumb">HALO <ChevronRight size={14} /> <strong>{nav.find(x => x.key === tab)?.label}</strong></div><div className="topbar-actions">{demo && <span className="demo-chip">MODE DÉMO</span>}<span className="privacy-chip"><LockKeyhole size={14} /> Espace privé</span><button className="profile-top" onClick={() => setSettingsOpen(true)}><Avatar person={user} size="sm" /><ChevronDown size={15} /></button></div></header>

      {tab === 'map' && <div className="map-page"><div className="map-layer"><MapCanvas people={people} positions={positions} own={demo ? demoOwnPosition : ownPosition} ownName={user.name} onLocate={locate} /></div><div className="map-top"><div className="map-title"><div className="eyebrow"><span className="eyebrow-dot" /> VOTRE MONDE EN UN COUP D’ŒIL</div><h1>On est mieux<br /><em>ensemble.</em></h1><p>Retrouvez les personnes qui choisissent de partager leur position avec vous.</p></div><div className="map-status"><span className={`status-light ${sharing ? 'on' : ''}`} /><div><strong>{sharing ? 'Position partagée · app ouverte' : 'Position invisible'}</strong><small>{sharing ? `Jusqu’à ${new Date(sharing.until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Vous gardez le contrôle'}</small></div></div></div><div className="map-bottom"><div className="map-card"><div className="map-card-head"><div><div className="section-kicker">VOTRE CERCLE</div><h2>Vos proches, tout près.</h2></div><span className="count-pill">{people.length} contacts</span></div><div className="map-people">{people.length ? people.map((person, index) => <div className="map-person-row" key={person.id}><Avatar person={person} index={index} /><div><strong>{person.name}</strong><small>{positions[person.id] ? `Position ${ago(positions[person.id].at)}` : 'Position non partagée'}</small></div><span className={`person-state ${positions[person.id] ? 'visible' : ''}`} /></div>) : <div className="empty-small">Invitez un proche pour commencer.</div>}</div><button className="text-link" onClick={() => selectTab('circle')}>Gérer mon cercle <ArrowRight size={16} /></button></div><div className="map-actions"><button className="share-location" onClick={async () => { if (sharing) { await stopSharing(); flash('Partage de position arrêté.'); } else { setSelectedIds([]); setShareModal(true); } }}><span className="share-icon"><Navigation size={21} /></span><span><strong>{sharing ? 'Arrêter le partage' : 'Partager ma position'}</strong><small>{sharing ? 'Interrompre maintenant' : 'Avec les proches choisis'}</small></span><ArrowRight size={20} /></button><div className="share-hint"><LockKeyhole size={14} /> Position chiffrée, visible seulement par les contacts choisis</div></div></div></div>}

      {tab === 'signals' && <div className="content-page signal-page"><div className="page-heading"><div className="eyebrow"><span className="eyebrow-dot" /> PETITS MOTS, GRAND LIEN</div><h1>Un signe suffit<span className="title-star"> ✳</span></h1><p>Ces phrases qu’on aimerait envoyer plus souvent. Sans pression, juste pour être là.</p></div><div className="signal-layout"><div className="signal-main"><div className="signal-feature"><div className="feature-head"><span className="feature-icon"><HeartPulse size={20} /></span><span>VOTRE SIGNAL DU JOUR</span></div><h2>Dire « je vais bien »,<br />en un seul geste.</h2><p>Un appui maintenu confirme votre présence et envoie un signal à vos contacts de confiance.</p><HoldButton duration={holdDuration} onComplete={holdConfirm} /><div className="last-check"><CheckCheck size={17} /> Dernière confirmation : {ago(checkinAt)}</div></div><div className="section-header"><div><div className="section-kicker">LES MOTS TOUT PRÊTS</div><h2>Qu’avez-vous envie de dire ?</h2></div><span className="subtle">À votre rythme</span></div><div className="phrase-grid">{phrases.map(item => <button key={item.text} className={`phrase-card tone-${item.tone}`} onClick={() => openSignal(item.text)}><span className="phrase-icon">{item.icon}</span><strong>{item.text}</strong><ArrowRight size={18} /></button>)}</div></div><aside className="signal-side"><div className="side-card"><div className="side-orbit">♡</div><h3>Un message simple peut faire toute la différence.</h3><p>Un signe pour rassurer. Un mot pour se rapprocher. Sans avoir à trouver la formule parfaite.</p></div><div className="side-tip"><LockKeyhole size={18} /><div><strong>Entre vous, vraiment.</strong><p>Seuls vos contacts approuvés peuvent recevoir vos signaux.</p></div></div></aside></div></div>}

      {tab === 'chats' && <div className="content-page chat-page"><div className="page-heading"><div className="eyebrow"><span className="eyebrow-dot" /> VOS CONVERSATIONS</div><h1>Les mots qui comptent<span className="title-star"> ✳</span></h1><p>Une conversation privée avec chaque personne de votre cercle.</p></div><div className="chat-layout"><div className="chat-list"><div className="chat-list-head"><h2>Messages</h2><span className="count-pill">{people.length}</span></div>{people.length ? people.map((person, index) => { const last = notes.filter(x => x.kind === 'chat' && (x.from === person.id || x.to === person.id)).sort((a, b) => b.at - a.at)[0]; return <button key={person.id} className={`chat-list-item ${selectedChat === person.id ? 'selected' : ''}`} onClick={() => setSelectedChat(person.id)}><Avatar person={person} index={index} /><span><strong>{person.name}</strong><small>{last ? last.body?.text : 'Commencer une conversation'}</small></span>{last && <time>{ago(last.at)}</time>}</button>; }) : <div className="empty-small">Votre cercle est encore vide.</div>}</div><div className="chat-conversation">{selectedPerson ? <><div className="conversation-head"><button className="chat-back" aria-label="Retour aux conversations" onClick={() => setSelectedChat(null)}><ArrowLeft size={22} /></button><Avatar person={selectedPerson} /><div><strong>{selectedPerson.name}</strong><small><LockKeyhole size={12} /> Conversation chiffrée</small></div><span className="fingerprint" title="Code de vérification de clé">{selectedPerson.publicKey && fingerprint(selectedPerson.publicKey).slice(0, 11)}</span></div><div className="message-stream">{chatHistory.length ? chatHistory.map(item => <div key={item.id} className={`message ${item.from === user.id ? 'mine' : ''}`}><span>{item.body?.text}</span><small>{new Date(item.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</small></div>) : <div className="chat-empty"><span>♡</span><h3>Une conversation à vous.</h3><p>Envoyez un premier message à {selectedPerson.name}.</p></div>}</div><form className="composer" onSubmit={async e => { e.preventDefault(); if (!chatDraft.trim()) return; try { await sendEncrypted('chat', chatDraft.trim(), [selectedPerson.id]); setChatDraft(''); } catch (error) { flash((error as Error).message); } }}><input placeholder="Écrivez un message…" value={chatDraft} onChange={e => setChatDraft(e.target.value)} maxLength={1000} /><button aria-label="Envoyer"><Send size={19} /></button></form></> : <div className="chat-empty"><span>♡</span><h3>Vos échanges commencent ici.</h3><p>Choisissez un contact dans la liste.</p></div>}</div></div></div>}

      {tab === 'circle' && <div className="content-page circle-page"><div className="page-heading"><div className="eyebrow"><span className="eyebrow-dot" /> UNIQUEMENT LES VÔTRES</div><h1>Votre cercle de confiance<span className="title-star"> ✳</span></h1><p>Un espace choisi, jamais imposé. Vous décidez qui entre et qui voit quoi.</p></div><div className="circle-layout"><div className="circle-main"><div className="panel"><div className="panel-heading"><div><div className="section-kicker">CONTACTS APPROUVÉS</div><h2>Les personnes qui comptent</h2></div><span className="count-pill">{people.length}</span></div>{people.length ? people.map((person, index) => <div className="contact-row" key={person.id}><Avatar person={person} index={index} /><div className="contact-name"><strong>{person.name}</strong><small>@{person.handle}</small></div><span className="approved"><Check size={14} /> Approuvé</span>{!demo && <button className="icon-button" title="Retirer ce contact" onClick={async () => { if (!session || !window.confirm(`Retirer ${person.name} de votre cercle ?`)) return; await api(`/contacts/${person.id}`, 'DELETE', undefined, session.token); refresh(session); }}><X size={17} /></button>}</div>) : <div className="empty-state"><Users size={28} /><h3>Votre cercle commence ici.</h3><p>Invitez une personne par son identifiant.</p></div>}</div><div className="panel invite-panel"><div className="section-kicker">AGRANDIR VOTRE CERCLE</div><h2>Inviter un proche</h2><p>Les invitations nécessitent l’accord de l’autre personne.</p><div className="invite-input"><span>@</span><input placeholder="son_identifiant" value={inviteHandle} onChange={e => setInviteHandle(e.target.value)} /><button onClick={invite} disabled={demo || !inviteHandle.trim()}><UserPlus size={18} /> Inviter</button></div>{demo && <small className="demo-note">Créez un compte pour envoyer de vraies invitations.</small>}</div>{incoming.length > 0 && <div className="panel"><div className="section-kicker">INVITATIONS REÇUES</div>{incoming.map(item => <div className="contact-row" key={item.id}><Avatar person={item.from} /><div className="contact-name"><strong>{item.from.name}</strong><small>@{item.from.handle}</small></div><button className="small-primary" onClick={async () => { await api(`/requests/${item.id}/accept`, 'POST', {}, session!.token); refresh(session!); }}>Accepter</button><button className="small-plain" onClick={async () => { await api(`/requests/${item.id}/decline`, 'POST', {}, session!.token); refresh(session!); }}>Refuser</button></div>)}</div>}{outgoing.length > 0 && <div className="panel"><div className="section-kicker">EN ATTENTE</div>{outgoing.map(item => <div className="contact-row" key={item.id}><Avatar person={item.to} /><div className="contact-name"><strong>{item.to.name}</strong><small>@{item.to.handle}</small></div><span className="pending">Invitation envoyée</span></div>)}</div>}</div><aside className="circle-aside"><div className="circle-illustration"><div className="circle-ring ring-a" /><div className="circle-ring ring-b" /><div className="circle-heart">♡</div></div><h3>Plus proches,<br />en toute confiance.</h3><p>Votre position et vos messages ne sont accessibles qu’aux contacts que vous avez approuvés.</p><div className="key-info"><LockKeyhole size={16} /> Vérifiez le code de clé d’un contact ensemble, en personne, avant un échange sensible.</div></aside></div></div>}

      {tab === 'safety' && <div className="content-page safety-page"><div className="page-heading"><div className="eyebrow"><span className="eyebrow-dot" /> VEILLER LES UNS SUR LES AUTRES</div><h1>Un lien qui rassure<span className="title-star"> ✳</span></h1><p>Des confirmations simples et une veille discrète pour ceux qui comptent.</p></div><div className="safety-layout"><div className="safety-main"><div className="safety-hero"><div className="section-kicker">CONFIRMATION RAPIDE</div><h2>Un geste pour dire<br />« je vais bien ».</h2><p>Le signal est envoyé aux contacts ci-dessous après un appui maintenu.</p><HoldButton duration={holdDuration} onComplete={holdConfirm} /><div className="last-check"><CheckCheck size={17} /> Dernière confirmation : {ago(checkinAt)}</div></div><div className="panel safety-config"><div className="panel-heading"><div><div className="section-kicker">VEILLE DISCRÈTE</div><h2>Mes contacts de confiance</h2></div><span className="count-pill">{safety.contactIds.length} choisi{safety.contactIds.length > 1 ? 's' : ''}</span></div><p>Si vous ne confirmez pas dans le délai choisi, ces personnes verront une alerte dans l’application. Prévoyez avec elles comment réagir.</p><div className="selection-list">{people.length ? people.map((person, index) => <label className="select-person" key={person.id}><Avatar person={person} index={index} /><span><strong>{person.name}</strong><small>@{person.handle}</small></span><input type="checkbox" checked={safety.contactIds.includes(person.id)} onChange={() => setSafety(old => ({ ...old, contactIds: old.contactIds.includes(person.id) ? old.contactIds.filter(x => x !== person.id) : [...old.contactIds, person.id] }))} /></label>) : <div className="empty-small">Ajoutez d’abord des contacts approuvés.</div>}</div><div className="safety-controls"><label>Rythme de confirmation<select value={safety.intervalHours} onChange={e => setSafety({ ...safety, intervalHours: Number(e.target.value) as Safety['intervalHours'] })}><option value={12}>Toutes les 12 heures</option><option value={24}>Chaque jour</option><option value={48}>Tous les 2 jours</option></select></label><label className="toggle-row"><span>Activer la veille</span><input type="checkbox" checked={safety.enabled} onChange={e => setSafety({ ...safety, enabled: e.target.checked })} /></label></div><button className="button primary save-safety" onClick={async () => { if (demo) { flash('Réglages enregistrés dans la démo.'); return; } try { const result = await api<{ safety: Safety; checkinAt: number }>('/safety', 'POST', safety, session!.token); setSafety(result.safety); setCheckinAt(result.checkinAt); flash('Votre veille est configurée.'); } catch (error) { flash((error as Error).message); } }}>Enregistrer mes choix <ArrowRight size={18} /></button></div></div><aside className="safety-side"><div className="safety-side-card"><span className="side-big-icon"><ShieldCheck size={27} /></span><h3>Vous êtes aux commandes.</h3><p>Le silence peut avoir mille raisons. Une alerte invite vos proches à prendre de vos nouvelles ; elle ne prouve pas qu’un danger existe.</p></div><div className="alert-list"><h3>Alertes reçues</h3>{alerts.filter(x => !x.read).length ? alerts.filter(x => !x.read).map(alert => <div className="alert-card" key={alert.id}><strong>{alert.fromUser.name} n’a pas confirmé.</strong><small>{ago(alert.at)}</small><button onClick={async () => { await api(`/alerts/${alert.id}/read`, 'POST', {}, session!.token); refresh(session!); }}>Marquer comme vu</button></div>) : <p>Aucune alerte en cours.</p>}</div><div className="emergency-note"><CircleHelp size={18} /> Halo ne remplace pas les services d’urgence.</div></aside></div></div>}
    </main>
    <nav className="mobile-nav">{nav.map(item => <button key={item.key} className={tab === item.key ? 'active' : ''} onClick={() => selectTab(item.key)}><item.icon size={22} /><span>{item.label}</span></button>)}</nav>

    {(signalModal || shareModal) && <div className="modal-backdrop" onClick={() => { setSignalModal(null); setShareModal(false); }}><div className="choice-modal" onClick={e => e.stopPropagation()}><button className="icon-button close" onClick={() => { setSignalModal(null); setShareModal(false); }}><X size={20} /></button><div className="modal-badge">{shareModal ? <Navigation size={22} /> : <Heart size={22} />}</div><div className="section-kicker">CHOISIR LES DESTINATAIRES</div><h2>{shareModal ? 'Avec qui partager votre position ?' : signalModal}</h2><p>{shareModal ? 'Votre position sera actualisée pendant 1 heure tant que l’app reste ouverte. Vous pouvez arrêter à tout moment.' : 'Un petit signe, seulement aux personnes choisies.'}</p><div className="selection-list modal-list">{people.length ? people.map((person, index) => <label className="select-person" key={person.id}><Avatar person={person} index={index} /><span><strong>{person.name}</strong><small>@{person.handle}</small></span><input type="checkbox" checked={selectedIds.includes(person.id)} onChange={() => choose(person.id)} /></label>) : <div className="empty-small">Ajoutez d’abord des contacts dans votre cercle.</div>}</div><button className="button primary full" disabled={!selectedIds.length} onClick={async () => { try { if (shareModal) startShare(); else { await sendEncrypted('pulse', signalModal!, selectedIds); setSignalModal(null); } } catch (error) { flash((error as Error).message); } }}>{shareModal ? 'Partager ma position' : `Envoyer à ${selectedIds.length} proche${selectedIds.length > 1 ? 's' : ''}`} <ArrowRight size={18} /></button></div></div>}
    {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><div className="choice-modal settings-modal" onClick={e => e.stopPropagation()}><button className="icon-button close" onClick={() => setSettingsOpen(false)}><X size={20} /></button><div className="modal-badge"><Settings2 size={22} /></div><div className="section-kicker">VOTRE ESPACE</div><h2>Réglages</h2><div className="setting-row"><div><strong>Appui de confirmation</strong><small>Durée nécessaire pour envoyer « Je vais bien »</small></div><select value={holdDuration} onChange={e => { const value = Number(e.target.value); setHoldDuration(value); localStorage.setItem('halo.hold', String(value)); }}><option value={2}>2 s</option><option value={3}>3 s</option><option value={5}>5 s</option></select></div><div className="setting-row"><div><strong>Adresse du serveur</strong><small>Utilisez HTTPS sur iOS et Android</small></div></div><input className="server-input" placeholder="https://api.votre-domaine.fr" value={apiAddress} onChange={e => setApiAddress(e.target.value)} onBlur={() => setApiUrl(apiAddress)} /><button className="small-plain" onClick={() => { setApiUrl(apiAddress); flash('Adresse enregistrée.'); }}>Enregistrer l’adresse</button>{session && <div className="setting-row"><div><strong>Votre code de clé</strong><small>{fingerprint(session.user.publicKey)}</small></div><button className="icon-button" title="Copier" onClick={() => navigator.clipboard.writeText(fingerprint(session.user.publicKey))}><Copy size={17} /></button></div>}<div className="setting-warning">Les clés restent sur cet appareil. Une nouvelle installation ne peut pas relire les anciens messages.</div><button className="button secondary full" onClick={async () => { if (session) await api('/auth/logout', 'POST', {}, session.token).catch(() => {}); await saveSession(null); setSession(null); setDemo(false); setSettingsOpen(false); }}>Se déconnecter</button></div></div>}
    {toast && <div className="toast"><Check size={18} />{toast}</div>}
  </div>;
}
