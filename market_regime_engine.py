"""Deterministic market regime and portfolio allocation engine.

LLMs may gather and summarize information, but this module owns the mechanical
portfolio stance: regime, target cash range, risk exposure limits, and event
defense mode.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Tuple


METRIC_KEYS = (
    "indexTrend",
    "breadth",
    "volatility",
    "ratesPressure",
    "cryptoRisk",
    "semiconductorMomentum",
)


def _num(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(str(value).replace(",", "").strip())
    except Exception:
        return default


def _today(value: Any = None) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value[:10]).date()
        except Exception:
            pass
    return date.today()


def _is_cash(position: Dict[str, Any]) -> bool:
    return (
        str(position.get("assetType") or "").lower() == "cash"
        or str(position.get("symbol") or "").upper() == "CASH"
    )


def _symbol(position: Dict[str, Any]) -> str:
    return str(position.get("symbol") or "").strip().upper()


def _position_value(position: Dict[str, Any]) -> float:
    if _is_cash(position):
        return _num(position.get("cashAmount"), _num(position.get("shares"), 0.0))
    return _num(position.get("shares")) * _num(position.get("currentPrice"))


def _portfolio_exposure(investment: Dict[str, Any]) -> Dict[str, Any]:
    positions = [p for p in investment.get("positions") or [] if isinstance(p, dict)]
    total = sum(_position_value(p) for p in positions)
    cash = sum(_position_value(p) for p in positions if _is_cash(p))
    risk = max(0.0, total - cash)
    leverage_symbols = {"QLD", "TQQQ", "SOXL", "UPRO", "TECL", "FNGU"}
    leverage_value = sum(_position_value(p) for p in positions if _symbol(p) in leverage_symbols)
    volatile_value = sum(
        _position_value(p)
        for p in positions
        if _symbol(p) in {"IREN", "CRCL"} or str(p.get("assetType") or "").lower() == "crypto"
    )
    return {
        "totalValue": total,
        "cashValue": cash,
        "riskAssetValue": risk,
        "cashWeight": (cash / total * 100.0) if total else 0.0,
        "riskAssetWeight": (risk / total * 100.0) if total else 0.0,
        "leverageWeight": (leverage_value / total * 100.0) if total else 0.0,
        "volatileWeight": (volatile_value / total * 100.0) if total else 0.0,
    }


def _clamp(value: float, low: float = -1.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def _metric_quality(raw: Dict[str, Any], metrics: Dict[str, float], today: date) -> Dict[str, Any]:
    coverage = sum(1 for key in METRIC_KEYS if raw.get(key) not in (None, ""))
    updated_at = _parse_datetime(raw.get("updatedAt") or raw.get("fetchedAt"))
    stale = False
    age_days = None
    if updated_at:
        age_days = max(0, (today - updated_at.date()).days)
        stale = age_days >= 2
    sources = raw.get("sources") if isinstance(raw.get("sources"), list) else []
    if stale:
        data_quality = "stale"
    elif coverage < 3:
        data_quality = "insufficient"
    else:
        data_quality = "sufficient"
    return {
        "dataQuality": data_quality,
        "coverage": coverage,
        "requiredCoverage": 3,
        "stale": stale,
        "ageDays": age_days,
        "updatedAt": updated_at.isoformat() if updated_at else None,
        "sources": [str(item) for item in sources[:12]],
        "missing": [key for key in METRIC_KEYS if raw.get(key) in (None, "")],
    }


def build_market_regime_metrics(investment: Dict[str, Any], today_value: Any = None) -> Dict[str, Any]:
    market = investment.get("market") if isinstance(investment.get("market"), dict) else {}
    raw = market.get("regimeMetrics") if isinstance(market.get("regimeMetrics"), dict) else {}
    today = _today(today_value)
    metrics = {
        "indexTrend": _clamp(_num(raw.get("indexTrend"), _num(market.get("indexTrend"), 0.0))),
        "breadth": _clamp(_num(raw.get("breadth"), _num(market.get("breadth"), 0.0))),
        "volatility": _clamp(_num(raw.get("volatility"), _num(market.get("volatility"), 0.0))),
        "ratesPressure": _clamp(_num(raw.get("ratesPressure"), _num(market.get("ratesPressure"), 0.0))),
        "cryptoRisk": _clamp(_num(raw.get("cryptoRisk"), _num(market.get("cryptoRisk"), 0.0))),
        "semiconductorMomentum": _clamp(_num(raw.get("semiconductorMomentum"), _num(market.get("semiconductorMomentum"), 0.0))),
    }
    return {
        "metrics": metrics,
        "quality": _metric_quality(raw, metrics, today),
    }


def _market_metrics(investment: Dict[str, Any], today_value: Any = None) -> Dict[str, float]:
    return build_market_regime_metrics(investment, today_value)["metrics"]


def _near_big_events(investment: Dict[str, Any], today: date) -> List[Dict[str, Any]]:
    important_types = {"macro", "fomc", "cpi", "earnings", "policy", "geopolitical", "rates"}
    important_words = ["cpi", "fomc", "fed", "powell", "earnings", "실적", "금리", "법안", "전쟁", "호르무즈", "미중"]
    events = []
    for event in investment.get("events") or []:
        if not isinstance(event, dict):
            continue
        raw_date = str(event.get("date") or event.get("eventDate") or "")[:10]
        try:
            event_date = datetime.fromisoformat(raw_date).date()
        except Exception:
            continue
        days = (event_date - today).days
        if days < 0 or days > 5:
            continue
        text = " ".join([
            str(event.get("type") or ""),
            str(event.get("title") or ""),
            str(event.get("body") or ""),
        ]).lower()
        if str(event.get("type") or "").lower() in important_types or any(word in text for word in important_words):
            events.append({
                "id": event.get("id"),
                "date": raw_date,
                "daysAway": days,
                "type": event.get("type") or "event",
                "symbol": event.get("symbol") or "MACRO",
                "title": event.get("title") or event.get("type") or "Big event",
            })
    return events[:12]


def classify_market_regime(investment: Dict[str, Any], today_value: Any = None) -> Dict[str, Any]:
    inv = investment if isinstance(investment, dict) else {}
    today = _today(today_value)
    metrics_result = build_market_regime_metrics(inv, today)
    metrics = metrics_result["metrics"]
    quality = metrics_result["quality"]
    events = _near_big_events(inv, today)
    risk_score = (
        metrics["indexTrend"] * 0.35
        + metrics["breadth"] * 0.25
        + metrics["cryptoRisk"] * 0.10
        + metrics["semiconductorMomentum"] * 0.10
        - metrics["volatility"] * 0.20
        - metrics["ratesPressure"] * 0.10
    )
    if quality["dataQuality"] in {"insufficient", "stale"}:
        risk_score = _clamp(risk_score, -0.15, 0.15)
    if events:
        risk_score -= min(0.25, 0.08 * len(events))
    if risk_score >= 0.35:
        regime = "uptrend"
        label = "상승장"
        target_cash = [10, 25]
    elif risk_score <= -0.25:
        regime = "downtrend"
        label = "하락장"
        target_cash = [40, 65]
    else:
        regime = "sideways"
        label = "횡보장"
        target_cash = [25, 40]
    if events:
        target_cash = [max(target_cash[0], 30), max(target_cash[1], 45)]
    return {
        "regime": regime,
        "label": label,
        "riskScore": round(risk_score, 3),
        "targetCashRange": target_cash,
        "eventDefense": bool(events),
        "bigEvents": events,
        "metrics": metrics,
        "metricsQuality": quality,
    }


def build_portfolio_allocation_plan(investment: Dict[str, Any], regime: Dict[str, Any]) -> Dict[str, Any]:
    exposure = _portfolio_exposure(investment if isinstance(investment, dict) else {})
    low, high = regime.get("targetCashRange") or [25, 40]
    cash_weight = exposure["cashWeight"]
    actions: List[Dict[str, Any]] = []
    if cash_weight < low:
        actions.append({
            "type": "raise_cash",
            "priority": "high",
            "title": "현금 비중을 목표 하단까지 높이기",
            "reason": f"현재 현금 {cash_weight:.1f}%가 {regime.get('label')} 목표 {low}-{high}%보다 낮습니다.",
            "target": f"{low:.0f}% 이상",
        })
    elif cash_weight > high:
        actions.append({
            "type": "deploy_cash_selectively",
            "priority": "medium",
            "title": "현금 비중이 목표보다 높음",
            "reason": f"현재 현금 {cash_weight:.1f}%가 목표 {low}-{high}%보다 높습니다. 단, 조건 충족 전 일괄 투입은 금지입니다.",
            "target": f"{high:.0f}% 이하로 단계적 조정",
        })
    else:
        actions.append({
            "type": "hold_cash_band",
            "priority": "normal",
            "title": "현금 비중은 목표 범위 안",
            "reason": f"현재 현금 {cash_weight:.1f}%가 목표 {low}-{high}% 안에 있습니다.",
            "target": "유지",
        })

    if exposure["leverageWeight"] > 0 and (regime.get("regime") != "uptrend" or regime.get("eventDefense")):
        actions.append({
            "type": "cap_leverage",
            "priority": "high",
            "title": "레버리지 신규 추가 금지",
            "reason": f"레버리지 노출 {exposure['leverageWeight']:.1f}%는 {regime.get('label')} 또는 이벤트 방어 구간에서 변동성을 키웁니다.",
            "target": "추가매수 금지, 이벤트 후 재평가",
        })

    if exposure["volatileWeight"] >= 30 and regime.get("eventDefense"):
        actions.append({
            "type": "trim_event_risk",
            "priority": "high",
            "title": "이벤트 전 고변동 노출 점검",
            "reason": f"고변동 노출 {exposure['volatileWeight']:.1f}% 상태에서 빅 이벤트가 5일 내 있습니다.",
            "target": "시나리오표 작성 전 추격 금지",
        })

    do_not_do = []
    if regime.get("eventDefense"):
        do_not_do.append("빅 이벤트 전 레버리지/고변동 종목을 뉴스만 보고 추가매수하지 않는다.")
    if regime.get("regime") == "downtrend":
        do_not_do.append("하락장에서는 손실 직후 물타기와 현금 소진을 금지한다.")
    if regime.get("regime") == "sideways":
        do_not_do.append("횡보장에서는 돌파 확인 전 전액 진입하지 않는다.")
    if not do_not_do:
        do_not_do.append("상승장이어도 손절/무효화 조건 없는 신규 진입은 하지 않는다.")

    return {
        "exposure": exposure,
        "targetCashRange": regime.get("targetCashRange") or [25, 40],
        "cashGap": {
            "current": round(cash_weight, 2),
            "min": low,
            "max": high,
            "status": "too_low" if cash_weight < low else "too_high" if cash_weight > high else "in_range",
        },
        "actions": actions[:8],
        "doNotDo": do_not_do[:8],
    }


def build_market_allocation_engine(investment: Dict[str, Any], today_value: Any = None) -> Dict[str, Any]:
    regime = classify_market_regime(investment, today_value)
    allocation = build_portfolio_allocation_plan(investment if isinstance(investment, dict) else {}, regime)
    return {
        "version": "2026-05-13.market-regime-1",
        "date": _today(today_value).isoformat(),
        "regime": regime,
        "allocation": allocation,
    }
