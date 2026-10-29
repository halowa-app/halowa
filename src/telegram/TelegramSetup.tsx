import { useEffect, useState } from 'react';
import { tdlib, type AuthorizationState, type TdObject } from './tdlib';

type Props = { onClose: () => void };

export function TelegramSetup({ onClose }: Props) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [state, setState] = useState<AuthorizationState | null>(null);
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [account, setAccount] = useState('');

  useEffect(() => {
    let active = true;
    const unsubscribe = tdlib.subscribe((update: TdObject) => {
      if (active && update['@type'] === 'updateAuthorizationState') {
        setState(update.authorization_state as AuthorizationState);
      }
    });
    void (async () => {
      const status = await tdlib.status();
      if (!active) return;
      setAvailable(status.available);
      if (!status.available) return;
      let current = await tdlib.start();
      if (current['@type'] === 'authorizationStateWaitTdlibParameters') {
        const saved = await tdlib.savedCredentials();
        if (saved) current = await tdlib.configure(saved.apiId, saved.apiHash);
      }
      if (active) setState(current);
    })().catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (state?.['@type'] !== 'authorizationStateReady') return;
    void tdlib.getMe().then(me => setAccount(String(me.first_name || me.username || me.id))).catch(() => {});
  }, [state]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!state) return;
    setBusy(true);
    setError('');
    try {
      const kind = state['@type'];
      let next: AuthorizationState;
      if (kind === 'authorizationStateWaitTdlibParameters') next = await tdlib.configure(Number(apiId), apiHash.trim());
      else {
        if (kind === 'authorizationStateWaitPhoneNumber') await tdlib.setPhoneNumber(value.trim());
        else if (kind === 'authorizationStateWaitCode') await tdlib.checkCode(value.trim());
        else if (kind === 'authorizationStateWaitPassword') await tdlib.checkPassword(value);
        else if (kind === 'authorizationStateWaitEmailAddress') await tdlib.setEmailAddress(value.trim());
        else if (kind === 'authorizationStateWaitEmailCode') await tdlib.checkEmailCode(value.trim());
        else throw new Error('Cette étape de connexion Telegram n’est pas encore prise en charge.');
        next = await tdlib.authorizationState();
      }
      setApiHash('');
      setValue('');
      setState(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const kind = state?.['@type'];
  const field = kind === 'authorizationStateWaitPhoneNumber' ? { label: 'Numéro de téléphone', type: 'tel', hint: '+33…' }
    : kind === 'authorizationStateWaitCode' ? { label: 'Code Telegram', type: 'text', hint: 'Code reçu' }
    : kind === 'authorizationStateWaitPassword' ? { label: 'Mot de passe Telegram', type: 'password', hint: 'Vérification en deux étapes' }
    : kind === 'authorizationStateWaitEmailAddress' ? { label: 'Adresse e-mail', type: 'email', hint: 'Adresse demandée par Telegram' }
    : kind === 'authorizationStateWaitEmailCode' ? { label: 'Code e-mail', type: 'text', hint: 'Code reçu par e-mail' }
    : null;

  return <div className="modal-backdrop" onClick={onClose}><div className="auth-card telegram-setup" onClick={event => event.stopPropagation()}>
    <button className="icon-button close" onClick={onClose} aria-label="Fermer">×</button>
    <span className="mini-logo">✳ HALO</span>
    <h2>Connexion Telegram</h2>
    {available === null && <p>Vérification de TDLib…</p>}
    {available === false && <p>TDLib n’est pas encore installé dans cette version de l’application. La connexion Telegram sera disponible après l’intégration de la bibliothèque native.</p>}
    {available && kind === 'authorizationStateWaitTdlibParameters' && <><p>Créez les identifiants de votre application sur <a href="https://my.telegram.org" target="_blank" rel="noreferrer">my.telegram.org</a>. Le hash est enregistré dans le stockage sécurisé de cet appareil.</p><form onSubmit={submit}><label>API ID<input required inputMode="numeric" value={apiId} onChange={event => setApiId(event.target.value)} /></label><label>API hash<input required type="password" autoComplete="off" value={apiHash} onChange={event => setApiHash(event.target.value)} /></label><button className="button primary full" disabled={busy}>Configurer Telegram</button></form></>}
    {available && field && <><p>Telegram demande cette étape pour connecter votre compte sur cet appareil.</p><form onSubmit={submit}><label>{field.label}<input required type={field.type} placeholder={field.hint} autoComplete="off" value={value} onChange={event => setValue(event.target.value)} /></label><button className="button primary full" disabled={busy}>Continuer</button></form></>}
    {available && kind === 'authorizationStateReady' && <p>Compte Telegram connecté{account ? ` : ${account}` : ''}. Le raccordement de la carte, des contacts et des Secret Chats est encore en cours.</p>}
    {available && kind && !field && kind !== 'authorizationStateWaitTdlibParameters' && kind !== 'authorizationStateReady' && <p>État Telegram : {kind}. Cette étape sera prise en charge lors de la suite de l’intégration.</p>}
    {error && <p className="telegram-error" role="alert">{error}</p>}
  </div></div>;
}
