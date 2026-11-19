import { useId } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

/** A problem shown just above the thing it is about (a field, or an action's buttons). */
export function ErrorText({ id, children, alert = false, sx }) {
  if (!children) return null;
  return (
    <Typography
      id={id}
      role={alert ? 'alert' : undefined}
      variant="body2"
      color="error"
      sx={[{ display: 'flex', alignItems: 'flex-start', gap: 0.5, fontWeight: 500, mb: 0.75 }, sx]}
    >
      <ErrorOutlineIcon fontSize="small" sx={{ mt: '1px', flexShrink: 0 }} aria-hidden="true" />
      <span>{children}</span>
    </Typography>
  );
}

/**
 * MUI TextField with its error message ABOVE the input instead of below.
 * `errorText` = the problem (red outline + message above); `helperText` stays a hint below.
 * The message is linked to the input (aria-describedby), so screen readers read it with the field.
 */
export default function Field({ errorText, id, helperText, slotProps, sx, ...props }) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const errorId = `${fieldId}-error`;
  const describedBy = [errorText && errorId, helperText && `${fieldId}-helper-text`].filter(Boolean).join(' ');

  return (
    <Box sx={[{ minWidth: 0 }, sx]}>
      <ErrorText id={errorId}>{errorText}</ErrorText>
      <TextField
        id={fieldId}
        error={Boolean(errorText)}
        helperText={helperText}
        {...props}
        slotProps={{
          ...slotProps,
          htmlInput: { ...slotProps?.htmlInput, 'aria-describedby': describedBy || undefined },
        }}
      />
    </Box>
  );
}
