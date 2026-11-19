/**
 * Where MUI keeps the light/dark choice: localStorage, synced between tabs.
 *
 * MUI's own manager applies the value carried by each 'storage' event and then
 * saves it again. A tab that gets events late (Edge holds them back for
 * background tabs) re-saves outdated values one by one, and every other tab
 * flips with each one: the page switches light/dark repeatedly until the
 * backlog runs out, and can end on a choice nobody made.
 *
 * This manager ignores the event's value and applies what is saved NOW. A late
 * event then changes nothing, and re-saving the current value fires no new event.
 */
export default function colorSchemeStorage({ key, storageWindow = window }) {
  const read = () => {
    try {
      return storageWindow.localStorage.getItem(key);
    } catch {
      return null; // storage blocked (private mode, policy)
    }
  };
  return {
    get: (defaultValue) => read() || defaultValue,
    set: (value) => {
      try {
        storageWindow.localStorage.setItem(key, value);
      } catch {
        // storage blocked: the choice lasts for this page only
      }
    },
    subscribe: (handler) => {
      const listener = (event) => {
        if (event.key === key) handler(read());
      };
      storageWindow.addEventListener('storage', listener);
      return () => storageWindow.removeEventListener('storage', listener);
    },
  };
}
