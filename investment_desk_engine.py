"""Server-side investment thesis, view, and behavior-control engine.

The browser keeps UI state. This module keeps the investment judgement rules
pure and testable: no Flask, no network, no storage writes.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Tuple
from market_regime_engine import build_market_allocation_engine


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


def _parse_record_date(record: Dict[str, Any]) -> date | None:
    raw = str(record.get("date") or record.get("createdAt") or record.get("timestamp") or "")[:10]
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


def _event_text(event: Dict[str, Any]) -> str:
    return " ".join([
        str(event.get("symbol") or ""),
        str(event.get("type") or ""),
        str(event.get("title") or ""),
        str(event.get("body") or ""),
        str(event.get("source") or ""),
    ]).lower()


def _driver_keywords(driver: str, profile: str) -> List[str]:
    text = f"{driver} {profile}".lower()
    base = {
        "usdc": ["usdc", "stablecoin", "reserve", "circle", "issuance", "supply"],
        "regulation": ["clarity", "genius", "stablecoin", "bill", "markup", "senate", "house", "regulation", "policy"],
        "rates": ["fed", "rate", "powell", "cpi", "inflation", "yield", "dollar"],
        "ai": ["ai", "cloud", "gpu", "microsoft", "anthropic", "contract", "rpo", "arr", "data center", "datacenter"],
        "dilution": ["dilution", "offering", "atm", "convertible", "shares", "equity", "424b5"],
        "btc": ["bitcoin", "btc", "hash", "mining", "hashprice"],
        "earnings": ["earnings", "eps", "revenue", "guidance", "10-q", "8-k", "call"],
        "semis": ["nasdaq", "semiconductor", "nvda", "chip", "ai capex", "breadth", "valuation", "momentum"],
        "crypto": ["crypto", "ethereum", "eth", "bitcoin", "btc", "etf", "flows", "liquidity"],
    }
    keywords: List[str] = []
    for key, values in base.items():
        if key in text or any(value in text for value in values):
            keywords.extend(values)
    keywords.extend([part for part in driver.lower().replace("/", " ").split() if len(part) >= 4])
    return sorted(set(keywords))


def _classify_evidence_impact(text: str, level: str) -> Tuple[str, str]:
    negative_terms = [
        "dilution", "offering", "atm", "downgrade", "miss", "delay", "delayed",
        "weaker", "decline", "outflow", "lawsuit", "investigation", "risk",
        "hot cpi", "rate hike", "inflation", "termination", "guidance cut",
    ]
    positive_terms = [
        "beat", "raise", "raised", "upgrade", "approval", "approved", "accepted",
        "contract", "prepayment", "growth", "increase", "inflow", "record",
        "on schedule", "guidance raised", "partnership",
    ]
    unconfirmed_terms = ["rumor", "reportedly", "x.com", "twitter", "unconfirmed", "may", "could", "signal"]
    if any(term in text for term in negative_terms):
        return "bearish", "possible thesis damage or risk expansion"
    if any(term in text for term in positive_terms):
        if level in {"D", "E"} or any(term in text for term in unconfirmed_terms):
            return "unconfirmed", "positive signal needs official/trusted confirmation"
        return "bullish", "supports one or more thesis drivers"
    if level in {"D", "E"} or any(term in text for term in unconfirmed_terms):
        return "unconfirmed", "weak-source or incomplete signal"
    return "neutral", "relevant but direction is not yet clear"


def build_thesis_evidence(investment: Dict[str, Any], theses: List[Dict[str, Any]], today_value: Any = None) -> Dict[str, Dict[str, Any]]:
    today = _today(today_value)
    events = [e for e in investment.get("events") or [] if isinstance(e, dict)]
    results: Dict[str, Dict[str, Any]] = {
        thesis["symbol"]: {
            "bullishEvidence": [],
            "bearishEvidence": [],
            "unconfirmedEvidence": [],
            "neutralEvidence": [],
            "pressureScore": 0,
            "status": "unproven",
        }
        for thesis in theses
    }

    for thesis in theses:
        symbol = thesis["symbol"]
        profile = thesis.get("profile") or ""
        drivers = thesis.get("drivers") or []
        driver_terms = {driver: _driver_keywords(driver, profile) for driver in drivers}
        for event in events:
            event_date = _parse_event_date(event)
            if event_date and abs((event_date - today).days) > 14:
                continue
            if not _event_relevance(event, symbol):
                continue
            text = _event_text(event)
            matched = [
                driver for driver, terms in driver_terms.items()
                if any(term and term in text for term in terms)
            ]
            if not matched and str(event.get("symbol") or "").upper() not in {symbol, "MACRO", "MARKET", ""}:
                continue
            level = _evidence_level(event)
            impact, reason = _classify_evidence_impact(text, level)
            item = {
                "eventId": event.get("id"),
                "date": str(event.get("date") or "")[:10],
                "symbol": symbol,
                "title": str(event.get("title") or event.get("type") or "evidence"),
                "drivers": matched or drivers[:1],
                "impact": impact,
                "evidenceLevel": level,
                "reason": reason,
                "needsVerification": level in {"D", "E"} or impact == "unconfirmed",
            }
            bucket = {
                "bullish": "bullishEvidence",
                "bearish": "bearishEvidence",
                "unconfirmed": "unconfirmedEvidence",
                "neutral": "neutralEvidence",
            }[impact]
            results[symbol][bucket].append(item)

    for symbol, data in results.items():
        score = (
            len(data["bullishEvidence"]) * 2
            - len(data["bearishEvidence"]) * 3
            - len(data["unconfirmedEvidence"])
        )
        data["pressureScore"] = score
        if data["bearishEvidence"]:
            data["status"] = "under_pressure"
        elif data["bullishEvidence"] and not data["unconfirmedEvidence"]:
            data["status"] = "supported"
        elif data["unconfirmedEvidence"]:
            data["status"] = "needs_confirmation"
        else:
            data["status"] = "unproven"
        for key in ("bullishEvidence", "bearishEvidence", "unconfirmedEvidence", "neutralEvidence"):
            data[key] = data[key][:5]
    return results


def build_behavior_controls(investment: Dict[str, Any], theses: List[Dict[str, Any]], today_value: Any = None, evidence_map: Dict[str, Dict[str, Any]] | None = None) -> List[Dict[str, Any]]:
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

        thesis_evidence = (evidence_map or {}).get(symbol) or {}
        if thesis_evidence.get("status") == "under_pressure":
            if severity != "block":
                state = "review"
                severity = "watch"
            blocked.append("add before thesis review")
            required.append("review bearish evidence")
            title = (thesis_evidence.get("bearishEvidence") or [{}])[0].get("title") or "bearish evidence"
            reasons.append(f"Thesis pressure detected: {title}.")
        elif thesis_evidence.get("status") == "needs_confirmation":
            if severity != "block":
                state = "confirmation_wait"
                severity = "watch"
            blocked.append("act on rumor")
            required.append("confirm with A/B evidence")
            reasons.append("Relevant evidence exists but source quality or direction is not strong enough.")

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


def build_scenarios(investment: Dict[str, Any], theses: List[Dict[str, Any]], controls: List[Dict[str, Any]], evidence_map: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows, _totals = _portfolio_rows(investment)
    row_map = {row["symbol"]: row for row in rows}
    control_map = {control["symbol"]: control for control in controls}
    scenarios: List[Dict[str, Any]] = []
    for thesis in theses:
        symbol = thesis["symbol"]
        row = row_map.get(symbol, {})
        control = control_map.get(symbol, {})
        evidence = evidence_map.get(symbol, {})
        profile = thesis.get("profile") or "single_equity"
        bullish = evidence.get("bullishEvidence") or []
        bearish = evidence.get("bearishEvidence") or []
        unconfirmed = evidence.get("unconfirmedEvidence") or []
        blocked = control.get("blockedActions") or []
        scenario = {
            "symbol": symbol,
            "profile": profile,
            "weight": round(_num(row.get("weight")), 2),
            "status": evidence.get("status") or "unproven",
            "bullCase": _build_bull_case(symbol, thesis, bullish, unconfirmed, control),
            "baseCase": _build_base_case(symbol, thesis, evidence, control),
            "bearCase": _build_bear_case(symbol, thesis, bearish, control),
            "blockedActions": blocked,
        }
        scenarios.append(scenario)
    return scenarios


def _driver_label(thesis: Dict[str, Any], fallback: str) -> str:
    drivers = thesis.get("drivers") or []
    return ", ".join(drivers[:3]) if drivers else fallback


def _build_bull_case(symbol: str, thesis: Dict[str, Any], bullish: List[Dict[str, Any]], unconfirmed: List[Dict[str, Any]], control: Dict[str, Any]) -> Dict[str, Any]:
    profile = thesis.get("profile") or ""
    if bullish and not unconfirmed and not control.get("blockedActions"):
        return {
            "condition": f"{symbol} thesis drivers are supported by A/B quality evidence.",
            "action": "hold_or_planned_add_only",
            "requiredEvidence": ["Position size still below max rule", "Order has price, size, and invalidation"],
            "blockedUntil": "",
            "rationale": ["Evidence supports thesis, but execution still needs a pre-written order plan."],
        }
    if profile == "stablecoin_issuer":
        required = ["Official bill text or committee schedule", "USDC supply/reserve trend", "Earnings call commentary"]
    elif profile == "ai_miner_infrastructure":
        required = ["Company IR/SEC confirmation of AI contract execution", "RPO/ARR or acceptance evidence", "Funding/dilution update"]
    elif profile == "growth_index_semiconductor":
        required = ["Nasdaq breadth confirmation", "Rates not moving against duration assets", "Pullback or clear stop level"]
    elif profile == "crypto_beta":
        required = ["ETF/on-chain/flow confirmation", "Policy signal from official or trusted source", "Risk appetite confirmation"]
    else:
        required = ["A/B quality evidence for key drivers", "Defined invalidation rule"]
    return {
        "condition": f"{symbol} bull case needs confirmation across {_driver_label(thesis, 'key drivers')}.",
        "action": "wait_for_confirmation",
        "requiredEvidence": required,
        "blockedUntil": "A/B evidence confirms the thesis and behavior controls clear",
        "rationale": ["Positive or relevant signals are not enough until they are confirmed by reliable evidence."],
    }


def _build_base_case(symbol: str, thesis: Dict[str, Any], evidence: Dict[str, Any], control: Dict[str, Any]) -> Dict[str, Any]:
    status = evidence.get("status") or "unproven"
    if status == "needs_confirmation":
        return {
            "condition": f"{symbol} has relevant but unconfirmed signals.",
            "action": "wait_for_confirmation",
            "requiredEvidence": ["A/B evidence before action", "Official source or trusted financial media confirmation"],
            "blockedUntil": "unconfirmed evidence is upgraded or expires",
            "rationale": ["Do not convert rumor, X flow, or weak RSS into a trade."],
        }
    if status == "under_pressure":
        return {
            "condition": f"{symbol} thesis is under pressure but not fully invalidated.",
            "action": "review_before_hold_or_add",
            "requiredEvidence": ["Read bearish evidence", "Rewrite invalidation rule", "Decide reduce/hold threshold"],
            "blockedUntil": "thesis review is written",
            "rationale": ["Holding can be valid, but adding risk before review is not."],
        }
    if not thesis.get("lastReviewedAt") and status == "unproven":
        return {
            "condition": f"{symbol} has exposure before a reviewed thesis history.",
            "action": "write_plan_before_trade",
            "requiredEvidence": ["Thesis", "Invalidation rule", "Next catalyst"],
            "blockedUntil": "plan exists",
            "rationale": ["The app should slow down trades when the thesis is not reviewed."],
        }
    if control.get("blockedActions"):
        return {
            "condition": f"{symbol} has behavior-control blocks.",
            "action": "obey_control_gate",
            "requiredEvidence": control.get("requiredBeforeAction") or ["Clear blocked actions"],
            "blockedUntil": ", ".join(control.get("blockedActions") or []),
            "rationale": control.get("reasons") or ["Behavior control is active."],
        }
    return {
        "condition": f"{symbol} remains in observation mode.",
        "action": "hold_or_observe",
        "requiredEvidence": ["Keep price, event, and thesis checks updated"],
        "blockedUntil": "",
        "rationale": ["No decisive new evidence; avoid unnecessary action."],
    }


def _build_bear_case(symbol: str, thesis: Dict[str, Any], bearish: List[Dict[str, Any]], control: Dict[str, Any]) -> Dict[str, Any]:
    if bearish:
        titles = [str(item.get("title") or "") for item in bearish[:3]]
        return {
            "condition": f"{symbol} bearish evidence hits thesis drivers.",
            "action": "reduce_or_exit_review",
            "requiredEvidence": ["Compare bearish evidence with invalidation rules", "Decide reduce/exit trigger before next trade"],
            "blockedUntil": "bearish evidence is disproved or position action is reviewed",
            "rationale": titles or ["Bearish evidence is present."],
        }
    rules = thesis.get("invalidationRules") or []
    return {
        "condition": f"{symbol} bear case is triggered if invalidation rules are met.",
        "action": "prepare_reduce_rule",
        "requiredEvidence": rules[:3] or ["Written invalidation rule"],
        "blockedUntil": "",
        "rationale": ["No bearish evidence yet, but the exit rule must be ready before volatility."],
    }


def build_market_view(investment: Dict[str, Any], theses: List[Dict[str, Any]], controls: List[Dict[str, Any]], today_value: Any = None, evidence_map: Dict[str, Dict[str, Any]] | None = None, market_regime: Dict[str, Any] | None = None) -> Dict[str, Any]:
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
            "thesisStatus": ((evidence_map or {}).get(row["symbol"]) or {}).get("status", "unproven"),
            "pressureScore": ((evidence_map or {}).get(row["symbol"]) or {}).get("pressureScore", 0),
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
        "thesisEvidence": evidence_map or {},
        "marketRegime": market_regime or {},
    }


def build_market_regime_review(investment: Dict[str, Any], today_value: Any = None, window_days: int = 7) -> Dict[str, Any]:
    today = _today(today_value)
    inv = investment if isinstance(investment, dict) else {}
    start = today - timedelta(days=max(1, window_days))
    snapshots = []
    for snapshot in inv.get("deskSnapshots") or []:
        if not isinstance(snapshot, dict):
            continue
        snapshot_date = _parse_record_date(snapshot)
        if snapshot_date and start <= snapshot_date <= today:
            snapshots.append((snapshot_date, snapshot))

    decisions = []
    for decision in inv.get("decisions") or []:
        if not isinstance(decision, dict):
            continue
        decision_date = _parse_record_date(decision)
        if decision_date and start <= decision_date <= today:
            decisions.append((decision_date, decision))

    snapshot_by_date = {snapshot_date.isoformat(): snapshot for snapshot_date, snapshot in snapshots}
    violations: List[Dict[str, Any]] = []
    for decision_date, decision in decisions:
        action = str(decision.get("action") or "").strip().lower()
        if action not in {"buy", "add"}:
            continue
        symbol = str(decision.get("symbol") or "").strip().upper()
        snapshot = snapshot_by_date.get(decision_date.isoformat())
        if not snapshot:
            continue

        nested_regime = snapshot.get("marketRegime") or {}
        regime_info = nested_regime.get("regime") or {}
        allocation = nested_regime.get("allocation") or {}
        event_level = str(snapshot.get("eventDefenseLevel") or regime_info.get("eventDefenseLevel") or "normal").lower()
        cash_gap = snapshot.get("cashGap") if isinstance(snapshot.get("cashGap"), dict) else allocation.get("cashGap") or {}
        cash_status = str(cash_gap.get("status") or "ok")
        allocation_actions = allocation.get("actions") or []
        action_types = {str(item.get("type") or "") for item in allocation_actions if isinstance(item, dict)}

        if event_level in {"medium", "high"}:
            if "cap_leverage" in action_types and _allocation_action_applies_to_trade("cap_leverage", symbol, "buy"):
                violations.append(_market_regime_violation(
                    decision_date,
                    decision,
                    "event_defense_buy",
                    "Buy/add happened while event defense was active and leverage adds were capped.",
                    event_level,
                    cash_status,
                ))
                continue
            if cash_status == "too_low":
                violations.append(_market_regime_violation(
                    decision_date,
                    decision,
                    "event_defense_buy",
                    "Buy/add happened while event defense was active and cash was below the target range.",
                    event_level,
                    cash_status,
                ))

    score = -25 * len(violations)
    return {
        "windowDays": window_days,
        "snapshotCount": len(snapshots),
        "decisionCount": len(decisions),
        "violationCount": len(violations),
        "violations": violations[:20],
        "score": score,
        "summary": _market_regime_review_summary(score, violations),
    }


def _market_regime_violation(decision_date: date, decision: Dict[str, Any], violation_type: str, reason: str, event_level: str, cash_status: str) -> Dict[str, Any]:
    return {
        "id": str(decision.get("id") or ""),
        "date": decision_date.isoformat(),
        "symbol": str(decision.get("symbol") or "").strip().upper(),
        "action": str(decision.get("action") or "").strip().lower(),
        "type": violation_type,
        "severity": "high" if event_level == "high" else "medium",
        "reason": reason,
        "eventDefenseLevel": event_level,
        "cashStatus": cash_status,
    }


def _market_regime_review_summary(score: int, violations: List[Dict[str, Any]]) -> str:
    if not violations:
        return "No market-regime control violations found in the review window."
    symbols = ", ".join(sorted({item.get("symbol") for item in violations if item.get("symbol")})[:4])
    return f"{len(violations)} market-regime control violation(s) found: {symbols or 'portfolio'}."


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
    evidence_map = build_thesis_evidence(inv, theses, today)
    for thesis in theses:
        thesis.update(evidence_map.get(thesis["symbol"], {}))
    controls = build_behavior_controls(inv, theses, today, evidence_map)
    scenarios = build_scenarios(inv, theses, controls, evidence_map)
    market_regime = build_market_allocation_engine(inv, today)
    market_view = build_market_view(inv, theses, controls, today, evidence_map, market_regime)
    market_regime_review = build_market_regime_review(inv, today)
    research_queue = build_research_queue(inv, theses)
    return {
        "version": "2026-05-13.py-engine-4",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "date": today.isoformat(),
        "marketRegime": market_regime,
        "marketRegimeReview": market_regime_review,
        "marketView": market_view,
        "theses": theses,
        "behaviorControls": controls,
        "thesisEvidence": evidence_map,
        "scenarios": scenarios,
        "researchQueue": research_queue,
        "summary": render_engine_brief({
            "marketView": market_view,
            "behaviorControls": controls,
            "theses": theses,
            "scenarios": scenarios,
        }),
    }


def evaluate_trade_intent_gate(investment: Dict[str, Any], intent: Dict[str, Any], today_value: Any = None) -> Dict[str, Any]:
    inv = investment if isinstance(investment, dict) else {}
    raw_intent = intent if isinstance(intent, dict) else {}
    symbol = str(raw_intent.get("symbol") or "").strip().upper()
    action = str(raw_intent.get("action") or "buy").strip().lower()
    if action == "add":
        action = "buy"
    engine = build_investment_desk_engine(inv, today_value or raw_intent.get("date"))
    controls = {item.get("symbol"): item for item in engine.get("behaviorControls") or []}
    scenarios = {item.get("symbol"): item for item in engine.get("scenarios") or []}
    thesis_evidence = (engine.get("thesisEvidence") or {}).get(symbol) or {}
    control = controls.get(symbol)
    scenario = scenarios.get(symbol)

    if not symbol:
        return _trade_gate_result(engine, symbol, action, "block", ["Symbol is required."], ["select symbol"], [], None)
    if not control and action in {"sell", "hold"}:
        return _trade_gate_result(engine, symbol, action, "block", ["No existing position found for this action."], ["sync ledger"], [], scenario)

    reasons: List[str] = []
    required: List[str] = []
    blocked_actions: List[str] = []
    if control:
        reasons.extend(control.get("reasons") or [])
        required.extend(control.get("requiredBeforeAction") or [])
        blocked_actions.extend(control.get("blockedActions") or [])

    market_regime = engine.get("marketRegime") or {}
    allocation = market_regime.get("allocation") or {}
    for allocation_action in allocation.get("actions") or []:
        action_type = str(allocation_action.get("type") or "")
        if not _allocation_action_applies_to_trade(action_type, symbol, action):
            continue
        blocked_actions.append(action_type)
        reasons.append(
            "Market allocation engine: "
            + " ".join(str(part) for part in [allocation_action.get("title"), allocation_action.get("reason")] if part)
        )
        required.append("resolve market allocation constraint before order")
    for item in allocation.get("doNotDo") or []:
        if action in {"buy", "add"}:
            reasons.append(f"Market allocation engine do-not-do: {item}")

    status = "allow"
    if action in {"buy", "add"}:
        hard_blocks = {
            "buy/add",
            "market buy",
            "impulse trade",
            "immediate re-entry",
            "act on rumor",
            "add before thesis review",
        }
        if hard_blocks.intersection(set(blocked_actions)):
            status = "block"
        if scenario and (scenario.get("baseCase") or {}).get("action") in {"wait_for_confirmation", "review_before_hold_or_add", "write_plan_before_trade"}:
            status = "block"
            required.extend((scenario.get("baseCase") or {}).get("requiredEvidence") or [])
            reasons.extend((scenario.get("baseCase") or {}).get("rationale") or [])
    elif action == "sell":
        if thesis_evidence.get("status") == "under_pressure":
            status = "review"
            if scenario:
                required.extend((scenario.get("bearCase") or {}).get("requiredEvidence") or [])
                reasons.extend((scenario.get("bearCase") or {}).get("rationale") or [])
        elif control and control.get("severity") == "block":
            status = "review"
    elif action == "hold":
        status = "review" if thesis_evidence.get("status") in {"under_pressure", "needs_confirmation"} else "allow"

    if not reasons:
        reasons.append("No active block from the server-side investment gate.")
    if not required:
        required.append("confirm size, price, thesis, and invalidation before order")
    return _trade_gate_result(engine, symbol, action, status, reasons, required, blocked_actions, scenario)


def _allocation_action_applies_to_trade(action_type: str, symbol: str, action: str) -> bool:
    if action not in {"buy", "add"}:
        return False
    leverage_symbols = {"QLD", "TQQQ", "SOXL", "UPRO", "TECL", "FNGU"}
    volatile_symbols = {"IREN", "CRCL", "ETH", "ETH-USD", "BTC", "BTC-USD", "MARA", "RIOT"}
    if action_type == "cap_leverage":
        return symbol in leverage_symbols
    if action_type == "trim_event_risk":
        return symbol in volatile_symbols
    if action_type == "raise_cash":
        return True
    return False


def parse_trade_intent_from_text(investment: Dict[str, Any], text: Any) -> Dict[str, Any] | None:
    raw = str(text or "").strip()
    if not raw:
        return None
    lower = raw.lower()
    if not _looks_like_trade_intent(lower):
        return None

    action = _parse_trade_action(lower)
    if not action:
        return None

    positions = _tradable_positions(investment if isinstance(investment, dict) else {})
    symbols = [_symbol(p) for p in positions if _symbol(p)]
    symbol = _parse_trade_symbol(raw, positions)
    quantity = _parse_quantity(raw)
    price = _parse_price(raw)
    return {
        "source": "chat",
        "rawText": raw,
        "symbol": symbol,
        "action": action,
        "quantity": quantity,
        "price": price,
        "symbolCandidates": symbols[:12],
    }


def evaluate_chat_trade_gate(investment: Dict[str, Any], text: Any, today_value: Any = None) -> Dict[str, Any]:
    intent = parse_trade_intent_from_text(investment, text)
    if not intent:
        return {
            "intentDetected": False,
            "intent": None,
            "gate": None,
            "reply": "",
        }
    gate = evaluate_trade_intent_gate(investment, intent, today_value)
    return {
        "intentDetected": True,
        "intent": intent,
        "gate": gate,
        "reply": render_trade_gate_reply(gate),
    }


def _looks_like_trade_intent(lower: str) -> bool:
    action_words = [
        "매수", "추매", "추가매수", "진입", "살까", "사도", "사자", "담을까", "들어갈까",
        "매도", "팔까", "팔자", "손절", "익절", "축소", "줄일까", "정리할까", "정리하자",
        "보유", "홀딩", "기다릴까", "hold", "buy", "add", "sell", "reduce", "exit",
        "stop loss", "take profit",
    ]
    return any(word in lower for word in action_words)


def _parse_trade_action(lower: str) -> str:
    if any(word in lower for word in ["매수", "추매", "추가매수", "진입", "살까", "사도", "사자", "담을까", "들어갈까"]) or re.search(r"\b(buy|add|entry)\b", lower):
        return "buy"
    if any(word in lower for word in ["매도", "팔까", "팔자", "손절", "익절", "축소", "줄일까", "정리할까", "정리하자"]) or re.search(r"\b(sell|reduce|exit|stop loss|take profit)\b", lower):
        return "sell"
    if any(word in lower for word in ["보유", "홀딩", "기다릴까"]) or re.search(r"\bhold\b", lower):
        return "hold"
    return ""


def _parse_trade_symbol(raw: str, positions: List[Dict[str, Any]]) -> str:
    upper = raw.upper()
    for p in positions:
        symbol = _symbol(p)
        if symbol and re.search(rf"(?<![A-Z0-9]){re.escape(symbol)}(?![A-Z0-9])", upper):
            return symbol
    aliases = {
        "아이렌": "IREN",
        "써클": "CRCL",
        "서클": "CRCL",
        "이더리움": "ETH-USD",
        "나스닥": "QLD",
    }
    available = {_symbol(p) for p in positions}
    for alias, symbol in aliases.items():
        if alias in raw and symbol in available:
            return symbol
    if len(positions) == 1:
        return _symbol(positions[0])
    return ""


def _parse_quantity(raw: str) -> float | None:
    match = re.search(r"([\d,]+(?:\.\d+)?)\s*(?:주|개|shares?|ea)\b", raw, re.IGNORECASE)
    if not match:
        return None
    return _num(match.group(1), 0.0)


def _parse_price(raw: str) -> float | None:
    patterns = [
        r"\$\s*([\d,]+(?:\.\d+)?)",
        r"([\d,]+(?:\.\d+)?)\s*(?:달러|불|usd)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, raw, re.IGNORECASE)
        if match:
            return _num(match.group(1), 0.0)
    return None


def render_trade_gate_reply(gate: Dict[str, Any]) -> str:
    symbol = gate.get("symbol") or "대상 미지정"
    action = gate.get("action") or "trade"
    status = gate.get("status") or "review"
    title = {
        "block": "서버 투자 게이트가 이 행동을 차단했습니다.",
        "review": "서버 투자 게이트가 먼저 검토를 요구합니다.",
        "allow": "서버 투자 게이트 기준으로 즉시 차단은 없습니다.",
    }.get(status, "서버 투자 게이트 검토 결과입니다.")
    lines = [
        title,
        "",
        f"- 대상: {symbol}",
        f"- 행동: {action}",
        f"- 판정: {status}",
    ]
    blocked = gate.get("blockedActions") or []
    if blocked:
        lines.extend(["", "금지/주의 행동:"])
        lines.extend(f"- {item}" for item in blocked[:5])
    reasons = gate.get("reasons") or []
    if reasons:
        lines.extend(["", "이유:"])
        lines.extend(f"- {item}" for item in reasons[:5])
    required = gate.get("requiredEvidence") or []
    if required:
        lines.extend(["", "먼저 확인할 것:"])
        lines.extend(f"- {item}" for item in required[:5])
    if status == "block":
        lines.extend(["", "이 상태에서는 AI 답변보다 원장 기준 행동 통제가 우선입니다. 공식 자료와 시나리오를 확인한 뒤 다시 판단하세요."])
    elif status == "review":
        lines.extend(["", "주문으로 넘기기 전에 왜 예외인지, 어느 조건이면 틀렸다고 볼지 먼저 적어야 합니다."])
    else:
        lines.extend(["", "그래도 수량, 가격, 무효화 조건을 적기 전에는 실제 주문으로 넘기지 않습니다."])
    return "\n".join(lines)


def _trade_gate_result(engine: Dict[str, Any], symbol: str, action: str, status: str, reasons: List[str], required: List[str], blocked_actions: List[str], scenario: Dict[str, Any] | None) -> Dict[str, Any]:
    return {
        "symbol": symbol,
        "action": action,
        "status": status,
        "label": {
            "block": "blocked",
            "review": "review required",
            "allow": "allowed with plan",
        }.get(status, status),
        "canCreateOrderIntent": status in {"allow", "review"},
        "reasons": list(dict.fromkeys([str(item) for item in reasons if item])),
        "requiredEvidence": list(dict.fromkeys([str(item) for item in required if item])),
        "blockedActions": sorted(set(str(item) for item in blocked_actions if item)),
        "scenario": scenario or {},
        "engineVersion": engine.get("version"),
        "engineDate": engine.get("date"),
    }


def render_engine_brief(engine: Dict[str, Any]) -> str:
    view = engine.get("marketView") or {}
    controls = engine.get("behaviorControls") or []
    theses = engine.get("theses") or []
    scenarios = engine.get("scenarios") or []
    blocked = [c for c in controls if c.get("blockedActions")]
    lines = [
        f"Top line: {view.get('topLine') or 'No view generated.'}",
        "Key issues:",
    ]
    for issue in (view.get("keyIssues") or [])[:3]:
        lines.append(
            f"- {issue.get('symbol')}: {issue.get('view')} "
            f"({issue.get('controlState')}, thesis={issue.get('thesisStatus')}, pressure={issue.get('pressureScore')})"
        )
    lines.append("Do not do:")
    for item in (view.get("doNotDo") or [])[:5]:
        lines.append(f"- {item}")
    if not blocked:
        lines.append("- No blocked action, but every order still needs size/invalidation/event check.")
    lines.append("Thesis drivers:")
    for thesis in theses[:4]:
        lines.append(f"- {thesis.get('symbol')}: {', '.join((thesis.get('drivers') or [])[:4])}")
    lines.append("Scenarios:")
    for scenario in scenarios[:3]:
        lines.append(
            f"- {scenario.get('symbol')}: bull={scenario.get('bullCase', {}).get('action')} / "
            f"base={scenario.get('baseCase', {}).get('action')} / "
            f"bear={scenario.get('bearCase', {}).get('action')}"
        )
    return "\n".join(lines)
