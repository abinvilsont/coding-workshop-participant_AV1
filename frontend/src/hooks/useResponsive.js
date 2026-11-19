import { useMediaQuery } from 'react-responsive';

// Breakpoints shared by every screen (React Responsive).
export const PHONE_MAX = 699;
export const TABLET_MAX = 959;

/** Phone: single column, cards instead of tables. */
export const useIsPhone = () => useMediaQuery({ maxWidth: PHONE_MAX });

// The admin top bar has twice as many links (six), so it needs more room before
// it fits in one row; below this it uses the menu drawer too.
export const WIDE_NAV_MAX = 1199;
// Wide tables (six or more columns) switch to cards below this width.
export const WIDE_TABLE_MAX = 1099;

/** Phone or tablet: navigation collapses into a menu, incident lists become cards. */
export const useIsCompact = () => useMediaQuery({ maxWidth: TABLET_MAX });

/** Below `maxWidth`: e.g. useIsNarrowerThan(WIDE_TABLE_MAX) for tables that need more room. */
export const useIsNarrowerThan = (maxWidth) => useMediaQuery({ maxWidth });
