import { useMediaQuery } from 'react-responsive';

// Breakpoints shared by every screen (React Responsive).
export const PHONE_MAX = 699;
export const TABLET_MAX = 959;

/** Phone: single column, cards instead of tables. */
export const useIsPhone = () => useMediaQuery({ maxWidth: PHONE_MAX });

/** Phone or small tablet: navigation collapses into a menu. */
export const useIsCompact = () => useMediaQuery({ maxWidth: TABLET_MAX });
