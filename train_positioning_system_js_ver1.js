/* =========================================================
   列車・バス位置情報システム JS
   時刻表(CSV)を読み込み、指定した時刻における列車のおおよその
   位置を路線図上に描画する。実際のGPS位置情報は使用していない。

   構成:
    1. 定数・設定(路線データ/多言語辞書/アイコン対応表)
    2. 状態管理(state)
    3. ユーティリティ関数(時刻変換・配色など)
    4. CSV読込・解析
    5. 運行日・時刻ロジック / 列車タイムライン生成
    6. 座標計算(位置予測)
    7. DOM生成・描画(路線選択画面/路線詳細画面)
    8. モーダル・トースト
    9. イベントハンドラ
    10. 初期化
   ========================================================= */

/* =========================================================
   1. 定数・設定
   ========================================================= */

/** 1系統(鹿児島駅前～谷山)の駅一覧。並び順=画面表示順(上→下)。
 *  code はCSVヘッダの駅コード("I_01"等)と一致させる。 */
const LINE1_STATIONS = [
  { code: "I_01", ja: "鹿児島駅前",       en: "Kagoshima-ekimae" },
  { code: "I_02", ja: "桜島桟橋通",       en: "Sakurajima-sanbashi-dori" },
  { code: "I_03", ja: "水族館口",         en: "Suizokukan-guchi" },
  { code: "I_04", ja: "市役所前",         en: "Shiyakusho-mae" },
  { code: "I_05", ja: "朝日通",           en: "Asahi-dori" },
  { code: "I_06", ja: "いづろ通",         en: "Izuro-dori" },
  { code: "I_07", ja: "天文館通",         en: "Tenmonkan-dori" },
  { code: "I_08", ja: "高見馬場",         en: "Takami-baba" },
  { code: "I_09", ja: "甲東中学校前",     en: "Koto-chugakko-mae" },
  { code: "I_10", ja: "新屋敷",           en: "Shin-yashiki" },
  { code: "I_11", ja: "武之橋",           en: "Takenoko-bashi" },
  { code: "I_12", ja: "二中通",           en: "Nichu-dori" },
  { code: "I_13", ja: "荒田八幡",         en: "Arata-hachiman" },
  { code: "I_14", ja: "騎射場",           en: "Kishaba" },
  { code: "I_15", ja: "鴨池",             en: "Kamoike" },
  { code: "I_16", ja: "郡元",             en: "Kogen" },
  { code: "I_17", ja: "郡元(南側)",       en: "Kogen (South)" },
  { code: "I_18", ja: "涙橋",             en: "Namida-bashi" },
  { code: "I_19", ja: "南鹿児島駅前",     en: "Minami-Kagoshima-ekimae" },
  { code: "I_20", ja: "二軒茶屋",         en: "Nikenchaya" },
  { code: "I_21", ja: "宇宿一丁目",       en: "Usuki-icchome" },
  { code: "I_22", ja: "脇田",             en: "Wakita" },
  { code: "I_23", ja: "笹貫",             en: "Sasanuki" },
  { code: "I_24", ja: "上塩屋",           en: "Kami-shioya" },
  { code: "I_25", ja: "谷山",             en: "Tanyama" },
];

/** 2系統(天文館通～中郡)の駅一覧。並び順=画面表示順(上→下)。
 *  2系統の画面自体は1系統に統一し、この駅一覧は天文館通～中郡(高見馬場までの共用トランク区間の
 *  末尾～2系統固有区間の末尾)のみを表示する。鹿児島駅前～天文館通の共用トランク前半と、
 *  郡元(2系統の実質的な終点)は1系統側の画面に統一して表示する(郡元は1系統のI_16を参照)。
 *  天文館通・中郡の両端には1系統画面へのリンクを表示する。 */
const LINE2_STATIONS = [
  { code: "N_07", ja: "天文館通",         en: "Tenmonkan-dori" },
  { code: "N_08", ja: "高見馬場",         en: "Takami-baba" },
  { code: "N_09", ja: "加治屋町",         en: "Kajiya-cho" },
  { code: "N_10", ja: "高見橋",           en: "Takami-bashi" },
  { code: "N_11", ja: "鹿児島中央駅前",   en: "Kagoshima-chuo-ekimae" },
  { code: "N_12", ja: "都通",             en: "Miyako-dori" },
  { code: "N_13", ja: "中州通",           en: "Nakasu-dori" },
  { code: "N_14", ja: "市立病院前",       en: "Shiritsu-byoin-mae" },
  { code: "N_15", ja: "神田(交通局前)",   en: "Kanda (Kotsukyoku-mae)" },
  { code: "N_16", ja: "唐湊",             en: "Toso" },
  { code: "N_17", ja: "工学部前",         en: "Kogakubu-mae" },
  { code: "N_18", ja: "純心学園前",       en: "Junshin-gakuen-mae" },
  { code: "N_19", ja: "中郡",             en: "Nakagori" },
];

/** 隣接する駅コードのペア配列を作る(区間の共用区間判定・重複区間の線描画に使用) */
function consecutivePairs(codes) {
  const pairs = [];
  for (let i = 0; i < codes.length - 1; i++) pairs.push([codes[i], codes[i + 1]]);
  return pairs;
}

/** 隣接する2駅の組が、指定路線における共用区間(トランク区間)かどうかを判定する */
function isOverlapSegment(route, codeA, codeB) {
  return route.overlapPairs.some(([a, b]) => (a === codeA && b === codeB) || (a === codeB && b === codeA));
}

/** 路線メタ情報。色は仕様書指定の値、Line_Numが空欄の列車は NO_LINE_COLOR で表示する。
 *  鹿児島駅前～高見馬場(1系統:I_01～I_08)は2系統と物理的に共用するトランク区間。
 *  高見馬場の先で1系統(→甲東中学校前方面)と2系統(→加治屋町方面)に分岐する。
 *  郡元(I_16)は2系統の実質的な終点でもあるため、郡元～郡元(南側)の間にも
 *  2系統への導線(分岐表示)を追加する。 */
const ROUTES = {
  1: {
    id: 1,
    color: "#0145BF",
    nameJa: "1系統", nameEn: "Line 1",
    fromJa: "鹿児島駅前", fromEn: "Kagoshima-ekimae",
    toJa: "谷山", toEn: "Tanyama",
    files: {
      down: "timetables/Kagoshima_city_tram/26_001_D_Timetable.csv",
      up: "timetables/Kagoshima_city_tram/26_001_U_Timetable.csv",
    },
    stations: LINE1_STATIONS,
    otherRouteId: 2,
    implemented: true,
  },
  2: {
    id: 2,
    color: "#FF2929",
    nameJa: "2系統", nameEn: "Line 2",
    fromJa: "天文館通", fromEn: "Tenmonkan-dori",
    viaJa: "鹿児島中央駅前", viaEn: "Kagoshima-chuo-ekimae",
    toJa: "中郡", toEn: "Nakagori",
    files: {
      down: "timetables/Kagoshima_city_tram/26_002_D_Timetable.csv",
      up: "timetables/Kagoshima_city_tram/26_002_U_Timetable.csv",
    },
    stations: LINE2_STATIONS,
    otherRouteId: 1,
    implemented: true,
  },
};

/** 1系統(I_01～I_08)・2系統(N_07～N_08、鹿児島駅前～天文館通は1系統側にのみ描画)の
 *  共用トランク区間の隣接ペア。この区間は自路線の色に、もう一方の系統色を細線で重ねる。 */
ROUTES[1].overlapPairs = consecutivePairs(LINE1_STATIONS.slice(0, 8).map((s) => s.code));
ROUTES[2].overlapPairs = consecutivePairs(LINE2_STATIONS.slice(0, 2).map((s) => s.code)); // 天文館通-高見馬場のみ

/** 1系統の画面に表示する分岐点。afterCodeの駅の直後の区間に、otherRouteIdへの分岐帯を描画する。
 *  ①高見馬場の先: 2系統本来の分岐 ②郡元の先: 2系統の郡元発着列車をここに重ねて表示するための導線。 */
ROUTES[1].branchPoints = [
  { afterCode: "I_08", otherRouteId: 2 },
  { afterCode: "I_16", otherRouteId: 2 },
];
ROUTES[2].branchPoints = [];

/** 2系統の画面(天文館通～中郡)の両端は1系統画面への導線とする(afterIndexは要素挿入位置の目印)。 */
ROUTES[2].edgeLinks = { top: 1, bottom: 1 };

/** 直通(003ファイル)列車の停車駅を、表示先の路線の駅コードへ読み替えるための「駅名→駅コード」対応表。
 *  駅名が一致しない(=その路線の路線図上には存在しない)駅はそのまま(003固有のX_xxコード)にしておく
 *  ことで、canonicalOrderに含まれず自動的に非表示になる(=表示中の路線の線路上にいない間は消える)。 */
function buildNameToCodeMap(stations) {
  const map = new Map();
  stations.forEach((s) => map.set(s.ja, s.code));
  return map;
}
const LINE1_NAME_TO_CODE = buildNameToCodeMap(LINE1_STATIONS);
const LINE2_NAME_TO_CODE = buildNameToCodeMap(LINE2_STATIONS);

/** 各駅の日本語名 → 表示名(ja/en) の対応表(1系統・2系統をあわせたもの)。
 *  モーダルの各駅発車時刻など、どちらの路線経由の駅名でも表示名を引けるようにする。 */
const ALL_STATIONS_BY_NAME = new Map();
[...LINE1_STATIONS, ...LINE2_STATIONS].forEach((s) => {
  if (!ALL_STATIONS_BY_NAME.has(s.ja)) ALL_STATIONS_BY_NAME.set(s.ja, s);
});

const NO_LINE_COLOR = "#A6A6A6";

/* =========================================================
   1-b. 駅ごとの時刻表URL・乗り換え案内(設定データ)
   ここではUI(選択の仕組み)だけを用意し、実際のURL値は空文字のままにしておく。
   URLの入力(値の書き換え)は運用担当者がこのファイルを直接編集して行う。
   ========================================================= */

/** 駅の時刻表URLスロット数(駅名で判定)。
 *  ・鹿児島駅前～高見馬場(共用トランク区間)と郡元は、系統ごとの時刻表が複数存在するため3つ
 *  ・1系統の高見馬場～谷山(郡元以外)、2系統の高見馬場～中郡(郡元以外)は2つ */
const TIMETABLE_URL_3SLOT_STATIONS = new Set([
  "鹿児島駅前", "桜島桟橋通", "水族館口", "市役所前", "朝日通", "いづろ通", "天文館通", "高見馬場", // トランク区間
  "郡元", // 1系統(I_16)。2系統の郡元発着列車もここに表示されるため同様に扱う。
]);
/** 1系統の固有区間(高見馬場～谷山、郡元を除く)の駅名 */
const LINE1_ONLY_NAMES = new Set(
  LINE1_STATIONS.slice(8).map((s) => s.ja).filter((n) => !TIMETABLE_URL_3SLOT_STATIONS.has(n))
);
/** 2系統の固有区間(高見馬場～中郡、駅一覧はすでに天文館通～中郡のみ)の駅名 */
const LINE2_ONLY_NAMES = new Set(
  LINE2_STATIONS.map((s) => s.ja).filter((n) => !TIMETABLE_URL_3SLOT_STATIONS.has(n))
);

/** 駅名から時刻表メニューの既定ラベル構成を決める。
 *  共用トランク区間・郡元は「1系統/2系統/その他の列車」、各路線固有区間は「自路線/その他の列車」。 */
function defaultTimetableLabels(stationName) {
  if (TIMETABLE_URL_3SLOT_STATIONS.has(stationName)) return ["1系統", "2系統", "その他の列車"];
  if (LINE1_ONLY_NAMES.has(stationName)) return ["1系統", "その他の列車"];
  if (LINE2_ONLY_NAMES.has(stationName)) return ["2系統", "その他の列車"];
  return ["その他の列車", "その他の列車"];
}

/** 駅名 → 時刻表エントリ配列({label, url})。urlは運用担当者が直接書き換える(空文字="未設定")。
 *  同じ駅名は1系統・2系統どちらの画面から開いても同じ配列を参照・編集できるよう共有する。 */
const TIMETABLE_URLS = new Map();
function timetableEntriesFor(stationName) {
  if (!TIMETABLE_URLS.has(stationName)) {
    TIMETABLE_URLS.set(stationName, defaultTimetableLabels(stationName).map((label) => ({ label, url: "" })));
  }
  return TIMETABLE_URLS.get(stationName);
}

/** 記入例: 鹿児島駅前の時刻表URL(運用担当者は他の駅も同様にurlを書き換えていく)。 */
TIMETABLE_URLS.set("鹿児島駅前", [
  { label: "1系統", url: "https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E9%B9%BF%E5%85%90%E5%B3%B6%E9%A7%85%E5%89%8D&kubun=0&syubetuId=1" },
  { label: "2系統", url: "https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E9%B9%BF%E5%85%90%E5%B3%B6%E9%A7%85%E5%89%8D&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: "https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E9%B9%BF%E5%85%90%E5%B3%B6%E9%A7%85%E5%89%8D&kubun=0&syubetuId=1" },
]);
TIMETABLE_URLS.set("桜島桟橋通", [
   {label: "1系統", url: "https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E6%A1%9C%E5%B3%B6%E6%A1%9F%E6%A9%8B%E9%80%9A&kubun=0&syubetuId=1" },
   {label: "2系統", url: "https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E6%A1%9C%E5%B3%B6%E6%A1%9F%E6%A9%8B%E9%80%9A&kubun=0&syubetuId=1" },
   {label: "その他の列車", url: "https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E6%A1%9C%E5%B3%B6%E6%A1%9F%E6%A9%8B%E9%80%9A&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("水族館口", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E6%B0%B4%E6%97%8F%E9%A4%A8%E5%8F%A3&kubun=0&syubetuId=1" },
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E6%B0%B4%E6%97%8F%E9%A4%A8%E5%8F%A3&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E6%B0%B4%E6%97%8F%E9%A4%A8%E5%8F%A3&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("市役所前", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E5%B8%82%E5%BD%B9%E6%89%80%E5%89%8D&kubun=0&syubetuId=1" },
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E5%B8%82%E5%BD%B9%E6%89%80%E5%89%8D&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E5%B8%82%E5%BD%B9%E6%89%80%E5%89%8D&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("朝日通", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E6%9C%9D%E6%97%A5%E9%80%9A&kubun=0&syubetuId=1" },
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E6%9C%9D%E6%97%A5%E9%80%9A&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E6%9C%9D%E6%97%A5%E9%80%9A&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("いづろ通", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E3%81%84%E3%81%A5%E3%82%8D%E9%80%9A&kubun=0&syubetuId=1" },
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E3%81%84%E3%81%A5%E3%82%8D%E9%80%9A&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E3%81%84%E3%81%A5%E3%82%8D%E9%80%9A&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("天文館通", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E5%A4%A9%E6%96%87%E9%A4%A8%E9%80%9A&kubun=0&syubetuId=1" },
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E5%A4%A9%E6%96%87%E9%A4%A8%E9%80%9A&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E5%A4%A9%E6%96%87%E9%A4%A8%E9%80%9A&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("高見馬場", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E9%AB%98%E8%A6%8B%E9%A6%AC%E5%A0%B4&kubun=0&syubetuId=1" },
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E9%AB%98%E8%A6%8B%E9%A6%AC%E5%A0%B4&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E9%AB%98%E8%A6%8B%E9%A6%AC%E5%A0%B4&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("甲東中学校前", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E7%94%B2%E6%9D%B1%E4%B8%AD%E5%AD%A6%E6%A0%A1%E5%89%8D&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("新屋敷", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E6%96%B0%E5%B1%8B%E6%95%B7&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("武之橋", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E6%AD%A6%E4%B9%8B%E6%A9%8B&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("二中通", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E4%BA%8C%E4%B8%AD%E9%80%9A%EF%BC%88%E3%82%AD%E3%83%A9%E3%83%A1%E3%82%AD%E3%83%86%E3%83%A9%E3%82%B9%E5%89%8D%EF%BC%89&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("荒田八幡", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E8%8D%92%E7%94%B0%E5%85%AB%E5%B9%A1&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("騎射場", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E9%A8%8E%E5%B0%84%E5%A0%B4&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("鴨池", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E9%B4%A8%E6%B1%A0&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("郡元", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E9%83%A1%E5%85%83&kubun=0&syubetuId=1" },
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E9%83%A1%E5%85%83&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("郡元(南側)", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E9%83%A1%E5%85%83%E5%8D%97%E5%81%B4&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E9%83%A1%E5%85%83%E5%8D%97%E5%81%B4&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("涙橋", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E6%B6%99%E6%A9%8B&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E6%B6%99%E6%A9%8B&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("南鹿児島駅前", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E5%8D%97%E9%B9%BF%E5%85%90%E5%B3%B6%E9%A7%85%E5%89%8D&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E5%8D%97%E9%B9%BF%E5%85%90%E5%B3%B6%E9%A7%85%E5%89%8D&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("二軒茶屋", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E4%BA%8C%E8%BB%92%E8%8C%B6%E5%B1%8B&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E4%BA%8C%E8%BB%92%E8%8C%B6%E5%B1%8B&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("宇宿一丁目", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E5%AE%87%E5%AE%BF%E4%B8%80%E4%B8%81%E7%9B%AE&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E5%AE%87%E5%AE%BF%E4%B8%80%E4%B8%81%E7%9B%AE&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("脇田", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E8%84%87%E7%94%B0&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E8%84%87%E7%94%B0&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("笹貫", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E7%AC%B9%E8%B2%AB&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E7%AC%B9%E8%B2%AB&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("上塩屋", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E4%B8%8A%E5%A1%A9%E5%B1%8B&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E4%B8%8A%E5%A1%A9%E5%B1%8B&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("谷山", [
  { label: "1系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1820,1821&name=%E8%B0%B7%E5%B1%B1&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E8%B0%B7%E5%B1%B1&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("加治屋町", [
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E5%8A%A0%E6%B2%BB%E5%B1%8B%E7%94%BA&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E5%8A%A0%E6%B2%BB%E5%B1%8B%E7%94%BA&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("高見橋", [
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E9%AB%98%E8%A6%8B%E6%A9%8B&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E9%AB%98%E8%A6%8B%E6%A9%8B&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("鹿児島中央駅前", [
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E9%B9%BF%E5%85%90%E5%B3%B6%E4%B8%AD%E5%A4%AE%E9%A7%85%E5%89%8D&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E9%B9%BF%E5%85%90%E5%B3%B6%E4%B8%AD%E5%A4%AE%E9%A7%85%E5%89%8D&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("都通", [
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E9%83%BD%E9%80%9A&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E9%83%BD%E9%80%9A&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("中州通", [
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E4%B8%AD%E6%B4%B2%E9%80%9A&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E4%B8%AD%E6%B4%B2%E9%80%9A&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("市立病院前", [
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E5%B8%82%E7%AB%8B%E7%97%85%E9%99%A2%E5%89%8D&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E5%B8%82%E7%AB%8B%E7%97%85%E9%99%A2%E5%89%8D&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("神田(交通局前)", [
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E7%A5%9E%E7%94%B0%EF%BC%88%E4%BA%A4%E9%80%9A%E5%B1%80%E5%89%8D%EF%BC%89&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E7%A5%9E%E7%94%B0%EF%BC%88%E4%BA%A4%E9%80%9A%E5%B1%80%E5%89%8D%EF%BC%89&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("唐湊", [
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E5%94%90%E6%B9%8A%EF%BC%88%E5%B0%8F%E7%89%A7%E5%BB%BA%E8%A8%AD%E5%89%8D%EF%BC%89&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E5%94%90%E6%B9%8A%EF%BC%88%E5%B0%8F%E7%89%A7%E5%BB%BA%E8%A8%AD%E5%89%8D%EF%BC%89&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("工学部前", [
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E5%B7%A5%E5%AD%A6%E9%83%A8%E5%89%8D&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E5%B7%A5%E5%AD%A6%E9%83%A8%E5%89%8D&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("純心学園前", [
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E7%B4%94%E5%BF%83%E5%AD%A6%E5%9C%92%E5%89%8D&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E7%B4%94%E5%BF%83%E5%AD%A6%E5%9C%92%E5%89%8D&kubun=0&syubetuId=1" },
]);

TIMETABLE_URLS.set("中郡", [
  { label: "2系統", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1840,1841&name=%E4%B8%AD%E9%83%A1&kubun=0&syubetuId=1" },
  { label: "その他の列車", url: " https://www.kotsu-city-kagoshima.jp/wp/timesearch/time_table.php?rosenId=1860,1861&name=%E4%B8%AD%E9%83%A1&kubun=0&syubetuId=1" },
]);



/** 乗り換え案内(駅名 → 乗り換え路線名の配列)。ここに無い駅は乗り換えボタン自体を表示しない。 */
const TRANSFER_INFO = {
  "鹿児島駅前": { ja: ["JR日豊線","JR鹿児島線"], en: ["JR Nippō Line", "JR Kagoshima Line"] },
  "鹿児島中央駅前": { ja: ["JR鹿児島線", "JR日豊線", "JR指宿枕崎線", "高速バス"], en: ["JR Kagoshima Line", "JR Nippō Line", "JR Ibusuki-Makurazaki Line", "Highway bus"] },
  "純心学園前": { ja: ["JR指宿枕崎線(郡元駅)"], en: ["JR Ibusuki-Makurazaki Line (Kogen Sta.)"] },
  "南鹿児島駅前": { ja: ["JR指宿枕崎線"], en: ["JR Ibusuki-Makurazaki Line"] },
  "谷山": { ja: ["JR指宿枕崎線"], en: ["JR Ibusuki-Makurazaki Line"] },
};

/** 支給された列車アイコン(SVG)。系統番号ごとに専用ファイルが用意されている。 */
const ICON_BASE = "icons/kagoshima_city_tram_icon/";
const ICONS = {
  blueNum1: `${ICON_BASE}KCT_blue_No1_icon.svg`,
  blueNonum: `${ICON_BASE}KCT_blue_nonum_icon.svg`,
  redNum2: `${ICON_BASE}KCT_red_No2_icon.svg`,
  redNonum: `${ICON_BASE}KCT_red_nonum_icon.svg`,
  redDirect: `${ICON_BASE}KCT_red_direct_icon.svg`,
  grayNonum: `${ICON_BASE}KCT_gray_nonum_icon.svg`,
};

/** 列車のLine_Numと読み込み元系統から、使用するアイコンSVGのパスを決定する。
 *  1→青1, 2→赤2, 直通→赤直, それ以外は読み込み元系統の路線カラー(nonum)。
 *  ただし003ファイル(直通ファイル)内の空欄は常にグレーとする。 */
function iconPathForTrain(train) {
  if (train.lineNum === "1") return ICONS.blueNum1;
  if (train.lineNum === "2") return ICONS.redNum2;
  if (train.lineNum === "直通") return ICONS.redDirect;
  if (train.sourceFile === "003") return ICONS.grayNonum;
  return train.sourceRoute === 2 ? ICONS.redNonum : ICONS.blueNonum;
}

/** Types列の値 → 種別頭文字(普/快/新/特)。局所線はすべてlocalのため今回は未使用だが拡張用に定義。 */
const TYPE_LABEL = {
  local: "普",
  rapid: "快",
  express: "特",
  direct: "直",
};

/** 駅ブロック1つ分の高さ(px)。CSSの --station-*-h / --segment-*-h と必ず一致させること。
 *  stationCenterは「駅名」+「乗り換え/時刻表アイコン」の2段構成のため25→46に拡張。 */
const LAYOUT = {
  stationTop: 45,
  stationCenter: 46,
  stationBottom: 45,
  segmentTop: 55,
  segmentBottom: 55,
};
LAYOUT.cycle = LAYOUT.stationTop + LAYOUT.stationCenter + LAYOUT.stationBottom + LAYOUT.segmentTop + LAYOUT.segmentBottom;

/** 列車の停車・出現タイミングに関する仕様値(秒) */
const TIMING = {
  originAppearBefore: 60,     // 始発駅: 発車の何秒前に出現するか
  intermediateArriveBefore: 30, // 途中駅: 発車の何秒前に到着(停車)扱いにするか
  terminusLingerAfter: 60,    // 終点: 到着後何秒間表示し続けるか
};

/** 同一アンカーに複数列車が重なった際の、後続列車をずらす量(px) */
const STACK_OFFSET_PX = 9;

/** 画面の自動更新間隔(ミリ秒) */
const REFRESH_INTERVAL_MS = 30000;

/** 多言語辞書(JP/EN) */
const I18N = {
  ja: {
    siteTitle: "列車位置情報サイト",
    disclaimer: "時刻による位置の予測です。実際の位置情報とは異なる可能性があるためご注意ください。",
    backToList: "路線一覧",
    selectRouteHeading: "路線を選択してください",
    dayTypeLabel: "運行日",
    dayWeekday: "平日",
    daySaturday: "土曜",
    dayHoliday: "日曜・祝日",
    timeLabel: "時刻",
    nowButton: "現在時刻に戻す",
    playButton: "再生",
    pauseButton: "停止",
    comingSoonTag: "準備中",
    comingSoonToast: "この路線は現在準備中です。",
    sharedNote: "鹿児島駅前～高見馬場は1・2系統の共用区間です。高見馬場の先で1系統・2系統に分岐します",
    viewRoute: "この路線を見る",
    modalType: "種別",
    modalDestination: "終点",
    modalDeparture: "始発",
    modalNote: "備考",
    modalStations: "各駅発車時刻",
    typeLocal: "普通",
    directionUp: (name) => `${name} 方面`,
    directionDown: (name) => `${name} 方面`,
    transferLabel: "乗り換え",
    timetableLabel: "時刻表",
    displayModeLabel: "ディスプレイモード",
    featureComingSoonToast: "この機能は準備中です。",
    transferNoInfoToast: "この駅の乗り換え情報はありません。",
    timetableUrlUnsetToast: "このURLはまだ設定されていません。",
    backToLine1: "1系統",
  },
  en: {
    siteTitle: "Train Position Info",
    disclaimer: "This is a prediction based on the timetable. The actual position may differ, so please use this information with caution.",
    backToList: "Route list",
    selectRouteHeading: "Please select a route",
    dayTypeLabel: "Service day",
    dayWeekday: "Weekday",
    daySaturday: "Saturday",
    dayHoliday: "Sunday & Holiday",
    timeLabel: "Time",
    nowButton: "Reset to now",
    playButton: "Play",
    pauseButton: "Pause",
    comingSoonTag: "Coming soon",
    comingSoonToast: "This route is currently under development.",
    sharedNote: "Kagoshima-ekimae - Takami-baba is shared by Lines 1 and 2. They branch apart just past Takami-baba",
    viewRoute: "View this route",
    modalType: "Type",
    modalDestination: "Terminus",
    modalDeparture: "Origin",
    modalNote: "Remarks",
    modalStations: "Departure times",
    typeLocal: "Local",
    directionUp: (name) => `To ${name}`,
    directionDown: (name) => `To ${name}`,
    transferLabel: "Transfer",
    timetableLabel: "Timetable",
    displayModeLabel: "Display mode",
    featureComingSoonToast: "This feature is currently under development.",
    transferNoInfoToast: "There is no transfer information for this station.",
    timetableUrlUnsetToast: "This URL has not been set yet.",
    backToLine1: "Line 1",
  },
};

/* =========================================================
   2. 状態管理(state)
   ========================================================= */
const state = {
  language: "ja",              // "ja" | "en"
  themePreference: "auto",     // "auto" | "light" | "dark"
  view: "select",              // "select" | "line"
  currentRouteId: null,         // "line"表示中の系統ID(1 または 2)
  dayType: null,                // "weekday" | "Saturday" | "Holiday"
  manualTime: null,             // 手動指定時の秒数(0-86399)。nullなら現在時刻を使用。
  trains: { 1: null, 2: null },  // 系統ごとの読込済み列車データ(キャッシュ)
  directTrainsRaw: null,        // 003(直通)ファイルの生データキャッシュ(路線への割り当て前)
  line2OwnTrainsRaw: null,      // 002(2系統固有)ファイルの生データキャッシュ
  liveTimer: null,
  activeTrainForModal: null,
  isPlaying: false,             // 手動指定時刻から実時間で進行中かどうか
  playBase: null,                // { simSec, realMs } 再生開始時点の基準値
  playTimer: null,
};

/* =========================================================
   3. ユーティリティ関数
   ========================================================= */

/** "hh:mm" または "hh:mm:ss" 形式の文字列を秒数に変換する(秒指定が無ければ0秒扱い) */
function timeToSeconds(timeStr) {
  const parts = timeStr.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  const s = parts[2] || 0;
  return h * 3600 + m * 60 + s;
}

/** 秒数を "hh:mm" 形式の文字列に変換する(時刻表示・input[type=time]用) */
function secondsToHHMM(totalSeconds) {
  const s = ((totalSeconds % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 現在の実時刻(秒)を取得する */
function nowSecondsReal() {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/** 春分の日/秋分の日(日本、1980～2099年で有効な近似式)を「その年の3月/9月の日」として返す */
function vernalEquinoxDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
function autumnalEquinoxDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** 指定月の第n月曜日の日付(1-31)を返す(ハッピーマンデー祝日の算出用) */
function nthMondayOfMonth(year, month, n) {
  const first = new Date(year, month - 1, 1);
  const offsetToMonday = (1 - first.getDay() + 7) % 7; // getDay: 0=日
  return 1 + offsetToMonday + (n - 1) * 7;
}

/** 日本の祝日(月,日)を年ごとに算出する(固定日+ハッピーマンデー+春分/秋分)。
 *  振替休日・国民の休日は isJapanesePublicHoliday 側でこの一覧を基に判定する。
 *  対象期間の目安: 2000年～2099年(この範囲外は主要な固定日のみ有効)。 */
function fixedJapaneseHolidays(year) {
  const list = [
    [1, 1],   // 元日
    [2, 11],  // 建国記念の日
    [4, 29],  // 昭和の日
    [5, 3],   // 憲法記念日
    [5, 4],   // みどりの日
    [5, 5],   // こどもの日
    [8, 11],  // 山の日
    [11, 3],  // 文化の日
    [11, 23], // 勤労感謝の日
    [1, nthMondayOfMonth(year, 1, 2)],  // 成人の日(1月第2月曜)
    [7, nthMondayOfMonth(year, 7, 3)],  // 海の日(7月第3月曜)
    [9, nthMondayOfMonth(year, 9, 3)],  // 敬老の日(9月第3月曜)
    [10, nthMondayOfMonth(year, 10, 2)], // スポーツの日(10月第2月曜)
    [3, vernalEquinoxDay(year)],   // 春分の日
    [9, autumnalEquinoxDay(year)], // 秋分の日
  ];
  if (year >= 2020) list.push([2, 23]); // 天皇誕生日(2020年～)
  return list;
}

/** 指定した日付が日本の祝日(振替休日・国民の休日を含む)かどうかを判定する */
function isJapanesePublicHoliday(date) {
  const year = date.getFullYear();
  const toKey = (m, d) => `${m}-${d}`;
  const sameDate = (a, m, d) => a.getFullYear() === date.getFullYear() && a.getMonth() === m - 1 && a.getDate() === d;

  const collectHolidaySet = (y) => new Set(fixedJapaneseHolidays(y).map(([m, d]) => toKey(m, d)));
  const thisYearSet = collectHolidaySet(year);
  const key = toKey(date.getMonth() + 1, date.getDate());
  if (thisYearSet.has(key)) return true;

  // 振替休日: 祝日が日曜のとき、直後の祝日でない平日を休日とする
  const isFixedHoliday = (y, m, d) => collectHolidaySet(y).has(toKey(m, d));
  const prevDay = new Date(date);
  prevDay.setDate(prevDay.getDate() - 1);
  let cursor = new Date(prevDay);
  let cameFromSundayHoliday = false;
  // 直前の連続した祝日を遡り、その先頭が日曜日ならcursorの翌日(=date)は振替休日
  while (isFixedHoliday(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate())) {
    if (cursor.getDay() === 0) cameFromSundayHoliday = true;
    cursor.setDate(cursor.getDate() - 1);
  }
  if (cameFromSundayHoliday && date.getDay() !== 0) return true;

  // 国民の休日: 前日・翌日がともに祝日で、当日が日曜でも祝日でもない場合
  if (date.getDay() !== 0) {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    const prevIsHoliday = isFixedHoliday(prevDay.getFullYear(), prevDay.getMonth() + 1, prevDay.getDate());
    const nextIsHoliday = isFixedHoliday(nextDay.getFullYear(), nextDay.getMonth() + 1, nextDay.getDate());
    if (prevIsHoliday && nextIsHoliday) return true;
  }

  return false;
}

/** 曜日・祝日から既定の運行日区分を推定する(日曜・祝日はHoliday扱い) */
function defaultDayTypeFromDate(date) {
  const day = date.getDay(); // 0=日,6=土
  if (day === 0 || isJapanesePublicHoliday(date)) return "Holiday";
  if (day === 6) return "Saturday";
  return "weekday";
}

/** 現在言語の辞書エントリを取得する */
function t(key) {
  return I18N[state.language][key];
}

/** Line_Num値から表示色を決定する(1系統=青, 2系統・直通=赤, 空欄=グレー) */
function colorForLineNum(lineNum) {
  if (lineNum === "1") return ROUTES[1].color;
  if (lineNum === "2" || lineNum === "直通") return ROUTES[2].color;
  return NO_LINE_COLOR;
}

/** 系統番号を全角のゴシック表記に変換する(四角囲みバッジ用。"直通"等はそのまま返す) */
function toFullWidthLineNum(lineNum) {
  if (lineNum === "1") return "１";
  if (lineNum === "2") return "２";
  return lineNum;
}

/* =========================================================
   4. CSV読込・解析
   ========================================================= */

const FIXED_COLUMNS = ["Vehicle", "Types", "Operator", "train_id", "Line_Num", "Departure", "Destination", "Direction", "Date", "Note"];

/** CSVテキストを {stations, rows} に分解する。駅列はヘッダ名 "コード_駅名" から抽出する。 */
function parseCSVText(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { stations: [], rows: [] };

  const header = lines[0].split(",");
  const stations = [];
  for (let i = FIXED_COLUMNS.length; i < header.length; i++) {
    const raw = header[i].trim();
    if (!raw) continue;
    const m = raw.match(/^([A-Za-z]+)_(\d+)_?(.*)$/);
    if (!m) continue;
    stations.push({ code: `${m[1]}_${m[2]}`, name: m[3], colIndex: i });
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < FIXED_COLUMNS.length) continue;
    rows.push(cols);
  }
  return { stations, rows };
}

/** 駅名の前に付く駅コード表記("I_08_高見馬場"や表記揺れの"I_08高見馬場")を取り除き駅名のみ返す */
function stripStationPrefix(raw) {
  if (!raw) return "";
  const m = raw.trim().match(/^[A-Za-z]_?\d+_?(.*)$/);
  return m ? m[1] : raw.trim();
}

/** 停車駅配列(stops, 進行方向の順)から、出現～各駅停車～走行～消滅までの時刻テーブル(timeline)を作る。
 *  仕様:
 *   - 始発駅: 発車の60秒前に出現し、発車(=CSV記載時刻の0秒)まで停車状態
 *   - 途中駅: 発車の30秒前に到着(停車)し、発車まで停車状態
 *   - 終点  : CSV記載時刻ちょうどに到着し、その後60秒間だけ表示を継続
 *   - 駅間走行: 出発駅の発車時刻～次駅の到着時刻(上記ルールで算出)の間を走行中とする */
function buildTrainTimeline(stops) {
  const timeline = [];
  const lastIndex = stops.length - 1;

  const arrivalWindow = (index) => {
    const t = stops[index].timeSec;
    if (index === 0) return { start: t - TIMING.originAppearBefore, end: t };
    if (index === lastIndex) return { start: t, end: t + TIMING.terminusLingerAfter };
    return { start: t - TIMING.intermediateArriveBefore, end: t };
  };

  for (let i = 0; i <= lastIndex; i++) {
    const win = arrivalWindow(i);
    timeline.push({ type: "station", stopIndex: i, start: win.start, end: win.end });

    if (i < lastIndex) {
      const travelStart = stops[i].timeSec; // 発車(CSV時刻の0秒)
      const nextWin = arrivalWindow(i + 1);
      const travelEnd = Math.max(travelStart, nextWin.start); // 次駅の到着(=停車開始)時刻
      timeline.push({ type: "travel", fromIndex: i, toIndex: i + 1, start: travelStart, end: travelEnd });
    }
  }
  return timeline;
}

/** 解析済みCSVから列車オブジェクトの配列を生成する。stopsは時刻表の並び順=進行方向の順。
 *  sourceRoute: 空欄Line_Num時のアイコン色を決めるための、読み込み元系統番号。
 *  sourceFile : "001"/"002"(各系統固有ファイル) または "003"(直通ファイル)。 */
function buildTrains(parsed, sourceRoute, sourceFile) {
  const trains = [];
  for (const cols of parsed.rows) {
    const stops = [];
    for (const st of parsed.stations) {
      const raw = (cols[st.colIndex] || "").trim();
      if (raw === "") continue;
      const sec = timeToSeconds(raw);
      if (sec === null) continue;
      stops.push({ code: st.code, name: st.name, timeStr: raw, timeSec: sec });
    }
    if (stops.length < 2) continue; // 位置補間には最低2駅分の時刻が必要
    trains.push({
      vehicle: cols[0],
      types: cols[1],
      operator: cols[2],
      trainId: cols[3],
      lineNum: (cols[4] || "").trim(),
      departure: stripStationPrefix(cols[5]),
      destination: stripStationPrefix(cols[6]),
      direction: cols[7],
      date: cols[8],
      note: cols[9] || "",
      sourceRoute,
      sourceFile,
      stops,
      timeline: buildTrainTimeline(stops),
    });
  }
  return trains;
}

/** 003(直通)ファイルの上り・下りを読み込み、キャッシュして返す(路線への割り当て前の生データ)。
 *  直通列車は1系統トランク(鹿児島駅前～高見馬場)・2系統固有区間(加治屋町～中郡)・
 *  1系統固有区間(郡元(南側)～谷山)を通しで走るため、どちらの系統の画面にも顔を出す。 */
async function loadDirectTrainsRaw() {
  if (state.directTrainsRaw) return state.directTrainsRaw;
  const DIRECT_FILES = {
    down: "timetables/Kagoshima_city_tram/26_003_D_Timetable.csv",
    up: "timetables/Kagoshima_city_tram/26_003_U_Timetable.csv",
  };
  const [downText, upText] = await Promise.all([
    fetch(DIRECT_FILES.down).then((r) => r.text()),
    fetch(DIRECT_FILES.up).then((r) => r.text()),
  ]);
  const downParsed = parseCSVText(downText);
  const upParsed = parseCSVText(upText);
  state.directTrainsRaw = [
    ...buildTrains(downParsed, null, "003"),
    ...buildTrains(upParsed, null, "003"),
  ];
  return state.directTrainsRaw;
}

/** stops配列の各駅コードを、表示先の路線の駅コードへ読み替える(名前が一致しない駅はそのまま=非表示になる)。
 *  timeSec等は変わらないためtimelineの再計算は不要。 */
function remapStopsToRoute(stops, nameToCode) {
  return stops.map((s) => (nameToCode.has(s.name) ? { ...s, code: nameToCode.get(s.name) } : s));
}

/** 003の生データ(全区間分の停車駅・時刻)を、指定路線向けに駅コードだけ読み替えて複製する。 */
function buildDirectTrainsForRoute(rawDirectTrains, routeId) {
  const nameToCode = routeId === 1 ? LINE1_NAME_TO_CODE : LINE2_NAME_TO_CODE;
  return rawDirectTrains.map((tr) => ({
    ...tr,
    sourceRoute: routeId,
    stops: remapStopsToRoute(tr.stops, nameToCode),
  }));
}

/** 2系統(002ファイル)固有の上り・下りを読み込み、キャッシュして返す(路線への割り当て前の生データ)。 */
async function loadLine2OwnTrainsRaw() {
  if (state.line2OwnTrainsRaw) return state.line2OwnTrainsRaw;
  const route2 = ROUTES[2];
  const [downText, upText] = await Promise.all([
    fetch(route2.files.down).then((r) => r.text()),
    fetch(route2.files.up).then((r) => r.text()),
  ]);
  const downParsed = parseCSVText(downText);
  const upParsed = parseCSVText(upText);
  state.line2OwnTrainsRaw = [
    ...buildTrains(downParsed, 2, "002"),
    ...buildTrains(upParsed, 2, "002"),
  ];
  return state.line2OwnTrainsRaw;
}

/** 2系統の郡元発着列車(始発または終点が「郡元」の列車)を、1系統画面のI_16(郡元)に
 *  重ねて表示するための複製を作る。郡元発は下り線、郡元終点は上り線に強制する(directionを上書き)。
 *  郡元の停車イベント以外は駅コードをそのままにする(=1系統の路線図上ではそこだけ現れる)。
 *  直通(003)列車は郡元を経由しないため対象外(呼び出し元でline2の固有ファイルのみを渡す)。 */
function buildKogenPinTrainsForLine1(line2OwnTrains) {
  const KOGEN_CODE = "I_16";
  const pins = [];
  for (const tr of line2OwnTrains) {
    const lastIdx = tr.stops.length - 1;
    const isOriginKogen = tr.stops[0].name === "郡元";
    const isTerminusKogen = !isOriginKogen && tr.stops[lastIdx].name === "郡元";
    if (!isOriginKogen && !isTerminusKogen) continue;
    const pinIndex = isOriginKogen ? 0 : lastIdx;
    pins.push({
      ...tr,
      direction: isOriginKogen ? "down" : "up",
      stops: tr.stops.map((s, i) => (i === pinIndex ? { ...s, code: KOGEN_CODE } : s)),
    });
  }
  return pins;
}

/** 指定系統の上り・下りCSVを取得し、003(直通)の列車も読み替えて合流させ、キャッシュして返す。
 *  1系統には加えて、2系統の郡元発着列車をI_16に重ねて表示するための複製も合流させる。 */
async function loadRouteTrains(routeId) {
  if (state.trains[routeId]) return state.trains[routeId];
  const route = ROUTES[routeId];

  const ownTrains = routeId === 2
    ? await loadLine2OwnTrainsRaw()
    : await (async () => {
        const [downText, upText] = await Promise.all([
          fetch(route.files.down).then((r) => r.text()),
          fetch(route.files.up).then((r) => r.text()),
        ]);
        return [...buildTrains(parseCSVText(downText), 1, "001"), ...buildTrains(parseCSVText(upText), 1, "001")];
      })();

  const rawDirect = await loadDirectTrainsRaw();
  const directTrains = buildDirectTrainsForRoute(rawDirect, routeId);

  let trains = [...ownTrains, ...directTrains];
  if (routeId === 1) {
    const line2Own = await loadLine2OwnTrainsRaw();
    trains = [...trains, ...buildKogenPinTrainsForLine1(line2Own)];
  }

  // 表示中の路線図(route.stations)の並び順を、位置計算の正準順(canonical order)とする
  const canonicalOrder = route.stations.map((s) => s.code);
  state.trains[routeId] = { trains, canonicalOrder };
  return state.trains[routeId];
}

/* =========================================================
   5. 運行日・時刻ロジック
   ========================================================= */

/** 表示に使う「現在時刻」を秒で返す。
 *  再生中は基準時刻+実経過秒数、手動指定があればその固定値、どちらも無ければ実時刻を返す。 */
function getEffectiveNowSeconds() {
  if (state.isPlaying && state.playBase) {
    const elapsedSec = (Date.now() - state.playBase.realMs) / 1000;
    return state.playBase.simSec + elapsedSec;
  }
  return state.manualTime !== null ? state.manualTime : nowSecondsReal();
}

/** 選択中の運行日に合致する列車のみを抽出する */
function filterTrainsByDayType(trains, dayType) {
  return trains.filter((tr) => tr.date === dayType);
}

/** 列車のあるstop(駅)について、指定時刻が「通過済み/現在停車中/未到達」のどれかを判定する(モーダル表示用) */
function getStopStatus(train, stopIndex, nowSec) {
  const entry = train.timeline.find((e) => e.type === "station" && e.stopIndex === stopIndex);
  if (!entry) return "upcoming";
  if (nowSec >= entry.start && nowSec < entry.end) return "current";
  if (nowSec >= entry.end) return "passed";
  return "upcoming";
}

/* =========================================================
   6. 座標計算(位置予測)
   ========================================================= */

/** 列車のtimelineを見て、現在時刻における状態("station"/"segment"/null)を正準順の駅インデックスで求める。
 *  駅間を走行中は経過時間の前半/後半を区別せず、常に区間の中央に表示する(発車した駅のゾーンに重ならないように)。 */
function computeTrainPosition(train, canonicalOrder, nowSec) {
  const idx = (code) => canonicalOrder.indexOf(code);
  const timeline = train.timeline;
  if (!timeline.length) return null;
  if (nowSec < timeline[0].start || nowSec >= timeline[timeline.length - 1].end) return null;

  for (const entry of timeline) {
    if (nowSec < entry.start || nowSec >= entry.end) continue;

    if (entry.type === "station") {
      const code = train.stops[entry.stopIndex].code;
      const stationIndex = idx(code);
      if (stationIndex < 0) return null;
      return { type: "station", stationIndex, stopIndex: entry.stopIndex, eventTime: train.stops[entry.stopIndex].timeSec };
    }

    const fromCode = train.stops[entry.fromIndex].code;
    const toCode = train.stops[entry.toIndex].code;
    const canA = idx(fromCode);
    const canB = idx(toCode);
    if (canA < 0 || canB < 0) return null;

    const segmentIndex = Math.min(canA, canB);
    return { type: "segment", segmentIndex, eventTime: train.stops[entry.toIndex].timeSec };
  }
  return null;
}

/** 正準順インデックスの駅要素を基準に、当該駅の「上端」「下端」アンカーのY座標(px, train_body基準)を返す */
function getStationAnchorY(stationIndex) {
  const baseTop = getStationAnchorY._baseTop;
  const baseBottom = getStationAnchorY._baseBottom;
  return {
    top: baseTop + stationIndex * LAYOUT.cycle,
    bottom: baseBottom + stationIndex * LAYOUT.cycle,
  };
}

/** train_body内の最初の駅要素の実測位置を基準値として記録する(呼び出し前に必須) */
function primeCoordinateBaseline(trainBodyEl) {
  const bodyRect = trainBodyEl.getBoundingClientRect();
  const topEl = trainBodyEl.querySelector(".js-station-top-anchor");
  const bottomEl = trainBodyEl.querySelector(".js-station-bottom-anchor");
  if (!topEl || !bottomEl) return false;
  getStationAnchorY._baseTop = topEl.getBoundingClientRect().top - bodyRect.top;
  getStationAnchorY._baseBottom = bottomEl.getBoundingClientRect().top - bodyRect.top;
  getStationAnchorY._bodyWidth = bodyRect.width;
  return true;
}

/** 区間(駅と駅の間)の中央のY座標を返す(前半/後半の区別はせず、常に区間の中央に表示する) */
function getSegmentAnchorY(segmentIndex) {
  const anchor = getStationAnchorY(segmentIndex);
  return anchor.bottom + LAYOUT.stationCenter + LAYOUT.stationBottom + (LAYOUT.segmentTop + LAYOUT.segmentBottom) / 2;
}

/** 進行方向によって左右の走行レーンを分ける(上り=左寄り, 下り=右寄り) */
function getLaneX(direction) {
  const width = getStationAnchorY._bodyWidth || 0;
  const gap = width * 0.12;
  return direction === "up" ? width / 2 - gap : width / 2 + gap;
}

/** computeTrainPosition の結果を実際の画面座標{x,y}に変換する。
 *  上り(direction="up")は駅エリアの上半分(station_area_top ~ ●の直前)、
 *  下り(direction="down")は下半分(●の直後 ~ station_area_bottom)に停車位置を置く。 */
function positionToCoordinates(position, direction) {
  const x = getLaneX(direction);
  if (position.type === "station") {
    const anchor = getStationAnchorY(position.stationIndex);
    const y = direction === "up" ? anchor.top + LAYOUT.stationTop : anchor.bottom;
    return { x, y };
  }
  const y = getSegmentAnchorY(position.segmentIndex);
  return { x, y };
}

/** 同一アンカーに複数列車が重なる場合のグループ化キー(方向が違えばレーンも違うため別グループ) */
function anchorKey(position, direction) {
  return position.type === "station"
    ? `station-${position.stationIndex}-${direction}`
    : `segment-${position.segmentIndex}-${direction}`;
}

/** 重なり順が2番目以降の列車を、進行方向に沿って少しずらす(時刻の遅い列車ほど後ろ=外側) */
function applyStackOffset(coords, direction, stackIndex) {
  if (stackIndex === 0) return coords;
  const sign = direction === "up" ? -1 : 1;
  return { x: coords.x, y: coords.y + sign * STACK_OFFSET_PX * stackIndex };
}

/* =========================================================
   7. DOM生成・描画
   ========================================================= */

/** 路線選択画面のカード一覧を生成する */
function renderRouteSelect() {
  const list = document.getElementById("routeCardList");
  list.innerHTML = "";

  Object.values(ROUTES).forEach((route) => {
    const card = document.createElement("div");
    card.className = "route_card";
    card.style.setProperty("--route-color", route.color);

    const name = state.language === "ja" ? route.nameJa : route.nameEn;
    const from = state.language === "ja" ? route.fromJa : route.fromEn;
    const to = state.language === "ja" ? route.toJa : route.toEn;
    const via = route.viaJa ? (state.language === "ja" ? route.viaJa : route.viaEn) : null;
    const sectionText = via ? `${from} ～ (${via}) ～ ${to}` : `${from} ～ ${to}`;

    card.innerHTML = `
      <span class="route_card_badge">${toFullWidthLineNum(String(route.id))}</span>
      <div class="route_card_main">
        <div class="route_card_head">
          <span class="route_card_name">${name}</span>
          ${!route.implemented ? `<span class="route_card_tag">${t("comingSoonTag")}</span>` : ""}
        </div>
        <div class="route_card_section">${sectionText}</div>
        <div class="route_card_note">${t("sharedNote")}</div>
      </div>
      <button type="button" class="route_card_action" data-route-id="${route.id}">${t("viewRoute")}</button>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll(".route_card_action").forEach((btn) => {
    btn.addEventListener("click", () => onRouteCardClicked(Number(btn.dataset.routeId)));
  });
}

/** 路線カードが押されたときの処理。実装済みの系統の詳細画面へ遷移する。 */
function onRouteCardClicked(routeId) {
  const route = ROUTES[routeId];
  if (!route.implemented) {
    showToast(t("comingSoonToast"));
    return;
  }
  switchView(routeId);
}

/** 駅ブロック1件分のDOMを生成する。
 *  真の終点(isFirst/isLastかつリンクなし)は連結線を描かず、駅の●で線が止まって見えるようにする。
 *  それ以外の先頭/末尾(2系統画面の天文館通・中郡など)は、線はそのまま伸ばしつつ、
 *  もう一方の画面へのリンクボタン(topLink/bottomLink)を表示する。
 *  もう一方の系統との共用区間に接する側には、その系統色の線を重ねるための --overlap クラスを付与する。 */
function createStationBlock(station, index, opts) {
  const { isFirst, isLast, topOverlap, bottomOverlap, topLink, bottomLink } = opts;
  const isTrueTerminusTop = isFirst && !topLink;
  const isTrueTerminusBottom = isLast && !bottomLink;
  const wrap = document.createElement("div");
  wrap.className = "station_area";

  const top = document.createElement("div");
  top.className = "station_area_top" + (index === 0 ? " js-station-top-anchor" : "") + (topOverlap ? " station_area_top--overlap" : "");
  if (topLink) {
    top.innerHTML = '<div class="boder"></div>' +
      `<button type="button" class="edge_link_btn edge_link_btn--top"><i class="fa-solid fa-chevron-up"></i><span>${topLink.label}</span></button>`;
    top.querySelector(".edge_link_btn").addEventListener("click", topLink.onClick);
  } else {
    top.innerHTML = isTrueTerminusTop ? "" : '<div class="boder"></div>';
  }

  const center = document.createElement("div");
  const overlapClass = topOverlap || bottomOverlap ? " station_center--overlap" : "";
  const terminusClass = (isTrueTerminusTop ? " station_center--terminus-top" : "") + (isTrueTerminusBottom ? " station_center--terminus-bottom" : "");
  center.className = "station_center" + overlapClass + terminusClass;
  const hasTransfer = Object.prototype.hasOwnProperty.call(TRANSFER_INFO, station.ja);
  center.innerHTML = `
    <div class="boder station_center_line"></div>
    <div class="station_text">
      <div class="station_name">
        <span>${state.language === "ja" ? station.ja : station.en}</span>
      </div>
      <div class="station_links_row">
        ${hasTransfer ? `<button type="button" class="station_link_btn" data-link="transfer" title="${t("transferLabel")}"><i class="fa-solid fa-train-subway"></i></button>` : ""}
        <button type="button" class="station_link_btn" data-link="timetable" title="${t("timetableLabel")}"><i class="fa-regular fa-clock"></i></button>
        <button type="button" class="station_link_btn" data-link="display" title="${t("displayModeLabel")}"><i class="fa-solid fa-display"></i></button>
      </div>
    </div>
    <div class="station_point_out"><div class="station_point_in"></div></div>
  `;

  const bottom = document.createElement("div");
  bottom.className = "station_area_bottom" + (index === 0 ? " js-station-bottom-anchor" : "") + (bottomOverlap ? " station_area_bottom--overlap" : "");
  if (bottomLink) {
    bottom.innerHTML = '<div class="boder"></div>' +
      `<button type="button" class="edge_link_btn edge_link_btn--bottom"><i class="fa-solid fa-chevron-down"></i><span>${bottomLink.label}</span></button>`;
    bottom.querySelector(".edge_link_btn").addEventListener("click", bottomLink.onClick);
  } else {
    bottom.innerHTML = isTrueTerminusBottom ? "" : '<div class="boder"></div>';
  }

  wrap.appendChild(top);
  wrap.appendChild(center);
  wrap.appendChild(bottom);

  const transferBtn = center.querySelector('.station_link_btn[data-link="transfer"]');
  transferBtn?.addEventListener("click", (e) => showTransferMenu(station, e.currentTarget));
  const timetableBtn = center.querySelector('.station_link_btn[data-link="timetable"]');
  timetableBtn?.addEventListener("click", (e) => showTimetableMenu(station, e.currentTarget));
  const displayBtn = center.querySelector('.station_link_btn[data-link="display"]');
  displayBtn?.addEventListener("click", () => showToast(t("featureComingSoonToast")));

  return wrap;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** 分岐点のインジケータを生成する。自路線の線はそのまま直進させ、その左側からもう一方の系統色の
 *  細い線(共用区間からの続き)が、太さ3px→8px(本線と同じ太さ)へなめらかにテーパーする1枚の
 *  塗りつぶし帯として始まり、本線の下をくぐって右へカーブしたあと、画面右端近くまでまっすぐ
 *  伸びる。帯を単一パスにすることで、カーブ~直線の継ぎ目に太さの段差が出ないようにしている。
 *  右端に残した「◯系統」ラベルはもう一方の路線ページへのリンクとしてクリック可能にする。 */
function createBranchIndicator(label, onLabelClick) {
  const wrap = document.createElement("div");
  wrap.className = "branch_indicator";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "branch_indicator_svg");
  svg.setAttribute("viewBox", "0 0 100 34");
  svg.setAttribute("preserveAspectRatio", "none");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M43,0 C43,12 50,16 62,16 L88,16 L88,24 L62,24 C50,24 46,14 46,0 Z");
  svg.appendChild(path);

  const labelBtn = document.createElement("button");
  labelBtn.type = "button";
  labelBtn.className = "branch_indicator_label";
  labelBtn.textContent = label;
  labelBtn.addEventListener("click", onLabelClick);

  wrap.appendChild(svg);
  wrap.appendChild(labelBtn);
  return wrap;
}

/** 駅と駅の間の区間DOMを生成する(共用区間の場合は線を重ね、分岐点の場合は分岐帯を添える) */
function createSegmentBlock(isOverlap, hasBranch, otherRouteId) {
  const seg = document.createElement("div");
  seg.className = "segment" + (isOverlap ? " segment--overlap" : "");
  seg.innerHTML = '<div class="boder"></div><div class="segment_top"></div><div class="segment_bottom"></div>';
  if (hasBranch) {
    const label = state.language === "ja" ? ROUTES[otherRouteId].nameJa : ROUTES[otherRouteId].nameEn;
    seg.appendChild(createBranchIndicator(label, () => onRouteCardClicked(otherRouteId)));
  }
  return seg;
}

/** 表示中の系統の路線図(駅+区間の縦並び)を生成し、train_body要素へ挿入する */
function renderLineDiagram() {
  const route = ROUTES[state.currentRouteId];
  const stations = route.stations;
  const body = document.getElementById("trainBody");
  body.innerHTML = "";
  body.style.setProperty("--route-color", route.color);
  body.style.setProperty("--overlay-color", ROUTES[route.otherRouteId].color);

  const lastIndex = stations.length - 1;
  const branchPoints = route.branchPoints || [];
  const edgeLinks = route.edgeLinks || {};

  stations.forEach((station, i) => {
    const prevOverlap = i > 0 && isOverlapSegment(route, stations[i - 1].code, station.code);
    const nextOverlap = i < lastIndex && isOverlapSegment(route, station.code, stations[i + 1].code);
    const branch = branchPoints.find((bp) => bp.afterCode === station.code);
    // 分岐帯へ滑らかにつながるよう、分岐直前の駅では●・下側スタブにも重ね線を表示する
    const bottomOverlapVisual = nextOverlap || !!branch;

    const topLink = i === 0 && edgeLinks.top
      ? { label: t("backToLine1"), onClick: () => switchView(edgeLinks.top) }
      : null;
    const bottomLink = i === lastIndex && edgeLinks.bottom
      ? { label: t("backToLine1"), onClick: () => switchView(edgeLinks.bottom) }
      : null;

    body.appendChild(
      createStationBlock(station, i, {
        isFirst: i === 0,
        isLast: i === lastIndex,
        topOverlap: prevOverlap,
        bottomOverlap: bottomOverlapVisual,
        topLink,
        bottomLink,
      })
    );
    if (i < lastIndex) body.appendChild(createSegmentBlock(nextOverlap, !!branch, branch?.otherRouteId));
  });

  document.getElementById("directionUpLabel").textContent = t("directionUp")(
    state.language === "ja" ? stations[0].ja : stations[0].en
  );
  document.getElementById("directionDownLabel").textContent = t("directionDown")(
    state.language === "ja" ? stations[lastIndex].ja : stations[lastIndex].en
  );
}

/** 先頭駅/最終駅が画面内に見えている間は、それぞれの固定方面表示を隠す(駅名との重なりを防ぐ) */
function updateDirectionLabelVisibility() {
  if (state.view !== "line") return;
  const areas = document.querySelectorAll(".station_area");
  if (!areas.length) return;

  const header = document.getElementById("trainHeader");
  const headerBottom = header.getBoundingClientRect().bottom;
  const viewportBottom = window.innerHeight;

  const firstRect = areas[0].getBoundingClientRect();
  const lastRect = areas[areas.length - 1].getBoundingClientRect();

  const upLabel = document.querySelector(".map_direction_up");
  const downLabel = document.querySelector(".map_direction_down");
  if (upLabel) upLabel.classList.toggle("is-hidden", firstRect.bottom > headerBottom && firstRect.top < viewportBottom);
  if (downLabel) downLabel.classList.toggle("is-hidden", lastRect.bottom > headerBottom && lastRect.top < viewportBottom);
}

/** 列車マーカー1件のDOMを生成する。支給された列車アイコン(SVG)を系統番号に応じて使い分ける。
 *  上り(▲)はアイコンの上、下り(▼)はアイコンの下に表示する。 */
function createTrainMarkerEl(train, coords) {
  const el = document.createElement("div");
  el.className = "train_marker";
  el.style.left = `${coords.x}px`;
  el.style.top = `${coords.y}px`;
  el.style.setProperty("--marker-color", colorForLineNum(train.lineNum)); // 方向キャレットの色に使用

  const iconPath = iconPathForTrain(train);
  const caretClass = train.direction === "up" ? "fa-caret-up is-up" : "fa-caret-down is-down";

  el.innerHTML = `
    <i class="fa-solid ${caretClass} train_marker_caret"></i>
    <img class="train_marker_icon" src="${iconPath}" alt="${train.lineNum || ""}" draggable="false">
  `;
  el.addEventListener("click", (e) => openTrainModal(train, e.currentTarget));
  return el;
}

/** 現在時刻に基づき、路線図上の全列車マーカーを再描画する。
 *  同一アンカーに複数列車が重なる場合は、時刻の遅い列車ほど外側へずらして表示する。 */
function updateTrainMarkers() {
  const body = document.getElementById("trainBody");
  body.querySelectorAll(".train_marker").forEach((el) => el.remove());
  if (!primeCoordinateBaseline(body)) return;

  const data = state.trains[state.currentRouteId];
  if (!data) return;

  const nowSec = getEffectiveNowSeconds();
  const trains = filterTrainsByDayType(data.trains, state.dayType);

  const placed = [];
  trains.forEach((train) => {
    const position = computeTrainPosition(train, data.canonicalOrder, nowSec);
    if (position) placed.push({ train, position });
  });

  const groups = new Map();
  placed.forEach((item) => {
    const key = anchorKey(item.position, item.train.direction);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  groups.forEach((group) => {
    group.sort((a, b) => a.position.eventTime - b.position.eventTime);
    group.forEach((item, stackIndex) => {
      const baseCoords = positionToCoordinates(item.position, item.train.direction);
      const coords = applyStackOffset(baseCoords, item.train.direction, stackIndex);
      body.appendChild(createTrainMarkerEl(item.train, coords));
    });
  });
}

/* =========================================================
   8. モーダル・トースト
   ========================================================= */

/** 列車アイコンタップ時、その列車の詳細(種別・始発・終点・各駅発車時刻等)を吹き出しで表示する。
 *  系統は四角バッジで示すため「系統」欄は出さない。あくまで時刻表からの予測のため断定表示は避け、
 *  各駅時刻一覧では通過済みを薄く、現在停車中の駅をオレンジで強調したうえで、その行が最初から見えるようスクロールする。 */
function openTrainModal(train, anchorEl) {
  state.activeTrainForModal = train;
  const body = document.getElementById("modalBody");
  const color = colorForLineNum(train.lineNum);
  const typeLabel = train.types === "local" ? t("typeLocal") : (TYPE_LABEL[train.types] || train.types);
  const nowSec = getEffectiveNowSeconds();

  const stationLabel = (code, fallbackName) => {
    const def = ALL_STATIONS_BY_NAME.get(fallbackName);
    return def ? (state.language === "ja" ? def.ja : def.en) : fallbackName;
  };

  const stationRows = train.stops
    .map((s, i) => {
      const label = stationLabel(s.code, s.name);
      const status = getStopStatus(train, i, nowSec);
      return `<div class="modal_station_row is-${status}" data-stop-index="${i}"><span>${label}</span><span>${s.timeStr}</span></div>`;
    })
    .join("");

  // 系統番号が空欄(003ファイルの一部列車)の場合はバッジ自体を表示せず、行き先を一番左に詰める
  const badgeHtml = train.lineNum
    ? `<span class="modal_badge" style="--modal-line-color:${color}">${toFullWidthLineNum(train.lineNum)}</span>`
    : "";

  body.innerHTML = `
    <div class="modal_title">
      ${badgeHtml}
      <span>${train.destination}${state.language === "ja" ? '<span class="modal_title_suffix"> 行</span>' : ""}</span>
    </div>
    <div class="modal_row"><span>${t("modalType")}</span><span>${typeLabel}</span></div>
    <div class="modal_row"><span>${t("modalDeparture")}</span><span>${train.departure}</span></div>
    <div class="modal_row"><span>${t("modalDestination")}</span><span>${train.destination}</span></div>
    ${train.note ? `<div class="modal_row"><span>${t("modalNote")}</span><span>${train.note}</span></div>` : ""}
    <div class="modal_row" style="border-bottom:none;padding-top:10px;"><span>${t("modalStations")}</span><span></span></div>
    <div class="modal_station_list" id="modalStationList">${stationRows}</div>
  `;
  document.getElementById("trainModal").classList.remove("is-hidden");
  positionModalBubble(anchorEl);

  // 行き先(モーダルの先頭)が常に見えるよう、外側のモーダル本体は必ず一番上までスクロールを戻す。
  const box = document.getElementById("modalBox");
  box.scrollTop = 0;

  // 開いた直後は、今後最初に到着する(または現在到着中の)駅の行が一覧の一番上に来るようにする。
  // 終点付近で残りの行が5行に満たない場合は、スクロール上限により自然と一番下が終点になる。
  // (scrollIntoViewは外側のmodal_boxまで巻き込んでスクロールさせてしまい、行き先が隠れることが
  //  あったため、内側のmodal_station_listだけを対象にscrollTopを直接計算する。)
  const list = document.getElementById("modalStationList");
  const currentRow = list.querySelector(".modal_station_row.is-current");
  const targetRow = currentRow || list.querySelector(".modal_station_row.is-upcoming") || list.lastElementChild;
  if (targetRow) {
    const listRect = list.getBoundingClientRect();
    const rowRect = targetRow.getBoundingClientRect();
    list.scrollTop += rowRect.top - listRect.top;
  }
}

/** 列車情報の吹き出しを、タップされたアイコンの近くに配置する。
 *  画面から見切れないよう、アイコンの上下どちらに余裕があるかで配置側を決めたうえで、
 *  その側の実際の余白に収まる高さへ動的に上限を設定する(横方向も画面内にクランプする)。 */
function positionModalBubble(anchorEl) {
  const box = document.getElementById("modalBox");
  box.classList.remove("bubble-above", "bubble-below");
  box.style.maxHeight = "";
  if (!anchorEl) {
    box.style.left = "50%";
    box.style.top = "50%";
    box.style.transform = "translate(-50%,-50%)";
    return;
  }

  const rect = anchorEl.getBoundingClientRect();
  const margin = 12;
  const boxWidth = Math.min(320, window.innerWidth - margin * 2);
  const centerX = rect.left + rect.width / 2;
  const clampedLeft = Math.min(Math.max(centerX, margin + boxWidth / 2), window.innerWidth - margin - boxWidth / 2);

  const spaceAbove = rect.top - margin * 2;
  const spaceBelow = window.innerHeight - rect.bottom - margin * 2;
  const placeAbove = spaceAbove > spaceBelow;
  const availableSpace = Math.max(spaceAbove, spaceBelow);

  box.style.width = `${boxWidth}px`;
  box.style.left = `${clampedLeft}px`;
  box.style.transform = "translateX(-50%)";
  // 選んだ側の実余白を超えないよう上限を付け、画面外へのはみ出しを防ぐ(最低限の高さは確保する)。
  box.style.maxHeight = `${Math.max(160, Math.min(availableSpace, window.innerHeight - margin * 2))}px`;
  if (placeAbove) {
    box.style.top = "auto";
    box.style.bottom = `${window.innerHeight - rect.top + margin}px`;
    box.classList.add("bubble-above");
  } else {
    box.style.bottom = "auto";
    box.style.top = `${rect.bottom + margin}px`;
    box.classList.add("bubble-below");
  }
  // 吹き出しの三角(tail)をアイコンの真上/真下に近づける
  const tailOffset = centerX - clampedLeft;
  box.style.setProperty("--bubble-tail-offset", `${tailOffset}px`);
}

/* ---------------------------------------------------------
   駅ボタン(乗り換え案内・時刻表URL選択)のポップアップメニュー
   --------------------------------------------------------- */
let stationMenuEl = null;
function closeStationMenu() {
  stationMenuEl?.remove();
  stationMenuEl = null;
}

/** アイコンボタンの近くに小さなメニュー(ボタン一覧)を表示する共通処理。
 *  item.showChevron を立てると、項目の右端に「>」を表示する(クリックして遷移する項目向け)。 */
function openStationMenu(className, items, anchorEl) {
  closeStationMenu();
  const menu = document.createElement("div");
  menu.className = className;
  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "station_menu_item";
    btn.innerHTML = `<span>${item.label}</span>` + (item.showChevron ? '<i class="fa-solid fa-chevron-right"></i>' : "");
    if (item.disabled) btn.disabled = true;
    else btn.addEventListener("click", () => { item.onClick(); closeStationMenu(); });
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  stationMenuEl = menu;

  const rect = anchorEl.getBoundingClientRect();
  const margin = 8;
  const menuRect = menu.getBoundingClientRect();
  const left = Math.min(Math.max(rect.left, margin), window.innerWidth - menuRect.width - margin);
  const spaceBelow = window.innerHeight - rect.bottom;
  const placeBelow = spaceBelow > menuRect.height + margin || spaceBelow > rect.top;
  menu.style.left = `${left}px`;
  if (placeBelow) {
    menu.style.top = `${rect.bottom + 6}px`;
  } else {
    menu.style.top = `${Math.max(margin, rect.top - menuRect.height - 6)}px`;
  }
}

document.addEventListener("click", (e) => {
  if (!stationMenuEl) return;
  if (stationMenuEl.contains(e.target)) return;
  if (e.target.closest('[data-link="transfer"],[data-link="timetable"]')) return;
  closeStationMenu();
});

/** 乗り換えボタンの処理。乗り換え路線が定義されている駅のみボタンが表示される。
 *  時刻表ボタンと同様、アイコンの近くに一覧を表示する(乗り換え先へのリンクは無いため項目はタップ不可)。 */
function showTransferMenu(station, anchorEl) {
  const info = TRANSFER_INFO[station.ja];
  if (!info) {
    showToast(t("transferNoInfoToast"));
    return;
  }
  const lines = state.language === "ja" ? info.ja : info.en;
  openStationMenu(
    "station_transfer_menu",
    lines.map((line) => ({ label: line, disabled: true })),
    anchorEl
  );
}

/** 時刻表ボタンの処理。駅ごとに用意された複数のURL(系統別など)から選んで開く(URL自体は運用担当者が設定)。 */
function showTimetableMenu(station, anchorEl) {
  const entries = timetableEntriesFor(station.ja);
  openStationMenu(
    "station_timetable_menu",
    entries.map(({ label, url }) => ({
      label,
      showChevron: true,
      onClick: () => {
        if (!url) { showToast(t("timetableUrlUnsetToast")); return; }
        window.open(url, "_blank", "noopener");
      },
    })),
    anchorEl
  );
}

function closeTrainModal() {
  document.getElementById("trainModal").classList.add("is-hidden");
  state.activeTrainForModal = null;
}

let toastTimer = null;
/** 画面下部に短時間だけメッセージを表示する(「準備中」通知などに使用) */
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("is-hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("is-hidden"), 2600);
}

/* =========================================================
   9. イベントハンドラ / 画面切替
   ========================================================= */

/** ヘッダの高さをCSS変数に反映する(操作パネルの表示/非表示で高さが変わるため都度呼び出す) */
function syncHeaderHeight() {
  const header = document.getElementById("trainHeader");
  document.documentElement.style.setProperty("--header-height", `${header.offsetHeight}px`);
}

/** 画面(路線選択/路線詳細)を切り替える。"select"以外を渡すと、その系統IDの詳細画面を表示する。 */
function switchView(target) {
  const isLine = target !== "select";
  state.view = isLine ? "line" : "select";
  state.currentRouteId = isLine ? target : null;
  closeStationMenu();

  document.getElementById("viewSelect").classList.toggle("is-hidden", isLine);
  document.getElementById("viewLine").classList.toggle("is-hidden", !isLine);
  document.getElementById("backButton").classList.toggle("is-hidden", !isLine);
  document.getElementById("controlPanel").classList.toggle("is-hidden", !isLine);

  syncHeaderHeight();

  if (isLine) {
    const routeId = state.currentRouteId;
    renderLineDiagram();
    requestAnimationFrame(updateDirectionLabelVisibility);
    loadRouteTrains(routeId).then(() => {
      if (state.currentRouteId !== routeId) return; // 読み込み中に別路線へ切り替わっていたら反映しない
      requestAnimationFrame(() => {
        syncHeaderHeight();
        updateTrainMarkers();
      });
    });
    startLiveClock();
  } else {
    stopLiveClock();
  }
}

/** ライブ時計(手動指定が無いときに一定間隔で現在時刻へ更新する)を開始する */
function startLiveClock() {
  stopLiveClock();
  state.liveTimer = setInterval(() => {
    if (state.manualTime !== null) return; // 手動指定中は自動更新しない
    document.getElementById("timeInput").value = secondsToHHMM(nowSecondsReal());
    updateTrainMarkers();
  }, REFRESH_INTERVAL_MS);
}
function stopLiveClock() {
  if (state.liveTimer) clearInterval(state.liveTimer);
  state.liveTimer = null;
}

/** 再生中、1秒おきに時刻表示とマーカーを更新する(現在時刻ライブ更新の30秒間隔より細かく動かすため) */
function startPlaybackTicker() {
  stopPlaybackTicker();
  state.playTimer = setInterval(() => {
    document.getElementById("timeInput").value = secondsToHHMM(Math.floor(getEffectiveNowSeconds()));
    updateTrainMarkers();
  }, 1000);
}
function stopPlaybackTicker() {
  if (state.playTimer) clearInterval(state.playTimer);
  state.playTimer = null;
}

/** 再生ボタンの表示(アイコン・ラベル)を再生状態・現在言語に合わせて更新する */
function updatePlayButtonUI() {
  const icon = document.getElementById("playButtonIcon");
  const label = document.getElementById("playButtonLabel");
  icon.className = state.isPlaying ? "fa-solid fa-stop" : "fa-solid fa-play";
  label.textContent = state.isPlaying ? t("pauseButton") : t("playButton");
}

/** 再生ボタンの処理。手動指定した時刻を起点に、実時間の経過と同じ速さで時刻を進める(もう一度押すと停止)。 */
function togglePlay() {
  if (state.isPlaying) {
    state.manualTime = Math.floor(getEffectiveNowSeconds()) % 86400;
    state.isPlaying = false;
    state.playBase = null;
    stopPlaybackTicker();
    startLiveClock();
  } else {
    const base = state.manualTime !== null ? state.manualTime : nowSecondsReal();
    state.playBase = { simSec: base, realMs: Date.now() };
    state.isPlaying = true;
    stopLiveClock();
    startPlaybackTicker();
  }
  updatePlayButtonUI();
  updateNowButtonVisibility();
}

/** 「現在時刻に戻す」ボタンの表示/非表示を切り替える。時刻を現在時刻から変更している(手動指定
 *  または再生中の)ときだけ表示し、実際の現在時刻を追従している間は表示しない。 */
function updateNowButtonVisibility() {
  const isDeviatedFromNow = state.manualTime !== null || state.isPlaying;
  document.getElementById("nowButton").classList.toggle("is-hidden", !isDeviatedFromNow);
}

/** 運行日セレクトの表示テキストを現在の言語に合わせて更新する */
function applyDayTypeOptionLabels() {
  const select = document.getElementById("dayTypeSelect");
  select.querySelector('option[value="weekday"]').textContent = t("dayWeekday");
  select.querySelector('option[value="Saturday"]').textContent = t("daySaturday");
  select.querySelector('option[value="Holiday"]').textContent = t("dayHoliday");
}

/** data-i18n属性を持つ要素のテキストを現在の言語で置き換える */
function applyStaticI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (I18N[state.language][key] !== undefined) el.textContent = t(key);
  });
  document.title = t("siteTitle");
  applyDayTypeOptionLabels();
}

/** 言語切替ボタンの処理。JP⇔ENを切り替えて画面全体を再描画する。 */
function toggleLanguage() {
  state.language = state.language === "ja" ? "en" : "ja";
  localStorage.setItem("transit_lang", state.language);
  document.documentElement.lang = state.language;
  document.getElementById("langButtonLabel").textContent = state.language === "ja" ? "EN" : "JP";
  applyStaticI18n();
  updatePlayButtonUI();
  renderRouteSelect();
  if (state.view === "line") {
    renderLineDiagram();
    requestAnimationFrame(() => {
      syncHeaderHeight();
      updateTrainMarkers();
      updateDirectionLabelVisibility();
    });
  }
  closeTrainModal();
}

/** 実際に適用する配色("light"/"dark")を、ユーザー設定とOS設定から決定する */
function resolveEffectiveTheme() {
  if (state.themePreference === "auto") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return state.themePreference;
}

/** <html>のdata-theme属性を更新し、テーマボタンのアイコンを合わせて切り替える */
function applyTheme() {
  const effective = resolveEffectiveTheme();
  document.documentElement.setAttribute("data-theme", effective);
  const icon = document.getElementById("themeButtonIcon");
  icon.className =
    state.themePreference === "auto"
      ? "fa-solid fa-circle-half-stroke"
      : state.themePreference === "light"
      ? "fa-solid fa-sun"
      : "fa-solid fa-moon";
}

/** テーマ切替ボタンの処理。auto→light→dark→auto…の順に循環させる。 */
function cycleTheme() {
  state.themePreference =
    state.themePreference === "auto" ? "light" : state.themePreference === "light" ? "dark" : "auto";
  localStorage.setItem("transit_theme", state.themePreference);
  applyTheme();
}

/** 運行日・時刻の操作パネルの値が変わったときに呼び出す(手動モードへ切り替え、即時再描画)。
 *  再生中にユーザーが時刻/運行日を変更した場合は、再生を止めてその新しい値を基準にする。 */
function onControlPanelChanged() {
  if (state.isPlaying) {
    state.isPlaying = false;
    state.playBase = null;
    stopPlaybackTicker();
    startLiveClock();
    updatePlayButtonUI();
  }
  const daySelect = document.getElementById("dayTypeSelect");
  const timeInput = document.getElementById("timeInput");
  state.dayType = daySelect.value;
  state.manualTime = timeInput.value ? timeToSeconds(timeInput.value + ":00") : null;
  updateTrainMarkers();
  updateNowButtonVisibility();
}

/** 「現在時刻に戻す」ボタンの処理。再生・手動指定を解除し、実際の現在時刻・運行日に復帰する。 */
function resetToNow() {
  const now = new Date();
  state.isPlaying = false;
  state.playBase = null;
  stopPlaybackTicker();
  state.manualTime = null;
  state.dayType = defaultDayTypeFromDate(now);
  document.getElementById("dayTypeSelect").value = state.dayType;
  document.getElementById("timeInput").value = secondsToHHMM(nowSecondsReal());
  updatePlayButtonUI();
  startLiveClock();
  updateTrainMarkers();
  updateNowButtonVisibility();
}

/* =========================================================
   10. 初期化
   ========================================================= */

function initEventListeners() {
  document.getElementById("backButton").addEventListener("click", () => switchView("select"));
  document.getElementById("langButton").addEventListener("click", toggleLanguage);
  document.getElementById("themeButton").addEventListener("click", cycleTheme);
  document.getElementById("dayTypeSelect").addEventListener("change", onControlPanelChanged);
  document.getElementById("timeInput").addEventListener("change", onControlPanelChanged);
  document.getElementById("nowButton").addEventListener("click", resetToNow);
  document.getElementById("playButton").addEventListener("click", togglePlay);
  document.getElementById("modalCloseButton").addEventListener("click", closeTrainModal);
  document.getElementById("trainModal").addEventListener("click", (e) => {
    if (e.target.id === "trainModal") closeTrainModal();
  });
  window.addEventListener("resize", () => {
    syncHeaderHeight();
    if (state.view === "line") {
      updateTrainMarkers();
      updateDirectionLabelVisibility();
    }
  });
  // スクロールで先頭/最終駅が見えたら、対応する固定方面表示を隠す
  window.addEventListener("scroll", updateDirectionLabelVisibility, { passive: true });
  // OSの配色設定が変化した場合、"auto"設定中であれば追従する
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (state.themePreference === "auto") applyTheme();
  });
}

/** アプリ起動時の初期化処理 */
function init() {
  // 言語・テーマの保存済み設定を復元
  state.language = localStorage.getItem("transit_lang") || "ja";
  state.themePreference = localStorage.getItem("transit_theme") || "auto";
  document.documentElement.lang = state.language;
  document.getElementById("langButtonLabel").textContent = state.language === "ja" ? "EN" : "JP";

  const now = new Date();
  state.dayType = defaultDayTypeFromDate(now);
  document.getElementById("dayTypeSelect").value = state.dayType;
  document.getElementById("timeInput").value = secondsToHHMM(nowSecondsReal());

  applyTheme();
  applyStaticI18n();
  updatePlayButtonUI();
  updateNowButtonVisibility();
  renderRouteSelect();
  initEventListeners();
  syncHeaderHeight();
  switchView("select");
}

document.addEventListener("DOMContentLoaded", init);
