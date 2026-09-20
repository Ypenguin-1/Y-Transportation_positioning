//現在時刻取得(秒数)
function get_current_time(){
    const now = new Date();
    const now_sec = now.getHours()*3600 + now.getMinutes()*60+ now.getSeconds();
    const now_date = [now.getFullYear(),now.getMonth(),now.getDate(),now.getDay()];
    return now_sec;
}

//年日曜取得
function get_date(){
    const now = new Date();
    const now_date = [now.getFullYear(),now.getMonth()+1,now.getDate(),now.getDay()];
    return now_date;
}

//時刻秒数変換
function time_to_second(time){
    const parts = time.split(":").map(Number);
    let result_second = 0;

    //秒数指定
    if(parts[2] == undefined){
        result_second = parts[0]*3600 + parts[1]*60;
    }else{
        result_second = parts[0]*3600 + parts[1]*60+ parts[2];
    }
    return result_second;
}

//CSVファイル読み込み・配列化
async function load_csv(csv_path){
    const res = await fetch(csv_path);
    const text = await res.text();
    
    const lines = text.replace(/\r/g,"").split("\n").filter(line => line.trim() !== "");
    
    const trains=[];
    for(let i = 1; i < lines.length;i++){
        const cols = lines[i].split(",");

        const train = {
            Train_ID: cols[0],
            Line: cols[1],
            Direction: cols[2],
            Types: cols[3],
            Type_name: cols[4],
            Departure: cols[5],
            Via: cols[6],
            Destination: cols[7],
            Car_length: Number(cols[8]),
            Train_comment: cols[9],
            stations:[]
        };

        //駅部分
        for(let j = 10;j<cols.length;j+=4){
            const Arr_time = cols[j];
            const Dep_time = cols[j+1];
            const id = cols[j+2];
            const platform = cols[j+3];

            if(Dep_time !== ""){
                train.stations.push({
                    Arr_time: time_to_second(Arr_time),
                    Dep_time: time_to_second(Dep_time),
                    id: Number(id),
                    platform: platform
                });
            }
        }
        trains.push(train);
    }

    return trains;
}

//画面サイズ取得
function get_display_size(){
    return [window.innerWidth,window.innerHeight];    
}


//駅座標取得(縦用)
function get_station_coordinates(station_code,direction){
    //始点座標の取得
    const body_CO = document.querySelector(".train_body").getBoundingClientRect();
    const TopStation_top_ab = document.querySelector(".Top_station_area_top").getBoundingClientRect();
    const TopStation_bottom_ab = document.querySelector(".Top_station_area_bottom").getBoundingClientRect();

    //body基準変換
    const Top_station_top_Y = TopStation_top_ab.top - body_CO.top;

    const Top_station_bottom_Y = TopStation_bottom_ab.top - body_CO.top;

    //画面サイズ取得
    const display_size = get_display_size();

    //補正分(Xは左右/Yは1区間分[px])
    const X_gap = display_size[0] * 0.1; //10%
    const Y_gap = 225; //固定値

    //方向別X処理
    let position_X;
    if(direction == "up"){ //上向き
        position_X = body_CO.width*0.5 - X_gap;
    }else{ //下向き
        position_X = body_CO.width*0.5 + X_gap;
    }

    //駅別y処理
    const position_Y_top = Top_station_top_Y + Y_gap * station_code;
    const position_Y_bottom = Top_station_bottom_Y + Y_gap * station_code;

    return ({
        top: {
            x: position_X,
            y: position_Y_top
        },
        bottom:{
            x: position_X,
            y: position_Y_bottom
        }
    });
}

//駅間座標取得(縦用) station_codeは発車駅
function get_segment_coordinates(station_code,direction){
    let station_coordinates;
    
    //区間y処理(駅区間分)
    const station_area_half = 45;
    const station_area_center = 25;
    const segment_half = 55;

    let Y_gap_top = station_area_half + station_area_center + station_area_half;
    let Y_gap_bottom = station_area_half + segment_half;

    if(direction == "down"){
        station_coordinates = get_station_coordinates(station_code,direction);
    }else{
        station_coordinates = get_station_coordinates(station_code-1,direction);
    }

    let segment_coordinates_top = [station_coordinates.top.x, station_coordinates.top.y+Y_gap_top];
    let segment_coordinates_bottom = [station_coordinates.bottom.x, station_coordinates.bottom.y+Y_gap_bottom];
    
    return ({
        top: {
            x: segment_coordinates_top[0],
            y: segment_coordinates_top[1]
        },
        bottom:{
            x: segment_coordinates_bottom[0],
            y: segment_coordinates_bottom[1]
        }
    });
    
}

//時間位置処理・位置特定(縦用・1列車)
function train_time_positioning(train, now){
    for(let i = 0; i < train.stations.length-1;i++){

        const Arr_time1 = train.stations[i].Arr_time;
        const Dep_time1 = train.stations[i].Dep_time;
        const Arr_time2 = train.stations[i+1].Arr_time;
        const Seg_half_time = (Arr_time2 + Dep_time1)/2; //区間分割時間

        if(now >= Arr_time1 && now <= Dep_time1){ //駅
            return ({
                situation: "station",
                station_id: train.stations[i].id
            });

        }else if(now > Dep_time1 && now <= Seg_half_time){ //区間上半分
            return ({
                situation: "segment_top",
                station_id: train.stations[i].id
            });

        }else if (now >= Seg_half_time && now <Arr_time2){ //区間下半分
            return ({
                situation: "segment_bottom",
                station_id: train.stations[i].id
            });
        }
    }
    return ({
        situation:"undisplay",
        station_id:null
    })
}

//位置の座標化
function train_pos(train, now){
    const position = train_time_positioning(train, now);

    let real_coordinates;
    if(position.situation == "station"){
        real_coordinates = get_station_coordinates(position.station_id, train.Direction);
        //方向別返却値分岐
        if(train.Direction == "up"){
            return real_coordinates.top;
        }else{
            return real_coordinates.bottom;
        }
    }else if(position.situation == "segment_top"){
        real_coordinates = get_segment_coordinates(position.station_id, train.Direction);
        return real_coordinates.top;
    }else if(position.situation == "segment_bottom"){
        real_coordinates = get_segment_coordinates(position.station_id, train.Direction);
        return real_coordinates.bottom;
    }else if(position.situation == "undisplay"){
        return "undisplay";
    }
    return null;
}

//描画(レンダリング)処理



//更新処理
//初期化(起動時)


/*
//デバック用
//デバック用
async function main(){
    const data = await load_csv("train_info_CSV.csv");
    console.log(data);
}

main();
*/
