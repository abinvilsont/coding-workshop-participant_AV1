import { useCallback, useState } from 'react';

/**
 * Run an async API action with shared busy/error state.
 * `run(fn)` resolves to fn's result on success, or `undefined` on failure
 * (the error message is stored in `error`, and any per-field validation
 * messages from the API in `fields`).
 */
export default function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});

  const run = useCallback(async (fn) => {
    setBusy(true);
    setError('');
    setFields({});
    try {
      const result = await fn();
      return result ?? true;
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  return { run, busy, error, setError, fields };
}
