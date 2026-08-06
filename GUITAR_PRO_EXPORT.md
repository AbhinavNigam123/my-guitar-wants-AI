# Guitar Pro Export — Research Context

> **Status:** Research only. No implementation yet.  
> **Purpose:** Background reference for implementing `.gp` export from the AI Practice Coach app.

---

## 1. The Guitar Pro File Format

Guitar Pro files (`.gp`, `.gp3`–`.gp7`, `.gp8`, `.gpx`) are binary formats developed by Arobas Music.

### Format generations

| Extension | Version | Notes |
|-----------|---------|-------|
| `.gp3` / `.gp4` / `.gp5` | GP 3–5 | Classic binary, well-documented by community reverse-engineering (Chevalier / MuseScore specs) |
| `.gpx` | GP 6 | XML-based container (ZIP archive with `Content/score.gpif` inside), human-readable |
| `.gp` | GP 7 / GP 8 | Binary container, similar to `.gpx` but uses a different compression and structure |

The most widely referenced spec for `.gp5` and earlier is the **Adrean Chevalier / MuseScore community documentation** available on GitHub.

### Key data structures (GP 5 and 7)

```
GpFile
 ├── GpTrack[]          – one per instrument
 │    ├── name: string
 │    ├── strings: GpString[]  – tuning (MIDI pitch per string)
 │    └── measures: GpMeasure[]
 │
 └── GpMeasure
      └── beats: GpBeat[]
           ├── duration: GpDuration  – quarter, eighth, etc.
           ├── notes: GpNote[]
           │    ├── string: number   – 1-indexed
           │    ├── fret: number
           │    ├── velocity: number
           │    └── effects: GpNoteEffect  – bend, vibrato, slide, etc.
           └── chord?: GpChord
```

Minimum viable export requires: `Track → Measure → Beat → Note → (fret, string, duration)`.

---

## 2. Library Options Evaluated

### A. `@coderline/alphaTab` (npm)

| Property | Detail |
|----------|--------|
| Language | TypeScript/JavaScript (browser + Node) |
| Can **read** GP | Yes — supports GP3–GP8, GPX, and MusicXML |
| Can **write** GP | Partial — write/export is in the enterprise/commercial tier; free tier is read + render only |
| Render | Full SVG/Canvas tab/notation renderer built-in |
| Bundle size | ~1–2 MB (full), tree-shakeable |
| License | LGPL-3 (free) + commercial add-ons |
| npm | `@coderline/alphatab` |

**Best path for import:** alphaTab is the top choice for reading `.gp` files and rendering them in-browser, replacing the manual SVG tab renderer in `TabViewer.tsx`.

**Export blocker:** The `alphaTab.exporter.Gp7Exporter` class exists but requires a commercial license for write operations. An alternative is `.gpx` (GP6 XML), which is writable and open.

---

### B. `guitarpro` (Python library)

| Property | Detail |
|----------|--------|
| Language | Python |
| Can read | Yes — GP3–GP5 |
| Can write | Yes |
| Suitable for | Server-side export (Next.js API route with Python subprocess, or separate microservice) |
| Limitation | No browser support; adds Python runtime dependency |

Use case: If the app grows a server component (e.g., Next.js API route), `guitarpro` can generate `.gp5` files server-side and serve them as downloads.

---

### C. Manual binary serialization (TypeScript)

Writing raw GP5 binary from TypeScript is feasible but expensive:
- The community spec covers header fields, track metadata, and note encoding.
- All numbers are little-endian; strings are Pascal-style (length-prefixed).
- Only practical if alphaTab commercial license is not an option and the Python route is too heavy.

**Recommendation:** Do not pursue unless both A and B are ruled out.

---

## 3. Blockers

| Blocker | Severity | Resolution path |
|---------|----------|----------------|
| alphaTab GP write = commercial | High | Use `.gpx` (GP6 XML) export instead — it is writable without a commercial license |
| alphaTab bundle size (1-2 MB) | Medium | Lazy-load alphaTab only on the `/practice` route via `next/dynamic` |
| Our `TabNote` model is minimal (fret + string + beat) | Medium | Extend `TabNote` with `durationBeats`, `effects?`, `velocity?` before attempting any export |
| Beat duration mapping (our beats → GP duration enum) | Low | Map `durationBeats` (1, 0.5, 0.25…) → GP `GpDuration` (QUARTER, EIGHTH, SIXTEENTH…) |

---

## 4. `.gpx` (GP6 XML) as Near-Term Target

`.gpx` is the easiest writable format:

```xml
<?xml version="1.0"?>
<GPIF>
  <Score>
    <Title>Smoke on the Water</Title>
    <Artist>Deep Purple</Artist>
  </Score>
  <MasterTrack>
    <Bars><!-- bar indices --></Bars>
    <Tempo><Value>110</Value></Tempo>
  </MasterTrack>
  <Tracks>
    <Track id="0" name="Guitar">
      <Properties>
        <Property name="Tuning">
          <Pitches>64 59 55 50 45 40</Pitches><!-- standard e B G D A E -->
        </Property>
      </Properties>
    </Track>
  </Tracks>
  <Bars><!-- GpBar elements --></Bars>
  <Beats><!-- GpBeat elements --></Beats>
  <Notes>
    <Note id="0"><Properties>
      <Property name="String"><Number>0</Number></Property>
      <Property name="Fret"><Number>5</Number></Property>
    </Properties></Note>
  </Notes>
</GPIF>
```

This can be generated in pure TypeScript and zipped into a `.gpx` file using the browser's `CompressionStream` API (available in all modern browsers and Node 18+).

---

## 5. Recommended Milestones

### Milestone 1 — alphaTab import (no commercial license needed)
1. `npm install @coderline/alphatab`
2. Lazy-load alphaTab in `TabViewer.tsx` via `next/dynamic`
3. Replace manual SVG tab renderer with alphaTab's canvas renderer
4. Allow users to drag & drop `.gp` files to populate the tab

### Milestone 2 — `.gpx` export (free, writable)
1. Extend `TabNote` with `durationBeats` and optional `effects`
2. Implement `src/lib/gpx-export.ts` — converts `PracticeSession` → GPX XML string
3. Zip with `CompressionStream` into a `.gpx` Blob
4. Add "Download .gpx" button in the song info header

### Milestone 3 — GP7 export (commercial or Python)
- Evaluate alphaTab commercial license cost
- Or: implement a Next.js API route (`/api/export/gp7`) that shells out to `guitarpro` (Python) and returns the binary file

---

## 6. References

- [alphaTab documentation](https://www.alphatab.net/docs/)
- [Guitar Pro format spec (community, GP3–GP5)](https://github.com/GuitarML/GuitarLSTM) *(links to Chevalier's spec)*
- [MuseScore source — Guitar Pro import](https://github.com/musescore/MuseScore/tree/master/importexport/guitarpro)
- [guitarpro Python library](https://github.com/slacker/guitarpro)
- [GPX (GP6) XML schema reference](https://alphatab.net/docs/reference/score/)
