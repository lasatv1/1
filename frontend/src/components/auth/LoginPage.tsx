import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, LogIn } from 'lucide-react';
import { useDataStore } from '@/state/dataStore';
import { WrongCredentialsError } from '@/lib/auth/crypto';
import { counterEnabled, subscribeCounter, type CounterKey } from '@/lib/counter';

/**
 * Sign-in screen for the login-protected site. Always fully black, regardless of the
 * app theme. The credentials are verified by decrypting the published data with them:
 * there is no password stored in the page or the repository.
 */
export function LoginPage() {
  const login = useDataStore((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userRef = useRef<HTMLInputElement>(null);

  useEffect(() => userRef.current?.focus(), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof WrongCredentialsError ? 'Invalid username or password.' : 'Could not load the protected data. Try again.');
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#000] px-4 text-[#e8e8e6]">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-3">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
            <circle cx="16" cy="16" r="11" fill="none" stroke="#8a8a86" strokeWidth="1.6" />
            <ellipse cx="16" cy="16" rx="5" ry="11" fill="none" stroke="#4a4a48" strokeWidth="1.2" />
            <path d="M5 16h22" stroke="#4a4a48" strokeWidth="1.2" />
            <path d="M9 9.5 Q16 4 22 11" fill="none" stroke="#ac4a44" strokeWidth="1.5" />
            <circle cx="22" cy="11" r="1.8" fill="#ac4a44" />
          </svg>
          <div>
            <h1 className="text-[17px] font-semibold leading-5">Ruster Ball</h1>
            <p className="text-xs text-[#6e6e6a]">Restricted access</p>
          </div>
        </div>

        <form onSubmit={submit} className="rounded-sm border border-[#1f1f1f] bg-[#070707] p-6" aria-label="Sign in">
          <div className="mb-5 flex items-center gap-2 text-sm text-[#a6a6a2]">
            <Lock size={14} /> Sign in to continue
          </div>

          <label htmlFor="login-user" className="mb-1.5 block text-xs text-[#a6a6a2]">
            Username
          </label>
          <input
            ref={userRef}
            id="login-user"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mb-4 h-10 w-full rounded-sm border border-[#2e2e2e] bg-[#000] px-3 text-sm text-[#e8e8e6] outline-none placeholder:text-[#4a4a48] focus:border-[#6e6e6a]"
          />

          <label htmlFor="login-pass" className="mb-1.5 block text-xs text-[#a6a6a2]">
            Password
          </label>
          <div className="relative mb-5">
            <input
              id="login-pass"
              name="password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 w-full rounded-sm border border-[#2e2e2e] bg-[#000] pl-3 pr-10 text-sm text-[#e8e8e6] outline-none focus:border-[#6e6e6a]"
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              aria-label={show ? 'Hide password' : 'Show password'}
              className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-[#6e6e6a] hover:text-[#e8e8e6]"
            >
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          {error && (
            <p role="alert" className="mb-4 rounded-sm border border-[#4a2626] bg-[#1a0e0e] px-3 py-2 text-xs text-[#d9a19c]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !username || !password}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-[#e8e8e6] text-sm font-medium text-[#000] transition-colors hover:bg-[#ffffff] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              'Verifying…'
            ) : (
              <>
                <LogIn size={15} /> Sign in
              </>
            )}
          </button>
        </form>

        {counterEnabled && <LiveCounters />}

        <p className="mt-6 text-center text-[11px] leading-4 text-[#4a4a48]">
          The intelligence data is encrypted. It is only decrypted in your browser after sign-in.
        </p>
      </div>
    </div>
  );
}

const LABELS: Array<{ key: CounterKey; label: string }> = [
  { key: 'opens', label: 'Page opens' },
  { key: 'visitors', label: 'Unique visitors' },
  { key: 'failed-logins', label: 'Failed sign-ins' },
];

/** Live counters (server-sent events), shown under the form. */
export function LiveCounters() {
  const [values, setValues] = useState<Partial<Record<CounterKey, number>>>({});
  useEffect(() => {
    const subs = LABELS.map(({ key }) => subscribeCounter(key, (n) => setValues((v) => ({ ...v, [key]: n }))));
    return () => subs.forEach((u) => u());
  }, []);
  return (
    <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-[#1f1f1f] bg-[#1f1f1f]" aria-live="polite">
      {LABELS.map(({ key, label }) => (
        <div key={key} className="bg-[#070707] px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.06em] text-[#6e6e6a]">
            {key === 'opens' && <span className="h-1.5 w-1.5 rounded-full bg-[#528270]" title="Live" />}
            {label}
          </div>
          <div className="mt-0.5 font-mono text-[17px] tabular-nums text-[#e8e8e6]">{values[key] ?? '—'}</div>
        </div>
      ))}
    </div>
  );
}
