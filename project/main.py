# -*- coding: utf-8 -*-
from __future__ import annotations

import re
import json
import os
import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse  # pip install sse-starlette
import httpx

# =========================================================
# App (단 하나만!)
# =========================================================
app = FastAPI(title="KBO Relay Replay API", version="0.5.0")

# =========================================================
# CORS 설정
# =========================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://baseball-ai-chat-bot.vercel.app",
        "https://baseball-ai-chat-bot-git-main-statseas-projects.vercel.app",
        "http://localhost:5500",
        "http://localhost:3000",
    ],
    allow_credentials=False,
    allow_methods=["*"],   # ✅ 중요
    allow_headers=["*"],   # ✅ 중요
)

# =========================================================
# 파일 경로
# =========================================================
BASE_PATH = Path(__file__).resolve().parent
RAW_DIR = BASE_PATH / "data" / "raw"
PROCESSED_DIR = BASE_PATH / "data" / "processed"

RULES_PATH = PROCESSED_DIR / "rules_summary.json"
CHEERS_PATH = PROCESSED_DIR / "cheers.json"

# ✅ (추가) 선수 응원가 json 경로
PLAYERS_PATH = BASE_PATH / "data" / "player.json"

# =========================================================
# 0) 규정/응원가 JSON 로드 + API
# =========================================================
class RuleItem(BaseModel):
    rule_key: str
    title: str
    short_def: str
    official_rule: str
    exception: Optional[str] = None

class CheerItem(BaseModel):
    team: str
    title: str
    url: str

RULES_DB: List[RuleItem] = []
_RULE_INDEX: Dict[str, RuleItem] = {}

CHEERS_DB: List[CheerItem] = []
_CHEERS_BY_TEAM: Dict[str, List[CheerItem]] = {}

def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()

def _rebuild_rules_index() -> None:
    global _RULE_INDEX
    _RULE_INDEX = {r.rule_key.upper(): r for r in RULES_DB}

def _rebuild_cheers_index() -> None:
    global _CHEERS_BY_TEAM
    _CHEERS_BY_TEAM = {}
    for c in CHEERS_DB:
        team = (c.team or "").strip()
        _CHEERS_BY_TEAM.setdefault(team, []).append(c)

def load_rules_from_json(path: Path) -> None:
    global RULES_DB
    if not path.exists():
        raise FileNotFoundError(f"rules json not found: {path}")
    with path.open("r", encoding="utf-8") as f:
        raw = json.load(f)
    RULES_DB = [RuleItem(**item) for item in raw]
    _rebuild_rules_index()

def load_cheers_from_json(path: Path) -> None:
    global CHEERS_DB
    if not path.exists():
        raise FileNotFoundError(f"cheers json not found: {path}")
    with path.open("r", encoding="utf-8") as f:
        raw = json.load(f)
    CHEERS_DB = [CheerItem(**item) for item in raw]
    _rebuild_cheers_index()

# =========================================================
# 0-1) 선수 응원가 JSON 로드 + API
# =========================================================
class PlayerItem(BaseModel):
    team: str
    name: str

    teamKey: Optional[str] = None
    number: Optional[int] = None

    title: Optional[str] = None
    lyrics: Optional[str] = None

    url: Optional[str] = None
    youtubeUrl: Optional[str] = None
    youtube_id: Optional[str] = None
    youtubeId: Optional[str] = None
    startTime: Optional[int] = None
    starttime: Optional[int] = None

    tip: Optional[str] = None
    position: Optional[str] = None

    model_config = {"extra": "allow"}

PLAYERS_DB: List[PlayerItem] = []
_PLAYERS_BY_TEAM: Dict[str, List[PlayerItem]] = {}
_PLAYERS_BY_TEAMKEY_NUM: Dict[Tuple[str, int], PlayerItem] = {}

def _rebuild_players_index() -> None:
    global _PLAYERS_BY_TEAM, _PLAYERS_BY_TEAMKEY_NUM
    _PLAYERS_BY_TEAM = {}
    _PLAYERS_BY_TEAMKEY_NUM = {}

    for p in PLAYERS_DB:
        t = (p.team or "").strip()
        _PLAYERS_BY_TEAM.setdefault(t, []).append(p)

        if p.teamKey and p.number is not None:
            _PLAYERS_BY_TEAMKEY_NUM[(p.teamKey.strip().lower(), int(p.number))] = p

def load_players_from_json(path: Path) -> None:
    global PLAYERS_DB
    if not path.exists():
        raise FileNotFoundError(f"players json not found: {path}")
    with path.open("r", encoding="utf-8-sig") as f:
        raw = json.load(f)
    if not isinstance(raw, list):
        raise ValueError("player.json must be a list")
    PLAYERS_DB = [PlayerItem(**item) for item in raw]
    _rebuild_players_index()

@app.on_event("startup")
def on_startup() -> None:
    # 없으면 바로 죽게 해서 실수 빠르게 발견
    load_rules_from_json(RULES_PATH)
    load_cheers_from_json(CHEERS_PATH)
    load_players_from_json(PLAYERS_PATH)

# -------------------------
# RULES API
# -------------------------
@app.get("/rules")
def list_rules():
    return {"count": len(RULES_DB), "items": [r.model_dump() for r in RULES_DB]}

@app.get("/rules/keys")
def list_rule_keys():
    keys = [r.rule_key for r in RULES_DB]
    return {"count": len(keys), "keys": keys}

@app.get("/rules/search")
def search_rules(q: str = Query(..., min_length=1)):
    query = _norm(q)
    out = []
    for r in RULES_DB:
        hay = " ".join(
            [
                _norm(r.rule_key),
                _norm(r.title),
                _norm(r.short_def),
                _norm(r.official_rule),
                _norm(r.exception or ""),
            ]
        )
        if query in hay:
            out.append(r.model_dump())
    return {"q": q, "count": len(out), "items": out}

@app.get("/rules/{rule_key}")
def get_rule(rule_key: str):
    k = (rule_key or "").strip().upper()
    if k in {"SEARCH", "KEYS"}:
        raise HTTPException(status_code=404, detail="reserved path")
    item = _RULE_INDEX.get(k)
    if not item:
        raise HTTPException(status_code=404, detail=f"rule_key not found: {rule_key}")
    return item.model_dump()

# -------------------------
# CHEERS API
# -------------------------
@app.get("/cheers")
def list_cheers():
    return {"count": len(CHEERS_DB), "items": [c.model_dump() for c in CHEERS_DB]}

@app.get("/cheers/teams")
def list_cheer_teams():
    teams = sorted(_CHEERS_BY_TEAM.keys())
    return {"count": len(teams), "teams": teams}

@app.get("/cheers/by_team/{team}")
def get_cheers_by_team(team: str):
    t = (team or "").strip()
    items = _CHEERS_BY_TEAM.get(t, [])
    if not items:
        raise HTTPException(status_code=404, detail=f"team not found: {team}")
    return {"team": t, "count": len(items), "items": [c.model_dump() for c in items]}

@app.get("/cheers/search/{text}")
def search_cheers_path(text: str, limit: int = Query(200, ge=1, le=1000)):
    t = (text or "").strip()

    if t in _CHEERS_BY_TEAM:
        items = _CHEERS_BY_TEAM.get(t, [])
        out = [c.model_dump() for c in items][:limit]
        return {"q": t, "mode": "team", "team": t, "count": len(out), "items": out}

    query = _norm(t)
    out = []
    for c in CHEERS_DB:
        if query and query in _norm(c.title):
            out.append(c.model_dump())
            if len(out) >= limit:
                break
    return {"q": t, "mode": "title", "team": None, "count": len(out), "items": out}

@app.get("/cheers/search")
def search_cheers(
    q: str = Query(..., min_length=1),
    team: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
):
    q_raw = (q or "").strip()
    team_filter = (team or "").strip() if team else None

    if team_filter:
        items = _CHEERS_BY_TEAM.get(team_filter, [])
        out = [c.model_dump() for c in items][:limit]
        return {"q": q_raw, "mode": "team", "team": team_filter, "count": len(out), "items": out}

    if q_raw in _CHEERS_BY_TEAM:
        items = _CHEERS_BY_TEAM[q_raw]
        out = [c.model_dump() for c in items][:limit]
        return {"q": q_raw, "mode": "team", "team": q_raw, "count": len(out), "items": out}

    query = _norm(q_raw)
    out = []
    for c in CHEERS_DB:
        if query and query in _norm(c.title):
            out.append(c.model_dump())
            if len(out) >= limit:
                break
    return {"q": q_raw, "mode": "title", "team": None, "count": len(out), "items": out}

# -------------------------
# PLAYERS API
# -------------------------
@app.get("/players")
def list_players(limit: int = Query(200, ge=1, le=5000)):
    items = [p.model_dump() for p in PLAYERS_DB][:limit]
    return {"count": len(PLAYERS_DB), "items": items}

@app.get("/players/teams")
def list_player_teams():
    teams = sorted(_PLAYERS_BY_TEAM.keys())
    return {"count": len(teams), "teams": teams}

@app.get("/players/by_team/{team}")
def get_players_by_team(team: str, limit: int = Query(500, ge=1, le=5000)):
    t = (team or "").strip()
    items = _PLAYERS_BY_TEAM.get(t, [])
    if not items:
        raise HTTPException(status_code=404, detail=f"team not found: {team}")
    out = [p.model_dump() for p in items][:limit]
    return {"team": t, "count": len(out), "items": out}

@app.get("/players/search/{text}")
def search_players_path(text: str, limit: int = Query(50, ge=1, le=1000)):
    t = (text or "").strip()

    if t in _PLAYERS_BY_TEAM:
        items = _PLAYERS_BY_TEAM.get(t, [])
        out = [p.model_dump() for p in items][:limit]
        return {"q": t, "mode": "team", "team": t, "count": len(out), "items": out}

    query = _norm(t)
    out = []
    for p in PLAYERS_DB:
        hay = " ".join(
            [
                _norm(p.team),
                _norm(p.teamKey),
                _norm(p.name),
                _norm(p.title),
                _norm(p.lyrics),
                _norm(p.tip),
                _norm(p.position),
            ]
        )
        if query and query in hay:
            out.append(p.model_dump())
            if len(out) >= limit:
                break
    return {"q": t, "mode": "search", "team": None, "count": len(out), "items": out}

@app.get("/players/search")
def search_players(q: str = Query(..., min_length=1), limit: int = Query(50, ge=1, le=1000)):
    return search_players_path(text=q, limit=limit)

@app.get("/players/{teamKey}/{number}")
def get_player(teamKey: str, number: int):
    key = (teamKey or "").strip().lower()
    try:
        num = int(number)
    except Exception:
        raise HTTPException(status_code=422, detail="number must be int")

    item = _PLAYERS_BY_TEAMKEY_NUM.get((key, num))
    if not item:
        raise HTTPException(status_code=404, detail="player not found (need teamKey+number in data)")
    return item.model_dump()

# =========================================================
# 1) relay 로더
# =========================================================
RELAY_FILE_MAP: Dict[str, str] = {
    "20250801HHHT02025": str(RAW_DIR / "20250801HHHT02025_relay.json"),
}

EVENTS_CACHE: Dict[str, List[Dict[str, Any]]] = {}
SSE_QUEUES: Dict[str, List[asyncio.Queue]] = {}
TEAM_CACHE: Dict[str, Dict[str, str]] = {}

# lineup / matchup 캐시
LINEUP_CACHE: Dict[str, Dict[str, Any]] = {}
PLAYER_NAME_CACHE: Dict[str, Dict[str, str]] = {}

def _read_json_file(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)

def _inning_file_paths(game_id: str) -> List[str]:
    paths: List[str] = []
    for inn in range(1, 10):
        p = str(RAW_DIR / f"{game_id}_inning{inn:02d}.json")
        if os.path.exists(p):
            paths.append(p)
    return paths

def _resolve_payload_paths(game_id: str) -> List[str]:
    inning_paths = _inning_file_paths(game_id)
    if inning_paths:
        return inning_paths

    single = RELAY_FILE_MAP.get(game_id)
    if single and os.path.exists(single):
        return [single]

    guess = str(RAW_DIR / f"{game_id}_relay.json")
    if os.path.exists(guess):
        return [guess]

    raise HTTPException(status_code=404, detail=f"no relay files found for game_id={game_id}")

def load_payloads(game_id: str) -> Tuple[List[Dict[str, Any]], List[str]]:
    paths = _resolve_payload_paths(game_id)
    payloads: List[Dict[str, Any]] = []

    for p in paths:
        try:
            payload = _read_json_file(p)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=500, detail=f"invalid json in {p}: {e}")
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f"file not found: {p}")

        if "result" not in payload or not isinstance(payload["result"], dict):
            raise HTTPException(status_code=422, detail=f"invalid payload in {p}: missing result object")

        payloads.append(payload)

    return payloads, paths

def _relay_root(payload: Dict[str, Any]) -> Dict[str, Any]:
    r = payload.get("result")
    if not isinstance(r, dict):
        return {}
    trd = r.get("textRelayData")
    return trd if isinstance(trd, dict) else {}

def _harvest_pcode_name(obj: Any, out: Dict[str, str]) -> None:
    if isinstance(obj, dict):
        if "pcode" in obj and "name" in obj:
            pc = str(obj.get("pcode") or "").strip()
            nm = str(obj.get("name") or "").strip()
            if pc and nm:
                out[pc] = nm
        for v in obj.values():
            _harvest_pcode_name(v, out)
    elif isinstance(obj, list):
        for it in obj:
            _harvest_pcode_name(it, out)

def _get_pcode_to_name(game_id: str) -> Dict[str, str]:
    if game_id in PLAYER_NAME_CACHE:
        return PLAYER_NAME_CACHE[game_id]

    payloads, _paths = load_payloads(game_id)
    p2n: Dict[str, str] = {}
    for p in payloads:
        root = _relay_root(p)
        _harvest_pcode_name(root, p2n)
        _harvest_pcode_name(p, p2n)

    PLAYER_NAME_CACHE[game_id] = p2n
    return p2n

def _get_lineups(game_id: str) -> Dict[str, Any]:
    if game_id in LINEUP_CACHE:
        return LINEUP_CACHE[game_id]

    payloads, _paths = load_payloads(game_id)
    home: List[Dict[str, Any]] = []
    away: List[Dict[str, Any]] = []

    for p in payloads:
        root = _relay_root(p)
        hl = root.get("homeLineup") if isinstance(root, dict) else None
        al = root.get("awayLineup") if isinstance(root, dict) else None
        hb = hl.get("batter") if isinstance(hl, dict) else None
        ab = al.get("batter") if isinstance(al, dict) else None

        if isinstance(hb, list) and isinstance(ab, list) and (len(hb) > 0 or len(ab) > 0):
            home = hb
            away = ab
            break

    LINEUP_CACHE[game_id] = {"home": home, "away": away}
    return LINEUP_CACHE[game_id]

# =========================================================
# 2) 이벤트 평탄화
# =========================================================
def flatten_events(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    r = payload["result"]
    trd = r.get("textRelayData", {})
    if not isinstance(trd, dict):
        raise HTTPException(status_code=422, detail="missing textRelayData")

    text_relays = trd.get("textRelays")
    if not isinstance(text_relays, list) or len(text_relays) == 0:
        raise HTTPException(
            status_code=422,
            detail=f"missing textRelayData.textRelays. textRelayData_keys={list(trd.keys())}",
        )

    events: List[Dict[str, Any]] = []
    for tr in text_relays:
        inn = tr.get("inn")
        home_away = tr.get("homeOrAway")

        options = tr.get("textOptions")
        if not isinstance(options, list) or len(options) == 0:
            seqno = tr.get("no") or tr.get("seqno")
            txt = tr.get("title") or tr.get("text") or ""
            events.append(
                {
                    "seqno": int(seqno) if str(seqno).isdigit() else seqno,
                    "inn": inn,
                    "homeOrAway": home_away,
                    "type": tr.get("statusCode") or tr.get("type"),
                    "text": txt,
                    "state": tr.get("currentGameState") or trd.get("currentGameState"),
                    "raw": tr,
                }
            )
            continue

        for opt in options:
            seqno = opt.get("seqno") or opt.get("seq") or opt.get("no") or tr.get("no")
            txt = opt.get("text") or opt.get("relayText") or ""
            ev_type = opt.get("type", tr.get("type"))
            cgs = opt.get("currentGameState") or tr.get("currentGameState") or trd.get("currentGameState")

            events.append(
                {
                    "seqno": int(seqno) if str(seqno).isdigit() else seqno,
                    "inn": inn,
                    "homeOrAway": home_away,
                    "type": ev_type,
                    "text": txt,
                    "state": cgs,
                    "raw": opt,
                }
            )

    def sort_key(ev: Dict[str, Any]):
        s = ev.get("seqno")
        return (0, s) if isinstance(s, int) else (1, str(s))

    events.sort(key=sort_key)
    return events

def _dedup_events(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for e in events:
        key = (e.get("seqno"), e.get("text"))
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out

def get_events(game_id: str) -> List[Dict[str, Any]]:
    if game_id in EVENTS_CACHE:
        return EVENTS_CACHE[game_id]

    payloads, _paths = load_payloads(game_id)
    merged: List[Dict[str, Any]] = []
    for p in payloads:
        merged.extend(flatten_events(p))

    merged.sort(key=lambda ev: (0, ev["seqno"]) if isinstance(ev.get("seqno"), int) else (1, str(ev.get("seqno"))))
    merged = _dedup_events(merged)

    EVENTS_CACHE[game_id] = merged

    if game_id not in REPLAY_STATE:
        REPLAY_STATE[game_id] = ReplayMeta(index=0, running=False, interval=10.0)

    TEAM_CACHE.pop(game_id, None)
    LINEUP_CACHE.pop(game_id, None)
    PLAYER_NAME_CACHE.pop(game_id, None)
    return merged

# =========================================================
# 3) state 구성
# =========================================================
def _safe_get(d: Any, *keys: str, default=None):
    cur = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur

def extract_scoreboard_from_state(cgs: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(cgs, dict):
        return {}
    sb = {
        "homeScore": _safe_get(cgs, "scoreBoard", "homeScore") or cgs.get("homeScore"),
        "awayScore": _safe_get(cgs, "scoreBoard", "awayScore") or cgs.get("awayScore"),
        "homeHit": _safe_get(cgs, "scoreBoard", "homeHit") or cgs.get("homeHit"),
        "awayHit": _safe_get(cgs, "scoreBoard", "awayHit") or cgs.get("awayHit"),
        "homeError": _safe_get(cgs, "scoreBoard", "homeError") or cgs.get("homeError"),
        "awayError": _safe_get(cgs, "scoreBoard", "awayError") or cgs.get("awayError"),
    }
    return {k: v for k, v in sb.items() if v is not None}

def extract_count_from_state(cgs: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(cgs, dict):
        return {}
    count = _safe_get(cgs, "count") or cgs.get("count") or {}
    if not isinstance(count, dict):
        count = {}
    return {
        "ball": count.get("ball", cgs.get("ball", "0")),
        "strike": count.get("strike", cgs.get("strike", "0")),
        "out": count.get("out", cgs.get("out", "0")),
    }

def extract_bases_from_state(cgs: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(cgs, dict):
        return {}
    bases = _safe_get(cgs, "bases") or cgs.get("bases") or {}
    if not isinstance(bases, dict):
        bases = {}
    return {
        "base1": bases.get("base1", cgs.get("base1", "0")),
        "base2": bases.get("base2", cgs.get("base2", "0")),
        "base3": bases.get("base3", cgs.get("base3", "0")),
    }

def inning_label(inn: Any, home_or_away: Any) -> str:
    if inn is None:
        return "?"
    top_bottom = "초" if str(home_or_away) in ("0", "T", "top", "TOP") else "말"
    return f"{inn}회{top_bottom}"

def _is_empty_base(v: Any) -> bool:
    return v in (None, "", "0", 0)

def bases_occupied(bases: Dict[str, Any]) -> List[str]:
    occ = []
    if not _is_empty_base(bases.get("base1")):
        occ.append("1루")
    if not _is_empty_base(bases.get("base2")):
        occ.append("2루")
    if not _is_empty_base(bases.get("base3")):
        occ.append("3루")
    return occ

def build_state(game_id: str) -> Dict[str, Any]:
    events = get_events(game_id)
    meta = REPLAY_STATE.get(game_id) or ReplayMeta()

    total = len(events)
    idx = max(0, min(meta.index, max(0, total - 1))) if total > 0 else 0

    last_event = events[idx] if total > 0 else None
    cgs = last_event.get("state") if isinstance(last_event, dict) else None

    inn = last_event.get("inn") if last_event else None
    hoa = last_event.get("homeOrAway") if last_event else None

    bases = extract_bases_from_state(cgs)

    return {
        "game_id": game_id,
        "replay": {
            "running": meta.running,
            "interval": meta.interval,
            "index": idx,
            "events_total": total,
            "inning": inn,
            "home_or_away": hoa,
            "inning_label": inning_label(inn, hoa),
        },
        "scoreboard": extract_scoreboard_from_state(cgs),
        "count": extract_count_from_state(cgs),
        "bases": bases,
        "bases_occupied": bases_occupied(bases),
        "last_event": {
            "seqno": last_event.get("seqno") if last_event else None,
            "type": last_event.get("type") if last_event else None,
            "text": last_event.get("text") if last_event else None,
        } if last_event else None,
    }

# =========================================================
# 3.5) 팀명 추출 + summary/commentary 텍스트
# =========================================================
def extract_teams_from_events(game_id: str) -> Dict[str, str]:
    if game_id in TEAM_CACHE:
        return TEAM_CACHE[game_id]

    events = get_events(game_id)
    away_team = None
    home_team = None

    pat = re.compile(r"(\S+)\s+공격")
    for e in events:
        txt = (e.get("text") or "").strip()
        hoa = str(e.get("homeOrAway") or "")
        m = pat.search(txt)
        if not m:
            continue

        team = m.group(1)
        if hoa == "0" and away_team is None:
            away_team = team
        elif hoa == "1" and home_team is None:
            home_team = team

        if away_team and home_team:
            break

    teams = {"away": away_team or "원정", "home": home_team or "홈"}
    TEAM_CACHE[game_id] = teams
    return teams

def format_team_score(scoreboard: Dict[str, Any], teams: Dict[str, str]) -> str:
    a = scoreboard.get("awayScore", "?")
    h = scoreboard.get("homeScore", "?")
    return f"스코어 {teams['away']} {a} - {h} {teams['home']}"

def format_count(count: Dict[str, Any]) -> str:
    b = count.get("ball", "0")
    s = count.get("strike", "0")
    o = count.get("out", "0")
    return f"B{b}-S{s}, {o}아웃"

def format_bases(bases: Dict[str, Any]) -> str:
    on = []
    if not _is_empty_base(bases.get("base1")):
        on.append("1루")
    if not _is_empty_base(bases.get("base2")):
        on.append("2루")
    if not _is_empty_base(bases.get("base3")):
        on.append("3루")
    return "주자: " + (", ".join(on) if on else "없음")

def state_to_sentence(state: Dict[str, Any], teams: Dict[str, str]) -> str:
    inning = state.get("replay", {}).get("inning_label", "?")
    sb = state.get("scoreboard", {})
    cnt = state.get("count", {})
    bases = state.get("bases", {})
    last = state.get("last_event", {}) or {}

    parts = [
        f"{inning}",
        format_team_score(sb, teams),
        format_count(cnt),
        format_bases(bases),
    ]
    if last.get("text"):
        parts.append(f"최근: {last['text']}")
    return " / ".join(parts)

# =========================================================
# 4) SSE
# =========================================================
async def broadcast_sse(game_id: str, data: Dict[str, Any]):
    queues = SSE_QUEUES.get(game_id, [])
    if not queues:
        return
    for q in list(queues):
        try:
            q.put_nowait(data)
        except Exception:
            pass

# =========================================================
# 5) replay loop  ✅ 들여쓰기/루프 수정본
# =========================================================
@dataclass
class ReplayMeta:
    index: int = 0
    running: bool = False
    interval: float = 10.0

REPLAY_STATE: Dict[str, ReplayMeta] = {}
REPLAY_TASKS: Dict[str, asyncio.Task] = {}

async def replay_loop(game_id: str):
    while True:
        try:
            meta = REPLAY_STATE.get(game_id)
            if meta is None:
                return

            if not meta.running:
                await asyncio.sleep(0.1)
                continue

            events = get_events(game_id)
            if len(events) == 0:
                meta.running = False
                await asyncio.sleep(0.2)
                continue

            # ✅ 끝까지 가면 0으로 되돌려서 계속 재생
            if meta.index >= len(events) - 1:
                meta.index = 0
                await broadcast_sse(game_id, {"type": "state", "data": build_state(game_id)})
                await asyncio.sleep(max(0.1, float(meta.interval)))
                continue

            meta.index += 1
            await broadcast_sse(game_id, {"type": "state", "data": build_state(game_id)})
            await asyncio.sleep(max(0.1, float(meta.interval)))

        except Exception as e:
            # ✅ task가 예외로 죽으면 "한 번만 돌고 멈춘 것처럼" 보임 → 로그 남기고 잠깐 쉬고 계속
            print(f"[replay_loop error] game_id={game_id} err={e}")
            await asyncio.sleep(0.5)


def ensure_replay_task(game_id: str):
    t = REPLAY_TASKS.get(game_id)
    if t and not t.done():
        return
    loop = asyncio.get_running_loop()
    REPLAY_TASKS[game_id] = loop.create_task(replay_loop(game_id))

# =========================================================
# 6) endpoints (relay)
# =========================================================
@app.get("/health")
async def health():
    return {
        "ok": True,
        "rules_count": len(RULES_DB),
        "cheers_count": len(CHEERS_DB),
        "players_count": len(PLAYERS_DB),
        "players_path": str(PLAYERS_PATH),
    }

@app.get("/games/{game_id}/debug/files")
async def debug_files(game_id: str):
    paths = _resolve_payload_paths(game_id)
    return {"game_id": game_id, "paths": paths}

@app.get("/games/{game_id}/debug/keys")
async def debug_keys(game_id: str):
    payloads, paths = load_payloads(game_id)
    payload = payloads[0]

    top_keys = list(payload.keys())
    r = payload.get("result", {})
    result_keys = list(r.keys()) if isinstance(r, dict) else []
    trd = r.get("textRelayData", {}) if isinstance(r, dict) else {}
    trd_keys = list(trd.keys()) if isinstance(trd, dict) else []
    trd_text_relays_len = (
        len(trd.get("textRelays", []))
        if isinstance(trd, dict) and isinstance(trd.get("textRelays"), list)
        else 0
    )

    return {
        "paths_used": paths,
        "top_keys": top_keys,
        "result_keys": result_keys,
        "textRelayData_keys": trd_keys,
        "textRelayData.textRelays_len(first_payload)": trd_text_relays_len,
    }

@app.get("/games/{game_id}/events")
async def events_all(game_id: str, limit: int = Query(200, ge=1, le=5000)):
    evs = get_events(game_id)
    return {"game_id": game_id, "total": len(evs), "events": evs[:limit]}

@app.get("/games/{game_id}/events/recent")
async def events_recent(game_id: str, n: int = Query(5, ge=1, le=50)):
    evs = get_events(game_id)
    meta = REPLAY_STATE.get(game_id) or ReplayMeta()

    if not evs:
        return {"game_id": game_id, "events": []}

    idx = max(0, min(meta.index, len(evs) - 1))
    start = max(0, idx - (n - 1))
    recent = evs[start : idx + 1]

    return {
        "game_id": game_id,
        "index": idx,
        "events": [
            {
                "seqno": e.get("seqno"),
                "type": e.get("type"),
                "inn": e.get("inn"),
                "homeOrAway": e.get("homeOrAway"),
                "text": e.get("text"),
            }
            for e in recent
        ],
    }

@app.get("/games/{game_id}/state")
async def state(game_id: str):
    get_events(game_id)
    return build_state(game_id)

# lineup / matchup / onfield
@app.get("/games/{game_id}/lineup")
async def lineup(game_id: str):
    get_events(game_id)
    lu = _get_lineups(game_id)
    return {
        "game_id": game_id,
        "lineup": lu,
        "counts": {"home": len(lu.get("home", []) or []), "away": len(lu.get("away", []) or [])},
    }

@app.get("/games/{game_id}/matchup")
async def matchup(game_id: str):
    evs = get_events(game_id)
    meta = REPLAY_STATE.get(game_id) or ReplayMeta()

    if not evs:
        return {"game_id": game_id, "matchup": {"pitcher": None, "batter": None}}

    idx = max(0, min(meta.index, len(evs) - 1))
    last_event = evs[idx]
    cgs = last_event.get("state") if isinstance(last_event, dict) else None
    if not isinstance(cgs, dict):
        return {"game_id": game_id, "matchup": {"pitcher": None, "batter": None}}

    p2n = _get_pcode_to_name(game_id)
    pitcher_pcode = str(cgs.get("pitcher") or "").strip()
    batter_pcode = str(cgs.get("batter") or "").strip()

    pitcher = {"pcode": pitcher_pcode, "name": p2n.get(pitcher_pcode)} if pitcher_pcode else None
    batter = {"pcode": batter_pcode, "name": p2n.get(batter_pcode)} if batter_pcode else None

    return {
        "game_id": game_id,
        "matchup": {
            "pitcher": pitcher,
            "batter": batter,
            "inning": last_event.get("inn"),
            "homeOrAway": last_event.get("homeOrAway"),
            "event_index": idx,
            "event_seqno": last_event.get("seqno"),
        },
    }

@app.get("/games/{game_id}/onfield")
async def onfield(game_id: str):
    st = build_state(game_id)
    lu = _get_lineups(game_id)

    mu_resp = await matchup(game_id)
    mu = mu_resp.get("matchup", {}) if isinstance(mu_resp, dict) else {}

    home_or_away = str(st.get("replay", {}).get("home_or_away"))
    offense = "away" if home_or_away in ("0", "T", "top", "TOP") else "home"
    defense = "home" if offense == "away" else "away"

    return {
        "game_id": game_id,
        "offense_team_side": offense,
        "defense_team_side": defense,
        "offense_lineup": lu.get(offense, []),
        "defense_pitcher": mu.get("pitcher"),
        "current_batter": mu.get("batter"),
        "meta": {
            "inning_label": st.get("replay", {}).get("inning_label"),
            "count": st.get("count"),
            "bases": st.get("bases"),
        },
    }

# replay control
@app.post("/games/{game_id}/replay/start")
async def replay_start(game_id: str, interval: float = Query(10.0, ge=0.1, le=60.0)):
    get_events(game_id)
    meta = REPLAY_STATE.get(game_id) or ReplayMeta()
    meta.interval = float(interval)
    meta.running = True
    REPLAY_STATE[game_id] = meta
    ensure_replay_task(game_id)
    return {"ok": True, "replay": meta.__dict__}

@app.post("/games/{game_id}/replay/pause")
async def replay_pause(game_id: str):
    get_events(game_id)
    meta = REPLAY_STATE.get(game_id) or ReplayMeta()
    meta.running = False
    REPLAY_STATE[game_id] = meta
    ensure_replay_task(game_id)
    return {"ok": True, "replay": meta.__dict__}

@app.post("/games/{game_id}/replay/seek")
async def replay_seek(game_id: str, index: int = Query(..., ge=0)):
    evs = get_events(game_id)
    meta = REPLAY_STATE.get(game_id) or ReplayMeta()
    meta.index = min(index, max(0, len(evs) - 1))
    REPLAY_STATE[game_id] = meta
    ensure_replay_task(game_id)
    return {"ok": True, "replay": meta.__dict__, "state": build_state(game_id)}

@app.post("/games/{game_id}/replay/reset")
async def replay_reset(game_id: str):
    get_events(game_id)
    REPLAY_STATE[game_id] = ReplayMeta(index=0, running=False, interval=10.0)
    ensure_replay_task(game_id)
    return {"ok": True, "replay": REPLAY_STATE[game_id].__dict__}

# SSE stream
@app.get("/games/{game_id}/stream")
async def stream(game_id: str):
    get_events(game_id)
    ensure_replay_task(game_id)

    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    SSE_QUEUES.setdefault(game_id, []).append(q)

    async def event_gen():
        yield {"event": "state", "data": json.dumps(build_state(game_id), ensure_ascii=False)}
        try:
            while True:
                msg = await q.get()
                if msg.get("type") == "state":
                    yield {"event": "state", "data": json.dumps(msg["data"], ensure_ascii=False)}
        finally:
            SSE_QUEUES[game_id] = [qq for qq in SSE_QUEUES.get(game_id, []) if qq is not q]

    return EventSourceResponse(event_gen())

@app.get("/games/{game_id}/summary")
async def summary(game_id: str):
    st = build_state(game_id)
    teams = extract_teams_from_events(game_id)
    return {"game_id": game_id, "teams": teams, "summary": state_to_sentence(st, teams), "state": st}

@app.get("/games/{game_id}/commentary")
async def commentary(game_id: str, n: int = Query(5, ge=1, le=20)):
    recent = await events_recent(game_id, n=n)
    texts = [e["text"] for e in recent.get("events", []) if e.get("text")]
    commentary_text = " / ".join(texts[-n:]) if texts else ""
    return {"game_id": game_id, "commentary": commentary_text, "recent": recent}

# =========================================================
# Proxy for Wanted LaaS
# =========================================================
@app.post("/api/proxy/chat")
async def proxy_chat(request: Request):
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON body: {e}")

    api_key = os.getenv("WANTED_LAAS_API_KEY")
    project_id = os.getenv("WANTED_LAAS_PROJECT_ID")
    preset_hash = os.getenv("WANTED_LAAS_PRESET_HASH")

    if not api_key or not project_id or not preset_hash:
        raise HTTPException(
            status_code=500,
            detail="Missing env: WANTED_LAAS_API_KEY / WANTED_LAAS_PROJECT_ID / WANTED_LAAS_PRESET_HASH",
        )

    api_url = "https://api-laas.wanted.co.kr/api/preset/v2/chat/completions"

    params = body.get("params") or {}
    if "tone" in body and "tone" not in params:
        params["tone"] = body["tone"]
    if "fan_team" in body and "fan_team" not in params:
        params["fan_team"] = body["fan_team"]

    messages = body.get("messages")
    if messages is None:
        user_message = body.get("user_message") or body.get("message") or ""
        messages = [{"role": "user", "content": user_message}] if user_message else []

    payload = {"hash": preset_hash, "params": params, "messages": messages}
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "project": project_id,
        "apiKey": api_key,
    }

    OVERLOAD_MSG = "잠깐만요! ⚾\n지금 AI 해설 서버에 질문이 한꺼번에 몰려서 숨 고르는 중이에요 😅\n잠시만 기다렸다가 다시 물어봐 주세요!"

    last_err = None
    for attempt in range(1, 3):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
                resp = await client.post(api_url, json=payload, headers=headers)

            # ✅ LAAS 과부하/게이트웨이 계열이면 고정 문구로 통일해서 내려주기
            if resp.status_code in (429, 500, 502, 503, 504):
                return JSONResponse(
                    status_code=503,  # 일시적 과부하 의미로 통일 (프론트 처리 쉬움)
                    content={"error": "LAAS_OVERLOADED", "message": OVERLOAD_MSG},
                )

            # 그 외 비정상 응답은 기존대로 상세 전달(디버깅용)
            if resp.status_code != 200:
                text = resp.text or ""

                # Cloudflare/HTML 에러 페이지 감지
                if "<html" in text.lower() or "cloudflare" in text.lower():
                    return JSONResponse(
                        status_code=502,
                        content={
                            "error": "LaaS Upstream Error (HTML from gateway)",
                            "status": resp.status_code,
                            "body": text[:1000],
                            "sent_payload": payload,
                        },
                    )

                return JSONResponse(
                    status_code=resp.status_code,
                    content={
                        "error": "LaaS API Error",
                        "status": resp.status_code,
                        "body": text,
                        "sent_payload": payload,
                    },
                )

            # ✅ 200이어도 JSON이 아닐 수 있으니 방어
            try:
                return resp.json()
            except Exception:
                return JSONResponse(
                    status_code=502,
                    content={
                        "error": "LaaS returned non-JSON on 200",
                        "body": (resp.text or "")[:1000],
                        "sent_payload": payload,
                    },
                )

        except (httpx.ReadTimeout, httpx.ConnectError, httpx.RemoteProtocolError) as e:
            last_err = str(e)
            await asyncio.sleep(0.3 * attempt)
            continue
        except Exception as e:
            last_err = str(e)
            break

    # ✅ 재시도 실패도 동일하게 과부하 안내로 내려주기
    return JSONResponse(
        status_code=503,
        content={"error": "LAAS_OVERLOADED", "message": OVERLOAD_MSG, "detail": last_err},
    )


# =========================================================
# Mount Static Files (Must be last)
# =========================================================
# 프로젝트 루트를 정적 파일로 서빙 (API 라우트가 우선)
app.mount("/", StaticFiles(directory=str(BASE_PATH.parent), html=True), name="static")
