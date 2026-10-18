import { describe, expect, it } from 'vitest';
import { diatonicChord, diatonicChords, MODES, scaleOf, type Key, type Mode } from '../../../src/theory';

const C = (mode: Mode = 'ionian'): Key => ({ tonic: 0, mode });

describe('scales', () => {
  it('builds all seven modes', () => {
    expect(scaleOf(C('ionian'))).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scaleOf({ tonic: 2, mode: 'dorian' })).toEqual([2, 4, 5, 7, 9, 11, 0]);
    expect(scaleOf({ tonic: 9, mode: 'aeolian' })).toEqual([9, 11, 0, 2, 4, 5, 7]);
    expect(MODES).toHaveLength(7);
  });
});

describe('diatonic triads', () => {
  const table: Record<Mode, string> = {
    ionian: 'C Dm Em F G Am Bdim',
    dorian: 'Cm Dm E♭ F Gm Adim B♭',
    phrygian: 'Cm D♭ E♭ Fm Gdim A♭ B♭m',
    lydian: 'C D Em F♯dim G Am Bm',
    mixolydian: 'C Dm Edim F Gm Am B♭',
    aeolian: 'Cm Ddim E♭ Fm Gm A♭ B♭',
    locrian: 'Cdim D♭ E♭m Fm G♭ A♭ B♭m',
  };
  for (const mode of MODES) {
    it(`${mode} on C`, () => {
      expect(
        diatonicChords(C(mode))
          .map((c) => c.name)
          .join(' '),
      ).toBe(table[mode]);
    });
  }

  it('Roman numerals use major-relative accidentals and case', () => {
    expect(diatonicChords(C('ionian')).map((c) => c.roman)).toEqual([
      'I',
      'ii',
      'iii',
      'IV',
      'V',
      'vi',
      'vii°',
    ]);
    expect(diatonicChords(C('aeolian')).map((c) => c.roman)).toEqual([
      'i',
      'ii°',
      '♭III',
      'iv',
      'v',
      '♭VI',
      '♭VII',
    ]);
    expect(diatonicChords(C('dorian')).map((c) => c.roman)).toEqual([
      'i',
      'ii',
      '♭III',
      'IV',
      'v',
      'vi°',
      '♭VII',
    ]);
    expect(diatonicChords(C('lydian'))[3]!.roman).toBe('♯iv°');
    expect(diatonicChords(C('locrian'))[4]!.roman).toBe('♭V');
  });
});

describe('sevenths and ninths', () => {
  it('stacks diatonic sevenths in major', () => {
    expect(diatonicChords(C(), 'seventh').map((c) => c.name)).toEqual([
      'Cmaj7',
      'Dm7',
      'Em7',
      'Fmaj7',
      'G7',
      'Am7',
      'Bm7♭5',
    ]);
    expect(diatonicChords(C(), 'seventh').map((c) => c.roman)).toEqual([
      'Imaj7',
      'ii7',
      'iii7',
      'IVmaj7',
      'V7',
      'vi7',
      'viiø7',
    ]);
  });

  it('stacks ninths but avoids diatonic ♭9s', () => {
    const ninths = diatonicChords(C(), 'ninth').map((c) => c.name);
    expect(ninths).toEqual(['Cmaj9', 'Dm9', 'Em7', 'Fmaj9', 'G9', 'Am9', 'Bm7♭5']);
  });

  it('applies explicit qualities to the diatonic root', () => {
    expect(diatonicChord(C(), { degree: 5, quality: 'sus4' }).name).toBe('Gsus4');
    expect(diatonicChord(C(), { degree: 4, quality: 'add9' }).pitchClasses).toEqual([5, 9, 0, 7]);
    expect(diatonicChord(C(), { degree: 1, quality: 'aug' })).toMatchObject({
      name: 'Caug',
      roman: 'I+',
      diatonic: false,
    });
  });
});

describe('modal interchange', () => {
  it('borrows from the parallel minor in major keys', () => {
    const k = C();
    expect(diatonicChord(k, { degree: 4, parallel: true })).toMatchObject({
      name: 'Fm',
      roman: 'iv',
      diatonic: false,
    });
    expect(diatonicChord(k, { degree: 6, parallel: true })).toMatchObject({ name: 'A♭', roman: '♭VI' });
    expect(diatonicChord(k, { degree: 7, parallel: true })).toMatchObject({ name: 'B♭', roman: '♭VII' });
    expect(diatonicChord(k, { degree: 3, parallel: true })).toMatchObject({ name: 'E♭', roman: '♭III' });
  });

  it('borrows from the parallel major in minor keys (Picardy third, major IV)', () => {
    const am: Key = { tonic: 9, mode: 'aeolian' };
    expect(diatonicChord(am, { degree: 1, parallel: true }).name).toBe('A');
    expect(diatonicChord(am, { degree: 4, parallel: true }).name).toBe('D');
    expect(diatonicChord(am, { degree: 5, parallel: true, extension: 'seventh' }).name).toBe('E7');
  });

  it('supports fixed borrowed chords', () => {
    const k: Key = { tonic: 7, mode: 'ionian' }; // G major
    expect(diatonicChord(k, { degree: 1, borrowed: 'bVII' })).toMatchObject({ name: 'F', roman: '♭VII' });
    expect(diatonicChord(k, { degree: 1, borrowed: 'iv' }).name).toBe('Cm');
    expect(diatonicChord(k, { degree: 1, borrowed: 'bVI', extension: 'seventh' }).name).toBe('E♭maj7');
    expect(diatonicChord(k, { degree: 1, borrowed: 'V/V', extension: 'seventh' })).toMatchObject({
      name: 'A7',
      roman: 'V7/V',
    });
  });
});

describe('spelling', () => {
  it('uses flats in flat keys and sharps in sharp keys', () => {
    expect(diatonicChords({ tonic: 10, mode: 'ionian' }).map((c) => c.name)[0]).toBe('B♭');
    expect(diatonicChords({ tonic: 3, mode: 'ionian' }).map((c) => c.name)).toEqual([
      'E♭',
      'Fm',
      'Gm',
      'A♭',
      'B♭',
      'Cm',
      'Ddim',
    ]);
    expect(diatonicChords({ tonic: 4, mode: 'ionian' }).map((c) => c.name)).toEqual([
      'E',
      'F♯m',
      'G♯m',
      'A',
      'B',
      'C♯m',
      'D♯dim',
    ]);
    expect(diatonicChords({ tonic: 2, mode: 'dorian' }).map((c) => c.name)[0]).toBe('Dm'); // D dorian = C major family
  });
});
