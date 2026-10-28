import { useState, type FormEvent } from 'react';
import {
  NAME_MAX_LENGTH,
  ROOM_CODE_LENGTH,
  chatCounter,
  normalizeRoomCode,
  validateName,
} from './validation.js';
import { useT } from './i18nContext.js';
import type { Language } from './settings.js';

export interface HomeScreenProps {
  /** Kalıcı adını girişe yaz. */
  initialName: string;
  language: Language;
  onLanguageChange: (language: Language) => void;
  onCreateRoom: (name: string) => void;
  onJoinRoom: (code: string, name: string) => void;
  onPlayLocal: (name: string) => void;
  onOpenSettings: () => void;
  busy: boolean;
}

/**
 * D1 — Home ekranı: takma ad, oda oluştur, kodla katıl, yerel oyna ve dil
 * seçici. Doğrulama satır içi (`aria-describedby` + `role="alert"`) hata
 * verir; geçersizken ağ çağrısı hiç yapılmaz.
 */
export function HomeScreen(props: HomeScreenProps) {
  const { t, lang } = useT();
  const [name, setName] = useState(props.initialName);
  const [code, setCode] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  const nameValidation = validateName(name);

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (!nameValidation.ok) {
      setNameError(t(nameValidation.i18nKey));
      return;
    }
    setNameError(null);
    props.onCreateRoom(nameValidation.value);
  }

  function submitJoin(event: FormEvent) {
    event.preventDefault();
    if (!nameValidation.ok) {
      setNameError(t(nameValidation.i18nKey));
      return;
    }
    const codeValidation = normalizeRoomCode(code);
    if (!codeValidation.ok) {
      setCodeError(t(codeValidation.i18nKey));
      return;
    }
    setNameError(null);
    setCodeError(null);
    props.onJoinRoom(codeValidation.value, nameValidation.value);
  }

  function submitLocal(event: FormEvent) {
    event.preventDefault();
    if (!nameValidation.ok) {
      setNameError(t(nameValidation.i18nKey));
      return;
    }
    setNameError(null);
    props.onPlayLocal(nameValidation.value);
  }

  return (
    <main className="home" aria-labelledby="home-title">
      <h1 id="home-title">{t('screen.home.title')}</h1>
      <p className="muted">{t('screen.home.subtitle')}</p>

      <form onSubmit={submitCreate} className="home-form" noValidate>
        <label htmlFor="home-name-input" className="field-label">
          {t('home.name.label')}
        </label>
        <input
          id="home-name-input"
          className={nameError ? 'text-input invalid' : 'text-input'}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          placeholder={t('home.name.placeholder')}
          maxLength={NAME_MAX_LENGTH + 10}
          autoComplete="nickname"
          aria-describedby={nameError ? 'home-name-error' : undefined}
          aria-invalid={nameError ? true : undefined}
        />
        {nameError ? (
          <p className="inline-error" id="home-name-error" role="alert">
            {nameError}
          </p>
        ) : null}

        <div className="home-actions">
          <button type="submit" className="button primary" disabled={props.busy}>
            {t('home.create')}
          </button>
          <button type="button" className="button" onClick={submitLocal} disabled={props.busy}>
            {t('home.local')}
          </button>
        </div>
      </form>

      <form onSubmit={submitJoin} className="home-form" noValidate>
        <label htmlFor="home-code-input" className="field-label">
          {t('home.code.label')}
        </label>
        <div className="join-row">
          <input
            id="home-code-input"
            className={codeError ? 'text-input code invalid' : 'text-input code'}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              setCodeError(null);
            }}
            placeholder={t('home.code.placeholder')}
            maxLength={ROOM_CODE_LENGTH}
            inputMode="text"
            autoCapitalize="characters"
            aria-describedby={codeError ? 'home-code-error' : undefined}
            aria-invalid={codeError ? true : undefined}
          />
          <button type="submit" className="button primary" disabled={props.busy}>
            {t('home.join')}
          </button>
        </div>
        {codeError ? (
          <p className="inline-error" id="home-code-error" role="alert">
            {codeError}
          </p>
        ) : null}
      </form>

      <div className="home-footrow">
        <label className="field-label" htmlFor="home-lang">
          {t('settings.language.label')}
        </label>
        <select
          id="home-lang"
          className="select"
          value={lang}
          onChange={(event) => props.onLanguageChange(event.target.value as Language)}
        >
          <option value="tr">{t('lang.tr')}</option>
          <option value="en">{t('lang.en')}</option>
        </select>
        <span className="muted" aria-hidden="true">
          {chatCounter(name, NAME_MAX_LENGTH)}
        </span>
        <button type="button" className="button ghost" onClick={props.onOpenSettings}>
          {t('home.openSettings')}
        </button>
      </div>
    </main>
  );
}
