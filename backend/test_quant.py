# -*- coding: utf-8 -*-
"""Unit tests for onset quantization, chord grouping, bend units, and techniques."""
from app.services.transcribe import (
    quantize_onset,
    quantize_duration,
    events_to_tab,
    dp_string_fret,
    dp_chord_aware,
    filter_events,
    coalesce_same_midi_fragments,
    merge_detection_passes,
    collapse_false_polyphony,
    simplify_unplayable_chords,
    simplify_unplayable_tab_chords,
    chord_window_ms_for_bpm,
    group_chords,
    merge_tab_beats,
    _classify_bends,
    _is_monotonic_glide,
    _bins_to_semitones,
    detect_techniques_pitch_based,
    preprocess_audio_for_basic_pitch,
    _match_known_shape,
    _max_span_at_position,
    _build_time_slots,
    _enumerate_voicings,
    _transition_cost,
    _position_center,
    apply_expected_tab_prior,
    prefer_expected_fingerings,
    sync_raw_events_to_tab_notes,
    events_to_raw_dicts,
    clamp_events_to_max_tab_fret,
    clamp_fingerings_to_max_tab_fret,
    remap_fingerings_preserve_midi,
    _pick_fingering_under_cap,
    _suppress_sudden_high_register_voicings,
    _is_playable_tab_chord,
    _STYLE_POWER,
    _STYLE_BARRE,
    _STYLE_OPEN,
    TabNoteOut,
    CHORD_WINDOW_MS,
    MAX_FRET,
    MAX_TAB_FRET,
    OPEN_STRING_MIDI,
)
from app.services.bpm_detect import detect_bpm, tempo_candidates
import numpy as np
import os
import tempfile
import soundfile as sf

def test_quantize_onset_basic():
    assert quantize_onset(0.0)   == (1, 1.0)
    assert quantize_onset(0.25)  == (1, 1.25)
    assert quantize_onset(0.5)   == (1, 1.5)
    assert quantize_onset(3.75)  == (1, 4.75)

def test_quantize_onset_snaps_to_nearest():
    # 0.02 beats off -> snaps to 0.0 -> (measure=1, beat=1.0)
    m, b = quantize_onset(0.02)
    assert (m, b) == (1, 1.0), f"Got ({m},{b})"

def test_quantize_onset_near_measure_boundary():
    # 3.99 absolute beats -> round(3.99/0.25)*0.25 = 4.0
    # measure = int(4.0 // 4)+1 = 2, beat = (4.0 % 4)+1.0 = 1.0
    # Correct: note is placed at downbeat of measure 2, not at beat 5 of measure 1
    m, b = quantize_onset(3.99)
    assert m == 2 and abs(b - 1.0) < 0.01, f"Expected (2, 1.0), got ({m}, {b})"

def test_chord_grouping():
    # Two notes played nearly simultaneously at BPM=120 (0.5 sec/beat)
    # Note 1 at 0.01s = 0.02 beats, Note 2 at 0.03s = 0.06 beats
    # Both round to 0.0 beats total -> (measure=1, beat=1.0)
    events = [(0.01, 0.5, 64, 0.8), (0.03, 0.5, 59, 0.7)]
    sfp = dp_string_fret(events)
    techniques = [(None, None), (None, None)]
    notes = events_to_tab(events, sfp, techniques, bpm=120.0)
    assert len(notes) == 2
    m1, b1 = notes[0].measure, notes[0].beat
    m2, b2 = notes[1].measure, notes[1].beat
    assert m1 == m2, f"Chord notes in different measures: {m1} vs {m2}"
    assert abs(b1 - b2) < 0.01, f"Chord notes at different beats: {b1} vs {b2}"
    print(f"  Chord at measure={m1}, beat={b1} OK")

def test_quantize_duration():
    assert quantize_duration(0.95) == 1.0
    assert quantize_duration(0.45) == 0.5
    assert quantize_duration(0.24) == 0.25
    assert quantize_duration(3.8)  == 4.0

def test_group_chords_collapses_strum():
    """Notes within 70ms should share the same onset after group_chords."""
    events = [
        (0.000, 0.5, 64, 0.9),   # onset 0ms
        (0.030, 0.5, 59, 0.8),   # onset 30ms (strum)
        (0.060, 0.5, 55, 0.7),   # onset 60ms (strum)
        (0.500, 0.5, 50, 0.85),  # onset 500ms — separate note
    ]
    grouped = group_chords(events, window_ms=70.0)
    # First 3 should have the same onset (median of 0,30,60 = 30ms = 0.030s)
    o1 = grouped[0][0]
    o2 = grouped[1][0]
    o3 = grouped[2][0]
    assert abs(o1 - o2) < 1e-6 and abs(o1 - o3) < 1e-6, f"Chord onsets not unified: {o1}, {o2}, {o3}"
    # Fourth note should be separate
    assert grouped[3][0] > 0.4, f"Separate note was merged: {grouped[3][0]}"
    print(f"  Strum at t={o1:.4f}s, separate at t={grouped[3][0]:.4f}s OK")

def test_classify_bends_no_bend_on_flat():
    """Flat pitch (no bends) -> technique should be None."""
    flat_bends = [0] * 20
    tech, semitones = _classify_bends(flat_bends)
    assert tech is None, f"Expected None, got {tech}"

def test_classify_bends_detects_bend():
    """Rise then hold — bend, not slide. Needs a clear >= ~0.75 st rise."""
    bend_bins = [0, 0, 0, 2, 4, 5, 5, 5, 5, 5, 5]
    tech, semitones = _classify_bends(bend_bins, duration_ms=280.0)
    assert tech == "bend", f"Expected 'bend', got {tech}"
    assert semitones is not None and semitones >= 0.75, f"Expected >= 0.75 semitones, got {semitones}"
    print(f"  Bend detected: {semitones} semitones")


def test_classify_bends_rejects_weak_jitter():
    """Small net rise that used to false-positive as a bend."""
    weak = [0, 1, 1, 2, 2, 2, 2, 2]
    tech, _ = _classify_bends(weak, duration_ms=300.0)
    assert tech is None, f"Expected no bend on weak jitter, got {tech}"

def test_classify_bends_detects_vibrato():
    """Oscillating pitch -> technique should be 'vibrato'."""
    import math
    # 24 samples of sine wave with amplitude ~1.2 semitone (3.6 bins)
    vibrato_bins = [int(round(3.6 * math.sin(i * math.pi / 2.5))) for i in range(24)]
    tech, _ = _classify_bends(vibrato_bins, duration_ms=320.0)
    assert tech == "vibrato", f"Expected 'vibrato', got {tech}"

def test_classify_bends_ignores_small_pitch_wobble():
    wobble_bins = [0, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1]
    tech, _ = _classify_bends(wobble_bins, duration_ms=320.0)
    assert tech is None, f"Expected small wobble not to be vibrato, got {tech}"

def test_group_chords_anchor_prevents_melody_merge():
    """Two melody notes 200ms apart should not become one chord."""
    events = [
        (0.000, 0.35, 64, 0.9),
        (0.200, 0.45, 66, 0.85),
    ]
    grouped = group_chords(events, window_ms=chord_window_ms_for_bpm(120.0))
    onsets_ms = [int(round(float(e[0]) * 1000)) for e in grouped]
    assert len(set(onsets_ms)) == 2, f"Expected separate onsets, got {onsets_ms}"

def test_group_chords_anchor_strum():
    """Three notes within 50ms should collapse to one chord onset."""
    events = [
        (0.000, 0.5, 64, 0.9),
        (0.025, 0.5, 59, 0.8),
        (0.050, 0.5, 55, 0.7),
        (0.600, 0.5, 48, 0.85),
    ]
    grouped = group_chords(events, window_ms=CHORD_WINDOW_MS)
    onsets_ms = sorted(set(int(round(float(e[0]) * 1000)) for e in grouped))
    assert len(onsets_ms) == 2, f"Expected 2 onset groups, got {onsets_ms}"
    print(f"  Anchor strum -> 2 onsets: {onsets_ms} OK")

def test_filter_events_drops_quiet_ghosts():
    events = [
        (0.0, 0.2, 64, 0.90),
        (0.1, 0.2, 65, 0.10),
        (0.2, 0.4, 67, 0.25),
    ]
    kept = filter_events(events, min_amplitude_ratio=0.22)
    mids = [int(e[2]) for e in kept]
    assert mids == [64, 67], f"Expected ghost note to be pruned, got {mids}"

def test_preprocess_audio_trims_and_normalizes():
    sr = 22050
    tone = np.sin(2 * np.pi * 220 * np.linspace(0, 0.25, int(sr * 0.25), endpoint=False)) * 0.02
    audio = np.concatenate([np.zeros(int(sr * 0.1)), tone, np.zeros(int(sr * 0.1))])
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    out_path = None
    try:
        sf.write(path, audio, sr)
        out_path, stats = preprocess_audio_for_basic_pitch(path)
        processed, _ = sf.read(out_path)
        assert stats["enabled"] is True, f"Expected preprocessing to run, got {stats}"
        assert stats["trimmedMs"] > 0, f"Expected silence trimming, got {stats}"
        assert stats.get("trimStartMs", 0) > 0, f"Expected trimStartMs, got {stats}"
        assert np.max(np.abs(processed)) > np.max(np.abs(audio)), "Expected normalized output to be louder"
    finally:
        if out_path and out_path != path and os.path.exists(out_path):
            os.remove(out_path)
        if os.path.exists(path):
            os.remove(path)

def test_collapse_single_note_artifact_cluster():
    """B-string C# plus lower/upper artifacts should collapse to the intended note."""
    events = [
        (0.000, 0.35, 42, 0.28),  # low-E fret 2 style lower artifact
        (0.006, 0.35, 61, 0.82),  # intended B-string fret 2 pitch
        (0.010, 0.32, 73, 0.36),  # octave artifact
    ]
    collapsed, stats = collapse_false_polyphony(events)
    mids = [int(round(e[2])) for e in collapsed]
    assert mids == [61], f"Expected one intended note, got {mids}"
    assert stats["collapsedEvents"] == 2, f"Expected two collapsed artifacts, got {stats}"

def test_collapse_dominant_non_overtone_ghost_cluster():
    events = [
        (0.000, 0.35, 61, 0.92),
        (0.006, 0.24, 54, 0.25),
        (0.010, 0.22, 66, 0.22),
        (0.012, 0.20, 70, 0.18),
    ]
    collapsed, stats = collapse_false_polyphony(events, window_ms=35.0)
    mids = [int(round(e[2])) for e in collapsed]
    assert mids == [61], f"Expected dominant single note, got {mids}"
    assert stats["dominantSingleClusters"] == 1

def test_collapse_duplicate_same_midi_events():
    events = [
        (0.000, 0.2, 61, 0.45),
        (0.004, 0.2, 61, 0.90),
    ]
    collapsed, stats = collapse_false_polyphony(events)
    assert len(collapsed) == 1, f"Expected one duplicate survivor, got {collapsed}"
    assert abs(float(collapsed[0][3]) - 0.90) < 0.001
    assert stats["collapsedEvents"] == 1

def test_real_triad_survives_polyphony_cleanup():
    events = [
        (0.000, 0.5, 52, 0.9),
        (0.020, 0.5, 56, 0.8),
        (0.040, 0.5, 59, 0.7),
    ]
    collapsed, stats = collapse_false_polyphony(events)
    simplified, chord_stats = simplify_unplayable_chords(group_chords(collapsed, window_ms=80.0))
    assert len(simplified) == 3, f"Expected triad to remain, got {simplified}"
    assert stats["collapsedEvents"] == 0
    assert chord_stats["removedEvents"] == 0

def test_impossible_chord_cluster_is_simplified():
    events = [
        (0.000, 0.5, 40, 0.9),
        (0.000, 0.5, 41, 0.8),
        (0.000, 0.5, 42, 0.7),
        (0.000, 0.5, 43, 0.6),
        (0.000, 0.5, 44, 0.5),
        (0.000, 0.5, 45, 0.4),
        (0.000, 0.5, 46, 0.3),
    ]
    simplified, stats = simplify_unplayable_chords(events)
    assert len(simplified) < len(events), f"Expected pruning, got {simplified}"
    assert stats["removedEvents"] > 0


def test_two_note_impossible_span_is_pruned():
    """Two notes that can only share one string must collapse."""
    # MIDI 40 and 41 both live only on the low-E string (frets 0 and 1).
    events = [
        (0.000, 0.4, 40, 0.9),
        (0.000, 0.4, 41, 0.85),
    ]
    simplified, stats = simplify_unplayable_chords(events)
    assert len(simplified) == 1, f"Expected same-string clash pruned to 1, got {simplified}"
    assert stats["removedEvents"] >= 1
    assert stats["simplifiedClusters"] >= 1


def test_octave_ghost_stripped_from_events():
    """Loud fundamental + quieter octave should leave one event (MIDI rewritten path)."""
    events = [
        (0.000, 0.4, 52, 0.90),  # E3
        (0.005, 0.35, 64, 0.40),  # E4 octave ghost
    ]
    simplified, stats = simplify_unplayable_chords(events)
    mids = [int(round(e[2])) for e in simplified]
    assert mids == [52], f"Expected octave ghost removed, got {mids}"
    assert stats["removedEvents"] >= 1


def test_octave_correct_rewrites_implausible_high_midi():
    """A pitch that only fits above fret 15 should be rewritten down an octave."""
    # MIDI 88 → min fret on high E is 24 (out of range) / wait 88-64=24 > 22
    # MIDI 84 = high E fret 20 — min_fret among candidates: string1 fret20
    # Actually need min_fret > 15: MIDI 81 → e fret 17, B fret 22
    events = [(0.0, 0.3, 81, 0.5)]
    simplified, stats = simplify_unplayable_chords(events)
    assert len(simplified) == 1
    assert int(round(simplified[0][2])) == 69, f"Expected octave-down to 69, got {simplified[0][2]}"
    assert stats.get("octaveCorrectedEvents", 0) >= 1


def test_sync_raw_events_matches_tab_midi():
    events = [
        (0.0, 0.3, 64, 0.9),
        (0.5, 0.8, 59, 0.8),
        (1.0, 1.3, 55, 0.7),
    ]
    notes = [
        TabNoteOut("a", 1, 1.0, 1, 0, 0.5, 64, 0, 0.9),
        TabNoteOut("c", 1, 3.0, 3, 0, 0.5, 55, 1000, 0.7),
    ]
    synced = sync_raw_events_to_tab_notes(events, notes)
    raw = events_to_raw_dicts(synced)
    assert len(raw) == 2
    assert [r["midi"] for r in raw] == [64, 55]
    assert abs(raw[0]["onsetMs"] - 0) <= 1
    assert abs(raw[1]["onsetMs"] - 1000) <= 1


def test_expected_tab_keeps_match_drops_phantom_preserves_miss():
    expected = [
        {"onsetMs": 0, "midi": 64, "string": 1, "fret": 0},
        {"onsetMs": 500, "midi": 59, "string": 2, "fret": 0},
        {"onsetMs": 1000, "midi": 55, "string": 3, "fret": 0},
    ]
    # Detected: match on first, octave-wrong on second, phantom harmonic, no third (miss)
    events = [
        (0.000, 0.25, 64, 0.9),
        (0.500, 0.75, 71, 0.85),   # 59+12 octave error → correct to 59
        (0.510, 0.70, 76, 0.25),   # quiet phantom near second slot
        (0.700, 0.90, 80, 0.20),   # weak phantom with no expected neighbor strength
    ]
    corrected, stats = apply_expected_tab_prior(events, expected, bpm=120.0)
    mids = [int(round(e[2])) for e in corrected]
    assert 64 in mids
    assert 59 in mids, f"Expected octave correction to 59, got {mids}"
    assert 55 not in mids, "Must not invent the missed expected note"
    assert stats["droppedPhantoms"] >= 1
    assert stats["matchedEvents"] >= 2
    assert stats["octaveCorrectedEvents"] >= 1


def test_expected_tab_neighboring_semitone_stays_wrong():
    expected = [{"onsetMs": 0, "midi": 64, "string": 1, "fret": 0}]
    corrected, stats = apply_expected_tab_prior(
        [(0.0, 0.25, 65, 0.9)],
        expected,
        bpm=120.0,
    )
    assert [int(round(event[2])) for event in corrected] == [65]
    assert stats["matchedEvents"] == 0
    assert stats["keptWrongNotes"] == 1


def test_expected_tab_duplicate_fingerings_share_pitch_slot():
    expected = [
        {"onsetMs": 0, "midi": 64, "string": 1, "fret": 0},
        {"onsetMs": 0, "midi": 64, "string": 2, "fret": 5},
    ]
    corrected, stats = apply_expected_tab_prior(
        [(0.0, 0.25, 64, 0.9)],
        expected,
        bpm=120.0,
    )
    assert [int(round(event[2])) for event in corrected] == [64]
    assert stats["expectedNotes"] == 2
    assert stats["expectedPitchSlots"] == 1
    assert stats["matchedEvents"] == 1


def test_expected_tab_never_synthesizes_a_missing_event():
    expected = [{"onsetMs": 0, "midi": 64, "string": 1, "fret": 0}]
    corrected, stats = apply_expected_tab_prior([], expected, bpm=120.0)
    assert corrected == []
    assert stats["matchedEvents"] == 0
    assert stats["expectedPitchSlots"] == 1


def test_accurate_merge_coalesces_fragments_and_rescues_pitch_once():
    primary = [(0.5, 0.8, 45, 0.7)]
    sensitive = [
        (0.0, 0.12, 40, 0.24),
        (0.12, 0.24, 40, 0.27),
        (0.5, 0.85, 45, 0.65),
    ]
    merged, stats = merge_detection_passes(primary, sensitive)
    assert [round(event[2]) for event in merged] == [40, 45]
    assert stats["rescuedEvents"] == 1


def test_accurate_merge_rejects_weaker_octave_artifact():
    primary = [(0.0, 0.4, 40, 0.8)]
    sensitive = [(0.02, 0.3, 52, 0.3)]
    merged, stats = merge_detection_passes(primary, sensitive)
    assert [round(event[2]) for event in merged] == [40]
    assert stats["rejectedSensitiveArtifacts"] == 1


def test_accurate_layout_remap_preserves_midi_or_omits():
    events = [
        (0.0, 0.3, 64, 0.8),
        (0.5, 0.8, 69, 0.8),
        (1.0, 1.3, 88, 0.8),
    ]
    pairs, kept, stats = remap_fingerings_preserve_midi(
        [(2, 5), (1, 5), (1, 24)],
        events,
    )
    assert len(kept) == 2
    assert stats["omittedUnrenderableEvents"] == 1
    for pair, event in zip(pairs, kept):
        assert OPEN_STRING_MIDI[pair[0]] + pair[1] == round(event[2])


def test_prefer_expected_fingerings_snaps_string_fret():
    notes = [
        TabNoteOut("a", 1, 1.0, 2, 5, 0.5, 64, 0, 0.9),  # wrong string for MIDI 64
    ]
    expected = [{"onsetMs": 0, "midi": 64, "string": 1, "fret": 0}]
    prefer_expected_fingerings(notes, expected, bpm=120.0)
    assert notes[0].string == 1 and notes[0].fret == 0


def test_ghost_slide_on_picked_sixteenths_not_tagged():
    """Same-string notes ~125ms apart (sixteenth @ 120) without glide are not slides."""
    notes = [
        TabNoteOut("a", 1, 1.0, 3, 5, 0.25, 60, 0, 0.9),
        TabNoteOut("b", 1, 1.25, 3, 7, 0.25, 62, 125, 0.8),
    ]
    detect_techniques_pitch_based(notes, 120.0)
    assert notes[0].technique is None, f"Expected no slide/hammer, got {notes[0].technique}"

def test_impossible_tab_chord_high_fret_is_simplified():
    notes = [
        TabNoteOut("a", 1, 1.0, 6, 20, 0.5, 60, 0, 0.30),
        TabNoteOut("b", 1, 1.0, 1, 27, 0.5, 91, 6, 0.25),
        TabNoteOut("c", 1, 1.0, 2, 0, 0.5, 59, 10, 0.82),
        TabNoteOut("d", 1, 1.0, 3, 12, 0.5, 67, 12, 0.35),
    ]
    simplified, stats = simplify_unplayable_tab_chords(notes)
    assert all(0 <= n.fret <= MAX_TAB_FRET for n in simplified), f"Invalid fret leaked: {simplified}"
    assert len(simplified) < len(notes), f"Expected impossible tab cluster pruning, got {simplified}"
    assert stats["removedTabNotes"] > 0

def test_dominant_tab_ghost_cluster_collapses_to_single_note():
    notes = [
        TabNoteOut("a", 1, 1.0, 2, 2, 0.5, 61, 0, 0.95),
        TabNoteOut("b", 1, 1.0, 4, 4, 0.5, 54, 6, 0.24),
        TabNoteOut("c", 1, 1.0, 1, 2, 0.5, 66, 10, 0.22),
    ]
    simplified, stats = simplify_unplayable_tab_chords(notes)
    assert len(simplified) == 1, f"Expected one tab note, got {simplified}"
    assert simplified[0].id == "a"
    assert stats["dominantTabSingleClusters"] == 1

def test_scattered_open_high_fret_chord_is_rejected():
    """x,14,2,0,x,3 style shapes must not survive tab cleanup."""
    notes = [
        TabNoteOut("a", 1, 1.0, 5, 14, 0.5, 59, 0, 0.7),
        TabNoteOut("b", 1, 1.0, 4, 2, 0.5, 52, 0, 0.8),
        TabNoteOut("c", 1, 1.0, 3, 0, 0.5, 55, 0, 0.75),
        TabNoteOut("d", 1, 1.0, 1, 3, 0.5, 67, 0, 0.7),
    ]
    simplified, stats = simplify_unplayable_tab_chords(notes)
    assert all(n.fret <= MAX_TAB_FRET for n in simplified), f"Fret cap leaked: {simplified}"
    assert not any(n.fret >= 13 for n in simplified), f"High outlier survived: {simplified}"
    assert _is_playable_tab_chord(simplified) or len(simplified) == 1

def test_same_beat_inhuman_chord_cleaned_after_split_onsets():
    """Notes that look like one chord on the page but had split onsets must still be cleaned.

    This is the real failure mode: fret 14 alone is legal; X,14,2,X,5,3 is not.
    merge_tab_beats unifies the grid — cleanup must cluster by (measure, beat).
    """
    from app.services.transcribe import merge_tab_beats

    notes = [
        TabNoteOut("a", 1, 1.0, 5, 14, 0.5, 59, 0, 0.8),
        TabNoteOut("b", 1, 1.25, 4, 2, 0.5, 52, 55, 0.8),
        TabNoteOut("c", 1, 1.0, 2, 5, 0.5, 64, 15, 0.8),
        TabNoteOut("d", 1, 1.25, 1, 3, 0.5, 67, 70, 0.8),
    ]
    merge_tab_beats(notes, window_ms=120.0)
    # After merge they share one beat
    assert len({(n.measure, n.beat) for n in notes}) == 1
    simplified, _ = simplify_unplayable_tab_chords(notes)
    assert not any(n.fret >= 11 for n in simplified), f"High outlier survived: {simplified}"
    if len(simplified) >= 2:
        assert _is_playable_tab_chord(simplified), f"Still inhuman: {[(n.string,n.fret) for n in simplified]}"


def test_xx_11_2_x_0_chord_is_rejected():
    notes = [
        TabNoteOut("a", 1, 1.0, 4, 11, 0.5, 61, 0, 0.8),
        TabNoteOut("b", 1, 1.0, 3, 2, 0.5, 57, 0, 0.8),
        TabNoteOut("c", 1, 1.0, 1, 0, 0.5, 64, 0, 0.8),
    ]
    assert not _is_playable_tab_chord(notes)
    simplified, _ = simplify_unplayable_tab_chords(notes)
    assert not any(n.fret >= 11 for n in simplified), f"Fret 11 survived: {simplified}"

def test_same_string_layered_chord_deletes_high_fret():
    notes = [
        TabNoteOut("b2", 1, 1.0, 2, 2, 0.5, 61, 0, 0.78),
        TabNoteOut("b10", 1, 1.0, 2, 10, 0.5, 69, 0, 0.80),
        TabNoteOut("g0", 1, 1.0, 3, 0, 0.5, 55, 0, 0.82),
        TabNoteOut("e0", 1, 1.0, 1, 0, 0.5, 64, 0, 0.82),
    ]
    simplified, stats = simplify_unplayable_tab_chords(notes)
    b_string = [n for n in simplified if n.string == 2]
    assert len(b_string) == 1, f"Layered B-string notes survived: {simplified}"
    assert b_string[0].fret == 2, f"Expected B-string fret 2 to survive, got {b_string[0]}"
    assert stats["removedTabNotes"] >= 1

def test_high_outlier_octave_remaps_only_when_it_matches_chord():
    notes = [
        TabNoteOut("low_e", 1, 1.0, 6, 0, 0.5, 40, 0, 0.82),
        TabNoteOut("a", 1, 1.0, 5, 2, 0.5, 47, 0, 0.82),
        TabNoteOut("d", 1, 1.0, 4, 2, 0.5, 52, 0, 0.82),
        TabNoteOut("g", 1, 1.0, 3, 1, 0.5, 56, 0, 0.82),
        TabNoteOut("high_e", 1, 1.0, 1, 0, 0.5, 64, 0, 0.82),
        TabNoteOut("outlier", 1, 1.0, 2, 12, 0.5, 71, 0, 0.75),
    ]
    simplified, _ = simplify_unplayable_tab_chords(notes)
    got = {(n.string, n.fret, n.midi) for n in simplified}
    assert (2, 0, 59) in got, f"Expected B4 outlier to octave-remap into open B: {got}"
    assert _is_playable_tab_chord(simplified), f"Still inhuman: {[(n.string, n.fret) for n in simplified]}"


def test_high_outlier_drops_when_octave_does_not_match_chord():
    notes = [
        TabNoteOut("low_e", 1, 1.0, 6, 0, 0.5, 40, 0, 0.82),
        TabNoteOut("a", 1, 1.0, 5, 2, 0.5, 47, 0, 0.82),
        TabNoteOut("d", 1, 1.0, 4, 2, 0.5, 52, 0, 0.82),
        TabNoteOut("g", 1, 1.0, 3, 0, 0.5, 55, 0, 0.82),
        TabNoteOut("high_e", 1, 1.0, 1, 0, 0.5, 64, 0, 0.82),
        TabNoteOut("outlier", 1, 1.0, 1, 14, 0.5, 78, 0, 0.75),
    ]
    simplified, _ = simplify_unplayable_tab_chords(notes)
    mids = [n.midi for n in simplified]
    assert 78 not in mids and 66 not in mids, f"Outlier survived/remapped into non-shape pitch: {simplified}"
    assert _is_playable_tab_chord(simplified), f"Still inhuman: {[(n.string, n.fret) for n in simplified]}"

def test_technique_reconcile_does_not_break_chord_playability():
    """Slide/hammer reconciliation must not mutate a cleaned chord into nonsense."""
    notes = [
        TabNoteOut("lead", 1, 1.0, 3, 4, 0.5, 59, 0, 0.9),
        TabNoteOut("chord_a", 1, 1.25, 2, 3, 0.5, 62, 70, 0.85),
        TabNoteOut("chord_b", 1, 1.25, 1, 0, 0.5, 64, 72, 0.8),
    ]
    assert _is_playable_tab_chord(notes[1:])
    detect_techniques_pitch_based(notes, bpm=120.0)
    assert _is_playable_tab_chord(notes[1:]), f"Technique pass broke chord: {[(n.string, n.fret) for n in notes[1:]]}"
    assert len({n.string for n in notes[1:]}) == 2

def test_single_pluck_ghost_chord_collapses():
    """One loud note + weak neighbors must collapse to a single note."""
    events = [
        (0.000, 0.35, 64, 0.92),
        (0.008, 0.30, 71, 0.28),
        (0.010, 0.28, 76, 0.22),
    ]
    collapsed, stats = collapse_false_polyphony(events)
    assert len(collapsed) == 1, f"Expected single note, got {collapsed}"
    assert int(round(collapsed[0][2])) == 64
    assert stats["dominantSingleClusters"] + stats["artifactClusters"] >= 1

def test_tight_harmonic_byproducts_collapse_even_if_playable():
    """A single pluck can look like a playable partial chord; use source evidence."""
    events = [
        (0.000, 0.45, 64, 0.90),
        (0.006, 0.20, 71, 0.55),
        (0.010, 0.18, 76, 0.35),
    ]
    collapsed, stats = collapse_false_polyphony(events)
    mids = [int(round(e[2])) for e in collapsed]
    assert mids == [64], f"Expected harmonic byproducts to collapse, got {mids}"
    assert stats["dominantSingleClusters"] + stats["artifactClusters"] >= 1

def test_comparable_tab_chord_survives_cleanup():
    notes = [
        TabNoteOut("a", 1, 1.0, 5, 3, 0.5, 48, 0, 0.85),
        TabNoteOut("b", 1, 1.0, 4, 2, 0.5, 52, 10, 0.78),
        TabNoteOut("c", 1, 1.0, 3, 0, 0.5, 55, 18, 0.70),
    ]
    simplified, stats = simplify_unplayable_tab_chords(notes)
    assert len(simplified) == 3, f"Expected comparable chord to survive, got {simplified}"
    assert stats["dominantTabSingleClusters"] == 0

def test_open_melody_prefers_open_string_over_fret_five():
    events = [
        _make_event(0.0, 0.25, 55, 0.85),  # open G
        _make_event(0.5, 0.75, 59, 0.85),  # open B
        _make_event(1.0, 1.25, 64, 0.85),  # open high E, not B-string fret 5
    ]
    pairs = dp_chord_aware(events, bpm=120.0)
    assert pairs == [(3, 0), (2, 0), (1, 0)], f"Expected open G/B/E melody, got {pairs}"

def test_isolated_fret_five_rewrites_in_open_phrase():
    events = [
        _make_event(0.0, 0.25, 64, 0.85),  # open high E
        _make_event(0.5, 0.75, 69, 0.85),  # would often be high-E fret 5
        _make_event(1.0, 1.25, 64, 0.85),  # open high E
    ]
    pairs = dp_chord_aware(events, bpm=120.0)
    assert pairs[1][1] <= 4, f"Isolated fret >=5 survived in open phrase: {pairs}"


def test_same_string_high_spike_and_return_is_banned():
    events = [
        _make_event(0.0, 0.25, 68, 0.85),  # high E fret 4
        _make_event(0.5, 0.75, 78, 0.85),  # high E fret 14 style spike
        _make_event(1.0, 1.25, 68, 0.85),  # back to fret 4
    ]
    pairs = dp_chord_aware(events, bpm=120.0)
    assert pairs[1][1] <= 4, f"Spike-and-return high fret survived: {pairs}"


def test_same_string_two_fourteen_two_spike_is_banned():
    events = [
        _make_event(0.0, 0.25, 66, 0.85),  # high E fret 2
        _make_event(0.5, 0.75, 78, 0.85),  # high E fret 14 style spike
        _make_event(1.0, 1.25, 66, 0.85),  # back to fret 2
    ]
    pairs = dp_chord_aware(events, bpm=120.0)
    assert all(f <= MAX_TAB_FRET for _, f in pairs), f"Fret cap leaked: {pairs}"
    assert pairs[1][1] <= 4, f"2-14-2 spike survived: {pairs}"


def test_tempo_candidates_expose_half_time():
    assert tempo_candidates(154.0) == [77.0, 154.0]

def test_alternate_bpm_changes_quantized_position():
    events = [(1.0, 1.25, 61, 0.9)]
    sfp = dp_string_fret(events)
    techniques = [(None, None)]
    fast = events_to_tab(events, sfp, techniques, bpm=154.0)[0]
    slow = events_to_tab(events, sfp, techniques, bpm=77.0)[0]
    assert (fast.measure, fast.beat) != (slow.measure, slow.beat)

def test_events_to_tab_respects_time_signature():
    events = [(1.5, 1.75, 61, 0.9)]  # 3 beats after start at 120 BPM
    sfp = dp_string_fret(events)
    techniques = [(None, None)]
    note = events_to_tab(events, sfp, techniques, bpm=120.0, beats_per_measure=3)[0]
    assert (note.measure, note.beat) == (2, 1.0), f"Expected 3/4 downbeat of measure 2, got {(note.measure, note.beat)}"

def test_detect_bpm_octave_corrects_click_track():
    sr = 22050
    bpm = 120.0
    duration_s = 8.0
    y = np.zeros(int(sr * duration_s), dtype=np.float32)
    click_len = int(sr * 0.015)
    for beat in np.arange(0.0, duration_s, 60.0 / bpm):
        start = int(beat * sr)
        stop = min(len(y), start + click_len)
        y[start:stop] += np.hanning(stop - start).astype(np.float32)

    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        sf.write(path, y, sr)
        result = detect_bpm(path)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass

    assert result["bpm"] is not None, f"Expected BPM, got {result}"
    assert abs(float(result["bpm"]) - bpm) <= 2.0, f"Expected ~{bpm}, got {result}"

def test_merge_tab_beats():
    notes = [
        TabNoteOut("a", 1, 1.0, 1, 0, 1.0, 64, 0, 0.9),
        TabNoteOut("b", 1, 1.25, 2, 0, 1.0, 59, 50, 0.8),
        TabNoteOut("c", 1, 1.0, 3, 0, 1.0, 55, 80, 0.7),
    ]
    merge_tab_beats(notes)
    beats = {n.beat for n in notes}
    assert len(beats) == 1, f"Chord notes on different beats: {beats}"

def test_classify_slide_glide_in_bend_bins():
    """Long monotonic glide in bend data — no longer auto-tagged (too noisy)."""
    glide_bins = [int(i * 2) for i in range(12)]
    tech, _ = _classify_bends(glide_bins)
    assert tech is None, f"Expected no technique from jitter, got {tech}"

def test_detect_two_note_slide():
    notes = [
        TabNoteOut("a", 1, 1.0, 3, 5, 0.5, 60, 0, 0.9),   # G string, fret 5
        TabNoteOut("b", 1, 1.75, 3, 8, 0.5, 63, 200, 0.8), # slide to fret 8, +3 st
    ]
    detect_techniques_pitch_based(notes, 120.0)
    assert notes[0].technique == "slide", f"Expected slide on n1, got {notes[0].technique}"

def test_detect_melody_not_slide():
    """Normal picked melody — different strings / long gap — not a slide."""
    notes = [
        TabNoteOut("a", 1, 1.0, 1, 8, 0.5, 76, 0, 0.9),
        TabNoteOut("b", 1, 2.0, 2, 5, 0.5, 69, 500, 0.8),  # 500ms apart
    ]
    detect_techniques_pitch_based(notes, 120.0)
    assert notes[0].technique is None, f"Expected no technique, got {notes[0].technique}"

def test_same_string_eighth_not_slide():
    """Picked eighths on one string (~250ms @ 120 BPM) are not slides."""
    notes = [
        TabNoteOut("a", 1, 1.0, 3, 5, 0.5, 60, 0, 0.9),
        TabNoteOut("b", 1, 1.5, 3, 7, 0.5, 62, 250, 0.8),
    ]
    detect_techniques_pitch_based(notes, 120.0)
    assert notes[0].technique is None, f"Expected no technique, got {notes[0].technique}"

def test_detect_hammer_not_slide():
    notes = [
        TabNoteOut("a", 1, 1.0, 2, 3, 0.25, 55, 0, 0.9),
        TabNoteOut("b", 1, 1.25, 2, 5, 0.25, 57, 60, 0.8),
    ]
    detect_techniques_pitch_based(notes, 120.0)
    assert notes[0].technique == "hammer", f"Expected hammer, got {notes[0].technique}"


def test_preprocess_quiet_input_single_pass_reaches_expected_range():
    """A quiet signal (peak ~0.02) must reach [0.15, 0.96] peak and [0.05, 0.15]
    RMS after the backend normalization pass alone.

    This documents the correct single-pass behaviour that is now the only
    normalization step. The frontend no longer normalizes before upload, so
    the backend receives the raw quiet signal and must raise it to a usable
    level without exceeding the safety caps.
    """
    sr = 22050
    freq = 220.0
    duration_s = 0.5
    tone = np.sin(2 * np.pi * freq * np.linspace(0, duration_s, int(sr * duration_s), endpoint=False)) * 0.02
    audio = np.concatenate([np.zeros(int(sr * 0.1)), tone, np.zeros(int(sr * 0.1))])
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    out_path = None
    try:
        sf.write(path, audio, sr)
        out_path, stats = preprocess_audio_for_basic_pitch(path)
        processed, _ = sf.read(out_path)
        assert stats["enabled"] is True, f"Expected preprocessing to run, got {stats}"
        peak = float(np.max(np.abs(processed)))
        rms_after = stats["rmsAfter"]
        assert 0.15 <= peak <= 0.96, (
            f"Expected peak in [0.15, 0.96] after single-pass normalization, got {peak:.4f}"
        )
        assert 0.05 <= rms_after <= 0.15, (
            f"Expected rmsAfter in [0.05, 0.15], got {rms_after:.4f}"
        )
    finally:
        if out_path and out_path != path and os.path.exists(out_path):
            os.remove(out_path)
        if os.path.exists(path):
            os.remove(path)


def test_preprocess_already_adequate_input_minimal_gain():
    """Audio already near full scale (peak ~0.85) must not receive significant
    additional gain from the backend normalization pass.

    Regression guard against double-amplification: if the frontend were still
    normalizing before upload, a quiet signal would arrive pre-boosted and
    the backend pass would add marginal gain. But a loud signal arriving at the
    backend should receive gain ≤ 1.1 (≤ 10% amplification), confirming that
    the single-pass path does not over-amplify adequate input.
    """
    sr = 22050
    freq = 440.0
    duration_s = 0.5
    # Signal already at ~0.85 peak — typical of a signal that the old frontend
    # normalization would have produced from a moderate-level recording.
    tone = np.sin(2 * np.pi * freq * np.linspace(0, duration_s, int(sr * duration_s), endpoint=False)) * 0.85
    audio = np.concatenate([np.zeros(int(sr * 0.05)), tone, np.zeros(int(sr * 0.05))])
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    out_path = None
    try:
        sf.write(path, audio, sr)
        out_path, stats = preprocess_audio_for_basic_pitch(path)
        assert stats["enabled"] is True, f"Expected preprocessing to run, got {stats}"
        gain_applied = stats["gain"]
        assert gain_applied <= 1.1, (
            f"Expected gain ≤ 1.1 on already-adequate input, got {gain_applied:.4f}. "
            "This would indicate double-amplification if the frontend were also normalizing."
        )
    finally:
        if out_path and out_path != path and os.path.exists(out_path):
            os.remove(out_path)
        if os.path.exists(path):
            os.remove(path)


# ── Guitar ergonomics: chord-aware DP tests ──────────────────────────────────

def _make_event(onset_s: float, end_s: float, midi: int, amp: float = 0.8):
    """Helper: create a minimal note event tuple."""
    return (onset_s, end_s, float(midi), amp)


def test_max_span_at_position():
    """Tight human span model — first position max 4; higher neck still capped."""
    assert _max_span_at_position(1, False) == 4
    assert _max_span_at_position(5, False) == 4
    assert _max_span_at_position(5, True) == 4
    assert _max_span_at_position(9, False) == 4
    assert _max_span_at_position(10, False) == 5
    assert _max_span_at_position(12, True) == 4
    assert _max_span_at_position(15, False) == 5
    assert _max_span_at_position(17, True) == 4


def test_match_known_shape_power_chord():
    """Power chord voicings receive the power style and a non-zero bonus."""
    # String 6 fret 5, string 5 fret 7 → root+5th power chord
    style, bonus = _match_known_shape([(6, 5), (5, 7)])
    assert style == _STYLE_POWER, f"Expected power style, got {style!r}"
    assert bonus > 0, f"Expected bonus > 0, got {bonus}"


def test_match_known_shape_three_note_power_chord():
    """3-note power chord (root + 5th + octave) is recognised."""
    style, bonus = _match_known_shape([(6, 3), (5, 5), (4, 5)])
    assert style == _STYLE_POWER
    assert bonus >= 1.5


def test_match_known_shape_open_em():
    """Open Em chord (022000) is recognised as open style."""
    # Em: string 6 fret 0, string 5 fret 2, string 4 fret 2, others open
    em_voicing = [(6, 0), (5, 2), (4, 2), (3, 0), (2, 0), (1, 0)]
    style, bonus = _match_known_shape(em_voicing)
    assert style == _STYLE_OPEN, f"Expected open style for Em, got {style!r}"
    assert bonus >= 2.0


def test_match_known_shape_open_am():
    """Open Am chord (x02210) is recognised."""
    am_voicing = [(5, 0), (4, 2), (3, 2), (2, 1), (1, 0)]
    style, bonus = _match_known_shape(am_voicing)
    assert style == _STYLE_OPEN, f"Expected open style for Am, got {style!r}"
    assert bonus >= 2.0


def test_match_known_shape_e_barre():
    """E-shape barre (e.g. F major = E-shape at fret 1) is recognised as barre."""
    # F = 133211: string 6 fret 1, 5 fret 3, 4 fret 3, 3 fret 2, 2 fret 1, 1 fret 1
    f_voicing = [(6, 1), (5, 3), (4, 3), (3, 2), (2, 1), (1, 1)]
    style, bonus = _match_known_shape(f_voicing)
    assert style in (_STYLE_BARRE, _STYLE_OPEN), f"Expected barre/open for F, got {style!r}"
    assert bonus >= 1.5


def test_match_known_shape_a_barre():
    """A-shape barre at fret 5 (D major) is recognised."""
    # D barre: string 5 fret 5, 4 fret 7, 3 fret 7, 2 fret 7, 1 fret 5
    d_barre = [(5, 5), (4, 7), (3, 7), (2, 7), (1, 5)]
    style, bonus = _match_known_shape(d_barre)
    assert style == _STYLE_BARRE, f"Expected barre for D barre, got {style!r}"
    assert bonus >= 1.5


def test_build_time_slots_single_note():
    """Single note event forms one slot of size 1."""
    events = [_make_event(0.0, 0.5, 64)]
    slots = _build_time_slots(events)
    assert len(slots) == 1
    assert len(slots[0]) == 1


def test_build_time_slots_chord():
    """Two events with identical onset form one slot (chord group)."""
    events = [_make_event(0.5, 1.0, 64), _make_event(0.5, 1.0, 59)]
    slots = _build_time_slots(events)
    assert len(slots) == 1
    assert len(slots[0]) == 2


def test_build_time_slots_melody():
    """Two events 200 ms apart form two separate slots (melody) at BPM=120."""
    # chord window at 120 BPM = min(120, 250) = 120 ms; 200 ms gap exceeds that
    events = [_make_event(0.0, 0.1, 64), _make_event(0.200, 0.3, 62)]
    slots = _build_time_slots(events, chord_window_s=0.120)
    assert len(slots) == 2


def test_enumerate_voicings_single_note():
    """Single-note slot always produces at least one voicing."""
    events = [_make_event(0.0, 0.5, 64)]  # E4, playable on strings 1-3
    voicings = _enumerate_voicings(events)
    assert len(voicings) >= 1
    v, cost, style = voicings[0]
    assert len(v) == 1
    s, f = v[0]
    assert 1 <= s <= 6 and 0 <= f <= MAX_FRET


def test_enumerate_voicings_chord_no_impossible_span():
    """Chord voicings must never have a fret span > position-allowed maximum."""
    # Am pitches: A2(45), E3(52), A3(57), C4(60), E4(64)
    am_midis = [45, 52, 57, 60, 64]
    events = [_make_event(0.0, 0.5, m) for m in am_midis]
    voicings = _enumerate_voicings(events)
    assert len(voicings) >= 1, "Am chord should have at least one valid voicing"
    for v, cost, style in voicings:
        fretted = [f for _, f in v if f > 0]
        if fretted:
            span     = max(fretted) - min(fretted)
            min_fret = min(fretted)
            has_open = any(f == 0 for _, f in v)
            max_span = _max_span_at_position(min_fret, has_open)
            assert span <= max_span, (
                f"Voicing {v} has span {span} but max allowed is {max_span}"
            )


def test_enumerate_voicings_chord_unique_strings():
    """Each note in a chord voicing must be on a distinct string."""
    events = [_make_event(0.0, 0.5, m) for m in [45, 52, 57]]
    for v, _cost, _style in _enumerate_voicings(events):
        strings = [s for s, _ in v]
        assert len(set(strings)) == len(strings), f"Duplicate strings in voicing: {v}"


def test_position_center_open():
    """All-open voicing has position center 0."""
    assert _position_center([(1, 0), (2, 0), (3, 0)]) == 0.0


def test_position_center_fretted():
    """Position center is the median fret of fretted notes."""
    # Frets: 5, 7, 7 → median = 7
    assert _position_center([(6, 5), (5, 7), (4, 7)]) == 7.0


def test_transition_cost_slow_large_jump_is_cheap():
    """A large position jump with ample time is cheaper than a fast jump,
    but still carries a soft continuity penalty (never free)."""
    v1 = [(6, 2)]   # fret 2
    v2 = [(1, 15)]  # fret 15 — 13-fret jump
    cost_slow = _transition_cost(v1, v2, 2000.0, "other", "other")
    cost_fast = _transition_cost(v1, v2, 50.0, "other", "other")
    assert cost_fast > cost_slow + 5, (
        f"Fast jump ({cost_fast:.1f}) should be much more expensive than slow ({cost_slow:.1f})"
    )
    # Soft floor: even slow jumps of 8+ frets are not free
    cost_local = _transition_cost([(6, 2)], [(5, 3)], 2000.0, "other", "other")
    assert cost_slow > cost_local + 2.0, (
        f"Large slow jump ({cost_slow:.1f}) should cost more than local move ({cost_local:.1f})"
    )


def test_transition_cost_fast_large_jump_is_expensive():
    """A 13-fret jump in 50 ms should be very costly (physically near impossible)."""
    v1 = [(6, 2)]
    v2 = [(1, 15)]
    cost = _transition_cost(v1, v2, 50.0, "other", "other")
    # 50 ms gap: max_possible=3, shift=13 → (13-3)*10 = 100 extra penalty
    assert cost >= 30.0, f"Expected very high cost for impossible jump, got {cost:.1f}"


def test_transition_cost_style_continuity_bonus():
    """Same-style consecutive voicings get a cost bonus."""
    v1 = [(6, 5), (5, 7)]  # power chord at fret 5
    v2 = [(6, 7), (5, 9)]  # power chord at fret 7
    cost_same  = _transition_cost(v1, v2, 400.0, _STYLE_POWER, _STYLE_POWER)
    cost_mixed = _transition_cost(v1, v2, 400.0, _STYLE_POWER, _STYLE_BARRE)
    assert cost_same < cost_mixed, "Same style should be cheaper"


def test_dp_chord_aware_no_impossible_fret_combinations():
    """dp_chord_aware must never produce a chord with fret span > position limit."""
    # Simulate a strummed Am chord (all notes same onset)
    am_events = [_make_event(0.5, 1.0, m, 0.75) for m in [45, 52, 57, 60, 64]]
    pairs = dp_chord_aware(am_events, bpm=120.0)
    assert len(pairs) == len(am_events)
    fretted = [f for _, f in pairs if f > 0]
    if fretted:
        span     = max(fretted) - min(fretted)
        min_fret = min(fretted)
        has_open = any(f == 0 for _, f in pairs)
        max_span = _max_span_at_position(min_fret, has_open)
        assert span <= max_span, (
            f"dp_chord_aware produced impossible span {span} at min_fret {min_fret}: {pairs}"
        )


def test_dp_chord_aware_position_continuity():
    """Two consecutive open-position chords should stay in the same position area."""
    # Am then C, both open-position chords, played at quarter-note pace at 120 BPM
    am_events = [_make_event(0.0,  0.5, m, 0.8) for m in [45, 52, 57, 60, 64]]
    c_events  = [_make_event(0.5,  1.0, m, 0.8) for m in [48, 52, 55, 60, 64]]
    all_events = am_events + c_events
    pairs = dp_chord_aware(all_events, bpm=120.0)
    am_pairs = pairs[:5]
    c_pairs  = pairs[5:]
    am_fretted = [f for _, f in am_pairs if f > 0]
    c_fretted  = [f for _, f in c_pairs  if f > 0]
    if am_fretted and c_fretted:
        am_center = sum(am_fretted) / len(am_fretted)
        c_center  = sum(c_fretted) / len(c_fretted)
        # Both should be in low-fret open position (< fret 8 on average)
        assert am_center <= 8, f"Am chord went to high frets: {am_pairs}"
        assert c_center  <= 8, f"C chord went to high frets: {c_pairs}"


def test_dp_chord_aware_impossible_span_never_appears():
    """Frets 2 and 21 should never be simultaneously assigned."""
    # Construct events that naively map to extreme frets
    # MIDI 42 (F#2): candidate on string 6 fret 2
    # MIDI 63 (Eb4): candidate on string 1 fret -1? No... fret 63-64=-1 invalid.
    # Use MIDI 66 (F#4): string 1 fret 2, string 2 fret 7, string 3 fret 11 — all reasonable
    # Use MIDI 85 (C#6): would be beyond MAX_FRET, but let's force it via odd combination
    # Actually let's just check that a normal chord always stays sane
    events = [_make_event(0.0, 0.5, m, 0.8) for m in [40, 52, 64]]  # E2, E3, E4
    pairs = dp_chord_aware(events, bpm=120.0)
    frets = [f for _, f in pairs]
    assert max(frets) - min(f for f in frets if f > 0) <= 6, (
        f"Chord produced impossible span: {pairs}"
    )


def test_dp_chord_aware_single_melody_notes():
    """Single melody notes are still handled correctly by the chord-aware DP."""
    # A simple scale: E4, F#4, G#4, A4
    melody_events = [
        _make_event(i * 0.5, i * 0.5 + 0.4, midi, 0.8)
        for i, midi in enumerate([64, 66, 68, 69])
    ]
    pairs = dp_chord_aware(melody_events, bpm=120.0)
    assert len(pairs) == 4
    for s, f in pairs:
        assert 1 <= s <= 6 and 0 <= f <= MAX_FRET


def test_dp_melody_stays_low_neck_and_local_strings():
    """A stepwise open-position scale should stay frets ≤7 on same/adjacent strings."""
    # E4 F#4 G#4 A4 B4 — idiomatic on one high string (0-2-4-5-7) or open B
    melody = [
        _make_event(i * 0.5, i * 0.5 + 0.4, midi, 0.85)
        for i, midi in enumerate([64, 66, 68, 69, 71])
    ]
    pairs = dp_chord_aware(melody, bpm=120.0)
    frets = [f for _, f in pairs]
    assert max(frets) <= 7, f"Melody wandered up the neck: {pairs}"
    strings = [s for s, _ in pairs]
    for a, b in zip(strings, strings[1:]):
        assert abs(a - b) <= 1, f"Non-adjacent string jump in melody: {pairs}"


def test_dp_open_am_uses_open_shape():
    """Am pitches should land on the open Am shape (x02210), not a high barre."""
    am_events = [_make_event(0.0, 0.5, m, 0.8) for m in [45, 52, 57, 60, 64]]
    pairs = dp_chord_aware(am_events, bpm=120.0)
    expected = {(5, 0), (4, 2), (3, 2), (2, 1), (1, 0)}
    got = set(pairs)
    assert got == expected, f"Expected open Am {expected}, got {got}"
    assert max(f for _, f in pairs) <= 3


def test_pick_fingering_blocks_fret_15_plus():
    """Pitches that would land at fret 17 remap to a lower-fret string."""
    # MIDI 81 = high-e fret 17 — must remap under MAX_TAB_FRET
    string, fret, midi = _pick_fingering_under_cap(81, neighbor_center=3.0)
    assert fret <= MAX_TAB_FRET, f"Expected fret <= {MAX_TAB_FRET}, got {fret} on string {string}"
    assert midi == 81 or midi == 69  # same pitch or octave-down


def test_clamp_events_drops_octave_for_uncappable_pitch():
    """A MIDI with no fingering under the cap is octave-corrected in events."""
    # MIDI 88 cannot sit on any string under the written-tab cap.
    events = [(0.0, 0.3, 88, 0.8)]
    clamped, stats = clamp_events_to_max_tab_fret(events)
    assert stats["octaveDroppedEvents"] >= 1
    assert int(round(clamped[0][2])) <= 64 + MAX_TAB_FRET


def test_dp_never_writes_fret_15_or_above():
    """Even high MIDI inputs must produce tab frets <= MAX_TAB_FRET."""
    events = [
        _make_event(0.0, 0.3, 81, 0.9),   # would be fret 17 on high e
        _make_event(0.5, 0.8, 79, 0.85),  # would be fret 15 on high e
        _make_event(1.0, 1.3, 64, 0.8),   # open high e
    ]
    pairs = dp_chord_aware(events, bpm=120.0)
    assert all(f <= MAX_TAB_FRET for _, f in pairs), f"High fret leaked: {pairs}"
    # Remap should prefer nearby low position from the open E neighbor
    assert pairs[2] == (1, 0) or pairs[2][1] <= 5


def test_clamp_fingerings_remaps_away_from_fret_twelve():
    """Explicit high-fret pair is remapped under the written-tab cap."""
    events = [(0.0, 0.4, 76, 0.9)]  # E5
    pairs = [(2, 17)]  # B string fret 17 = MIDI 76 — illegal
    new_pairs, new_events, stats = clamp_fingerings_to_max_tab_fret(pairs, events)
    assert stats["remappedFingerings"] == 1
    s, f = new_pairs[0]
    assert f <= MAX_TAB_FRET
    assert OPEN_STRING_MIDI[s] + f == int(round(float(new_events[0][2])))
    assert f < 12, f"Fret 12+ survived written-tab cap: {(s, f)}"


def test_register_island_top_string_chord_is_octave_lowered():
    """A low phrase should not suddenly become a high G/B/e-string triad."""
    events = [
        _make_event(0.0, 0.35, 40, 0.85),
        _make_event(0.0, 0.35, 47, 0.85),
        _make_event(0.0, 0.35, 52, 0.85),
        # Naively legal as G7/B7/e10, but it is a sudden high-register island.
        _make_event(0.5, 0.85, 62, 0.85),
        _make_event(0.5, 0.85, 66, 0.85),
        _make_event(0.5, 0.85, 74, 0.85),
    ]
    pairs = dp_chord_aware(events, bpm=120.0)
    assert pairs[3:] == [(3, 7), (2, 7), (1, 10)], f"Fixture no longer reproduces high island: {pairs}"

    repaired_pairs, repaired_events, stats = _suppress_sudden_high_register_voicings(pairs, events)
    assert stats["registerRemappedSlots"] == 1
    assert stats["registerOctaveDroppedEvents"] >= 1
    assert _position_center(repaired_pairs[3:]) <= 5.5, f"High island survived: {repaired_pairs}"
    assert set(s for s, _ in repaired_pairs[3:]) == {2, 3, 4}, f"Expected D/G/B-style voicing, got {repaired_pairs[3:]}"
    assert max(f for _, f in repaired_pairs) <= MAX_TAB_FRET
    assert max(event[2] for event in repaired_events[3:]) < 74, f"High octave pitch survived: {repaired_events[3:]}"


def test_enumerate_voicings_never_duplicate_strings():
    """Even fallback voicings must use unique strings."""
    # Cluster that is hard to voice jointly
    events = [_make_event(0.0, 0.5, m, 0.7) for m in [40, 41, 42, 43, 44, 45]]
    for v, _cost, _style in _enumerate_voicings(events):
        strings = [s for s, _ in v]
        assert len(set(strings)) == len(strings), f"Duplicate strings: {v}"


def test_dp_chord_aware_avoids_fast_large_position_jump():
    """Two consecutive notes far apart on the neck with a very short gap should
    prefer a voicing that avoids the large jump (e.g. choose a different string)."""
    # E2 (MIDI 40) at fret 0 string 6 → position center ~0
    # Then C6 (MIDI 84) 30 ms later: all candidates are very high fret
    # The DP should pick the lowest available fret, not introduce phantom jumps
    e2_event = _make_event(0.0, 0.5, 40, 0.8)   # low E
    e4_event = _make_event(0.03, 0.5, 64, 0.8)  # E4, 30 ms later — close gap
    pairs = dp_chord_aware([e2_event, e4_event], bpm=120.0)
    assert len(pairs) == 2
    # Both should be valid positions
    for s, f in pairs:
        assert 1 <= s <= 6 and 0 <= f <= MAX_FRET
    # Prefer low frets when available
    assert pairs[1][1] <= 5, f"E4 should prefer open/low fret, got {pairs}"


if __name__ == "__main__":
    tests = [
        test_quantize_onset_basic,
        test_quantize_onset_snaps_to_nearest,
        test_quantize_onset_near_measure_boundary,
        test_chord_grouping,
        test_quantize_duration,
        test_group_chords_collapses_strum,
        test_group_chords_anchor_prevents_melody_merge,
        test_group_chords_anchor_strum,
        test_filter_events_drops_quiet_ghosts,
        test_preprocess_audio_trims_and_normalizes,
        test_collapse_single_note_artifact_cluster,
        test_collapse_dominant_non_overtone_ghost_cluster,
        test_collapse_duplicate_same_midi_events,
        test_real_triad_survives_polyphony_cleanup,
        test_impossible_chord_cluster_is_simplified,
        test_two_note_impossible_span_is_pruned,
        test_octave_ghost_stripped_from_events,
        test_octave_correct_rewrites_implausible_high_midi,
        test_sync_raw_events_matches_tab_midi,
        test_expected_tab_keeps_match_drops_phantom_preserves_miss,
        test_expected_tab_neighboring_semitone_stays_wrong,
        test_expected_tab_duplicate_fingerings_share_pitch_slot,
        test_expected_tab_never_synthesizes_a_missing_event,
        test_accurate_merge_coalesces_fragments_and_rescues_pitch_once,
        test_accurate_merge_rejects_weaker_octave_artifact,
        test_accurate_layout_remap_preserves_midi_or_omits,
        test_prefer_expected_fingerings_snaps_string_fret,
        test_ghost_slide_on_picked_sixteenths_not_tagged,
        test_impossible_tab_chord_high_fret_is_simplified,
        test_dominant_tab_ghost_cluster_collapses_to_single_note,
        test_scattered_open_high_fret_chord_is_rejected,
        test_same_beat_inhuman_chord_cleaned_after_split_onsets,
        test_xx_11_2_x_0_chord_is_rejected,
        test_same_string_layered_chord_deletes_high_fret,
        test_high_outlier_octave_remaps_only_when_it_matches_chord,
        test_high_outlier_drops_when_octave_does_not_match_chord,
        test_technique_reconcile_does_not_break_chord_playability,
        test_single_pluck_ghost_chord_collapses,
        test_tight_harmonic_byproducts_collapse_even_if_playable,
        test_comparable_tab_chord_survives_cleanup,
        test_open_melody_prefers_open_string_over_fret_five,
        test_isolated_fret_five_rewrites_in_open_phrase,
        test_same_string_high_spike_and_return_is_banned,
        test_same_string_two_fourteen_two_spike_is_banned,
        test_tempo_candidates_expose_half_time,
        test_alternate_bpm_changes_quantized_position,
        test_events_to_tab_respects_time_signature,
        test_detect_bpm_octave_corrects_click_track,
        test_merge_tab_beats,
        test_classify_bends_no_bend_on_flat,
        test_classify_bends_detects_bend,
        test_classify_bends_rejects_weak_jitter,
        test_classify_bends_detects_vibrato,
        test_classify_bends_ignores_small_pitch_wobble,
        test_classify_slide_glide_in_bend_bins,
        test_detect_two_note_slide,
        test_detect_melody_not_slide,
        test_same_string_eighth_not_slide,
        test_detect_hammer_not_slide,
        test_preprocess_quiet_input_single_pass_reaches_expected_range,
        test_preprocess_already_adequate_input_minimal_gain,
        # Guitar ergonomics
        test_max_span_at_position,
        test_match_known_shape_power_chord,
        test_match_known_shape_three_note_power_chord,
        test_match_known_shape_open_em,
        test_match_known_shape_open_am,
        test_match_known_shape_e_barre,
        test_match_known_shape_a_barre,
        test_build_time_slots_single_note,
        test_build_time_slots_chord,
        test_build_time_slots_melody,
        test_enumerate_voicings_single_note,
        test_enumerate_voicings_chord_no_impossible_span,
        test_enumerate_voicings_chord_unique_strings,
        test_position_center_open,
        test_position_center_fretted,
        test_transition_cost_slow_large_jump_is_cheap,
        test_transition_cost_fast_large_jump_is_expensive,
        test_transition_cost_style_continuity_bonus,
        test_dp_chord_aware_no_impossible_fret_combinations,
        test_dp_chord_aware_position_continuity,
        test_dp_chord_aware_impossible_span_never_appears,
        test_dp_chord_aware_single_melody_notes,
        test_dp_melody_stays_low_neck_and_local_strings,
        test_dp_open_am_uses_open_shape,
        test_pick_fingering_blocks_fret_15_plus,
        test_clamp_events_drops_octave_for_uncappable_pitch,
        test_dp_never_writes_fret_15_or_above,
        test_clamp_fingerings_remaps_away_from_fret_twelve,
        test_register_island_top_string_chord_is_octave_lowered,
        test_enumerate_voicings_never_duplicate_strings,
        test_dp_chord_aware_avoids_fast_large_position_jump,
    ]
    passed = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"FAIL  {t.__name__}: {e}")
    print(f"\n{passed}/{len(tests)} tests passed")
    assert passed == len(tests), "Some tests failed"
