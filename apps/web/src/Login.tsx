import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from './api/api';

type Problem = 'invalid' | 'failed';

/** M4-1: the login form, shown over the app whenever the api asks for a session (M4-2). */
export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const titleId = useId();
  const usernameId = useId();
  const passwordId = useId();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<Problem>();
  const [checking, setChecking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setChecking(true);
    setProblem(undefined);
    try {
      if ((await api.login(username, password)) === 'ok') {
        onLoggedIn();
        return;
      }
      setProblem('invalid');
      setPassword('');
    } catch {
      setProblem('failed');
    } finally {
      setChecking(false);
    }
  };

  return (
    <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="login">
      <h1 id={titleId}>{t('login.title')}</h1>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor={usernameId}>{t('login.username')}</label>
        <input
          id={usernameId}
          name="username"
          // The form replaces the screen, so typing starts here.
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <label htmlFor={passwordId}>{t('login.password')}</label>
        <input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {problem && (
          <p role="alert" className="problem">
            {t(`login.${problem}`)}
          </p>
        )}
        <button type="submit" className="primary" disabled={checking}>
          {checking ? t('login.checking') : t('login.submit')}
        </button>
      </form>
    </section>
  );
}
