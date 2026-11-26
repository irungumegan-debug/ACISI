import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * SHA claims add-on: true only when it is switched on for this clinic (by the
 * ACISI owner) and on the server (SHA_ENABLED). Any error, including the 404
 * when the server switch is off, counts as off, so SHA panels stay hidden.
 */
export function useShaAddon(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .getShaAddonStatus()
      .then((s) => live && setOn(s.enabled))
      .catch(() => live && setOn(false));
    return () => {
      live = false;
    };
  }, []);
  return on;
}
