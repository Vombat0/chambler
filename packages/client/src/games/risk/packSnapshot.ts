/**
 * R2 — Aetheris paket anlık görüntüsü.
 *
 * Kanonik kaynak: `packs/territory-wars/**`. Vite `fs.allow` paket kökü dışındaki
 * dosyaları vitest'te engellediği için içerik derleme zamanında gömülür;
 * `packSnapshot.test.ts` bu kopyanın paketle BİREBİR aynı olduğunu her test
 * çalıştırmasında diskten doğrular (drift olursa test kırmızıya döner).
 */

export const BOARD_JSON = `{
  "formatVersion": 1,
  "boardId": "territory-wars-aetheris",
  "world": "aetheris",
  "canvas": { "width": 1600, "height": 900 },
  "note": "Original world map of Aetheris. Anchors are label/seed points used to generate the procedural region polygons; neighbors is the canonical adjacency graph and must stay symmetric and connected (enforced by tests).",
  "regions": [
    { "id": "fangreach", "continent": "drakemoor", "nameKey": "region.fangreach.name", "anchor": [150, 140], "neighbors": ["stormfell", "aldermoor"] },
    { "id": "stormfell", "continent": "drakemoor", "nameKey": "region.stormfell.name", "anchor": [470, 110], "neighbors": ["fangreach", "ironfrost", "hollowbridge"] },
    { "id": "ironfrost", "continent": "drakemoor", "nameKey": "region.ironfrost.name", "anchor": [790, 130], "neighbors": ["stormfell", "whitmane", "mistral-basin"] },
    { "id": "whitmane", "continent": "drakemoor", "nameKey": "region.whitmane.name", "anchor": [1110, 120], "neighbors": ["ironfrost", "grimhold", "kestrel-down"] },
    { "id": "grimhold", "continent": "drakemoor", "nameKey": "region.grimhold.name", "anchor": [1380, 140], "neighbors": ["whitmane", "sundergate", "ashen-quay"] },

    { "id": "aldermoor", "continent": "koros", "nameKey": "region.aldermoor.name", "anchor": [120, 380], "neighbors": ["hollowbridge", "larkspur", "fangreach"] },
    { "id": "hollowbridge", "continent": "koros", "nameKey": "region.hollowbridge.name", "anchor": [420, 360], "neighbors": ["aldermoor", "mistral-basin", "loamfield", "stormfell"] },
    { "id": "mistral-basin", "continent": "koros", "nameKey": "region.mistral-basin.name", "anchor": [730, 400], "fortress": true, "neighbors": ["hollowbridge", "kestrel-down", "reedmarsh", "ironfrost"] },
    { "id": "kestrel-down", "continent": "koros", "nameKey": "region.kestrel-down.name", "anchor": [1030, 340], "neighbors": ["mistral-basin", "sundergate", "whitmane", "amber-steppe"] },
    { "id": "sundergate", "continent": "koros", "nameKey": "region.sundergate.name", "anchor": [1300, 300], "fortress": true, "neighbors": ["kestrel-down", "emberwatch", "grimhold"] },
    { "id": "emberwatch", "continent": "koros", "nameKey": "region.emberwatch.name", "anchor": [1420, 430], "neighbors": ["sundergate", "pyre-key", "cinderfall"] },
    { "id": "loamfield", "continent": "koros", "nameKey": "region.loamfield.name", "anchor": [300, 590], "neighbors": ["hollowbridge", "reedmarsh", "glassholt"] },
    { "id": "reedmarsh", "continent": "koros", "nameKey": "region.reedmarsh.name", "anchor": [570, 610], "neighbors": ["loamfield", "mistral-basin", "sunspire"] },

    { "id": "larkspur", "continent": "virelai", "nameKey": "region.larkspur.name", "anchor": [150, 620], "neighbors": ["aldermoor", "glassholt"] },
    { "id": "glassholt", "continent": "virelai", "nameKey": "region.glassholt.name", "anchor": [330, 780], "fortress": true, "neighbors": ["larkspur", "tidewick", "fernmarsh", "loamfield"] },
    { "id": "tidewick", "continent": "virelai", "nameKey": "region.tidewick.name", "anchor": [130, 830], "neighbors": ["glassholt", "fernmarsh"] },
    { "id": "fernmarsh", "continent": "virelai", "nameKey": "region.fernmarsh.name", "anchor": [500, 860], "neighbors": ["glassholt", "tidewick", "sunspire"] },

    { "id": "sunspire", "continent": "sundar", "nameKey": "region.sunspire.name", "anchor": [760, 700], "neighbors": ["reedmarsh", "fernmarsh", "amber-steppe", "myrravale"] },
    { "id": "amber-steppe", "continent": "sundar", "nameKey": "region.amber-steppe.name", "anchor": [1020, 640], "neighbors": ["sunspire", "dunehollow", "myrravale", "kestrel-down"] },
    { "id": "dunehollow", "continent": "sundar", "nameKey": "region.dunehollow.name", "anchor": [1240, 640], "neighbors": ["amber-steppe", "cinderfall", "olivane", "saltmerrow"] },
    { "id": "cinderfall", "continent": "sundar", "nameKey": "region.cinderfall.name", "anchor": [1440, 650], "neighbors": ["dunehollow", "emberwatch", "saltmerrow", "coral-reach"] },
    { "id": "myrravale", "continent": "sundar", "nameKey": "region.myrravale.name", "anchor": [860, 870], "neighbors": ["sunspire", "amber-steppe", "olivane"] },
    { "id": "olivane", "continent": "sundar", "nameKey": "region.olivane.name", "anchor": [1120, 840], "neighbors": ["dunehollow", "myrravale", "stormcay"] },

    { "id": "ashen-quay", "continent": "emberisle", "nameKey": "region.ashen-quay.name", "anchor": [1540, 210], "neighbors": ["grimhold", "pyre-key"] },
    { "id": "pyre-key", "continent": "emberisle", "nameKey": "region.pyre-key.name", "anchor": [1550, 470], "neighbors": ["ashen-quay", "emberwatch", "coral-reach"] },
    { "id": "coral-reach", "continent": "emberisle", "nameKey": "region.coral-reach.name", "anchor": [1540, 780], "neighbors": ["pyre-key", "saltmerrow", "cinderfall"] },
    { "id": "saltmerrow", "continent": "emberisle", "nameKey": "region.saltmerrow.name", "anchor": [1360, 790], "neighbors": ["coral-reach", "cinderfall", "stormcay", "dunehollow"] },
    { "id": "stormcay", "continent": "emberisle", "nameKey": "region.stormcay.name", "anchor": [1250, 870], "neighbors": ["saltmerrow", "olivane"] }
  ]
}
`;

export const CONTINENTS_JSON = `{
  "formatVersion": 1,
  "note": "Continents of Aetheris. Bonus armies are granted when a player holds every member region at the start of their reinforcement step. Members must match region.continent in board.json (tests enforce both directions and per-continent connectivity).",
  "continents": [
    {
      "id": "drakemoor",
      "nameKey": "continent.drakemoor.name",
      "color": "#3D6E8F",
      "bonus": 5,
      "members": ["fangreach", "stormfell", "ironfrost", "whitmane", "grimhold"]
    },
    {
      "id": "koros",
      "nameKey": "continent.koros.name",
      "color": "#B98A3C",
      "bonus": 7,
      "members": ["aldermoor", "hollowbridge", "mistral-basin", "kestrel-down", "sundergate", "emberwatch", "loamfield", "reedmarsh"]
    },
    {
      "id": "virelai",
      "nameKey": "continent.virelai.name",
      "color": "#6B4A8C",
      "bonus": 3,
      "members": ["larkspur", "glassholt", "tidewick", "fernmarsh"]
    },
    {
      "id": "sundar",
      "nameKey": "continent.sundar.name",
      "color": "#B4552D",
      "bonus": 4,
      "members": ["sunspire", "amber-steppe", "dunehollow", "cinderfall", "myrravale", "olivane"]
    },
    {
      "id": "emberisle",
      "nameKey": "continent.emberisle.name",
      "color": "#2E7D4F",
      "bonus": 3,
      "members": ["ashen-quay", "pyre-key", "coral-reach", "saltmerrow", "stormcay"]
    }
  ]
}
`;

export const TERRITORY_JSON = `{
  "formatVersion": 1,
  "deckId": "territory",
  "nameKey": "deck.territory.name",
  "shuffle": "auto",
  "cardCount": 30,
  "cards": [
    {
      "id": "territory-fangreach",
      "titleKey": "region.fangreach.name",
      "textKey": "card.territory.fangreach.text",
      "regionId": "fangreach",
      "continentId": "drakemoor",
      "value": 1
    },
    {
      "id": "territory-stormfell",
      "titleKey": "region.stormfell.name",
      "textKey": "card.territory.stormfell.text",
      "regionId": "stormfell",
      "continentId": "drakemoor",
      "value": 1
    },
    {
      "id": "territory-ironfrost",
      "titleKey": "region.ironfrost.name",
      "textKey": "card.territory.ironfrost.text",
      "regionId": "ironfrost",
      "continentId": "drakemoor",
      "value": 1
    },
    {
      "id": "territory-whitmane",
      "titleKey": "region.whitmane.name",
      "textKey": "card.territory.whitmane.text",
      "regionId": "whitmane",
      "continentId": "drakemoor",
      "value": 1
    },
    {
      "id": "territory-grimhold",
      "titleKey": "region.grimhold.name",
      "textKey": "card.territory.grimhold.text",
      "regionId": "grimhold",
      "continentId": "drakemoor",
      "value": 1
    },
    {
      "id": "territory-aldermoor",
      "titleKey": "region.aldermoor.name",
      "textKey": "card.territory.aldermoor.text",
      "regionId": "aldermoor",
      "continentId": "koros",
      "value": 1
    },
    {
      "id": "territory-hollowbridge",
      "titleKey": "region.hollowbridge.name",
      "textKey": "card.territory.hollowbridge.text",
      "regionId": "hollowbridge",
      "continentId": "koros",
      "value": 1
    },
    {
      "id": "territory-mistral-basin",
      "titleKey": "region.mistral-basin.name",
      "textKey": "card.territory.mistral-basin.text",
      "regionId": "mistral-basin",
      "continentId": "koros",
      "value": 1
    },
    {
      "id": "territory-kestrel-down",
      "titleKey": "region.kestrel-down.name",
      "textKey": "card.territory.kestrel-down.text",
      "regionId": "kestrel-down",
      "continentId": "koros",
      "value": 1
    },
    {
      "id": "territory-sundergate",
      "titleKey": "region.sundergate.name",
      "textKey": "card.territory.sundergate.text",
      "regionId": "sundergate",
      "continentId": "koros",
      "value": 1
    },
    {
      "id": "territory-emberwatch",
      "titleKey": "region.emberwatch.name",
      "textKey": "card.territory.emberwatch.text",
      "regionId": "emberwatch",
      "continentId": "koros",
      "value": 1
    },
    {
      "id": "territory-loamfield",
      "titleKey": "region.loamfield.name",
      "textKey": "card.territory.loamfield.text",
      "regionId": "loamfield",
      "continentId": "koros",
      "value": 1
    },
    {
      "id": "territory-reedmarsh",
      "titleKey": "region.reedmarsh.name",
      "textKey": "card.territory.reedmarsh.text",
      "regionId": "reedmarsh",
      "continentId": "koros",
      "value": 1
    },
    {
      "id": "territory-larkspur",
      "titleKey": "region.larkspur.name",
      "textKey": "card.territory.larkspur.text",
      "regionId": "larkspur",
      "continentId": "virelai",
      "value": 1
    },
    {
      "id": "territory-glassholt",
      "titleKey": "region.glassholt.name",
      "textKey": "card.territory.glassholt.text",
      "regionId": "glassholt",
      "continentId": "virelai",
      "value": 1
    },
    {
      "id": "territory-tidewick",
      "titleKey": "region.tidewick.name",
      "textKey": "card.territory.tidewick.text",
      "regionId": "tidewick",
      "continentId": "virelai",
      "value": 1
    },
    {
      "id": "territory-fernmarsh",
      "titleKey": "region.fernmarsh.name",
      "textKey": "card.territory.fernmarsh.text",
      "regionId": "fernmarsh",
      "continentId": "virelai",
      "value": 1
    },
    {
      "id": "territory-sunspire",
      "titleKey": "region.sunspire.name",
      "textKey": "card.territory.sunspire.text",
      "regionId": "sunspire",
      "continentId": "sundar",
      "value": 1
    },
    {
      "id": "territory-amber-steppe",
      "titleKey": "region.amber-steppe.name",
      "textKey": "card.territory.amber-steppe.text",
      "regionId": "amber-steppe",
      "continentId": "sundar",
      "value": 1
    },
    {
      "id": "territory-dunehollow",
      "titleKey": "region.dunehollow.name",
      "textKey": "card.territory.dunehollow.text",
      "regionId": "dunehollow",
      "continentId": "sundar",
      "value": 1
    },
    {
      "id": "territory-cinderfall",
      "titleKey": "region.cinderfall.name",
      "textKey": "card.territory.cinderfall.text",
      "regionId": "cinderfall",
      "continentId": "sundar",
      "value": 1
    },
    {
      "id": "territory-myrravale",
      "titleKey": "region.myrravale.name",
      "textKey": "card.territory.myrravale.text",
      "regionId": "myrravale",
      "continentId": "sundar",
      "value": 1
    },
    {
      "id": "territory-olivane",
      "titleKey": "region.olivane.name",
      "textKey": "card.territory.olivane.text",
      "regionId": "olivane",
      "continentId": "sundar",
      "value": 1
    },
    {
      "id": "territory-ashen-quay",
      "titleKey": "region.ashen-quay.name",
      "textKey": "card.territory.ashen-quay.text",
      "regionId": "ashen-quay",
      "continentId": "emberisle",
      "value": 1
    },
    {
      "id": "territory-pyre-key",
      "titleKey": "region.pyre-key.name",
      "textKey": "card.territory.pyre-key.text",
      "regionId": "pyre-key",
      "continentId": "emberisle",
      "value": 1
    },
    {
      "id": "territory-coral-reach",
      "titleKey": "region.coral-reach.name",
      "textKey": "card.territory.coral-reach.text",
      "regionId": "coral-reach",
      "continentId": "emberisle",
      "value": 1
    },
    {
      "id": "territory-saltmerrow",
      "titleKey": "region.saltmerrow.name",
      "textKey": "card.territory.saltmerrow.text",
      "regionId": "saltmerrow",
      "continentId": "emberisle",
      "value": 1
    },
    {
      "id": "territory-stormcay",
      "titleKey": "region.stormcay.name",
      "textKey": "card.territory.stormcay.text",
      "regionId": "stormcay",
      "continentId": "emberisle",
      "value": 1
    },
    {
      "id": "territory-joker-01",
      "titleKey": "card.joker.title",
      "textKey": "card.joker.text",
      "wild": true,
      "value": 1
    },
    {
      "id": "territory-joker-02",
      "titleKey": "card.joker.title",
      "textKey": "card.joker.text",
      "wild": true,
      "value": 1
    }
  ]
}`;

export const TR_I18N_JSON = `{
  "game.title": "Territory Wars",
  "game.subtitle": "Aetheris'in 28 bölgesini fethet ve tek sancak altında topla.",
  "continent.drakemoor.name": "Drakemoor Uçları",
  "continent.koros.name": "Koros Yaylası",
  "continent.virelai.name": "Virelai Bataklıkları",
  "continent.sundar.name": "Sundar Bozkırı",
  "continent.emberisle.name": "Ember Adaları",
  "region.fangreach.name": "Fangreach",
  "card.territory.fangreach.text": "Bu sancak kartı Fangreach bölgesini temsil eder.",
  "region.stormfell.name": "Stormfell",
  "card.territory.stormfell.text": "Bu sancak kartı Stormfell bölgesini temsil eder.",
  "region.ironfrost.name": "Ironfrost",
  "card.territory.ironfrost.text": "Bu sancak kartı Ironfrost bölgesini temsil eder.",
  "region.whitmane.name": "Whitmane",
  "card.territory.whitmane.text": "Bu sancak kartı Whitmane bölgesini temsil eder.",
  "region.grimhold.name": "Grimhold",
  "card.territory.grimhold.text": "Bu sancak kartı Grimhold bölgesini temsil eder.",
  "region.aldermoor.name": "Aldermoor",
  "card.territory.aldermoor.text": "Bu sancak kartı Aldermoor bölgesini temsil eder.",
  "region.hollowbridge.name": "Hollowbridge",
  "card.territory.hollowbridge.text": "Bu sancak kartı Hollowbridge bölgesini temsil eder.",
  "region.mistral-basin.name": "Mistral Basin",
  "card.territory.mistral-basin.text": "Bu sancak kartı Mistral Basin bölgesini temsil eder.",
  "region.kestrel-down.name": "Kestrel Down",
  "card.territory.kestrel-down.text": "Bu sancak kartı Kestrel Down bölgesini temsil eder.",
  "region.sundergate.name": "Sundergate",
  "card.territory.sundergate.text": "Bu sancak kartı Sundergate bölgesini temsil eder.",
  "region.emberwatch.name": "Emberwatch",
  "card.territory.emberwatch.text": "Bu sancak kartı Emberwatch bölgesini temsil eder.",
  "region.loamfield.name": "Loamfield",
  "card.territory.loamfield.text": "Bu sancak kartı Loamfield bölgesini temsil eder.",
  "region.reedmarsh.name": "Reedmarsh",
  "card.territory.reedmarsh.text": "Bu sancak kartı Reedmarsh bölgesini temsil eder.",
  "region.larkspur.name": "Larkspur",
  "card.territory.larkspur.text": "Bu sancak kartı Larkspur bölgesini temsil eder.",
  "region.glassholt.name": "Glassholt",
  "card.territory.glassholt.text": "Bu sancak kartı Glassholt bölgesini temsil eder.",
  "region.tidewick.name": "Tidewick",
  "card.territory.tidewick.text": "Bu sancak kartı Tidewick bölgesini temsil eder.",
  "region.fernmarsh.name": "Fernmarsh",
  "card.territory.fernmarsh.text": "Bu sancak kartı Fernmarsh bölgesini temsil eder.",
  "region.sunspire.name": "Sunspire",
  "card.territory.sunspire.text": "Bu sancak kartı Sunspire bölgesini temsil eder.",
  "region.amber-steppe.name": "Amber Steppe",
  "card.territory.amber-steppe.text": "Bu sancak kartı Amber Steppe bölgesini temsil eder.",
  "region.dunehollow.name": "Dunehollow",
  "card.territory.dunehollow.text": "Bu sancak kartı Dunehollow bölgesini temsil eder.",
  "region.cinderfall.name": "Cinderfall",
  "card.territory.cinderfall.text": "Bu sancak kartı Cinderfall bölgesini temsil eder.",
  "region.myrravale.name": "Myrravale",
  "card.territory.myrravale.text": "Bu sancak kartı Myrravale bölgesini temsil eder.",
  "region.olivane.name": "Olivane",
  "card.territory.olivane.text": "Bu sancak kartı Olivane bölgesini temsil eder.",
  "region.ashen-quay.name": "Ashen Quay",
  "card.territory.ashen-quay.text": "Bu sancak kartı Ashen Quay bölgesini temsil eder.",
  "region.pyre-key.name": "Pyre Key",
  "card.territory.pyre-key.text": "Bu sancak kartı Pyre Key bölgesini temsil eder.",
  "region.coral-reach.name": "Coral Reach",
  "card.territory.coral-reach.text": "Bu sancak kartı Coral Reach bölgesini temsil eder.",
  "region.saltmerrow.name": "Saltmerrow",
  "card.territory.saltmerrow.text": "Bu sancak kartı Saltmerrow bölgesini temsil eder.",
  "region.stormcay.name": "Stormcay",
  "card.territory.stormcay.text": "Bu sancak kartı Stormcay bölgesini temsil eder.",
  "card.joker.title": "Aetheris Sancağı",
  "card.joker.text": "Herhangi bir bölge kartının yerine geçer; bozdurmada eksik kartı tamamlar.",
  "deck.territory.name": "Bölge Sancakları",
  "deck.legions.name": "Lejyon Kararnameleri",
  "legion.spearwatch.name": "Mızrakkale Muhafızları",
  "legion.spearwatch.text": "Savunma yaparken ilk zarına +1 eklersin (en fazla 6).",
  "legion.stormwing.name": "Fırtınatkanat Akıncıları",
  "legion.stormwing.text": "Saldırıda ilk zarın 1 gelirse o zarı bir kez yeniden atarsın.",
  "legion.ironbull.name": "Demirboğa Koşucuları",
  "legion.ironbull.text": "Bir bölgeyi ele geçirdiğinde en az 2 birliği ilerletmek zorundasın.",
  "rule.setup": "Sırayla bölge kap; her bölgeye 1 muhafız koy, kalan orduyu başkentinde beklet.",
  "rule.reinforce": "Turunun başında bölge sayısının üçte biri kadar, en az 3, takviye al.",
  "rule.bonus": "Bir kıtanın her bölgesi sendeyse kıta bonusunu al; başkent +2 verir.",
  "rule.attack": "Komşu bölgeye saldır; 2+ birlikli bölgeden en çok 3 zar atarsın.",
  "rule.defend": "Savunan taraf en çok 2 zar atar.",
  "rule.pairing": "Zarlar büyükten küçüğe eşleşir; her eşleşmede kaybeden 1 birlik verir.",
  "rule.ties": "Eşitlikte zarı savunan kazanır; kale bölgeleri savunmanın ilk zarına +1 ekler.",
  "rule.conquest": "Bölgeyi alınca kullandığın zar sayısından az olmamak üzere birlik ilerlet.",
  "rule.trade": "3 sancak kartı birikince takviye sonrası bozdur; seri büyüdükçe ödül artar.",
  "rule.legion": "Takviyeden sonra 1 lejyon kararnamesi çek; her turda 1 lejyon oynanır.",
  "rule.elimination": "Son bölgesini kaybeden oyundan çekilir; sancakları fetihçiye devreder.",
  "rule.end": "Ayağa kalan son komutan Aetheris'i yönetir; eşitlikte daha az tur oynayan kazanır.",
  "token.token-scarlet.name": "Kızıl Komutan",
  "token.token-indigo.name": "Lacivert Komutan",
  "token.token-jade.name": "Yeşim Komutan",
  "token.token-umber.name": "Kestane Komutan",
  "token.token-silver.name": "Gümüş Komutan",
  "token.token-amber.name": "Kehribar Komutan",
  "token.army-disc.name": "Birlik Pullu",
  "army.per-region": "Her bölge en az 1 birlik bulundurur."
}`;
