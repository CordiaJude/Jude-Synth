// Mapping presets: the four built-ins plus the user's own (persisted locally).

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { BUILT_IN_PRESETS, CLASSIC_TWO_HAND } from '../mapping/presets';
import { validatePreset } from '../mapping/schema';
import type { MappingPreset } from '../mapping/types';

interface PresetState {
  userPresets: MappingPreset[];
  activeId: string;
  select: (id: string) => void;
  /** Save edits to a user preset; editing a built-in creates a copy first. Returns the saved preset's id. */
  save: (preset: MappingPreset) => string;
  duplicate: (id: string) => string;
  remove: (id: string) => void;
  importJson: (text: string) => { ok: true; id: string } | { ok: false; errors: string[] };
}

export const allPresets = (user: MappingPreset[]): MappingPreset[] => [...BUILT_IN_PRESETS, ...user];

const newId = () => `user-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export const usePresets = create<PresetState>()(
  persist(
    (set, get) => ({
      userPresets: [],
      activeId: CLASSIC_TWO_HAND.id,
      select: (id) => set({ activeId: id }),
      save: (preset) => {
        if (preset.builtIn) {
          const copy = {
            ...structuredClone(preset),
            id: newId(),
            builtIn: false,
            name: `${preset.name} (custom)`,
          };
          set((s) => ({ userPresets: [...s.userPresets, copy], activeId: copy.id }));
          return copy.id;
        }
        set((s) => ({ userPresets: s.userPresets.map((p) => (p.id === preset.id ? preset : p)) }));
        return preset.id;
      },
      duplicate: (id) => {
        const src = allPresets(get().userPresets).find((p) => p.id === id);
        if (!src) return get().activeId;
        const copy = { ...structuredClone(src), id: newId(), builtIn: false, name: `${src.name} copy` };
        set((s) => ({ userPresets: [...s.userPresets, copy], activeId: copy.id }));
        return copy.id;
      },
      remove: (id) =>
        set((s) => ({
          userPresets: s.userPresets.filter((p) => p.id !== id),
          activeId: s.activeId === id ? CLASSIC_TWO_HAND.id : s.activeId,
        })),
      importJson: (text) => {
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          return { ok: false, errors: ['Not valid JSON.'] };
        }
        const r = validatePreset(json);
        if (!r.ok) return r;
        const preset = { ...r.preset, id: newId(), builtIn: false };
        set((s) => ({ userPresets: [...s.userPresets, preset], activeId: preset.id }));
        return { ok: true, id: preset.id };
      },
    }),
    {
      name: 'handwave.presets.v1',
      storage: createJSONStorage(() => localStorage),
      // Drop anything in storage that no longer validates (e.g. after a schema change).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PresetState>;
        const userPresets = (p.userPresets ?? []).flatMap((x) => {
          const r = validatePreset(x);
          return r.ok ? [r.preset] : [];
        });
        const ids = new Set(allPresets(userPresets).map((x) => x.id));
        return {
          ...current,
          userPresets,
          activeId: p.activeId && ids.has(p.activeId) ? p.activeId : current.activeId,
        };
      },
    },
  ),
);

export function activePreset(): MappingPreset {
  const s = usePresets.getState();
  return allPresets(s.userPresets).find((p) => p.id === s.activeId) ?? CLASSIC_TWO_HAND;
}
