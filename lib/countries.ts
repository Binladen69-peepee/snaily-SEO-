/**
 * ISO-3166-1 alpha-3 → alpha-2, so country codes can be turned into names.
 *
 * Search Console reports countries as lowercase alpha-3 ("usa", "gbr"), but
 * `Intl.DisplayNames` only accepts alpha-2 or a UN M49 number and throws on
 * anything else. This bridges the two so the UI can print "United States"
 * rather than "USA".
 *
 * Only the alpha-3 → alpha-2 hop is hardcoded; the name itself comes from the
 * runtime's own locale data, so this never has to carry 250 country names or
 * keep them up to date. `npm run test:countries` checks every pair.
 */
const ALPHA3_TO_ALPHA2_TABLE = `
abw AW  afg AF  ago AO  aia AI  ala AX  alb AL  and AD  are AE  arg AR  arm AM
asm AS  ata AQ  atf TF  atg AG  aus AU  aut AT  aze AZ  bdi BI  bel BE  ben BJ
bes BQ  bfa BF  bgd BD  bgr BG  bhr BH  bhs BS  bih BA  blm BL  blr BY  blz BZ
bmu BM  bol BO  bra BR  brb BB  brn BN  btn BT  bvt BV  bwa BW  caf CF  can CA
cck CC  che CH  chl CL  chn CN  civ CI  cmr CM  cod CD  cog CG  cok CK  col CO
com KM  cpv CV  cri CR  cub CU  cuw CW  cxr CX  cym KY  cyp CY  cze CZ  deu DE
dji DJ  dma DM  dnk DK  dom DO  dza DZ  ecu EC  egy EG  eri ER  esh EH  esp ES
est EE  eth ET  fin FI  fji FJ  flk FK  fra FR  fro FO  fsm FM  gab GA  gbr GB
geo GE  ggy GG  gha GH  gib GI  gin GN  glp GP  gmb GM  gnb GW  gnq GQ  grc GR
grd GD  grl GL  gtm GT  guf GF  gum GU  guy GY  hkg HK  hmd HM  hnd HN  hrv HR
hti HT  hun HU  idn ID  imn IM  ind IN  iot IO  irl IE  irn IR  irq IQ  isl IS
isr IL  ita IT  jam JM  jey JE  jor JO  jpn JP  kaz KZ  ken KE  kgz KG  khm KH
kir KI  kna KN  kor KR  kwt KW  lao LA  lbn LB  lbr LR  lby LY  lca LC  lie LI
lka LK  lso LS  ltu LT  lux LU  lva LV  mac MO  maf MF  mar MA  mco MC  mda MD
mdg MG  mdv MV  mex MX  mhl MH  mkd MK  mli ML  mlt MT  mmr MM  mne ME  mng MN
mnp MP  moz MZ  mrt MR  msr MS  mtq MQ  mus MU  mwi MW  mys MY  myt YT  nam NA
ncl NC  ner NE  nfk NF  nga NG  nic NI  niu NU  nld NL  nor NO  npl NP  nru NR
nzl NZ  omn OM  pak PK  pan PA  pcn PN  per PE  phl PH  plw PW  png PG  pol PL
pri PR  prk KP  prt PT  pry PY  pse PS  pyf PF  qat QA  reu RE  rou RO  rus RU
rwa RW  sau SA  sdn SD  sen SN  sgp SG  sgs GS  shn SH  sjm SJ  slb SB  sle SL
slv SV  smr SM  som SO  spm PM  srb RS  ssd SS  stp ST  sur SR  svk SK  svn SI
swe SE  swz SZ  sxm SX  syc SC  syr SY  tca TC  tcd TD  tgo TG  tha TH  tjk TJ
tkl TK  tkm TM  tls TL  ton TO  tto TT  tun TN  tur TR  tuv TV  twn TW  tza TZ
uga UG  ukr UA  umi UM  ury UY  usa US  uzb UZ  vat VA  vct VC  ven VE  vgb VG
vir VI  vnm VN  vut VU  wlf WF  wsm WS  yem YE  zaf ZA  zmb ZM  zwe ZW
`;

/**
 * Parsed strictly: anything that is not exactly three lowercase letters
 * followed by two uppercase ones is dropped rather than guessed at, so a typo
 * in the table above costs one country its name instead of mislabelling it.
 */
export const ALPHA3_TO_ALPHA2: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  const tokens = ALPHA3_TO_ALPHA2_TABLE.trim().split(/\s+/);
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const alpha3 = tokens[i]!;
    const alpha2 = tokens[i + 1]!;
    if (!/^[a-z]{3}$/.test(alpha3) || !/^[A-Z]{2}$/.test(alpha2)) continue;
    map.set(alpha3, alpha2);
  }
  return map;
})();

let display: Intl.DisplayNames | null | undefined;

function regionNames(): Intl.DisplayNames | null {
  if (display === undefined) {
    try {
      display = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      display = null;
    }
  }
  return display;
}

/**
 * "usa" → "United States".
 *
 * Falls back to the code in capitals when the country is unknown, so an
 * unmapped code shows as "XKX" rather than vanishing from a traffic table and
 * silently taking its clicks with it.
 */
export function countryName(alpha3: string): string {
  const code = alpha3.trim().toLowerCase();
  if (code === "") return "Unknown";

  const alpha2 = ALPHA3_TO_ALPHA2.get(code);
  if (alpha2 === undefined) return code.toUpperCase();

  try {
    return regionNames()?.of(alpha2) ?? alpha2;
  } catch {
    return alpha2;
  }
}
