import { useCallback, useState } from 'react';

/**
 * Per-field error messages, shown above each field by <Field>.
 *
 *   const fe = useFieldErrors();
 *   <Field {...fe.props('title')} />          // red outline + message above the field
 *   <Field {...fe.props('code', 'Hint')} />   // ...and a hint below it
 *   fe.set({ title: 'Enter a title.' });       // after client-side checks
 *   fe.fromApi(err)                            // after an API error; true if it named fields
 *   focusFirstError(formElement)               // move the cursor to the first problem
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

  const props = (field, helperText) => ({ errorText: errors[field], helperText });

  return { errors, set: setErrors, clear, fromApi, props, any: Object.keys(errors).length > 0 };
}

/** Focus the first invalid input inside `form` once React has rendered the errors. */
export function focusFirstError(form) {
  requestAnimationFrame(() => form?.querySelector('[aria-invalid="true"]')?.focus());
}
