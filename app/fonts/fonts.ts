import localFont from 'next/font/local';

// Sora (display) and Nunito (body), committed here so the build needs no
// network (#560). The files are the variable woff2 subsets Google Fonts
// serves, split by script with the same unicode ranges, so a browser only
// downloads the subsets a page's text uses and preloads just the Latin ones.
// Licences: Sora-OFL.txt and Nunito-OFL.txt (SIL Open Font License 1.1).
//
// next/font/local takes one unicode range per call, so each subset is its
// own call, all naming the same family. The Latin call carries the CSS
// variable and the metric-matched fallback; tokens.css reads the variables
// into --pc-font-display / --pc-font-body.
//
// The options must be written out as literals (next/font reads them at
// compile time), hence the repeated unicode ranges: the Latin, Latin
// Extended, Cyrillic Extended, Cyrillic and Vietnamese ranges of Google's
// CSS for these families. The calls keep Google's rule order, Latin last:
// where ranges overlap (a few combining marks), the browser tries the last
// rule first.

const soraLatinExt = localFont({
  src: './sora-latin-ext.woff2',
  weight: '100 800',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: 'Sora' },
    { prop: 'unicode-range', value: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF' },
  ],
});
const sora = localFont({
  src: './sora-latin.woff2',
  weight: '100 800',
  style: 'normal',
  display: 'swap',
  variable: '--pc-font-sora',
  declarations: [
    { prop: 'font-family', value: 'Sora' },
    { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  ],
});

const nunitoCyrillicExt = localFont({
  src: './nunito-cyrillic-ext.woff2',
  weight: '200 1000',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: 'Nunito' },
    { prop: 'unicode-range', value: 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F' },
  ],
});
const nunitoCyrillic = localFont({
  src: './nunito-cyrillic.woff2',
  weight: '200 1000',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: 'Nunito' },
    { prop: 'unicode-range', value: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' },
  ],
});
const nunitoVietnamese = localFont({
  src: './nunito-vietnamese.woff2',
  weight: '200 1000',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: 'Nunito' },
    { prop: 'unicode-range', value: 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB' },
  ],
});
const nunitoLatinExt = localFont({
  src: './nunito-latin-ext.woff2',
  weight: '200 1000',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: 'Nunito' },
    { prop: 'unicode-range', value: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF' },
  ],
});
const nunito = localFont({
  src: './nunito-latin.woff2',
  weight: '200 1000',
  style: 'normal',
  display: 'swap',
  variable: '--pc-font-nunito',
  declarations: [
    { prop: 'font-family', value: 'Nunito' },
    { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  ],
});

/**
 * The class names that define --pc-font-sora and --pc-font-nunito, for the
 * root element. The other subsets only contribute @font-face rules; naming
 * them here keeps their CSS in the build.
 */
export const fontVariables = [sora.variable, nunito.variable].join(' ');

/** Every subset, so none is dropped as unused. */
export const fontSubsets = [sora, soraLatinExt, nunito, nunitoLatinExt, nunitoCyrillicExt, nunitoCyrillic, nunitoVietnamese];
