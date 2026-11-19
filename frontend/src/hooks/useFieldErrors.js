import { useCallback, useState } from 'react';

/**
 * Per-field error messages for MUI TextFields.
 *
 *   const fe = useFieldErrors();
 *   <TextField {...fe.props('title')} />      // red outline + message under the field
 *   fe.set({ title: 'Enter a title.' });       // after client-side checks
 *   fe.fromApi(err)                            // after a 400 from the API; true if it had field errors
 */
export default function useFieldErrors() {
  const [errors, setErrors] = useState({});

  const clear = useCallback((field) => {
    setErrors((prev) => {
      if (field === undefined) return {};
      if (!(field in prev)) return prev;
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const fromApi = useCallback((err) => {
    const fields = err?.fields ?? {};
    setErrors(fields);
    return Object.keys(fields).length > 0;
  }, []);

  const props = (field, helperText) => ({
    error: Boolean(errors[field]),
    helperText: errors[field] || helperText,
  });

  return { errors, set: setErrors, clear, fromApi, props, any: Object.keys(errors).length > 0 };
}
