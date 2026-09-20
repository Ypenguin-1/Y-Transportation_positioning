/* =========================================================
   列車・バス位置情報システム JS
   時刻表(CSV)を読み込み、指定した時刻における列車のおおよその
   位置を路線図上に描画する。実際のGPS位置情報は使用していない。

   構成:
    1. 定数・設定(路線データ/多言語辞書/アイコン対応表)
    2. 状態管理(state)
    3. ユーティリティ関数(時刻変換など)
    4. CSV読込・解析
    5. 運行日・時刻ロジック
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

/** 1系統・高見馬場までは2系統と共用区間であることを示す駅コード */
const LINE1_SHARED_WITH_LINE2 = ["I_01", "I_02", "I_03", "I_04", "I_05", "I_06", "I_07", "I_08"];

/** 路線メタ情報。色は仕様書指定の値、Line_Numが空欄の列車は NO_LINE_COLOR で表示する。 */
const ROUTES = {
  1: {
    id: 1,
    color: "#1F3DFF",
    nameJa: "1系統", nameEn: "Line 1",
    fromJa: "鹿児島駅前", fromEn: "Kagoshima-ekimae",
    toJa: "谷山", toEn: "Tanyama",
    files: {
      down: "timetables/Kagoshima_city_tram/26_001_D_Timetable.csv",
      up: "timetables/Kagoshima_city_tram/26_001_U_Timetable.csv",
    },
    implemented: true,
  },
  2: {
    id: 2,
    color: "#FF362E",
    nameJa: "2系統", nameEn: "Line 2",
    fromJa: "天文館通", fromEn: "Tenmonkan-dori",
    viaJa: "鹿児島中央駅前", viaEn: "Kagoshima-chuo Station",
    toJa: "中郡", toEn: "Nakagori",
    files: {
      down: "timetables/Kagoshima_city_tram/26_002_D_Timetable.csv",
      up: "timetables/Kagoshima_city_tram/26_002_U_Timetable.csv",
    },
    implemented: false, // 今回は1系統のみ実装。今後の拡張用に定義だけ用意しておく。
  },
};

const NO_LINE_COLOR = "#EDEDED";

/** Vehicle列の値 → Font Awesome アイコンクラス(絵文字は使用しない) */
const VEHICLE_ICON_CLASS = {
  tram: "fa-solid fa-train-tram",
  train: "fa-solid fa-train",
  subway: "fa-solid fa-train-subway",
  bus: "fa-solid fa-bus",
  highway_bus: "fa-solid fa-bus-simple",
};
const DEFAULT_VEHICLE_ICON_CLASS = "fa-solid fa-train-tram";

/** Types列の値 → 種別頭文字(普/快/新/特)。局所線はすべてlocalのため今回は未使用だが拡張用に定義。 */
const TYPE_LABEL = {
  local: "普",
  rapid: "快",
  express: "特",
  direct: "直",
};

/** 駅ブロック1つ分の高さ(px)。CSSの --station-*-h / --segment-*-h と必ず一致させること。 */
const LAYOUT = {
  stationTop: 45,
  stationCenter: 25,
  stationBottom: 45,
  segmentTop: 55,
  segmentBottom: 55,
};
LAYOUT.cycle = LAYOUT.stationTop + LAYOUT.stationCenter + LAYOUT.stationBottom + LAYOUT.segmentTop + LAYOUT.segmentBottom;

/** 多言語辞書(JP/EN) */
const I18N = {
  ja: {
    siteTitle: "列車位置情報サイト(開発中)",
    disclaimer: "時刻による位置の予測です。実際の位置情報とは異なる可能性があるためご注意ください。",
    backToList: "路線一覧",
    selectRouteHeading: "路線を選択してください",
    dayTypeLabel: "運行日",
    dayWeekday: "平日",
    daySaturday: "土曜",
    dayHoliday: "日曜・祝日",
    timeLabel: "時刻",
    nowButton: "現在時刻に戻す",
    comingSoonTag: "準備中",
    comingSoonToast: "この路線は現在準備中です。",
    sharedNote: (a, b) => `${a}～${b}は1・2系統の共用区間です`,
    viewRoute: "この路線を見る",
    modalType: "種別",
    modalLine: "系統",
    modalDestination: "行き先",
    modalDeparture: "出発",
    modalStations: "各駅発車時刻",
    typeLocal: "普通",
    directionUp: (name) => `${name} 方面`,
    directionDown: (name) => `${name} 方面`,
    junctionButtonLabel: "共用区間",
    junctionToastLine2: "この先は2系統との共用区間です。2系統は現在準備中です。",
  },
  en: {
    siteTitle: "Train Position Info (in development)",
    disclaimer: "This is a prediction based on the timetable. The actual position may differ, so please use this information with caution.",
    backToList: "Route list",
    selectRouteHeading: "Please select a route",
    dayTypeLabel: "Service day",
    dayWeekday: "Weekday",
    daySaturday: "Saturday",
    dayHoliday: "Sunday & Holiday",
    timeLabel: "Time",
    nowButton: "Reset to now",
    comingSoonTag: "Coming soon",
    comingSoonToast: "This route is currently under development.",
    sharedNote: (a, b) => `${a} - ${b} is shared by Line 1 and Line 2`,
    viewRoute: "View this route",
    modalType: "Type",
    modalLine: "Line",
    modalDestination: "Destination",
    modalDeparture: "Departure",
    modalStations: "Departure times",
    typeLocal: "Local",
    directionUp: (name) => `To ${name}`,
    directionDown: (name) => `To ${name}`,
    junctionButtonLabel: "Shared section",
    junctionToastLine2: "Beyond here is shared with Line 2, which is currently under development.",
  },
};

/* =========================================================
   2. 状態管理(state)
   ========================================================= */
const state = {
  language: "ja",              // "ja" | "en"
  themePreference: "auto",     // "auto" | "light" | "dark"
  view: "select",              // "select" | "line1"
  dayType: null,                // "weekday" | "Saturday" | "Holiday"
  manualTime: null,             // 手動指定時の秒数(0-86399)。nullなら現在時刻を使用。
  trains: { 1: null },          // 系統ごとの読込済み列車データ(キャッシュ)
  liveTimer: null,
  activeTrainForModal: null,
};

/* =========================================================
   3. ユーティリティ関数
   ========================================================= */

/** "hh:mm" または "hh:mm:ss" 形式の文字列を秒数に変換する */
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

/** 曜日から既定の運行日区分を推定する(祝日データは持たないため、日曜は"Holiday"扱いとする簡易実装) */
function defaultDayTypeFromDate(date) {
  const day = date.getDay(); // 0=日,6=土
  if (day === 0) return "Holiday";
  if (day === 6) return "Saturday";
  return "weekday";
}

/** 現在言語の辞書エントリを取得する */
function t(key) {
  return I18N[state.language][key];
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

/** 解析済みCSVから列車オブジェクトの配列を生成する。stopsは時刻表の並び順=進行方向の順。 */
function buildTrains(parsed) {
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
      stops,
    });
  }
  return trains;
}

/** 指定系統(現状は1系統のみ)の上り・下りCSVを取得し、キャッシュして返す */
async function loadRouteTrains(routeId) {
  if (state.trains[routeId]) return state.trains[routeId];
  const route = ROUTES[routeId];
  const [downText, upText] = await Promise.all([
    fetch(route.files.down).then((r) => r.text()),
    fetch(route.files.up).then((r) => r.text()),
  ]);
  const downParsed = parseCSVText(downText);
  const upParsed = parseCSVText(upText);
  const trains = [...buildTrains(downParsed), ...buildTrains(upParsed)];
  // 下り方向CSVのヘッダ順が「上から下」の正順なので、これを画面表示上の正準順(canonical order)とする
  const canonicalOrder = downParsed.stations.map((s) => s.code);
  state.trains[routeId] = { trains, canonicalOrder };
  return state.trains[routeId];
}

/* =========================================================
   5. 運行日・時刻ロジック
   ========================================================= */

/** 表示に使う「現在時刻」を秒で返す。手動指定があればそれを優先する。 */
function getEffectiveNowSeconds() {
  return state.manualTime !== null ? state.manualTime : nowSecondsReal();
}

/** 選択中の運行日に合致する列車のみを抽出する */
function filterTrainsByDayType(trains, dayType) {
  return trains.filter((tr) => tr.date === dayType);
}

/* =========================================================
   6. 座標計算(位置予測)
   ========================================================= */

/** 列車の現在の状態("station"/"segment"/null)を、正準順の駅インデックスで求める */
function computeTrainPosition(train, canonicalOrder, nowSec) {
  const idx = (code) => canonicalOrder.indexOf(code);
  const stops = train.stops;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (nowSec < first.timeSec || nowSec > last.timeSec) return null;

  for (let i = 0; i < stops.length; i++) {
    if (nowSec === stops[i].timeSec) {
      return { type: "station", stationIndex: idx(stops[i].code) };
    }
    if (i < stops.length - 1) {
      const a = stops[i];
      const b = stops[i + 1];
      if (nowSec > a.timeSec && nowSec < b.timeSec) {
        const canA = idx(a.code);
        const canB = idx(b.code);
        if (canA < 0 || canB < 0) return null;
        const fraction = (nowSec - a.timeSec) / (b.timeSec - a.timeSec);
        const goingDown = canA < canB; // 正準順で index が増える方向=下(谷山側)へ進んでいる
        const segmentIndex = Math.min(canA, canB);
        // goingDown: 前半(fraction<0.5)は上側駅寄り→segment_top / 後半は下側駅寄り→segment_bottom
        // goingUp  : 前半は下側駅(まだ上には進んでいない)→segment_bottom / 後半→segment_top
        let half;
        if (goingDown) half = fraction < 0.5 ? "top" : "bottom";
        else half = fraction < 0.5 ? "bottom" : "top";
        return { type: "segment", segmentIndex, half };
      }
    }
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

/** 区間(駅と駅の間)の上半分/下半分のY座標を返す */
function getSegmentAnchorY(segmentIndex, half) {
  const anchor = getStationAnchorY(segmentIndex);
  const yTop = anchor.bottom + LAYOUT.stationCenter + LAYOUT.stationBottom + LAYOUT.segmentTop / 2;
  const yBottom = anchor.bottom + LAYOUT.stationCenter + LAYOUT.stationBottom + LAYOUT.segmentTop + LAYOUT.segmentBottom / 2;
  return half === "top" ? yTop : yBottom;
}

/** 進行方向によって左右の走行レーンを分ける(上り=左寄り, 下り=右寄り) */
function getLaneX(direction) {
  const width = getStationAnchorY._bodyWidth || 0;
  const gap = width * 0.12;
  return direction === "up" ? width / 2 - gap : width / 2 + gap;
}

/** computeTrainPosition の結果を実際の画面座標{x,y}に変換する */
function positionToCoordinates(position, direction) {
  const x = getLaneX(direction);
  if (position.type === "station") {
    const anchor = getStationAnchorY(position.stationIndex);
    const y = direction === "up" ? anchor.top : anchor.bottom;
    return { x, y };
  }
  const y = getSegmentAnchorY(position.segmentIndex, position.half);
  return { x, y };
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

    const nameJa = route.nameJa;
    const name = state.language === "ja" ? route.nameJa : route.nameEn;
    const from = state.language === "ja" ? route.fromJa : route.fromEn;
    const to = state.language === "ja" ? route.toJa : route.toEn;
    const via = route.viaJa ? (state.language === "ja" ? route.viaJa : route.viaEn) : null;
    const sectionText = via ? `${from} ～ (${via}) ～ ${to}` : `${from} ～ ${to}`;

    card.innerHTML = `
      ${!route.implemented ? `<span class="route_card_tag">${t("comingSoonTag")}</span>` : ""}
      <div class="route_card_head">
        <span class="route_card_badge">${route.id === 1 ? "1" : route.id}</span>
        <span class="route_card_name">${name}</span>
      </div>
      <div class="route_card_section">${sectionText}</div>
      ${route.id === 1 ? `<div class="route_card_note">${t("sharedNote")("鹿児島駅前", "高見馬場")}</div>` : ""}
      <button type="button" class="route_card_action" data-route-id="${route.id}">${t("viewRoute")}</button>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll(".route_card_action").forEach((btn) => {
    btn.addEventListener("click", () => onRouteCardClicked(Number(btn.dataset.routeId)));
  });
}

/** 路線カード/共用区間ボタンが押されたときの処理。1系統のみ詳細画面へ遷移する。 */
function onRouteCardClicked(routeId) {
  const route = ROUTES[routeId];
  if (!route.implemented) {
    showToast(t("comingSoonToast"));
    return;
  }
  switchView("line1");
}

/** 駅ブロック1件分のDOMを生成する(先頭駅にはJS座標計算用の基準クラスを付与) */
function createStationBlock(station, index) {
  const wrap = document.createElement("div");
  wrap.className = "station_area";

  const top = document.createElement("div");
  top.className = "station_area_top" + (index === 0 ? " js-station-top-anchor" : "");
  top.innerHTML = '<div class="boder"></div>';

  const center = document.createElement("div");
  center.className = "station_center";
  const isJunction = LINE1_SHARED_WITH_LINE2.includes(station.code);
  center.innerHTML = `
    <div class="station_name">
      <span>${state.language === "ja" ? station.ja : station.en}</span>
      ${state.language === "ja" ? `<span class="station_name_en">${station.en}</span>` : ""}
      ${isJunction ? `<button type="button" class="station_junction_btn" title="${t("junctionButtonLabel")}"><i class="fa-solid fa-code-branch"></i></button>` : ""}
    </div>
    <div class="station_point_out"><div class="station_point_in"></div></div>
  `;

  const bottom = document.createElement("div");
  bottom.className = "station_area_bottom" + (index === 0 ? " js-station-bottom-anchor" : "");
  bottom.innerHTML = '<div class="boder"></div>';

  wrap.appendChild(top);
  wrap.appendChild(center);
  wrap.appendChild(bottom);

  center.querySelector(".station_junction_btn")?.addEventListener("click", () => showToast(t("junctionToastLine2")));

  return wrap;
}

/** 駅と駅の間の区間DOMを生成する */
function createSegmentBlock() {
  const seg = document.createElement("div");
  seg.className = "segment";
  seg.innerHTML = '<div class="boder"></div><div class="segment_top"></div><div class="segment_bottom"></div>';
  return seg;
}

/** 1系統の路線図(駅+区間の縦並び)を生成し、train_body要素へ挿入する */
function renderLineDiagram() {
  const body = document.getElementById("trainBody");
  body.innerHTML = "";
  body.style.setProperty("--route-color", ROUTES[1].color);

  LINE1_STATIONS.forEach((station, i) => {
    body.appendChild(createStationBlock(station, i));
    if (i < LINE1_STATIONS.length - 1) body.appendChild(createSegmentBlock());
  });

  document.getElementById("directionUpLabel").textContent = t("directionUp")(
    state.language === "ja" ? LINE1_STATIONS[0].ja : LINE1_STATIONS[0].en
  );
  document.getElementById("directionDownLabel").textContent = t("directionDown")(
    state.language === "ja" ? LINE1_STATIONS[LINE1_STATIONS.length - 1].ja : LINE1_STATIONS[LINE1_STATIONS.length - 1].en
  );
}

/** Line_Num値から表示色を決定する(1系統=青, 2系統=赤, 空欄=グレー) */
function colorForLineNum(lineNum) {
  if (lineNum === "1") return ROUTES[1].color;
  if (lineNum === "2") return ROUTES[2].color;
  return NO_LINE_COLOR;
}

/** 列車マーカー1件のDOMを生成する */
function createTrainMarkerEl(train, coords) {
  const el = document.createElement("div");
  el.className = "train_marker";
  el.style.left = `${coords.x}px`;
  el.style.top = `${coords.y}px`;
  const color = colorForLineNum(train.lineNum);
  el.style.setProperty("--marker-color", color);

  const vehicleIcon = VEHICLE_ICON_CLASS[train.vehicle] || DEFAULT_VEHICLE_ICON_CLASS;
  const badge = train.lineNum ? `<span class="train_marker_badge">${train.lineNum}</span>` : "";
  const caret = train.direction === "up" ? "fa-caret-up" : "fa-caret-down";

  el.innerHTML = `
    <div class="train_marker_icon"><i class="${vehicleIcon}"></i>${badge}</div>
    <i class="fa-solid ${caret} train_marker_direction"></i>
  `;
  el.addEventListener("click", () => openTrainModal(train));
  return el;
}

/** 現在時刻に基づき、路線図上の全列車マーカーを再描画する */
function updateTrainMarkers() {
  const body = document.getElementById("trainBody");
  body.querySelectorAll(".train_marker").forEach((el) => el.remove());
  if (!primeCoordinateBaseline(body)) return;

  const data = state.trains[1];
  if (!data) return;

  const nowSec = getEffectiveNowSeconds();
  const trains = filterTrainsByDayType(data.trains, state.dayType);

  trains.forEach((train) => {
    const position = computeTrainPosition(train, data.canonicalOrder, nowSec);
    if (!position) return;
    const coords = positionToCoordinates(position, train.direction);
    body.appendChild(createTrainMarkerEl(train, coords));
  });
}

/* =========================================================
   8. モーダル・トースト
   ========================================================= */

/** 列車アイコンタップ時、その列車の詳細(系統・種別・行先・各駅発車時刻)を表示する */
function openTrainModal(train) {
  state.activeTrainForModal = train;
  const body = document.getElementById("modalBody");
  const color = colorForLineNum(train.lineNum);
  const typeLabel = train.types === "local" ? t("typeLocal") : (TYPE_LABEL[train.types] || train.types);

  const stationRows = train.stops
    .map((s) => {
      const stationDef = LINE1_STATIONS.find((st) => st.code === s.code);
      const label = stationDef ? (state.language === "ja" ? stationDef.ja : stationDef.en) : s.name;
      return `<div class="modal_station_row"><span>${label}</span><span>${s.timeStr}</span></div>`;
    })
    .join("");

  body.innerHTML = `
    <div class="modal_title">
      <span class="modal_badge" style="--modal-line-color:${color}">${train.lineNum || "-"}</span>
      <span>${train.destination} ${state.language === "ja" ? "行" : ""}</span>
    </div>
    <div class="modal_row"><span>${t("modalLine")}</span><span>${train.lineNum || "-"}</span></div>
    <div class="modal_row"><span>${t("modalType")}</span><span>${typeLabel}</span></div>
    <div class="modal_row"><span>${t("modalDeparture")}</span><span>${train.departure}</span></div>
    <div class="modal_row"><span>${t("modalDestination")}</span><span>${train.destination}</span></div>
    ${train.note ? `<div class="modal_row"><span>Note</span><span>${train.note}</span></div>` : ""}
    <div class="modal_row" style="border-bottom:none;padding-top:10px;"><span>${t("modalStations")}</span><span></span></div>
    <div class="modal_station_list">${stationRows}</div>
  `;
  document.getElementById("trainModal").classList.remove("is-hidden");
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

/** 画面(路線選択/路線詳細)を切り替える */
function switchView(view) {
  state.view = view;
  const isLine = view === "line1";

  document.getElementById("viewSelect").classList.toggle("is-hidden", isLine);
  document.getElementById("viewLine").classList.toggle("is-hidden", !isLine);
  document.getElementById("backButton").classList.toggle("is-hidden", !isLine);
  document.getElementById("controlPanel").classList.toggle("is-hidden", !isLine);

  syncHeaderHeight();

  if (isLine) {
    renderLineDiagram();
    loadRouteTrains(1).then(() => {
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

/** ライブ時計(手動指定が無いときに数秒おきに現在時刻へ更新する)を開始する */
function startLiveClock() {
  stopLiveClock();
  state.liveTimer = setInterval(() => {
    if (state.manualTime !== null) return; // 手動指定中は自動更新しない
    document.getElementById("timeInput").value = secondsToHHMM(nowSecondsReal());
    updateTrainMarkers();
  }, 15000);
}
function stopLiveClock() {
  if (state.liveTimer) clearInterval(state.liveTimer);
  state.liveTimer = null;
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
  renderRouteSelect();
  if (state.view === "line1") {
    renderLineDiagram();
    requestAnimationFrame(() => {
      syncHeaderHeight();
      updateTrainMarkers();
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

/** 運行日・時刻の操作パネルの値が変わったときに呼び出す(手動モードへ切り替え、即時再描画) */
function onControlPanelChanged() {
  const daySelect = document.getElementById("dayTypeSelect");
  const timeInput = document.getElementById("timeInput");
  state.dayType = daySelect.value;
  state.manualTime = timeInput.value ? timeToSeconds(timeInput.value + ":00") : null;
  updateTrainMarkers();
}

/** 「現在時刻に戻す」ボタンの処理。手動指定を解除し、実際の現在時刻・運行日に復帰する。 */
function resetToNow() {
  const now = new Date();
  state.manualTime = null;
  state.dayType = defaultDayTypeFromDate(now);
  document.getElementById("dayTypeSelect").value = state.dayType;
  document.getElementById("timeInput").value = secondsToHHMM(nowSecondsReal());
  updateTrainMarkers();
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
  document.getElementById("modalCloseButton").addEventListener("click", closeTrainModal);
  document.getElementById("trainModal").addEventListener("click", (e) => {
    if (e.target.id === "trainModal") closeTrainModal();
  });
  window.addEventListener("resize", () => {
    syncHeaderHeight();
    if (state.view === "line1") updateTrainMarkers();
  });
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
  renderRouteSelect();
  initEventListeners();
  syncHeaderHeight();
  switchView("select");
}

document.addEventListener("DOMContentLoaded", init);
