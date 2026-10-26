// App-wide state: your list and location (saved on the phone), nearby stores,
// and every price the app knows about.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { indexItem, nearestStore, chainName } from '../lib/shared';
import * as api from '../lib/api';

const DEFAULT_HERE = { lat: 37.6547, lng: -122.4508, label: 'Near South SF' };
const DEFAULT_RADIUS = 15; // miles; the location sheet's slider changes it (1–25)
export const AD_CHAINS = ['safeway', 'traderjoes', 'sprouts', 'costco'];

const Ctx = createContext(null);
export const useAppData = () => useContext(Ctx);

async function readJson(key, fallback) {
  try { const v = await AsyncStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

export function AppDataProvider({ children }) {
  const [hydrated, setHydrated] = useState(false);
  const [list, setList] = useState([]);
  const [here, setHereState] = useState(DEFAULT_HERE);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [hideChains, setHideChains] = useState([]); // stores turned off on My list
  const [stores, setStores] = useState([]);
  const [adItems, setAdItems] = useState([]);
  const [krogerByTerm, setKrogerByTerm] = useState({});
  const [status, setStatus] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const krogerPending = useRef(new Set());

  // Restore the list and location saved on this phone.
  useEffect(() => {
    (async () => {
      const [l, h, r, hc] = await Promise.all([
        readJson('gp.list', []), readJson('gp.here', DEFAULT_HERE), readJson('gp.radius', DEFAULT_RADIUS), readJson('gp.hideChains', []),
      ]);
      setList(l);
      setHereState(h);
      setRadius(r);
      setHideChains(hc);
      setHydrated(true);
    })();
  }, []);
  useEffect(() => { if (hydrated) AsyncStorage.setItem('gp.list', JSON.stringify(list)).catch(() => {}); }, [list, hydrated]);
  useEffect(() => { if (hydrated) AsyncStorage.setItem('gp.here', JSON.stringify(here)).catch(() => {}); }, [here, hydrated]);
  useEffect(() => { if (hydrated) AsyncStorage.setItem('gp.radius', JSON.stringify(radius)).catch(() => {}); }, [radius, hydrated]);
  useEffect(() => { if (hydrated) AsyncStorage.setItem('gp.hideChains', JSON.stringify(hideChains)).catch(() => {}); }, [hideChains, hydrated]);

  const storesById = useMemo(() => Object.fromEntries(stores.map((s) => [s.id, s])), [stores]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const near = await api.nearbyStores(here, radius);
      const byId = Object.fromEntries(near.map((s) => [s.id, s]));
      const [ads, st] = await Promise.all([api.adItems(near.map((s) => s.id)), api.updateStatus(AD_CHAINS)]);
      setStores(near);
      setAdItems(ads.map((it) => indexItem(it, byId)));
      setStatus(st);
      setKrogerByTerm({});
      krogerPending.current.clear();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [here, radius]);

  useEffect(() => { if (hydrated) load(); }, [hydrated, load]);

  // Kroger prices are looked up per list item (Kroger has no weekly ad to download).
  useEffect(() => {
    const krogerIds = stores.filter((s) => s.chain === 'kroger').slice(0, 3).map((s) => s.id);
    if (!krogerIds.length) return;
    for (const e of list) {
      const key = e.q.toLowerCase();
      if (key in krogerByTerm || krogerPending.current.has(key)) continue;
      krogerPending.current.add(key);
      api.krogerProducts(e.q, krogerIds)
        .then((items) => setKrogerByTerm((m) => ({ ...m, [key]: items.map((it) => indexItem(it, storesById)) })))
        .catch(() => setKrogerByTerm((m) => ({ ...m, [key]: [] })))
        .finally(() => krogerPending.current.delete(key));
    }
  }, [list, stores, storesById, krogerByTerm]);

  const items = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const it of [...adItems, ...Object.values(krogerByTerm).flat()]) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
    return out;
  }, [adItems, krogerByTerm]);

  // ---------- list actions ----------
  const addItem = useCallback((q, mode = 'generic') => {
    setList((l) => [...l, { id: Math.random().toString(36).slice(2, 9), q, mode, qty: 1, pin: null }]);
  }, []);
  const updateItem = useCallback((id, patch) => setList((l) => l.map((e) => (e.id === id ? { ...e, ...patch } : e))), []);
  const removeItem = useCallback((id) => setList((l) => l.filter((e) => e.id !== id)), []);

  // ---------- location ----------
  const setZip = useCallback(async (zip) => {
    const pt = await api.zipToPoint(zip);
    if (!pt) throw new Error(`We don't have a location for ZIP ${zip}. Try a nearby ZIP.`);
    setHereState({ ...pt, label: `Near ${zip}`, zip });
  }, []);

  const locateMe = useCallback(async () => {
    const { status: perm } = await Location.requestForegroundPermissionsAsync();
    if (perm !== 'granted') throw new Error('Location permission was not granted.');
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setHereState({ lat: p.coords.latitude, lng: p.coords.longitude, label: 'Near you' });
  }, []);

  // ---------- My list store filter ----------
  const listChains = useMemo(() => [...new Set(stores.map((s) => s.chain))], [stores]);
  /** From "All stores", tapping a store shows only that store; after that, taps add or remove stores. */
  const toggleListChain = useCallback((k) => {
    setHideChains((hidden) => {
      const allOn = listChains.every((c) => !hidden.includes(c));
      let next;
      if (k === 'all') next = [];
      else if (allOn) next = listChains.filter((c) => c !== k);
      else if (hidden.includes(k)) next = hidden.filter((c) => c !== k);
      else next = [...hidden, k];
      return listChains.every((c) => next.includes(c)) ? [] : next; // none left: back to all
    });
  }, [listChains]);
  const listItems = useMemo(
    () => (hideChains.length ? items.filter((it) => !hideChains.includes(it.chain)) : items),
    [items, hideChains],
  );

  // ---------- labels ----------
  /** "Safeway", or the store on the sign for Kroger-owned stores ("Foods Co"). */
  const labelFor = useCallback((item) => {
    const s = nearestStore(item, storesById, here)?.store;
    return chainName(item.chain, s?.banner);
  }, [storesById, here]);

  const value = {
    hydrated, list, here, radius, setRadius, hideChains, listChains, toggleListChain, listItems, stores, storesById, items, status, loading, error,
    krogerPending: krogerPending.current,
    reload: load, addItem, updateItem, removeItem, setZip, locateMe, labelFor,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
