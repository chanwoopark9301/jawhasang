"""Server-side investment thesis, view, and behavior-control engine.

The browser keeps UI state. This module keeps the investment judgement rules
pure and testable: no Flask, no network, no storage writes.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, List, Tuple


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


def _position_value(position: Dict[str, Any], price_key: str = "currentPrice") -> float:
    if _is_cash(position):
        return _num(position.get("cashAmount"), _num(position.get("shares"), 0.0))
    return _num(position.get("shares")) * _num(position.get(price_key))


def _cost_value(position: Dict[str, Any]) -> float:
    if _is_cash(position):
        return _position_value(position)
    return _num(position.get("shares")) * _num(position.get("avgPrice"))


def _tradable_positions(investment: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        p for p in investment.get("positions") or []
        if isinstance(p, dict) and _symbol(p) and not _is_cash(p)
    ]


def _portfolio_rows(investment: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
    positions = [p for p in investment.get("positions") or [] if isinstance(p, dict)]
    total_value = sum(_position_value(p) for p in positions)
    total_cost = sum(_cost_value(p) for p in positions)
    rows: List[Dict[str, Any]] = []
    for p in positions:
        value = _position_value(p)
        cost = _cost_value(p)
        rows.append({
            "symbol": _symbol(p),
            "name": str(p.get("name") or _symbol(p)),
            "assetType": str(p.get("assetType") or "stock").lower(),
            "shares": _num(p.get("shares")),
            "avgPrice": _num(p.get("avgPrice")),
            "currentPrice": _num(p.get("currentPrice")),
            "value": value,
            "cost": cost,
            "gain": value - cost,
            "gainPercent": ((value - cost) / cost * 100.0) if cost else 0.0,
            "weight": (value / total_value * 100.0) if total_value else 0.0,
            "raw": p,
        })
    return rows, {
        "totalValue": total_value,
        "totalCost": total_cost,
        "totalGain": total_value - total_cost,
        "totalGainPercent": ((total_value - total_cost) / total_cost * 100.0) if total_cost else 0.0,
    }


def _profile_for(position: Dict[str, Any]) -> Dict[str, Any]:
    symbol = _symbol(position)
    text = " ".join([
        symbol,
        str(position.get("name") or ""),
        str(position.get("assetType") or ""),
        str(position.get("thesis") or ""),
        str(position.get("addRule") or ""),
    ]).lower()

    if symbol == "CRCL" or any(k in text for k in ["circle", "usdc", "stablecoin", "payment"]):
        return {
            "profile": "stablecoin_issuer",
            "drivers": ["USDC supply", "reserve yield", "Fed path", "stablecoin legislation", "earnings quality"],
            "questions": ["USDC supply is expanding or shrinking?", "Are reserve yields compressing?", "Is legislation official or rumor?"],
        }
    if symbol in {"ETH", "ETH-USD", "BTC", "BTC-USD"} or any(k in text for k in ["ethereum", "bitcoin", "crypto"]):
        return {
            "profile": "crypto_beta",
            "drivers": ["crypto liquidity", "ETF flows", "policy risk", "risk appetite", "dollar and rates"],
            "questions": ["Is crypto beta confirming equity risk appetite?", "Are flows broad or event-only?"],
        }
    if symbol == "IREN" or any(k in text for k in ["miner", "mining", "data center", "datacenter", "gpu", "cloud"]):
        return {
            "profile": "ai_miner_infrastructure",
            "drivers": ["AI contract execution", "RPO/ARR conversion", "BTC hash economics", "funding and dilution", "power delivery"],
            "questions": ["Are contracts accepted and revenue-generating?", "Is growth funded without heavy dilution?"],
        }
    if symbol in {"QQQ", "QQQM", "QLD", "TQQQ", "SMH", "SOXX", "NVDA", "AMD", "AVGO", "TSM"} or any(k in text for k in ["nasdaq", "semiconductor", "ai capex", "chip"]):
        return {
            "profile": "growth_index_semiconductor",
            "drivers": ["Nasdaq breadth", "AI capex", "rates", "valuation", "momentum exhaustion"],
            "questions": ["Is breadth confirming the index move?", "Is this entry or chase?"],
        }
    return {
        "profile": "single_equity",
        "drivers": ["earnings", "guidance", "valuation", "sector trend", "company filings"],
        "questions": ["What would invalidate the original thesis?", "What event changes fair value?"],
    }


def build_theses(investment: Dict[str, Any]) -> List[Dict[str, Any]]:
    existing = investment.get("theses") or {}
    if isinstance(existing, list):
        existing = {str(t.get("symbol") or "").upper(): t for t in existing if isinstance(t, dict)}
    theses = []
    for p in _tradable_positions(investment):
        symbol = _symbol(p)
        old = existing.get(symbol, {}) if isinstance(existing, dict) else {}
        profile = _profile_for(p)
        thesis_text = old.get("thesis") or p.get("thesis") or _default_thesis(symbol, profile["profile"])
        theses.append({
            "symbol": symbol,
            "name": p.get("name") or symbol,
            "profile": profile["profile"],
            "thesis": thesis_text,
            "drivers": old.get("drivers") or profile["drivers"],
            "openQuestions": old.get("openQuestions") or profile["questions"],
            "invalidationRules": old.get("invalidationRules") or _default_invalidation_rules(profile["profile"]),
            "lastReviewedAt": old.get("lastReviewedAt"),
        })
    return theses


def _default_thesis(symbol: str, profile: str) -> str:
    if profile == "stablecoin_issuer":
        return f"{symbol} is driven more by stablecoin supply, reserve yield, and regulation than by headline EPS alone."
    if profile == "crypto_beta":
        return f"{symbol} is a crypto risk/liquidity exposure and should be judged with flows, rates, and policy signals."
    if profile == "ai_miner_infrastructure":
        return f"{symbol} depends on AI infrastructure execution, funding quality, BTC economics, and dilution control."
    if profile == "growth_index_semiconductor":
        return f"{symbol} is a growth/Nasdaq exposure where entry quality matters more than narrative strength."
    return f"{symbol} needs a written thesis, event calendar, and invalidation rule before aggressive sizing."


def _default_invalidation_rules(profile: str) -> List[str]:
    mapping = {
        "stablecoin_issuer": [
            "USDC supply trend weakens while valuation assumes growth.",
            "Regulation headline is not confirmed by official bill text or committee schedule.",
            "Reserve income outlook deteriorates faster than the market prices.",
        ],
        "crypto_beta": [
            "Crypto policy or ETF flow confirms risk-off rather than risk-on.",
            "Price breaks support without improving liquidity or breadth.",
        ],
        "ai_miner_infrastructure": [
            "AI contract acceptance, RPO/ARR conversion, or power delivery is delayed.",
            "Growth requires unexpected dilution or expensive funding.",
            "BTC/hash economics deteriorate while AI execution is unproven.",
        ],
        "growth_index_semiconductor": [
            "Nasdaq move is narrow and rates move against duration assets.",
            "Position is entered after a sharp rally without a pullback or stop.",
        ],
    }
    return mapping.get(profile, [
        "The original thesis no longer explains the price move.",
        "The next catalyst is unclear or already priced in.",
    ])


def _parse_event_date(event: Dict[str, Any]) -> date | None:
    raw = str(event.get("date") or event.get("published") or "")[:10]
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw).date()
    except Exception:
        return None


def _event_relevance(event: Dict[str, Any], symbol: str) -> bool:
    event_symbol = str(event.get("symbol") or "").upper()
    if not event_symbol or event_symbol in {"MACRO", "MARKET"}:
        return True
    return event_symbol == symbol


def _evidence_level(event: Dict[str, Any]) -> str:
    text = " ".join([
        str(event.get("source") or ""),
        str(event.get("sourceUrl") or ""),
        str(event.get("title") or ""),
    ]).lower()
    if any(k in text for k in ["sec", "edgar", "investor relations", "10-q", "8-k", "earnings call"]):
        return "A"
    if any(k in text for k in ["reuters", "bloomberg", "cnbc", "wsj", "ft.com", "marketwatch"]):
        return "B"
    if any(k in text for k in ["analyst", "consensus", "price target", "tipranks", "zacks"]):
        return "C"
    if any(k in text for k in ["x.com", "twitter", "signal", "rumor"]):
        return "D"
    return "E"


def build_behavior_controls(investment: Dict[str, Any], theses: List[Dict[str, Any]], today_value: Any = None) -> List[Dict[str, Any]]:
    today = _today(today_value)
    rows, totals = _portfolio_rows(investment)
    rules = investment.get("rules") or {}
    max_weight = _num(rules.get("maxPositionWeight"), 25.0)
    chase_limit = abs(_num(rules.get("chaseLimit"), 3.0))
    cooldown_days = 2
    recent_decisions = investment.get("decisions") or []
    events = investment.get("events") or []
    thesis_map = {t["symbol"]: t for t in theses}
    controls: List[Dict[str, Any]] = []

    for row in rows:
        if row["assetType"] == "cash" or row["symbol"] == "CASH":
            continue
        symbol = row["symbol"]
        state = "observe"
        severity = "allow"
        reasons: List[str] = []
        blocked: List[str] = []
        required: List[str] = []

        if row["weight"] > max_weight:
            state = "blocked"
            severity = "block"
            blocked.append("buy/add")
            reasons.append(f"Position weight {row['weight']:.1f}% exceeds max {max_weight:.1f}%.")

        change = _num(row["raw"].get("changePercent"), 0.0)
        if change >= chase_limit:
            if severity != "block":
                state = "cooldown"
                severity = "watch"
            blocked.append("market buy")
            reasons.append(f"Today move {change:.1f}% is above chase limit {chase_limit:.1f}%.")

        if not _num(row["raw"].get("stopPrice")) and not thesis_map.get(symbol, {}).get("invalidationRules"):
            if severity != "block":
                state = "needs_plan"
                severity = "watch"
            required.append("write invalidation rule")
            reasons.append("No stop price or thesis invalidation rule is recorded.")

        near_events = []
        for event in events:
            event_date = _parse_event_date(event)
            if not event_date or not _event_relevance(event, symbol):
                continue
            days = (event_date - today).days
            if -1 <= days <= 3 and str(event.get("type") or "") in {"earnings", "macro", "analyst", "signal", "news"}:
                near_events.append(event)
        if near_events:
            if severity != "block":
                state = "event_wait"
                severity = "watch"
            blocked.append("impulse trade")
            required.append("scenario table before order")
            titles = ", ".join(str(e.get("title") or e.get("type"))[:60] for e in near_events[:2])
            reasons.append(f"Near catalyst: {titles}.")

        for decision in recent_decisions:
            if str(decision.get("symbol") or "").upper() != symbol:
                continue
            action = str(decision.get("action") or "").lower()
            if action != "sell":
                continue
            raw_date = str(decision.get("date") or decision.get("createdAt") or "")[:10]
            try:
                decision_date = datetime.fromisoformat(raw_date).date()
            except Exception:
                continue
            if 0 <= (today - decision_date).days <= cooldown_days:
                if severity != "block":
                    state = "cooldown"
                    severity = "watch"
                blocked.append("immediate re-entry")
                reasons.append("Recent sell detected; protect realized cash from FOMO re-entry.")
                break

        if not reasons:
            reasons.append("No immediate rule violation detected; still require price, size, and invalidation before action.")
            required.append("confirm order size and invalidation")

        controls.append({
            "symbol": symbol,
            "state": state,
            "severity": severity,
            "weight": round(row["weight"], 2),
            "blockedActions": sorted(set(blocked)),
            "requiredBeforeAction": sorted(set(required)),
            "reasons": reasons,
        })
    return controls


def build_research_queue(investment: Dict[str, Any], theses: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    events = investment.get("events") or []
    queue: List[Dict[str, Any]] = []
    for thesis in theses:
        symbol = thesis["symbol"]
        drivers = thesis.get("drivers") or []
        for driver in drivers[:4]:
            queue.append({
                "symbol": symbol,
                "driver": driver,
                "query": f"{symbol} {driver} latest official filing investor relations trusted financial news",
                "evidenceNeeded": "A/B first, C for consensus, D only as unconfirmed signal",
            })
        relevant_events = [e for e in events if _event_relevance(e, symbol)]
        if relevant_events:
            queue.append({
                "symbol": symbol,
                "driver": "event follow-up",
                "query": f"{symbol} upcoming catalyst official date earnings macro impact",
                "evidenceNeeded": "official calendar, company IR, SEC filing",
            })
    queue.append({
        "symbol": "MACRO",
        "driver": "market regime",
        "query": "CPI Fed rates dollar oil China trade Nasdaq breadth crypto policy this week",
        "evidenceNeeded": "official calendars and trusted market data",
    })
    return queue[:24]


def build_market_view(investment: Dict[str, Any], theses: List[Dict[str, Any]], controls: List[Dict[str, Any]], today_value: Any = None) -> Dict[str, Any]:
    today = _today(today_value)
    rows, totals = _portfolio_rows(investment)
    tradable_rows = [r for r in rows if r["assetType"] != "cash" and r["symbol"] != "CASH"]
    top_rows = sorted(tradable_rows, key=lambda r: r["weight"], reverse=True)[:3]
    events = investment.get("events") or []

    evidence = []
    for event in events:
        event_date = _parse_event_date(event)
        if event_date and abs((event_date - today).days) <= 7:
            evidence.append({
                "id": event.get("id"),
                "date": event_date.isoformat(),
                "symbol": str(event.get("symbol") or ""),
                "type": str(event.get("type") or "event"),
                "title": str(event.get("title") or ""),
                "evidenceLevel": _evidence_level(event),
            })
    evidence = sorted(evidence, key=lambda e: (e["date"], e["symbol"], e["title"]))[:12]

    key_issues = []
    for row in top_rows:
        thesis = next((t for t in theses if t["symbol"] == row["symbol"]), None)
        control = next((c for c in controls if c["symbol"] == row["symbol"]), None)
        key_issues.append({
            "symbol": row["symbol"],
            "weight": round(row["weight"], 2),
            "profile": thesis.get("profile") if thesis else "unknown",
            "view": thesis.get("thesis") if thesis else "No thesis recorded.",
            "controlState": control.get("state") if control else "observe",
            "whyItMatters": _why_it_matters(row, thesis),
        })

    blocked = [c for c in controls if c.get("blockedActions")]
    top_line = _build_top_line(key_issues, blocked, evidence)
    return {
        "date": today.isoformat(),
        "topLine": top_line,
        "portfolio": totals,
        "keyIssues": key_issues,
        "evidence": evidence,
        "doNotDo": _build_do_not_do(blocked),
        "falsificationFocus": _build_falsification_focus(theses, key_issues),
    }


def _why_it_matters(row: Dict[str, Any], thesis: Dict[str, Any] | None) -> str:
    if not thesis:
        return "Sizing exists before a written thesis; the next action needs a thesis first."
    drivers = ", ".join((thesis.get("drivers") or [])[:3])
    return f"{row['symbol']} is {row['weight']:.1f}% of account exposure; today's view should be checked against {drivers}."


def _build_top_line(key_issues: List[Dict[str, Any]], blocked: List[Dict[str, Any]], evidence: List[Dict[str, Any]]) -> str:
    if blocked:
        symbols = ", ".join(sorted({c["symbol"] for c in blocked if c.get("symbol")})[:3])
        return f"Control first: {symbols or 'portfolio'} has blocked or cooldown actions before any new risk."
    if evidence:
        return "Evidence first: nearby catalysts must be confirmed with official/trusted sources before trade changes."
    if key_issues:
        return f"View first: {key_issues[0]['symbol']} is the main exposure, so its thesis drivers decide the day."
    return "No tradable exposure found; build the ledger before making an investment view."


def _build_do_not_do(blocked: List[Dict[str, Any]]) -> List[str]:
    actions = []
    for control in blocked:
        for action in control.get("blockedActions") or []:
            actions.append(f"{control['symbol']}: do not {action} until required checks are done.")
    if not actions:
        actions.append("Do not place a trade without size, invalidation, and event check.")
    return actions[:8]


def _build_falsification_focus(theses: List[Dict[str, Any]], key_issues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    wanted = {issue["symbol"] for issue in key_issues}
    rows = []
    for thesis in theses:
        if thesis["symbol"] not in wanted:
            continue
        rows.append({
            "symbol": thesis["symbol"],
            "rules": (thesis.get("invalidationRules") or [])[:3],
        })
    return rows


def build_investment_desk_engine(investment: Dict[str, Any], today_value: Any = None) -> Dict[str, Any]:
    today = _today(today_value)
    inv = investment if isinstance(investment, dict) else {}
    theses = build_theses(inv)
    controls = build_behavior_controls(inv, theses, today)
    market_view = build_market_view(inv, theses, controls, today)
    research_queue = build_research_queue(inv, theses)
    return {
        "version": "2026-05-11.py-engine-1",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "date": today.isoformat(),
        "marketView": market_view,
        "theses": theses,
        "behaviorControls": controls,
        "researchQueue": research_queue,
        "summary": render_engine_brief({
            "marketView": market_view,
            "behaviorControls": controls,
            "theses": theses,
        }),
    }


def render_engine_brief(engine: Dict[str, Any]) -> str:
    view = engine.get("marketView") or {}
    controls = engine.get("behaviorControls") or []
    theses = engine.get("theses") or []
    blocked = [c for c in controls if c.get("blockedActions")]
    lines = [
        f"Top line: {view.get('topLine') or 'No view generated.'}",
        "Key issues:",
    ]
    for issue in (view.get("keyIssues") or [])[:3]:
        lines.append(f"- {issue.get('symbol')}: {issue.get('view')} ({issue.get('controlState')})")
    lines.append("Do not do:")
    for item in (view.get("doNotDo") or [])[:5]:
        lines.append(f"- {item}")
    if not blocked:
        lines.append("- No blocked action, but every order still needs size/invalidation/event check.")
    lines.append("Thesis drivers:")
    for thesis in theses[:4]:
        lines.append(f"- {thesis.get('symbol')}: {', '.join((thesis.get('drivers') or [])[:4])}")
    return "\n".join(lines)
